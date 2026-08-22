import type { Item } from '../state/types'

/* ---------------------------------------------------------------------------
 * Lining a card up with the ones already there.
 *
 * While a card is being dragged, its edges and its middle are compared with
 * the edges and middles of everything else near it. Anything within a few
 * pixels pulls the card onto that line and draws it, so cards end up sharing
 * an edge exactly rather than nearly.
 *
 * Everything here is board coordinates. The tolerance is given in screen
 * pixels and divided by the zoom by the caller, so the pull feels the same
 * whatever the board is scaled to.
 * ------------------------------------------------------------------------- */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Line {
  /* Where the line sits on its axis. */
  at: number
  /* How far it runs on the other axis, so the guide can be drawn between the
   * two cards that agree rather than across the whole board. */
  from: number
  to: number
}

export interface Guides {
  v: Line[]
  h: Line[]
}

/* The lines other cards offer: their two edges and their middle, each way. */
export function guidesFrom(items: Item[]): Guides {
  const v: Line[] = []
  const h: Line[] = []
  for (const it of items) {
    if (it.kind === 'edge') continue
    v.push({ at: it.x, from: it.y, to: it.y + it.h })
    v.push({ at: it.x + it.w / 2, from: it.y, to: it.y + it.h })
    v.push({ at: it.x + it.w, from: it.y, to: it.y + it.h })
    h.push({ at: it.y, from: it.x, to: it.x + it.w })
    h.push({ at: it.y + it.h / 2, from: it.x, to: it.x + it.w })
    h.push({ at: it.y + it.h, from: it.x, to: it.x + it.w })
  }
  return { v, h }
}

export interface Snap {
  dx: number
  dy: number
  /* The line to draw, and how far it should run, once the card has moved. */
  vLine: Line | null
  hLine: Line | null
}

function best(edges: number[], lines: Line[], tol: number) {
  let hit: { d: number; line: Line } | null = null
  for (const line of lines) {
    for (const e of edges) {
      const d = line.at - e
      if (Math.abs(d) > tol) continue
      if (!hit || Math.abs(d) < Math.abs(hit.d)) hit = { d, line }
    }
  }
  return hit
}

export function snap(box: Box, g: Guides, tol: number): Snap {
  const vx = best([box.x, box.x + box.w / 2, box.x + box.w], g.v, tol)
  const hy = best([box.y, box.y + box.h / 2, box.y + box.h], g.h, tol)
  const dx = vx ? vx.d : 0
  const dy = hy ? hy.d : 0
  /* The guide runs from the far end of the card it matched to the far end of
   * the card being dragged, so it is obvious which two are lining up. */
  const vLine = vx
    ? { at: vx.line.at, from: Math.min(vx.line.from, box.y + dy), to: Math.max(vx.line.to, box.y + box.h + dy) }
    : null
  const hLine = hy
    ? { at: hy.line.at, from: Math.min(hy.line.from, box.x + dx), to: Math.max(hy.line.to, box.x + box.w + dx) }
    : null
  return { dx, dy, vLine, hLine }
}
