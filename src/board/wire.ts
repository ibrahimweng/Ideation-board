/* ---------------------------------------------------------------------------
 * Where a connection between two cards is drawn.
 *
 * A wire is not stored as a shape. It is stored as two card ids, and its
 * geometry is worked out from wherever those cards happen to be, so moving a
 * card drags its wires with it without either card knowing they exist.
 *
 * Each end attaches to whichever side of its card faces the other, and leaves
 * that side at a right angle before curving across. Straight lines between
 * centres would pass through the cards themselves and cross each other far
 * more often.
 * ------------------------------------------------------------------------- */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export type Side = 'n' | 'e' | 's' | 'w'

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

export function sideFacing(a: Box, b: Box): Side {
  const ca = centre(a)
  const cb = centre(b)
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  /* The larger gap decides, so cards side by side join left to right and
   * cards above one another join top to bottom. */
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w'
  return dy >= 0 ? 's' : 'n'
}

export function portPoint(b: Box, s: Side) {
  if (s === 'n') return { x: b.x + b.w / 2, y: b.y }
  if (s === 's') return { x: b.x + b.w / 2, y: b.y + b.h }
  if (s === 'w') return { x: b.x, y: b.y + b.h / 2 }
  return { x: b.x + b.w, y: b.y + b.h / 2 }
}

const away = (s: Side, d: number) =>
  s === 'n' ? { x: 0, y: -d } : s === 's' ? { x: 0, y: d } : s === 'w' ? { x: -d, y: 0 } : { x: d, y: 0 }

/* How far the curve holds its leaving direction: enough to read as a curve
 * over a short gap, not so much that a long wire loops. */
const reach = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
  Math.max(36, Math.min(140, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.42))

function curve(p1: { x: number; y: number }, s1: Side, p2: { x: number; y: number }, s2: Side) {
  const d = reach(p1, p2)
  const o1 = away(s1, d)
  const o2 = away(s2, d)
  return `M ${p1.x} ${p1.y} C ${p1.x + o1.x} ${p1.y + o1.y}, ${p2.x + o2.x} ${p2.y + o2.y}, ${p2.x} ${p2.y}`
}

export function wirePath(a: Box, b: Box): string {
  const sa = sideFacing(a, b)
  const sb = sideFacing(b, a)
  return curve(portPoint(a, sa), sa, portPoint(b, sb), sb)
}

/* The wire being dragged, which has a card at one end and the pointer at the
 * other. The side is the port it was started from and does not change while
 * dragging, so the wire stays attached to the dot under the finger. */
export function wireToPoint(a: Box, s: Side, x: number, y: number): string {
  const p1 = portPoint(a, s)
  const p2 = { x, y }
  const to: Side = s === 'n' ? 's' : s === 's' ? 'n' : s === 'e' ? 'w' : 'e'
  return curve(p1, s, p2, to)
}
