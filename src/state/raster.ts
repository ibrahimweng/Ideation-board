import { outsetOf, svgFor } from './shapes'
import type { Item } from './types'
import { newKey } from '../store/media'
import { putBlob } from '../store/idb'
import { ensureSource } from '../board/sources'
import { store } from './store'

/* ---------------------------------------------------------------------------
 * Baking a drawing into pixels.
 *
 * A shape has none. That is what makes it a shape — a handful of numbers drawn
 * afresh at whatever size it is being looked at, exact at four per cent and at
 * four hundred. It is also what makes it useless to the seventy shaders on the
 * other side of this file, every one of which wants an image to read.
 *
 * So: draw it once, twice as big as the card, and keep the picture beside the
 * drawing the way a document keeps its page. The numbers stay on the record,
 * which is what makes this a door rather than a cliff — taking the picture off
 * gives the drawing back, and it is the drawing that was there.
 * ------------------------------------------------------------------------- */

/* Twice the card, so it holds up when it is scaled up a little afterwards,
 * and never past this many pixels on a side: a shape dragged out across a
 * whole board is a picture nobody wants sixteen megabytes of. */
const OVER = 2
const CAP = 2048

/* The ink the board is being looked at in.
 *
 * A picture has no theme to follow once it is pixels, so a drawing baked on a
 * dark board is baked in the ink it was drawn in. That is the honest answer:
 * you baked it while you were looking at it, so it bakes as it looked. */
export const inkNow = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#18181b'

/* A piece of SVG markup as something a canvas will draw.
 *
 * Shared, because three things want it: baking a drawing into a card's own
 * picture, drawing one into the board's poster, and the export. */
export function svgImage(markup: string): Promise<HTMLImageElement> {
  const img = new Image()
  return new Promise((done, fail) => {
    img.onload = () => done(img)
    img.onerror = () => fail(new Error('the drawing would not render'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })
}

/* The picture, as a blob. */
export async function bake(it: Item): Promise<Blob | null> {
  if (!it.shape) return null
  const pad = outsetOf(it.shape)
  const bw = it.w + pad * 2
  const bh = it.h + pad * 2
  const over = Math.min(OVER, CAP / Math.max(bw, bh))
  const img = await svgImage(svgFor(it.shape, it.w, it.h, pad, inkNow()))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bw * over))
  canvas.height = Math.max(1, Math.round(bh * over))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
}

/* Bake it and hang the picture on the card.
 *
 * The card grows by the outset, because a stroke straddles the line it is on
 * and an arrowhead reaches further still: baking the box alone would give a
 * circle with four flat sides. Growing it puts the drawing on the board in
 * exactly the place it already was. */
export async function rasterise(ids: string[]): Promise<number> {
  let done = 0
  for (const id of ids) {
    const it = store.getItem(id)
    if (!it || it.kind !== 'shape' || !it.shape || it.poster) continue
    const blob = await bake(it)
    if (!blob) continue
    const key = newKey('bake')
    await putBlob(key, blob)
    void ensureSource(key, blob)
    const pad = outsetOf(it.shape)
    store.update(id, {
      x: Math.round(it.x - pad),
      y: Math.round(it.y - pad),
      w: Math.round(it.w + pad * 2),
      h: Math.round(it.h + pad * 2),
      poster: key,
      nw: Math.round(it.w + pad * 2),
      nh: Math.round(it.h + pad * 2),
    })
    done++
  }
  return done
}

/* And back. The numbers never went anywhere, so this is not an undo — it is
 * the card pointing at what it always was. */
export function unrasterise(ids: string[]) {
  for (const id of ids) {
    const it = store.getItem(id)
    if (!it || it.kind !== 'shape' || !it.shape || !it.poster) continue
    const pad = outsetOf(it.shape)
    store.update(id, {
      x: Math.round(it.x + pad),
      y: Math.round(it.y + pad),
      w: Math.max(1, Math.round(it.w - pad * 2)),
      h: Math.max(1, Math.round(it.h - pad * 2)),
      poster: undefined,
      nw: undefined,
      nh: undefined,
    })
  }
}
