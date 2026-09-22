import { describe, expect, it } from 'vitest'
import { asCard, combine, ringsOf, ringsOfShape } from '../../src/state/boolean'
import type { Ring } from '../../src/state/boolean'
import { pathFor } from '../../src/state/shapes'
import type { ShapeSpec } from '../../src/state/shapes'

/* Two shapes into one.
 *
 * Three things to be sure of, and only the first two can be written down as
 * numbers: that a shape read back off its own `d` string is the shape it was,
 * and that the four operations give the areas they are supposed to. The third
 * — that the answer looks right — is the browser suite's job.
 *
 * The area of a ring is what most of this leans on: it is one number, it is
 * exact for a polygon, and it is the thing all four operations are actually
 * about. */

/* The shoelace area, unsigned. */
const area = (ring: Ring) => {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % ring.length]
    a += x0 * y1 - x1 * y0
  }
  return Math.abs(a) / 2
}
/* Whether a point is inside a ring, by counting the crossings of a ray. */
const inside = (p: [number, number], ring: Ring) => {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/* An even-odd figure's area: a ring inside an odd number of others is a hole,
 * which is the whole of what an even-odd fill means. Written out rather than
 * assumed, because half of these cases are about the difference between a hole
 * and a second piece and a helper that could not tell them apart would report
 * two separate squares as nothing at all. */
const areaOf = (rings: Ring[]) =>
  rings.reduce((n, r) => {
    const depth = rings.filter((o) => o !== r && inside(r[0], o)).length
    return n + (depth % 2 ? -1 : 1) * area(r)
  }, 0)

const bounds = (rings: Ring[]) => {
  const xs = rings.flat().map((p) => p[0])
  const ys = rings.flat().map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

const rect = (x: number, y: number, w: number, h: number): Ring[] =>
  ringsOfShape({ kind: 'rect' }, { x, y, w, h })
const circle = (x: number, y: number, w: number, h: number): Ring[] =>
  ringsOfShape({ kind: 'ellipse' }, { x, y, w, h })

describe('reading a shape back off its own path', () => {
  it('reads a rectangle as four corners, where it sits on the board', () => {
    const r = rect(10, 20, 100, 60)
    expect(r.length).toBe(1)
    expect(area(r[0])).toBeCloseTo(6000, 4)
    expect(bounds(r)).toEqual({ x0: 10, y0: 20, x1: 110, y1: 80 })
  })

  it('reads a rounded rectangle as a rectangle with its corners taken off', () => {
    const rounded = ringsOfShape({ kind: 'rect', radius: 0.5 }, { x: 0, y: 0, w: 100, h: 100 })
    /* Radius is a fraction of the shortest side, so a half is a fifty pixel
       corner on a hundred pixel square, which makes this a circle. The flat
       run cuts the corners off it, so the area comes out a little under. */
    const round = Math.PI * 50 * 50
    expect(area(rounded[0])).toBeLessThan(round)
    expect(area(rounded[0])).toBeGreaterThan(round * 0.99)
  })

  it('puts every point of an ellipse on the ellipse itself', () => {
    /* What the tolerance promises is that no part of the flat run strays
       further than a third of a pixel from the curve — and the way it is
       sampled, the points are exactly on it and only the chords between them
       fall inside. So the guarantee is checked as it is written: every point
       on the curve, and the area short by no more than the chords can lose. */
    const c = circle(0, 0, 200, 200)
    for (const [x, y] of c[0]) expect(Math.hypot(x - 100, y - 100)).toBeCloseTo(100, 6)
    const round = Math.PI * 100 * 100
    expect(area(c[0])).toBeLessThan(round)
    expect(area(c[0])).toBeGreaterThan(round - 2 * Math.PI * 100 * 0.33)
  })

  it('and takes more points for a bigger one, since the tolerance is a length', () => {
    const small = circle(0, 0, 40, 40)
    const large = circle(0, 0, 400, 400)
    expect(large[0].length).toBeGreaterThan(small[0].length * 2)
  })

  it('reads a polygon and a star as themselves', () => {
    const hex = ringsOfShape({ kind: 'polygon', sides: 6 }, { x: 0, y: 0, w: 100, h: 100 })
    expect(hex[0].length).toBe(6)
    const star = ringsOfShape({ kind: 'star', sides: 5, inner: 0.45 }, { x: 0, y: 0, w: 100, h: 100 })
    expect(star[0].length).toBe(10)
  })

  it('reads a path made of curves as the curve it draws', () => {
    /* Four smooth points with handles four fifths of the way to the corner:
       the usual way to write a circle as four cubics, and near enough to one
       that its area gives the flattener away if it reads a curve straight. */
    const k = 0.5522847 / 2
    const spec: ShapeSpec = {
      kind: 'path',
      closed: true,
      nodes: [
        { x: 0.5, y: 0, ox: k, oy: 0, ix: -k, iy: 0 },
        { x: 1, y: 0.5, ox: 0, oy: k, ix: 0, iy: -k },
        { x: 0.5, y: 1, ox: -k, oy: 0, ix: k, iy: 0 },
        { x: 0, y: 0.5, ox: 0, oy: -k, ix: 0, iy: k },
      ],
    }
    const ring = ringsOfShape(spec, { x: 0, y: 0, w: 100, h: 100 })[0]
    expect(ring.length).toBeGreaterThan(30)
    /* Under a percent of a circle of radius fifty, which a straight run
       between the four points would miss by a third. */
    expect(area(ring)).toBeGreaterThan(Math.PI * 50 * 50 * 0.99)
    expect(area(ring)).toBeLessThan(Math.PI * 50 * 50 * 1.001)
  })

  it('takes more pieces for a longer curve, since the tolerance is a length', () => {
    const bowed: ShapeSpec = {
      kind: 'path',
      closed: true,
      nodes: [
        { x: 0, y: 0, ox: 0.4, oy: 0.6 },
        { x: 1, y: 0, ix: -0.4, iy: 0.6 },
        { x: 1, y: 1 },
      ],
    }
    const small = ringsOfShape(bowed, { x: 0, y: 0, w: 60, h: 60 })[0]
    const large = ringsOfShape(bowed, { x: 0, y: 0, w: 600, h: 600 })[0]
    expect(large.length).toBeGreaterThan(small.length * 2)
  })

  it('reads several rings out of one path', () => {
    const two = ringsOf('M0 0H10V10H0ZM20 0H30V10H20Z')
    expect(two.length).toBe(2)
    expect(two.map(area)).toEqual([100, 100])
  })

  it('invents nothing on a command it does not read', () => {
    expect(ringsOf('M0 0H10V10H0Z')).toHaveLength(1)
    expect(ringsOf('')).toEqual([])
    expect(ringsOf('M0 0L10 0')).toEqual([])
    /* A quadratic and a relative line are both things `pathFor` never writes.
       Reading either as something else would put out a ring that is not the
       shape, so what comes back is nothing — and, just as importantly, the
       ring after it is unharmed. */
    expect(ringsOf('M0 0Q5 5 10 0L10 10L0 10Z')).toEqual([])
    expect(ringsOf('M0 0l10 0L10 10L0 10Z')).toEqual([])
    expect(ringsOf('M0 0Q5 5 10 0ZM20 0H30V10H20Z')).toHaveLength(1)
  })

  it('closes a run that was left open, because an open run has no area', () => {
    const open = ringsOf('M0 0H10V10H0')
    expect(open.length).toBe(1)
    expect(area(open[0])).toBeCloseTo(100, 6)
  })
})

describe('the four of them', () => {
  /* Two hundred-square rectangles overlapping by half. */
  const a = rect(0, 0, 100, 100)
  const b = rect(50, 0, 100, 100)

  it('unites two into the area of both', () => {
    expect(areaOf(combine('union', [a, b]))).toBeCloseTo(15000, 4)
  })

  it('subtracts the second out of the first', () => {
    expect(areaOf(combine('subtract', [a, b]))).toBeCloseTo(5000, 4)
  })

  it('and the other way round is a different answer, because order is the point', () => {
    const out = combine('subtract', [b, a])
    expect(areaOf(out)).toBeCloseTo(5000, 4)
    expect(bounds(out).x0).toBeCloseTo(100, 4)
  })

  it('intersects them down to what they share', () => {
    expect(areaOf(combine('intersect', [a, b]))).toBeCloseTo(5000, 4)
  })

  it('excludes what they share, leaving the rest', () => {
    expect(areaOf(combine('exclude', [a, b]))).toBeCloseTo(10000, 4)
  })

  it('makes a hole when one is wholly inside the other', () => {
    const ring = combine('subtract', [rect(0, 0, 100, 100), rect(25, 25, 50, 50)])
    expect(ring.length).toBe(2)
    expect(areaOf(ring)).toBeCloseTo(10000 - 2500, 4)
  })

  it('leaves two pieces when two that do not touch are united', () => {
    const apart = combine('union', [rect(0, 0, 10, 10), rect(100, 0, 10, 10)])
    expect(apart.length).toBe(2)
    /* Two pieces and not a hole, which is the difference that matters: one
       ring inside another takes area away, two side by side add up. */
    expect(areaOf(apart)).toBeCloseTo(200, 4)
  })

  it('gives nothing at all for the overlap of two that miss', () => {
    expect(combine('intersect', [rect(0, 0, 10, 10), rect(100, 0, 10, 10)])).toEqual([])
  })

  it('takes more than two, in order', () => {
    const three = combine('union', [rect(0, 0, 10, 10), rect(10, 0, 10, 10), rect(20, 0, 10, 10)])
    expect(areaOf(three)).toBeCloseTo(300, 4)
  })

  it('hands back what it was given when there is only one of them', () => {
    expect(areaOf(combine('union', [a]))).toBeCloseTo(10000, 4)
  })

  it('cuts a circle out of a square and keeps the circle round', () => {
    const hole = circle(50, 50, 100, 100)
    const out = combine('subtract', [rect(0, 0, 200, 200), hole])
    expect(out.length).toBe(2)
    /* Against the flat circle's own area rather than the ideal one: what came
       out is what went in, and the tolerance was spent on the way in. */
    expect(areaOf(out)).toBeCloseTo(40000 - area(hole[0]), 2)
  })
})

describe('writing the answer back as a card', () => {
  const out = combine('subtract', [rect(0, 0, 100, 100), rect(25, 25, 50, 50)])

  it('puts a box round every ring and writes them as fractions of it', () => {
    const card = asCard(out)!
    expect(card.box).toEqual({ x: 0, y: 0, w: 100, h: 100 })
    for (const p of [...card.nodes, ...card.subs.flat()]) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the outline as the outline and the rest as rings of their own', () => {
    const card = asCard(out)!
    expect(card.nodes.length).toBeGreaterThan(3)
    expect(card.subs.length).toBe(1)
  })

  it('answers nothing for nothing, rather than a card with no shape in it', () => {
    expect(asCard([])).toBeNull()
    expect(asCard([[[0, 0], [1, 1]]])).toBeNull()
  })

  it('comes out as a path that reads back as the same area', () => {
    /* The whole round trip: shapes in, rings out, a card, a `d` string, and
       the rings read back off that. */
    const card = asCard(out)!
    const spec: ShapeSpec = { kind: 'path', nodes: card.nodes, subs: card.subs, closed: true }
    const again = ringsOf(pathFor(spec, card.box.w, card.box.h))
    expect(again.length).toBe(2)
    expect(areaOf(again)).toBeCloseTo(areaOf(out), 2)
  })
})
