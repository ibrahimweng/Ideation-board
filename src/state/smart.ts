import type { Item } from './types'
import type { Moves } from './arrange'

/* ---------------------------------------------------------------------------
 * A selection that has a shape.
 *
 * The moment a handful of cards sit in a row, the gaps between them stop being
 * empty space and become a thing you can take hold of. That is the whole idea,
 * and it is the best gesture on any canvas: no dialogue, no field to type a
 * number into, no menu — the space itself is the control.
 *
 * Everything here is about deciding when that is honestly true. A set of
 * handles offered over a pile of cards is a set of handles that lie: dragging
 * one would have to invent an order the cards do not have, and whatever
 * happened next would be a surprise. So the answer is only yes when the cards
 * really are evenly spaced, and no the rest of the time — and `tidyOnto` next
 * door is how a pile becomes a row in one press.
 *
 * Pure arithmetic, like everything else in this file's neighbourhood: boxes in,
 * positions out. Which is what lets the awkward part — is this a row, a column,
 * a grid, or nothing — be checked without a browser.
 * ------------------------------------------------------------------------- */

export interface Smart {
  /* Which way a lane runs. A row runs along x; a column along y. */
  axis: 'x' | 'y'
  /* The cards, in the order they sit. One lane for a row, several for a grid —
     all the same length but the last, which a grid of five in threes leaves
     short. */
  lanes: string[][]
  /* The gap along a lane. Every pair has this one, which is what made it a
     run in the first place. */
  gap: number
  /* And the gap between lanes, when there is more than one. */
  cross: number | null
}

/* How far apart two figures can be and still count as the same one.
 *
 * Two pixels: cards are placed by hand and land on whole numbers, so a row
 * somebody nudged into place is out by one here and there. Tighter than this
 * and the feature would almost never appear; looser and it would appear over
 * arrangements that are not really rows. */
export const TOL = 2

const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol

/* Whether every figure in a list is the same one, and what it is. */
function shared(list: number[], tol = TOL): number | null {
  if (!list.length) return null
  const first = list[0]
  for (const v of list) if (!near(v, first, tol)) return null
  /* The average rather than the first, so a row that is out by one in both
     directions does not drift when it is respaced. */
  return list.reduce((a, b) => a + b, 0) / list.length
}

/* The gaps between a run of boxes, in order along the axis. */
const gapsAlong = (list: Item[], axis: 'x' | 'y'): number[] => {
  const size = axis === 'x' ? ('w' as const) : ('h' as const)
  const out: number[] = []
  for (let i = 1; i < list.length; i++) out.push(list[i][axis] - (list[i - 1][axis] + list[i - 1][size]))
  return out
}

/* Split a list into lanes: the runs that share a line across the other axis. */
function lanesAcross(list: Item[], axis: 'x' | 'y'): Item[][] {
  const other = axis === 'x' ? ('y' as const) : ('x' as const)
  const sorted = [...list].sort((a, b) => a[other] - b[other] || a[axis] - b[axis])
  const lanes: Item[][] = []
  for (const it of sorted) {
    const lane = lanes[lanes.length - 1]
    if (lane && near(lane[0][other], it[other])) lane.push(it)
    else lanes.push([it])
  }
  for (const lane of lanes) lane.sort((a, b) => a[axis] - b[axis])
  return lanes
}

/* What shape this selection has, or nothing.
 *
 * Tried both ways round and the better answer kept: three cards side by side
 * are a row read along x and three lanes of one read along y, and only the
 * first of those is worth handles. */
export function smartOf(items: Item[], tol = TOL): Smart | null {
  if (items.length < 2) return null
  return pick(shapeAlong(items, 'x', tol), shapeAlong(items, 'y', tol))
}

/* The one with more cards in a lane, since that is the one with gaps to take
 * hold of. A tie goes to the row, because a board is read across. */
const pick = (a: Smart | null, b: Smart | null): Smart | null => {
  if (!a) return b
  if (!b) return a
  return b.lanes[0].length > a.lanes[0].length ? b : a
}

function shapeAlong(items: Item[], axis: 'x' | 'y', tol: number): Smart | null {
  const lanes = lanesAcross(items, axis)
  /* Every lane the same length, except the last, which may be short — that is
     not a ragged grid, it is what tidying five cards onto three columns looks
     like, and it has exactly the same gaps in it. A lane that comes up short
     anywhere *but* the end is a grid with a hole in it, and a hole means the
     cards after it do not sit where the arrangement says they do. */
  const width = lanes[0].length
  if (width < 2) return null
  if (lanes.some((l, i) => (i === lanes.length - 1 ? l.length > width : l.length !== width))) return null

  /* One gap along, shared by every pair in every lane. */
  const gap = shared(lanes.flatMap((l) => gapsAlong(l, axis)), tol)
  if (gap === null) return null

  /* And every lane starting at the same place, or they are rows of different
     things rather than a grid. */
  if (lanes.length > 1 && shared(lanes.map((l) => l[0][axis]), tol) === null) return null

  /* One gap between the lanes, when there is more than one lane. */
  let cross: number | null = null
  if (lanes.length > 1) {
    const other = axis === 'x' ? ('y' as const) : ('x' as const)
    const size = axis === 'x' ? ('h' as const) : ('w' as const)
    const between: number[] = []
    for (let i = 1; i < lanes.length; i++) {
      const prev = lanes[i - 1]
      const tall = Math.max(...prev.map((p) => p[size]))
      between.push(lanes[i][0][other] - (prev[0][other] + tall))
    }
    cross = shared(between, tol)
    if (cross === null) return null
  }

  return { axis, lanes: lanes.map((l) => l.map((i) => i.id)), gap, cross }
}

/* ---------------------------------------------------------------------------
 * Taking hold of the gaps.
 * ------------------------------------------------------------------------- */

const byId = (items: Item[]) => new Map(items.map((i) => [i.id, i]))

/* Where everything goes when the gap changes.
 *
 * The first card in each lane stays where it is and the rest close up or open
 * out behind it, which is what makes it read as spacing rather than as the
 * whole row sliding sideways. */
export function respace(items: Item[], smart: Smart, gap: number, cross?: number): Moves {
  const at = byId(items)
  const axis = smart.axis
  const other = axis === 'x' ? ('y' as const) : ('x' as const)
  const size = axis === 'x' ? ('w' as const) : ('h' as const)
  const tall = axis === 'x' ? ('h' as const) : ('w' as const)
  const out: Moves = new Map()

  /* Where each lane starts across the other axis, when that is moving too. */
  const top = at.get(smart.lanes[0][0])?.[other] ?? 0
  let lane0 = top
  for (const lane of smart.lanes) {
    const first = at.get(lane[0])
    if (!first) continue
    let run = first[axis]
    const across = cross === undefined ? first[other] : Math.round(lane0)
    for (const id of lane) {
      const it = at.get(id)
      if (!it) continue
      const p = {
        x: axis === 'x' ? Math.round(run) : across,
        y: axis === 'x' ? across : Math.round(run),
      }
      if (p.x !== it.x || p.y !== it.y) out.set(id, p)
      run += it[size] + gap
    }
    if (cross !== undefined) {
      const deep = Math.max(...lane.map((id) => at.get(id)?.[tall] ?? 0))
      lane0 += deep + cross
    }
  }
  return out
}

/* One card taken out of its place in the run and put back at another, with
 * everything between it closing up behind.
 *
 * Which is what dragging a card along a row ought to do and never did: it used
 * to land on top of whatever was already there and leave a hole where it came
 * from. */
export function reorder(items: Item[], smart: Smart, id: string, to: number): Moves {
  const flat = smart.lanes.flat()
  const from = flat.indexOf(id)
  if (from < 0 || to < 0 || to >= flat.length || from === to) return new Map()
  const order = flat.slice()
  order.splice(to, 0, ...order.splice(from, 1))

  /* The places themselves do not move; what sits in each one does. */
  const at = byId(items)
  const spots = flat.map((who) => {
    const it = at.get(who)
    return it ? { x: it.x, y: it.y } : { x: 0, y: 0 }
  })
  const out: Moves = new Map()
  order.forEach((who, i) => {
    const it = at.get(who)
    if (!it) return
    const spot = spots[i]
    if (spot.x !== it.x || spot.y !== it.y) out.set(who, spot)
  })
  return out
}

/* Which slot along the run a point falls in, for a card being dragged. */
export function slotAt(items: Item[], smart: Smart, x: number, y: number): number {
  const at = byId(items)
  const flat = smart.lanes.flat()
  let best = 0
  let near2 = Infinity
  flat.forEach((id, i) => {
    const it = at.get(id)
    if (!it) return
    const d = Math.hypot(it.x + it.w / 2 - x, it.y + it.h / 2 - y)
    if (d < near2) {
      near2 = d
      best = i
    }
  })
  return best
}

/* Where a gap handle sits, in board coordinates: the space between two cards,
 * and whether it is a gap along a lane or the gap between two lanes. A grid
 * has both, and they are two different figures to take hold of. */
export interface Mark {
  x: number
  y: number
  w: number
  h: number
  /* True for the space between two lanes rather than between two cards. */
  cross: boolean
}

export function gapMarks(items: Item[], smart: Smart): Mark[] {
  const at = byId(items)
  const axis = smart.axis
  const marks: Mark[] = []
  const span = (a: Item, b: Item, along: 'x' | 'y'): Mark => {
    const other = along === 'x' ? ('y' as const) : ('x' as const)
    const size = along === 'x' ? ('w' as const) : ('h' as const)
    const tall = along === 'x' ? ('h' as const) : ('w' as const)
    const near2 = Math.max(a[other], b[other])
    const far = Math.min(a[other] + a[tall], b[other] + b[tall])
    const from = a[along] + a[size]
    const to = b[along]
    return along === 'x'
      ? { x: from, y: near2, w: Math.max(0, to - from), h: Math.max(1, far - near2), cross: false }
      : { x: near2, y: from, w: Math.max(1, far - near2), h: Math.max(0, to - from), cross: false }
  }

  for (const lane of smart.lanes) {
    for (let i = 1; i < lane.length; i++) {
      const a = at.get(lane[i - 1])
      const b = at.get(lane[i])
      if (a && b) marks.push(span(a, b, axis))
    }
  }

  /* And between the lanes, which run the other way. */
  const other = axis === 'x' ? ('y' as const) : ('x' as const)
  for (let i = 1; i < smart.lanes.length; i++) {
    const a = at.get(smart.lanes[i - 1][0])
    const b = at.get(smart.lanes[i][0])
    if (!a || !b) continue
    const wide = smart.lanes[i - 1]
      .map((id) => at.get(id))
      .filter(Boolean) as Item[]
    const last = wide[wide.length - 1]
    const mark = span(a, b, other)
    /* Drawn across the whole lane rather than only across its first card. */
    if (axis === 'x') {
      mark.x = a.x
      mark.w = Math.max(1, last.x + last.w - a.x)
    } else {
      mark.y = a.y
      mark.h = Math.max(1, last.y + last.h - a.y)
    }
    mark.cross = true
    marks.push(mark)
  }
  return marks
}
