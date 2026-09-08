import { store } from './store'
import { getBlob, putBlob } from '../store/idb'
import { ensureSource } from '../board/sources'
import { decodeCapped, newKey } from '../store/media'
import { STAGE_0, renderModel } from '../store/model'
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
export async function skinsOn(it: Item): Promise<Map<string, ImageBitmap> | undefined> {
  const want = it.skins
  if (!want) return undefined
  const out = new Map<string, ImageBitmap>()
  for (const [name, key] of Object.entries(want)) {
    if (!key) continue
    const blob = await getBlob(key)
    if (!blob) continue
    const bmp = await decodeCapped(blob)
    if (bmp) out.set(name, bmp)
  }
  return out.size ? out : undefined
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
    for (const bmp of skins?.values() || []) bmp.close()
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

/* Hands a picture to one of the model's materials, or takes it off again. One
 * step of undo, because it is one decision. */
export async function wearSkin(id: string, material: string, mediaKey: string | null): Promise<boolean> {
  const it = store.getItem(id)
  if (!isStaged(it)) return false
  const next: Record<string, string> = { ...(it.skins || {}) }
  if (mediaKey) next[material] = mediaKey
  else delete next[material]
  store.beginGesture(0)
  store.update(id, { skins: Object.keys(next).length ? next : undefined }, false)
  return turnTo(id, stageOf(store.getItem(id)))
}
