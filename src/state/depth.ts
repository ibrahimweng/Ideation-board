import { store } from './store'
import { getBlob, putBlob } from '../store/idb'
import { ensureSource, markReady } from '../board/sources'
import { decodeCapped, newKey } from '../store/media'
import { getEngine } from '../engine/client'
import { hasPixels, pixelKey } from './kinds'
import { FX_0 } from '../engine/types'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * A depth map as a card.
 *
 * The board could already push one picture around with another: Displace has
 * read the wired card's brightness since the day wires meant anything. What it
 * had no way of making was the picture worth pushing things around with — so
 * every use of it was a texture scan or a gradient somebody drew, and the one
 * map a photograph is actually about, how far away everything in it is, could
 * only come from somewhere else.
 *
 * ## Why a card rather than a buffer
 *
 * The obvious build is a hidden depth buffer hanging off the picture. This is
 * a card instead, and that decision is most of the feature:
 *
 *   - it can be looked at, which is the only way to know whether the guess is
 *     any good before spending an hour on top of it;
 *   - it takes every effect on the list, so a map that reads a window as near
 *     is corrected with Levels and a Brush, not with a slider somebody has to
 *     write first;
 *   - it can be drawn from nothing as a sketch, or brought in from a renderer
 *     that exported a real one;
 *   - it wires into anything, so one map can drive four pictures;
 *   - and it exports, varies twelve ways, and comes back after a reload,
 *     because everything that works on a picture already works on it.
 *
 * A hidden buffer would have needed every one of those written again.
 *
 * ## Wired straight in
 *
 * The map is wired into the picture it was made from, because that is what
 * anybody making one is about to do by hand. Where two wires arrive at one
 * card the newest wins, which is the board's own rule for changing your mind —
 * so this replaces a pairing that was already there, and says so.
 * ------------------------------------------------------------------------- */

/* Big enough to push pixels around with and small enough to keep twelve of.
 * A depth map is a smooth field: at half the size of a photograph it loses
 * nothing anybody can see once it is driving a displacement. */
const CAP = 1280
const TYPE = 'image/png'

/* The settings the button uses. The effect itself is on the list with all of
 * these on sliders — this is only what it starts at, chosen by making maps of
 * real photographs and looking at them. */
export const DEPTH_0 = { p0: 24, p1: 0.6, p2: 0.5, p3: 0.3, p4: 0.35, p5: 0 }

/* And a soft pass over the top. Depth is piecewise smooth — a surface, not a
 * texture — and the cues underneath are measured per pixel, so without this
 * the map carries the grain of the photograph and Displace turns that grain
 * into noise. */
const SMOOTH = { effectId: 'gaussian', params: { p0: 9, p1: 1 } }

export const canDepth = (i?: Item | null): i is Item => hasPixels(i) && !!pixelKey(i)

/* Where the map goes: beside the picture it came from, at the same height, far
 * enough clear that the wire between them is a line rather than a join. */
const beside = (it: Item) => ({ x: Math.round(it.x + it.w + 32), y: Math.round(it.y) })

const nameFor = (it: Item) => `${(it.name || 'Picture').replace(/\.[a-z0-9]{1,5}$/i, '')} — depth`

/* Makes a depth map of one card and puts it on the board. Returns the reason
 * it could not, or null if it did. */
export async function makeDepth(id: string): Promise<string | null> {
  const it = store.getItem(id)
  if (!canDepth(it)) return 'only a picture has a depth map'
  const key = pixelKey(it)!
  const file = await getBlob(key)
  if (!file) return 'that picture could not be read'
  const src = await decodeCapped(file)
  if (!src) return 'that picture could not be read'

  const w = Math.max(2, Math.min(CAP, src.width))
  const h = Math.max(2, Math.round((w / src.width) * src.height))
  const out = await getEngine().renderOnce(src, {
    effectId: 'depthfrom',
    params: DEPTH_0,
    stack: [SMOOTH],
    seed: 7,
    width: w,
    height: h,
  })
  if (!out) return 'a depth map could not be made from that'

  const canvas = document.createElement('canvas')
  canvas.width = out.width
  canvas.height = out.height
  canvas.getContext('2d')?.drawImage(out, 0, 0)
  out.close()
  /* PNG rather than WebP. This is a picture that will be read as numbers
   * rather than looked at, and a lossy encoder puts ringing round every edge —
   * which comes back as a halo when something is displaced by it. */
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, TYPE))
  if (!blob) return 'that depth map could not be saved'

  const media = newKey('dep')
  await putBlob(media, blob)
  const bmp = await decodeCapped(blob)
  if (bmp) {
    getEngine().putSource(media, bmp)
    markReady(media)
  } else {
    void ensureSource(media, blob)
  }

  const still = store.getItem(id)
  if (!still) return null
  const at = beside(still)
  const made: Item = {
    id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: 'image',
    x: at.x,
    y: at.y,
    z: 0,
    w: Math.round(still.w),
    h: Math.round(still.h),
    name: nameFor(still),
    media,
    mime: TYPE,
    nw: canvas.width,
    nh: canvas.height,
    readable: true,
    fx: { ...FX_0 },
    tag: null,
  }
  /* One press of undo for the card, the wire and the selection: this is one
   * decision however many records it takes. */
  store.beginGesture(0)
  store.add(made)
  store.connect(made.id, id)
  store.select([made.id])
  return null
}
