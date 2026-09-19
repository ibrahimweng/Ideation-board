/* ---------------------------------------------------------------------------
 * Scaling a selection as one thing.
 *
 * Every selected card used to draw its own four handles, and every handle
 * resized the one card it belonged to. Select three photographs and you got
 * three boxes and no way to make the three of them bigger together — the one
 * gesture anybody selects three photographs in order to do.
 *
 * So a selection of more than one draws a single box around the lot, and a
 * corner of that box scales everything inside it about the opposite corner:
 * each card's size and its distance from that corner go up by the same factor,
 * which is what keeps an arrangement an arrangement rather than a pile.
 *
 * ## Shift locks the shape
 *
 * A corner drag scales width and height independently, so a card can be made
 * wider without being made taller. Holding shift ties them to one factor, and
 * whatever is being scaled comes out the shape it went in — one card or forty.
 *
 * That is the key every drawing program has used for this since the eighties,
 * which is the whole argument for it: the hand already knows. It is also the
 * one rule for both cases, so scaling four photographs is the same gesture as
 * scaling one and not a second thing to learn.
 *
 * ## Everything in here is arithmetic
 *
 * No store, no DOM, no pointer. The board hands it boxes and a delta and gets
 * boxes back, which is what lets the awkward parts — the anchor for each
 * corner, the floor, what proportional means when the drag is diagonal — be
 * checked without a browser.
 * ------------------------------------------------------------------------- */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/* How small the smallest side of anything is allowed to get.
 *
 * Not the eighty-by-sixty a single card stops at: that is a floor for a card
 * you are resizing on its own, and a group holds cards that are already under
 * it — a label is fifty-six tall the day it is made — so applying it here
 * would mean a selection with a label in it could not be shrunk at all. Twelve
 * pixels is the point at which a card stops being a thing you can see and get
 * hold of again. */
export const FLOOR = 12

/* And where a single card stops. Wider than the floor above, because one card
 * being resized is a box you are fitting to something rather than one of forty
 * being scaled together: it should not be possible to lose it by accident. */
export const MIN_W = 80
export const MIN_H = 60

/* The box that holds all of them. Null for nothing, which is the one case the
 * caller has to answer rather than draw. */
export function boundsOf(items: Box[]): Box | null {
  if (!items.length) return null
  let x = Infinity
  let y = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const i of items) {
    if (i.x < x) x = i.x
    if (i.y < y) y = i.y
    if (i.x + i.w > r) r = i.x + i.w
    if (i.y + i.h > b) b = i.y + i.h
  }
  return { x, y, w: r - x, h: b - y }
}

/* The corner that stays put: the one opposite the one being dragged. */
export function anchorOf(box: Box, corner: Corner): { x: number; y: number } {
  return {
    x: corner.includes('w') ? box.x + box.w : box.x,
    y: corner.includes('n') ? box.y + box.h : box.y,
  }
}

/* Which way a drag on this corner grows the box. */
const signOf = (corner: Corner) => ({
  sx: corner.includes('w') ? -1 : 1,
  sy: corner.includes('n') ? -1 : 1,
})

/* The smallest factor that leaves every side of every card at the floor. */
export function floorScale(items: Box[]): number {
  let k = 0
  for (const i of items) {
    /* A card already under the floor is not what the floor is protecting. It
     * is too small to get hold of whatever happens next, and letting it have a
     * say would mean one stray card froze the whole selection: its factor
     * would be greater than one, and the drag could only ever grow. */
    if (i.w >= FLOOR) k = Math.max(k, FLOOR / i.w)
    if (i.h >= FLOOR) k = Math.max(k, FLOOR / i.h)
  }
  return k
}

/* The factors a drag asks for, before anything is done about the floor. */
export function factorsFor(box: Box, corner: Corner, dx: number, dy: number, lock: boolean) {
  const { sx, sy } = signOf(corner)
  /* A box with no width cannot be scaled by a width, so that axis stands at
   * one rather than dividing by nothing. */
  const kx = box.w > 0 ? (box.w + dx * sx) / box.w : 1
  const ky = box.h > 0 ? (box.h + dy * sy) / box.h : 1
  if (!lock) return { kx, ky }
  /* One factor, taken from whichever axis the drag moved further along
   * relative to the box. Averaging the two reads as mush — the box lags the
   * corner in both directions at once — and taking x always means a vertical
   * drag does nothing. */
  const k = Math.abs(kx - 1) >= Math.abs(ky - 1) ? kx : ky
  return { kx: k, ky: k }
}

/* Every box scaled about the anchor.
 *
 * Returned in the order they were given, so the caller can pair them back up
 * with whatever it is holding — this knows nothing about cards or ids. */
export function scaleAll(
  items: Box[],
  box: Box,
  corner: Corner,
  dx: number,
  dy: number,
  lock = false
): Box[] {
  const at = anchorOf(box, corner)
  const low = floorScale(items)
  const want = factorsFor(box, corner, dx, dy, lock)
  /* Past the floor the drag simply stops, rather than flipping the selection
   * inside out the moment the corner crosses the anchor. */
  const kx = Math.max(want.kx, low)
  const ky = Math.max(want.ky, low)
  return items.map((i) => ({
    x: Math.round(at.x + (i.x - at.x) * kx),
    y: Math.round(at.y + (i.y - at.y) * ky),
    w: Math.max(1, Math.round(i.w * kx)),
    h: Math.max(1, Math.round(i.h * ky)),
  }))
}
