import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * Where things go when you line them up.
 *
 * Pure arithmetic, kept out of the store. Lining up, spacing out and tidying
 * are the three places on the board with real geometry in them, and inside the
 * store they could only be checked by driving a browser at a board and
 * measuring the result. Here they are three functions from a list of boxes to
 * a list of positions, and the store's job shrinks to recording them.
 * ------------------------------------------------------------------------- */

export type AlignMode = 'left' | 'hcentre' | 'right' | 'top' | 'vmiddle' | 'bottom'

/* Where each item should end up, by id. Only what actually moves is listed. */
export type Moves = Map<string, { x: number; y: number }>

const bounds = (list: Item[]) => ({
  x0: Math.min(...list.map((i) => i.x)),
  y0: Math.min(...list.map((i) => i.y)),
  x1: Math.max(...list.map((i) => i.x + i.w)),
  y1: Math.max(...list.map((i) => i.y + i.h)),
})

const moved = (list: Item[], at: (it: Item) => { x: number; y: number }): Moves => {
  const out: Moves = new Map()
  for (const it of list) {
    const p = at(it)
    if (p.x !== it.x || p.y !== it.y) out.set(it.id, p)
  }
  return out
}

/* Every edge onto the outermost one of its kind. */
export function alignTo(list: Item[], mode: AlignMode): Moves {
  if (list.length < 2) return new Map()
  const b = bounds(list)
  return moved(list, (it) => {
    let { x, y } = it
    if (mode === 'left') x = b.x0
    else if (mode === 'right') x = b.x1 - it.w
    else if (mode === 'hcentre') x = Math.round((b.x0 + b.x1 - it.w) / 2)
    else if (mode === 'top') y = b.y0
    else if (mode === 'bottom') y = b.y1 - it.h
    else y = Math.round((b.y0 + b.y1 - it.h) / 2)
    return { x, y }
  })
}

/* Even gaps between the boxes, with the outermost two left where they are,
 * which is what makes it read as spacing rather than as moving. */
export function distributeAlong(list: Item[], axis: 'x' | 'y'): Moves {
  if (list.length < 3) return new Map()
  const across = axis === 'x'
  const sorted = [...list].sort((a, b) => (across ? a.x - b.x : a.y - b.y))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = across ? last.x + last.w - first.x : last.y + last.h - first.y
  const used = sorted.reduce((n, i) => n + (across ? i.w : i.h), 0)
  const gap = (span - used) / (sorted.length - 1)
  const out: Moves = new Map()
  let at = across ? first.x : first.y
  for (const it of sorted) {
    const v = Math.round(at)
    const p = { x: across ? v : it.x, y: across ? it.y : v }
    if (p.x !== it.x || p.y !== it.y) out.set(it.id, p)
    at += (across ? it.w : it.h) + gap
  }
  return out
}

/* A grid, in the order the list reads now, keeping roughly the shape it
 * already has: a row stays a row and a pile stays a pile, because how many
 * columns it uses comes from how wide the thing already is. Anchored at the
 * top left of what was there, so tidying does not also move the work. */
export function tidyOnto(list: Item[], gap = 24): Moves {
  if (list.length < 2) return new Map()
  const b = bounds(list)
  const cellW = Math.max(...list.map((i) => i.w))
  const cellH = Math.max(...list.map((i) => i.h))
  /* Cards within about a card's height of each other are read as one row. */
  const band = cellH * 0.6
  const sorted = [...list].sort((a, b2) => (Math.abs(a.y - b2.y) > band ? a.y - b2.y : a.x - b2.x))
  const cols = Math.max(1, Math.min(sorted.length, Math.round((b.x1 - b.x0 + gap) / (cellW + gap))))
  const out: Moves = new Map()
  sorted.forEach((it, i) => {
    const p = {
      x: Math.round(b.x0 + (i % cols) * (cellW + gap)),
      y: Math.round(b.y0 + Math.floor(i / cols) * (cellH + gap)),
    }
    if (p.x !== it.x || p.y !== it.y) out.set(it.id, p)
  })
  return out
}

/* ---------------------------------------------------------------------------
 * Putting a set of things in one place.
 *
 * A board grows by accumulation and the things you end up choosing are wherever
 * you happened to drop them — six keepers scattered across four screens. Every
 * other arrangement here rearranges cards where they already are; this one is
 * the last step of curating, which is to gather what survived into somewhere of
 * its own so that it can be looked at, presented and handed over as a set.
 *
 * The block is laid out squarish rather than in the row-count the cards
 * happened to be in, because what comes out of this is a group to be read as
 * one thing and not a trail of where they used to be.
 * ------------------------------------------------------------------------- */

export interface Gathered {
  /* The area to put around them, in board coordinates. */
  frame: { x: number; y: number; w: number; h: number }
  /* Where each one goes inside it. */
  moves: Moves
}

/* Room above the cards for the section's own title. */
const TITLE_H = 30

export function gatherInto(
  list: Item[],
  /* Where the top left of the frame should sit. */
  at: { x: number; y: number },
  gap = 24,
  pad = 20
): Gathered | null {
  if (!list.length) return null
  const cellW = Math.max(...list.map((i) => i.w))
  const cellH = Math.max(...list.map((i) => i.h))
  /* Reading order first, so what was arranged deliberately keeps its sense. */
  const band = cellH * 0.6
  const sorted = [...list].sort((a, b) => (Math.abs(a.y - b.y) > band ? a.y - b.y : a.x - b.x))
  /* Squarish, allowing for the cards being wider than they are tall. */
  /* Rounded up rather than to nearest: three landscape cards come to 1.4
   * columns, and one column of three is a strip and not a block. */
  const cols = Math.max(1, Math.min(sorted.length, Math.ceil(Math.sqrt((sorted.length * cellH) / cellW))))
  const rows = Math.ceil(sorted.length / cols)
  const x0 = Math.round(at.x + pad)
  const y0 = Math.round(at.y + pad + TITLE_H)
  const moves: Moves = new Map()
  sorted.forEach((it, i) => {
    moves.set(it.id, {
      x: x0 + (i % cols) * (cellW + gap),
      y: y0 + Math.floor(i / cols) * (cellH + gap),
    })
  })
  return {
    frame: {
      x: Math.round(at.x),
      y: Math.round(at.y),
      w: cols * cellW + (cols - 1) * gap + pad * 2,
      h: rows * cellH + (rows - 1) * gap + pad * 2 + TITLE_H,
    },
    moves,
  }
}

/* Clear ground to put it on: under everything, with a gap, and lined up with
 * the left edge of the board so a shortlist reads as the next thing down
 * rather than as something dropped at random. */
export function clearGround(all: Item[], gap = 80): { x: number; y: number } {
  const boxes = all.filter((i) => i.w > 0 && i.h > 0)
  if (!boxes.length) return { x: 0, y: 0 }
  const b = bounds(boxes)
  return { x: Math.round(b.x0), y: Math.round(b.y1 + gap) }
}
