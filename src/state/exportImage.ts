import type { Item } from './types'
import { getBlob } from '../store/idb'
import { getEngine } from '../engine/client'
import { coverUv } from '../engine/gl'
import { adjustCSS, hasEffect } from '../board/adjust'
import { GRAIN_SVG, GRAIN_TILE } from '../board/grain'
import { safeName } from '../store/fs'
import { hasPixels } from './kinds'

/* ---------------------------------------------------------------------------
 * A card, as a picture you can hand to someone.
 *
 * The board could put thirty-one shaders on a photograph and there was no way
 * to get the result out of it. Everything the engine draws is sized for the
 * screen; this is the one path that is not. It decodes the original file at
 * its own resolution rather than the capped copy the board keeps on the GPU,
 * renders the effect at the size of the part of the picture the card is
 * showing, and then puts back everything the card does after the shader.
 *
 * That last part is the difficulty. What you see on a card is a shader render,
 * then a CSS filter for the tone, then a transform for the framing, then a
 * grain overlay. Exporting the shader alone would hand back something that is
 * not what you were looking at, so the compose here follows the same order
 * through a canvas filter, a canvas transform and the same noise.
 * ------------------------------------------------------------------------- */

export interface ExportedImage {
  blob: Blob
  name: string
  w: number
  h: number
}

/* Past this the file is enormous and the detail is invented. */
const MAX_EDGE = 4096

const baseName = (item: Item) => safeName((item.name || 'card').replace(/\.[a-z0-9]{1,5}$/i, '')) || 'card'

/* The seed the card renders with, so an export is the picture on screen rather
 * than a fresh roll of the same dice. Matches Card's own hash. */
function seedFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % 997
}

/* The part of the picture the card is showing, at the picture's own
 * resolution. A card cropped to a narrow slice of a wide photograph exports
 * the pixels of that slice rather than a stretched copy of the whole. */
export function exportSize(sw: number, sh: number, cardW: number, cardH: number) {
  if (!(sw > 0 && sh > 0)) return { w: 2, h: 2 }
  const aspect = cardW > 0 && cardH > 0 ? cardW / cardH : sw / sh
  let w: number
  let h: number
  if (sw / sh > aspect) {
    h = sh
    w = sh * aspect
  } else {
    w = sw
    h = sw / aspect
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  return { w: Math.max(2, Math.round(w * scale)), h: Math.max(2, Math.round(h * scale)) }
}

/* The picture behind a card, at full size rather than at the size the board
 * keeps resident. */
async function sourceFor(item: Item): Promise<ImageBitmap | null> {
  try {
    if (item.kind === 'video') {
      /* Whatever frame is on screen: exporting a video card exports the moment
       * you are looking at. A host that will not let its pixels be read throws
       * here, which is the same reason its card cannot take a shader. */
      const el = document.querySelector(`.card[data-id="${item.id}"] video`) as HTMLVideoElement | null
      if (!el || !el.videoWidth) return null
      return await createImageBitmap(el)
    }
    if (!item.media) return null
    const blob = await getBlob(item.media)
    if (!blob) return null
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

/* The crop the renderer applies, for the path with no shader in it. */
function cropToCard(src: ImageBitmap, w: number, h: number): HTMLCanvasElement | null {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const cx = cv.getContext('2d')
  if (!cx) return null
  const c = coverUv(src.width, src.height, w, h)
  cx.drawImage(src, c.ox * src.width, c.oy * src.height, c.sx * src.width, c.sy * src.height, 0, 0, w, h)
  return cv
}

let grainImage: HTMLImageElement | null = null
async function grain(): Promise<HTMLImageElement | null> {
  if (grainImage) return grainImage
  try {
    const img = new Image()
    img.src = GRAIN_SVG
    await img.decode()
    grainImage = img
    return img
  } catch {
    return null
  }
}

/* Everything the card does after the shader, in the order it does it. */
async function compose(
  picture: ImageBitmap | HTMLCanvasElement,
  item: Item,
  w: number,
  h: number
): Promise<HTMLCanvasElement | null> {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const cx = cv.getContext('2d')
  if (!cx) return null

  const fx = item.fx
  /* Canvas has taken the same filter syntax as CSS since Chrome 52 and Safari
   * 16.4. Where it has not, the export loses the tone rather than failing. */
  const filter = adjustCSS(fx)
  if (filter) cx.filter = filter

  /* The same order frameCSS writes: scale, translate, rotate, flip, about the
   * middle, which is where a CSS transform-origin sits by default. */
  cx.save()
  cx.translate(w / 2, h / 2)
  if (fx.zoom !== 1) cx.scale(fx.zoom, fx.zoom)
  if (fx.ox || fx.oy) cx.translate((fx.ox / 100) * w, (fx.oy / 100) * h)
  if (fx.rot) cx.rotate((fx.rot * Math.PI) / 180)
  if (fx.fh || fx.fv) cx.scale(fx.fh ? -1 : 1, fx.fv ? -1 : 1)
  cx.drawImage(picture as CanvasImageSource, -w / 2, -h / 2, w, h)
  cx.restore()
  cx.filter = 'none'

  if (fx.grain > 0) {
    const noise = await grain()
    if (noise) {
      const pattern = cx.createPattern(noise, 'repeat')
      if (pattern) {
        cx.save()
        /* The card blends its noise in overlay at the same opacity. */
        cx.globalCompositeOperation = 'overlay'
        cx.globalAlpha = Math.min(1, fx.grain / 100)
        cx.fillStyle = pattern
        cx.fillRect(0, 0, w, h)
        cx.restore()
      }
    }
  }
  void GRAIN_TILE
  return cv
}

/* One card as a PNG, or null when there is nothing to export: a card with no
 * picture behind it, or a video whose host will not let its pixels be read. */
export async function exportCard(item: Item): Promise<ExportedImage | null> {
  if (!hasPixels(item)) return null
  const src = await sourceFor(item)
  if (!src) return null

  /* The card is the picture now: nothing is reserved above it. */
  const size = exportSize(src.width, src.height, item.w, item.h)

  let picture: ImageBitmap | HTMLCanvasElement | null = null
  if (hasEffect(item.fx) && item.readable !== false) {
    /* renderOnce takes ownership of the source and closes it. */
    picture = await getEngine().renderOnce(src, {
      effectId: item.fx.fxid,
      params: item.fx.ep,
      seed: seedFor(item.id),
      width: size.w,
      height: size.h,
    })
    if (!picture) return null
  } else {
    picture = cropToCard(src, size.w, size.h)
    src.close()
    if (!picture) return null
  }

  const cv = await compose(picture, item, size.w, size.h)
  if ('close' in picture) picture.close()
  if (!cv) return null

  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'))
  if (!blob) return null
  return { blob, name: `${baseName(item)}.png`, w: size.w, h: size.h }
}

/* Several cards, named apart where two of them share a name. */
export async function exportCards(items: Item[]): Promise<ExportedImage[]> {
  const out: ExportedImage[] = []
  const used = new Set<string>()
  for (const item of items) {
    const made = await exportCard(item)
    if (!made) continue
    let name = made.name
    let n = 2
    while (used.has(name)) name = made.name.replace(/\.png$/, `-${n++}.png`)
    used.add(name)
    out.push({ ...made, name })
  }
  return out
}
