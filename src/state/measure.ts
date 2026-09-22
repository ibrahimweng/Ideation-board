/* ---------------------------------------------------------------------------
 * How far apart two things are.
 *
 * Hold a key, point at something, and the board tells you the distance between
 * it and whatever you have selected. It is the one thing a canvas can do that
 * a ruler cannot, and the reason is that it knows what you are asking about:
 * two cards side by side means the gap between their facing edges, a card
 * inside a section means the space left on each side of it, and a card away up
 * and to the right means both at once.
 *
 * Three cases per axis, and which one applies is decided by the boxes rather
 * than by the person:
 *
 *   apart      |A|--12--|B|        one figure: the gap between facing edges
 *   overlapping  |A  |B|  |        two: how far in from each edge B sits
 *   flush      |A|B|                nothing, because nothing is between them
 *
 * Boxes in, lines out. The awkward part is which lines, so that is the part
 * that is arithmetic and checkable rather than something drawn in a component.
 * ------------------------------------------------------------------------- */

/* One line to draw, in board coordinates, with the figure to print on it.
 *
 * `n` is null for the thin guide that carries the eye from a box out to a
 * measurement drawn beside it rather than across it. It is not a distance and
 * it wears no number. */
/* A box, structurally the same as the three the board already keeps — this
 * one is here so the arithmetic does not import the board to describe a
 * rectangle. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Span {
  x1: number
  y1: number
  x2: number
  y2: number
  n: number | null
}

/* Where a measurement along one axis should be drawn across the other: down
 * the middle of the band the two boxes share, or — when they share none —
 * down the middle of the one being pointed at, with a guide back to the other.
 */
function band(a0: number, a1: number, b0: number, b1: number) {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  if (hi >= lo) return { at: (lo + hi) / 2, shared: true }
  return { at: (b0 + b1) / 2, shared: false }
}

/* A single axis of it, written once and used for both. `along` is the axis
 * being measured; the four numbers are that axis, and `at` is where to draw. */
function alongAxis(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  at: number,
  horizontal: boolean
): Span[] {
  const line = (from: number, to: number, n: number | null): Span =>
    horizontal ? { x1: from, y1: at, x2: to, y2: at, n } : { x1: at, y1: from, x2: at, y2: to, n }

  /* Apart: one gap, between the edges that face each other. Edges that touch
     have no gap between them, and a 0 printed on a line of no length is worse
     than nothing at all. */
  if (b0 >= a1) return b0 > a1 ? [line(a1, b0, b0 - a1)] : []
  if (b1 <= a0) return b1 < a0 ? [line(b1, a0, a0 - b1)] : []

  /* Overlapping: how far in from each edge, which is what you are asking when
     one thing sits inside another. A flush edge measures nothing, so it draws
     nothing rather than a line of length zero with a 0 on it. */
  const out: Span[] = []
  if (Math.abs(b0 - a0) > 0) out.push(line(Math.min(a0, b0), Math.max(a0, b0), Math.abs(b0 - a0)))
  if (Math.abs(a1 - b1) > 0) out.push(line(Math.min(a1, b1), Math.max(a1, b1), Math.abs(a1 - b1)))
  return out
}

/* The guide from a box's edge out to a measurement drawn off the side of it. */
function reach(edge: number, from0: number, from1: number, at: number, horizontal: boolean): Span {
  const near = at < from0 ? from0 : from1
  return horizontal
    ? { x1: edge, y1: near, x2: edge, y2: at, n: null }
    : { x1: near, y1: edge, x2: at, y2: edge, n: null }
}

/* Every line to draw between what is selected and what is being pointed at. */
export function measure(a: Box, b: Box): Span[] {
  const ax1 = a.x + a.w
  const ay1 = a.y + a.h
  const bx1 = b.x + b.w
  const by1 = b.y + b.h
  const out: Span[] = []

  const across = band(a.y, ay1, b.y, by1)
  const spansX = alongAxis(a.x, ax1, b.x, bx1, across.at, true)
  out.push(...spansX)
  /* Drawn beside both boxes rather than across either, so a guide back to the
     selection is what says which two things the figure is about. */
  if (!across.shared && spansX.length) out.push(reach(b.x >= ax1 ? ax1 : a.x, a.y, ay1, across.at, true))

  const down = band(a.x, ax1, b.x, bx1)
  const spansY = alongAxis(a.y, ay1, b.y, by1, down.at, false)
  out.push(...spansY)
  if (!down.shared && spansY.length) out.push(reach(b.y >= ay1 ? ay1 : a.y, a.x, ax1, down.at, false))

  return out
}
