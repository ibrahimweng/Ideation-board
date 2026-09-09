import { store } from './store'
import { getBlob, putBlob } from '../store/idb'
import { ensureSource } from '../board/sources'
import { decodeCapped, newKey } from '../store/media'
import { STAGE_0, renderModel, textureOf } from '../store/model'
import { exportSize, renderCardPicture } from './exportImage'
import { getEngine } from '../engine/client'
import { hasEffect } from '../board/adjust'
import { feederCard, refreshFeeds } from './feeds'
import { SLOT_BY_ID, dressOf, withSkin, withoutSkin } from './skins'
import type { Stage } from '../store/model'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * Turning a model.
 *
 * A model card is a picture of a model taken from somewhere, so turning it is
 * not a transform on the card: it is a new picture. That makes this the same
 * job as turning to another page of a PDF — render, save, point the card at it
 * — and it is written the same way and in the same place, for the same reason:
 * it writes to storage and it must not be started twelve times at once.
 *
 * ## Trailing rather than queued
 *
 * A drag asks for a new angle every few milliseconds and a render takes longer
 * than that, so a queue would fall behind the hand and go on turning after it
 * stopped. Instead the last angle asked for is kept and everything before it
 * is dropped, which means the picture lands wherever the hand actually is and
 * the model always comes to rest showing what was asked for last.
 *
 * ## The old views are let go
 *
 * Each render is saved under a new address and the one before it is simply
 * abandoned — a file nothing points at, which is exactly what the sweep in
 * `store/reclaim.ts` collects. Page turning already works this way; a turn of
 * a model is the same transaction.
 * ------------------------------------------------------------------------- */

/* Ninety degrees is straight down, and a camera that goes over the top rolls
 * the picture upside down on the way — so it stops just short of it, at both
 * ends. */
export const PITCH = 85
/* One is the model exactly filling the frame, so under one is inside it — a
 * detail, a corner, the join between two parts — and three is the whole thing
 * small in the middle of the card, which is what a model wants when the card
 * is one of twelve. */
export const DIST = { min: 0.5, max: 3 }

export const isStaged = (i?: Item | null): i is Item => !!i && i.kind === 'model' && !!i.media

/* What a card is showing, with every number present — a board saved before
 * this existed has a model card with no stage on it at all. */
export const stageOf = (i?: Item | null): Stage => ({ ...STAGE_0, ...(i?.stage || {}) })

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/* Round, and it comes back to where it started. Kept inside half a turn either
 * way so the number in the panel is one a person can read. */
export const wrapYaw = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180

export const turned = (s: Stage, dyaw: number, dpitch: number): Stage => ({
  ...s,
  yaw: wrapYaw(s.yaw + dyaw),
  pitch: clamp(s.pitch + dpitch, -PITCH, PITCH),
})

export const dollied = (s: Stage, by: number): Stage => ({
  ...s,
  dist: clamp(s.dist * by, DIST.min, DIST.max),
})

export const sameStage = (a: Stage, b: Stage) =>
  Math.abs(a.yaw - b.yaw) < 0.01 && Math.abs(a.pitch - b.pitch) < 0.01 && Math.abs(a.dist - b.dist) < 0.001

/* ---------------------------------------------------------------------------
 * Rendering it again.
 * ------------------------------------------------------------------------- */

/* Cards with a render in flight, and the angle each one should land on. */
const busy = new Set<string>()
const wanted = new Map<string, Stage>()

export const turningModel = (id: string) => busy.has(id)

/* The pictures a model is wearing, decoded. A card handed to a material is
 * held by its media address, not by its id: the address is what survives the
 * card being deleted, and it is what the renderer needs anyway. */
export async function skinsOn(it: Item): Promise<Map<string, Map<string, ImageBitmap>> | undefined> {
  const want = dressOf(it)
  const out = new Map<string, Map<string, ImageBitmap>>()
  for (const [name, slots] of Object.entries(want)) {
    for (const [slot, key] of Object.entries(slots)) {
      if (!key) continue
      const blob = await getBlob(key)
      if (!blob) continue
      const bmp = await decodeCapped(blob)
      if (!bmp) continue
      const mine = out.get(name) || new Map<string, ImageBitmap>()
      mine.set(slot, bmp)
      out.set(name, mine)
    }
  }
  return out.size ? out : undefined
}

/* Every bitmap in one, for the callers that only have to close them. */
export function eachSkin(worn: Map<string, Map<string, ImageBitmap>> | undefined): ImageBitmap[] {
  const out: ImageBitmap[] = []
  for (const slots of worn?.values() || []) for (const bmp of slots.values()) out.push(bmp)
  return out
}

/* Renders whatever the card is currently asking for, until it stops asking.
 * Returns whether anything was drawn. */
async function drain(id: string): Promise<boolean> {
  let drew = false
  while (wanted.has(id)) {
    const stage = wanted.get(id)!
    wanted.delete(id)
    const it = store.getItem(id)
    if (!isStaged(it)) break
    const file = await getBlob(it.media!)
    if (!file) break
    const skins = await skinsOn(it)
    const shot = await renderModel(it.media!, file, stage, { skins })
    for (const bmp of eachSkin(skins)) bmp.close()
    if (!shot) break

    const key = newKey('pv')
    await putBlob(key, shot.blob)
    await ensureSource(key, shot.blob)

    /* Written with recording off and without touching the card's size. The
     * step of undo belongs to the gesture that asked for the turn, which
     * opened one before the first of these was ever started; a card that
     * resized itself as it turned would walk around the board. */
    const still = store.getItem(id)
    if (!isStaged(still)) break
    store.update(id, { poster: key, stage, parts: shot.parts }, false)
    drew = true
  }
  return drew
}

/* Turns a model card to an angle. Safe to call as fast as a pointer moves. */
export async function turnTo(id: string, stage: Stage): Promise<boolean> {
  const it = store.getItem(id)
  if (!isStaged(it)) return false
  const want: Stage = {
    yaw: wrapYaw(stage.yaw),
    pitch: clamp(stage.pitch, -PITCH, PITCH),
    dist: clamp(stage.dist, DIST.min, DIST.max),
  }
  /* The numbers go on the card at once, so the panel and the label follow the
   * hand rather than the renderer. */
  store.update(id, { stage: want }, false)
  wanted.set(id, want)
  if (busy.has(id)) return false
  busy.add(id)
  try {
    return await drain(id)
  } catch {
    return false
  } finally {
    busy.delete(id)
    wanted.delete(id)
  }
}

/* ---------------------------------------------------------------------------
 * Handing a card to a material.
 *
 * What goes on the model is the card as it looks, not the file behind it.
 *
 * That distinction is the whole feature. A card on this board is a photograph
 * plus everything that has been done to it — an effect, a tone, a crop — and
 * the point of putting one on a material is to see that treatment on the
 * thing, not to see the original photograph again. Handing over the file's
 * address was quick and quietly wrong: halftone a scan, hand it to a material,
 * and the model came back wearing the scan.
 *
 * So the card is rendered exactly the way exporting it as a picture renders
 * it — same path, same order, effect then tone then crop — and the result is
 * what the material wears.
 *
 * ## A picture taken at the moment you press it
 *
 * The skin is a render, so it is a moment rather than a link: change the card
 * afterwards and the model goes on wearing what it was given. That is why the
 * button stays there once something is worn — pressing it again takes a fresh
 * picture — and it is the honest arrangement, because a live link would mean
 * every slider on a wired card re-rendering a model somewhere else on the
 * board.
 * ------------------------------------------------------------------------- */

/* Plenty for a material on a model rendered at 1024, and small enough that a
 * board of dressed models is not a board of ten-megabyte textures. */
const SKIN = 2048

/* WebP at this quality is indistinguishable from the PNG on a texture and
 * about a tenth of the size, which on a browser that holds all your work in a
 * storage quota is the difference that matters. */
const SKIN_TYPE = 'image/webp'
const SKIN_Q = 0.92

async function bake(from: Item): Promise<Blob | null> {
  /* The picture's own dimensions, cropped to the shape the card is showing it
   * in, then capped. `nw`/`nh` describe the picture; `w`/`h` the card. */
  const at = exportSize(from.nw || from.w, from.nh || from.h, from.w, from.h)
  const k = Math.min(1, SKIN / Math.max(at.w, at.h))
  const cv = await renderCardPicture(from, Math.max(2, Math.round(at.w * k)), Math.max(2, Math.round(at.h * k)))
  if (!cv) return null
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, SKIN_TYPE, SKIN_Q))
  /* A browser that will not write WebP still gets a texture. */
  return blob || (await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png')))
}

/* Puts the card wired into this model onto one of its materials. Returns the
 * reason it could not, or null if it did. */
export async function wearSkin(id: string, material: string, slot = 'colour'): Promise<string | null> {
  const it = store.getItem(id)
  if (!isStaged(it)) return 'that card is not a model'
  if (!SLOT_BY_ID[slot]) return `a material has nothing called ${slot}`
  refreshFeeds()
  const fromId = feederCard(id)
  const from = fromId ? store.getItem(fromId) : null
  if (!from) return 'wire a card into this one first'

  const blob = await bake(from)
  if (!blob) return 'that card could not be rendered'
  const key = newKey('skn')
  await putBlob(key, blob)

  const still = store.getItem(id)
  if (!isStaged(still)) return null
  store.beginGesture(0)
  store.update(id, { skins: withSkin(still, material, slot, key) }, false)
  await turnTo(id, stageOf(store.getItem(id)))
  return null
}

/* ---------------------------------------------------------------------------
 * Treating the texture a model came with.
 *
 * Wearing puts another card on a material. This is the other half of the same
 * sentence and the half that was missing: a model that arrives with a colour
 * map on it has a picture inside it, and until now the only thing that could
 * be done to that picture was to throw it away and put a different one there.
 *
 * The treatment is the one the card is already set to. That is deliberate and
 * it is what keeps this to a single button: you choose the effect in the
 * Effect tab and tune its sliders watching the whole view, exactly as on any
 * other card, and then say "that, on this material". No second effect picker,
 * no second set of sliders, and the thing you were looking at while you tuned
 * it is the thing that gets baked.
 *
 * Afterwards the card's own effect is usually worth setting back to Original,
 * so that what you see is a model with one treated material rather than a
 * treated picture of a model with one treated material. The panel says so.
 * ------------------------------------------------------------------------- */

export async function treatSkin(id: string, material: string, slot = 'colour'): Promise<string | null> {
  const it = store.getItem(id)
  if (!isStaged(it)) return 'that card is not a model'
  const which = SLOT_BY_ID[slot]
  /* Relief is a thing you put on rather than a thing a file arrives with —
   * glTF carries directions, not heights — so there is nothing of its own to
   * treat and the panel does not offer it. */
  if (!which?.reads) return `a material carries no ${slot} of its own to treat`
  if (!hasEffect(it.fx)) return 'choose an effect first, then put it on a material'

  const file = await getBlob(it.media!)
  if (!file) return 'that model could not be read'
  const src = await textureOf(it.media!, file, material, slot)
  if (!src) return `${material} has no ${which.name.toLowerCase()} of its own to treat`

  /* The bitmap belongs to the parsed model, so the engine is handed a copy:
   * renderOnce closes what it is given, and closing this one would take the
   * texture off the model for the rest of the session. */
  const mine = await createImageBitmap(src)
  const out = await getEngine().renderOnce(mine, {
    effectId: it.fx.fxid,
    params: it.fx.ep,
    stack: it.fx.more?.length ? it.fx.more.map((l) => ({ effectId: l.fxid, params: l.ep, n: l.n })) : undefined,
    n: it.fx.n,
    seed: 11,
    /* Square and generous. A texture is not a card and has no aspect to
     * preserve; what it has is UVs, and stretching it would move the picture
     * about on the model. */
    width: Math.min(SKIN, src.width),
    height: Math.min(SKIN, src.height),
  })
  if (!out) return 'that effect could not be run on the texture'

  const canvas = document.createElement('canvas')
  canvas.width = out.width
  canvas.height = out.height
  canvas.getContext('2d')?.drawImage(out, 0, 0)
  out.close()
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, SKIN_TYPE, SKIN_Q))
  if (!blob) return 'that texture could not be saved'

  const key = newKey('skn')
  await putBlob(key, blob)
  const still = store.getItem(id)
  if (!isStaged(still)) return null
  store.beginGesture(0)
  store.update(id, { skins: withSkin(still, material, slot, key) }, false)
  await turnTo(id, stageOf(store.getItem(id)))
  return null
}

/* And takes it off again. One step of undo, because it is one decision. */
export async function takeOffSkin(id: string, material: string, slot = 'colour'): Promise<boolean> {
  const it = store.getItem(id)
  if (!isStaged(it)) return false
  const next = withoutSkin(it, material, slot)
  if (next === undefined && dressOf(it)[material]?.[slot] === undefined) return false
  store.beginGesture(0)
  store.update(id, { skins: next }, false)
  await turnTo(id, stageOf(store.getItem(id)))
  return true
}
