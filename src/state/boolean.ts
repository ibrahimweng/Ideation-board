/* The one import in this file that is not this app's own. Its bundle exports
 * the four of them together as a default and its own declaration file says
 * they are named exports, so this is the shape the bundle actually has —
 * `allowSyntheticDefaultImports` is what lets the two agree. */
import clipping from 'polygon-clipping'
import type { MultiPolygon } from 'polygon-clipping'
import type { Node, ShapeSpec } from './shapes'
import { pathFor } from './shapes'

/* ---------------------------------------------------------------------------
 * Two shapes into one.
 *
 * Union, subtract, intersect and exclude — the four that turn a handful of
 * rectangles and circles into a shape nobody could draw by hand. They are the
 * oldest idea in vector drawing and still the fastest way to get an exact
 * outline: a rounded tab is a rectangle and a circle; a crescent is two
 * circles; a keyhole is a circle and a triangle.
 *
 * Three steps, and the middle one is the only hard part:
 *
 *   1. every shape written out as flat rings of points, in board units
 *   2. the rings clipped against each other
 *   3. the answer written back as a path card
 *
 * Step 1 is here because a shape on this board is a handful of numbers and a
 * rule for turning them into a `d` string, and the one thing that knows every
 * one of those rules is that `d` string. So this reads it back: a small parser
 * for the seven commands the app writes, and a flattener that turns curves and
 * arcs into short straight runs.
 *
 * Step 2 is `polygon-clipping`, the only dependency in this app that is not
 * React, three.js or a PDF reader, and the one piece of this nobody should
 * write themselves. General polygon boolean arithmetic is a swamp of
 * degenerate cases — edges that touch without crossing, vertices on edges,
 * rings that meet at a point — and a wrong answer is not a crash but a shape
 * that looks nearly right.
 *
 * What comes out is flat. The curves are gone and what is left is a run of
 * short lines: that is the honest trade, and every tool makes it somewhere in
 * this pipeline. It is bounded rather than vague — no part of the answer is
 * further than `TOL` from the curve it replaced — and nothing is thinned down
 * afterwards, because the flattening only ever puts down the points that
 * tolerance needs. Running the pencil's simplifier over the answer at that
 * same tolerance was tried and removed not one point.
 * ------------------------------------------------------------------------- */

export type Boolean4 = 'union' | 'subtract' | 'intersect' | 'exclude'

export type Point = [number, number]
export type Ring = Point[]

/* How far a flattened curve may stray from the real one, in board units.
 * A third of a pixel: below what anybody can see at 1:1, and still coarse
 * enough that a circle comes out as tens of points rather than hundreds. */
export const TOL = 0.33

/* ---------------------------------------------------------------------------
 * Reading a path back.
 * ------------------------------------------------------------------------- */

/* Every letter SVG's path grammar uses, so that a command is always cut at the
 * right place — and then only the seven this app writes are read.
 *
 * `pathFor` builds every shape out of M, L, H, V, C, A and Z, all absolute, so
 * a parser for the whole grammar would be a parser with untested halves. The
 * rest are cut out properly and then abandoned rather than guessed at: a
 * command whose meaning is unknown leaves the position unknown, and a ring
 * carried on from a place that is a guess is worse than no ring.
 *
 * `e` and `E` are not path commands and are deliberately not in the list,
 * because a number written in exponent notation contains one. */
const CMD = /([MZLHVCSQTA])([^MZLHVCSQTA]*)/gi
const READ = new Set(['M', 'L', 'H', 'V', 'C', 'A', 'Z'])

const nums = (s: string): number[] =>
  s.trim().length ? s.trim().split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v)) : []

/* A cubic, as a run of straight lines.
 *
 * How many is worked out from the control polygon, which is never shorter than
 * the curve and rarely much longer: the error of a straight run across a cubic
 * falls with the square of the number of pieces, so this is a generous bound
 * and a cheap one. */
function cubic(x0: number, y0: number, c1x: number, c1y: number, c2x: number, c2y: number, x1: number, y1: number, tol: number): Point[] {
  const hull =
    Math.hypot(c1x - x0, c1y - y0) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x1 - c2x, y1 - c2y)
  const steps = Math.min(64, Math.max(2, Math.ceil(Math.sqrt(hull / tol))))
  const out: Point[] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push([
      u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1,
      u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1,
    ])
  }
  return out
}

/* An elliptical arc, as a run of straight lines.
 *
 * Sampled off the ellipse itself rather than turned into cubics first: the
 * answer wanted here is points, and going by way of curves would be two
 * approximations where one will do. The centre and the two angles come from
 * the endpoint parameterisation in the SVG specification, which is the one
 * piece of arithmetic in this file that cannot be read off the page. */
function arc(
  x0: number, y0: number,
  rx: number, ry: number, rot: number,
  large: number, sweep: number,
  x1: number, y1: number,
  tol: number
): Point[] {
  /* Degenerate radii mean a straight line, which the specification says in as
     many words. */
  if (!rx || !ry) return [[x1, y1]]
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = (rot * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x0 - x1) / 2
  const dy = (y0 - y1) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  /* Radii too small to reach are scaled up until they just do. */
  const check = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (check > 1) {
    const s = Math.sqrt(check)
    rx *= s
    ry *= s
  }
  const sq = Math.max(
    0,
    (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) /
      (rx * rx * y1p * y1p + ry * ry * x1p * x1p)
  )
  const co = (large === sweep ? -1 : 1) * Math.sqrt(sq)
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const d = (Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1
    const c = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d))
    return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(c)
  }
  const from = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let sweepA = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && sweepA > 0) sweepA -= 2 * Math.PI
  if (sweep && sweepA < 0) sweepA += 2 * Math.PI

  /* The error of a straight run across a circular arc is r(1 - cos(θ/2)), so
     the step that keeps it under the tolerance comes straight out of it. */
  const r = Math.max(rx, ry)
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)))
  const steps = Math.min(256, Math.max(2, Math.ceil(Math.abs(sweepA) / Math.max(1e-3, step))))
  const out: Point[] = []
  for (let i = 1; i <= steps; i++) {
    const t = from + (sweepA * i) / steps
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    out.push([cx + cos * ex - sin * ey, cy + sin * ex + cos * ey])
  }
  return out
}

/* Every closed ring in a `d` string, flattened, with `at` added on so rings
 * from different cards are in the same coordinates.
 *
 * An open subpath is closed anyway: the arithmetic downstream is about areas,
 * and an open run of lines has none. That is the same thing a browser does
 * when it fills one. */
export function ringsOf(d: string, at: { x: number; y: number } = { x: 0, y: 0 }, tol = TOL): Ring[] {
  const rings: Ring[] = []
  let ring: Ring = []
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const put = (px: number, py: number) => {
    ring.push([px + at.x, py + at.y])
    x = px
    y = py
  }
  const end = () => {
    if (ring.length >= 3) rings.push(ring)
    ring = []
  }
  CMD.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CMD.exec(d))) {
    const cmd = m[1]
    /* Read only the absolute seven. A lower case letter is the same command
       said relative to where the pen is, which is a different command. */
    if (!READ.has(cmd)) {
      ring = []
      continue
    }
    const a = nums(m[2])
    if (cmd === 'M') {
      end()
      /* Only the first pair of an M starts a run; any pairs after it are
         lines. Nothing this app writes puts more than one pair on an M, but a
         parser that read them as more starts is a parser that would quietly
         lose a ring the day one does. */
      for (let i = 0; i + 1 < a.length; i += 2) {
        put(a[i], a[i + 1])
        if (i === 0) {
          sx = a[0]
          sy = a[1]
        }
      }
    } else if (cmd === 'L') {
      for (let i = 0; i + 1 < a.length; i += 2) put(a[i], a[i + 1])
    } else if (cmd === 'H') {
      for (const v of a) put(v, y)
    } else if (cmd === 'V') {
      for (const v of a) put(x, v)
    } else if (cmd === 'C') {
      for (let i = 0; i + 5 < a.length; i += 6) {
        for (const p of cubic(x, y, a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], tol)) {
          ring.push([p[0] + at.x, p[1] + at.y])
        }
        x = a[i + 4]
        y = a[i + 5]
      }
    } else if (cmd === 'A') {
      for (let i = 0; i + 6 < a.length; i += 7) {
        for (const p of arc(x, y, a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], tol)) {
          ring.push([p[0] + at.x, p[1] + at.y])
        }
        x = a[i + 5]
        y = a[i + 6]
      }
    } else if (cmd === 'Z') {
      end()
      x = sx
      y = sy
    }
  }
  end()
  return rings
}

/* A card's shape as rings, where it sits on the board. */
export function ringsOfShape(spec: ShapeSpec, box: { x: number; y: number; w: number; h: number }, tol = TOL): Ring[] {
  return ringsOf(pathFor(spec, box.w, box.h), box, tol)
}

/* ---------------------------------------------------------------------------
 * Clipping.
 * ------------------------------------------------------------------------- */

/* A set of rings as the clipper wants them: each ring its own polygon, closed.
 *
 * Every ring on its own rather than the first being an outline and the rest
 * holes, because that is what a card's shape actually is — a `d` string with
 * several M commands in it says nothing about which of them is inside which.
 * Exclusive-or between them is what an even-odd fill means, and an even-odd
 * fill is how the app draws a shape that has more than one ring. */
const closed = (r: Ring): Ring =>
  r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r

function asGeom(rings: Ring[]): MultiPolygon {
  return rings.map((r) => [closed(r)]) as MultiPolygon
}

/* One figure out of several, however many rings each of them has. */
function oneOf(rings: Ring[]): MultiPolygon {
  if (!rings.length) return []
  const [first, ...rest] = asGeom(rings)
  return rest.length ? clipping.xor(first, ...rest) : (clipping.union(first) as MultiPolygon)
}

/* The four of them.
 *
 * Subtract and exclude are about an order, so the list arrives in the order
 * the caller means: the first is the one being kept and the rest are taken out
 * of it. Union and intersect do not care.
 *
 * Every answer comes back as rings again, the outlines and the holes together,
 * because that is what the card that holds the answer is: rings, drawn even
 * odd, where a ring inside another is a hole by arithmetic rather than by
 * being labelled one. */
export function combine(op: Boolean4, shapes: Ring[][]): Ring[] {
  const figures = shapes.map(oneOf).filter((f) => f.length)
  if (figures.length < 2) return figures.flat().flat()
  const [first, ...rest] = figures
  const out =
    op === 'union' ? clipping.union(first, ...rest)
    : op === 'subtract' ? clipping.difference(first, ...rest)
    : op === 'intersect' ? clipping.intersection(first, ...rest)
    : clipping.xor(first, ...rest)
  /* A closing point that repeats the first is a thing the clipper returns and
     a thing a run of points does not need. */
  return (out as MultiPolygon).flat().map((r) => {
    const ring = r as Ring
    const last = ring.length - 1
    return last > 0 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
      ? ring.slice(0, last)
      : ring
  })
}

/* ---------------------------------------------------------------------------
 * Writing the answer back.
 * ------------------------------------------------------------------------- */

export interface Combined {
  box: { x: number; y: number; w: number; h: number }
  nodes: Node[]
  subs: Node[][]
}

const boundsOfRings = (rings: Ring[]) => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/* Rings into a card: a box round the lot, and every point written as a
 * fraction of it, which is the only unit the record knows. */
export function asCard(rings: Ring[]): Combined | null {
  const kept = rings.filter((r) => r.length >= 3)
  if (!kept.length) return null
  const box = boundsOfRings(kept)
  const asNodes = (r: Ring): Node[] => r.map(([x, y]) => ({ x: (x - box.x) / box.w, y: (y - box.y) / box.h }))
  const [outline, ...rest] = kept
  return { box, nodes: asNodes(outline), subs: rest.map(asNodes) }
}
