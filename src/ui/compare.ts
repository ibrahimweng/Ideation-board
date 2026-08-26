/* ---------------------------------------------------------------------------
 * How to lay two, three or four things out against each other.
 *
 * Comparing is the act the rest of this is in service of. A board is for
 * gathering, a mark is for recording what you decided, and the deciding itself
 * is nearly always between two things — this one or that one — which the show
 * could not help with, because it puts one thing on screen at a time and the
 * question is what the other one looked like.
 *
 * The arithmetic is only this: of the ways a few boxes can be arranged in a
 * rectangle, which one leaves each box biggest. Four wide photographs want two
 * rows; four tall ones want four columns; and which is which depends on the
 * shape of the window as much as on the shape of the pictures. So it is worked
 * out rather than written down, and worked out here where it can be checked
 * without a screen.
 * ------------------------------------------------------------------------- */

export interface Grid {
  cols: number
  rows: number
  /* What each one gets, before its own shape is fitted into it. */
  tile: { w: number; h: number }
}

/* More than four and they are too small to be held against each other; at that
 * point what you want is the board. */
export const MOST = 4

export function bestGrid(count: number, areaW: number, areaH: number, gap = 20): Grid {
  const n = Math.max(1, Math.min(MOST, Math.round(count)))
  let best: Grid | null = null
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const w = (areaW - gap * (cols - 1)) / cols
    const h = (areaH - gap * (rows - 1)) / rows
    if (w <= 0 || h <= 0) continue
    const grid: Grid = { cols, rows, tile: { w, h } }
    /* The smallest tile is what decides it: an arrangement is only as good as
     * the least room it gives anything in it. */
    if (!best || w * h > best.tile.w * best.tile.h) best = grid
  }
  return best ?? { cols: n, rows: 1, tile: { w: areaW / n, h: areaH } }
}
