import { describe, expect, it } from 'vitest'
import {
  DASHES,
  DEFAULTS,
  addNode,
  bendSegment,
  moveHandle,
  moveNode,
  nodeAt,
  pointOnSegment,
  boundsOfNodes,
  dropNode,
  ellipsePath,
  headsFor,
  isSmooth,
  nearestOn,
  nearestSegment,
  nodesPath,
  normalise,
  outsetOf,
  paintOf,
  pathFor,
  polyPoints,
  rectPath,
  settingOf,
  simplify,
  smoothNodes,
  specFor,
  starPoints,
  svgFor,
  toggleSmooth,
} from '../../src/state/shapes'
import type { Node, ShapeSpec } from '../../src/state/shapes'

/* The vector layer's arithmetic.
 *
 * Every shape on the board is a handful of numbers turned into one `d` string,
 * and a `d` string is the one thing in this app that cannot be looked at to
 * see whether it is right. So it is read back here: the numbers out of the
 * path, against the numbers that should be in it.
 *
 * The claim the whole design rests on is the last one in this file — points
 * are fractions of the card, so scaling the card scales the drawing and
 * nothing has to be rewritten to make that true. */

/* The numbers out of a `d`, in order. */
const nums = (d: string): number[] => (d.match(/-?\d*\.?\d+/g) || []).map(Number)

/* The commands out of a `d`, in order. */
const cmds = (d: string): string => (d.match(/[A-Za-z]/g) || []).join('')

/* A `d` split into its commands and their arguments. */
const parts = (d: string): { cmd: string; args: number[] }[] =>
  (d.match(/[A-Za-z][^A-Za-z]*/g) || []).map((s) => ({ cmd: s[0], args: nums(s.slice(1)) }))

/* Only the numbers in a `d` that are lengths on the board.
 *
 * An arc carries seven: two radii, a rotation, two flags and a point. Three of
 * those are not lengths, and a doubled sweep flag is not a sweep flag — which
 * is the whole reason this is here rather than a map over every number. */
const spans = (d: string): number[] =>
  parts(d).flatMap((p) => (p.cmd.toUpperCase() === 'A' ? [p.args[0], p.args[1], p.args[5], p.args[6]] : p.args))

const dist = (a: [number, number], c: [number, number]) => Math.hypot(a[0] - c[0], a[1] - c[1])

describe('a rectangle', () => {
  it('is four sides and no arcs when its corners are square', () => {
    expect(rectPath(200, 100)).toBe('M0 0H200V100H0Z')
    expect(cmds(rectPath(200, 100))).toBe('MHVHZ')
  })

  it('rounds its corners with four arcs', () => {
    expect(cmds(rectPath(200, 100, 0.2))).toBe('MHAVAHAVAZ')
  })

  it('measures the radius off the shortest side, so a wide box rounds like a tall one', () => {
    /* A quarter of 100 either way round. */
    expect(nums(rectPath(400, 100, 0.25))[0]).toBe(25)
    expect(nums(rectPath(100, 400, 0.25))[0]).toBe(25)
  })

  it('will not round past half, because past half the corners have met', () => {
    const stadium = rectPath(200, 100, 0.5)
    expect(nums(stadium)[0]).toBe(50)
    /* Asking for more is the same drawing, not a broken one. */
    expect(rectPath(200, 100, 4)).toBe(stadium)
    expect(rectPath(200, 100, -1)).toBe(rectPath(200, 100, 0))
  })

  it('keeps its corners in proportion when the card is scaled', () => {
    const small = rectPath(100, 100, 0.3)
    const big = rectPath(200, 200, 0.3)
    expect(cmds(big)).toBe(cmds(small))
    expect(spans(big)).toEqual(spans(small).map((v) => v * 2))
    /* The arc flags are not lengths and do not scale with anything. */
    expect(parts(big).filter((p) => p.cmd === 'A').map((p) => p.args.slice(2, 5)))
      .toEqual(parts(small).filter((p) => p.cmd === 'A').map((p) => p.args.slice(2, 5)))
  })
})

describe('an ellipse', () => {
  it('is two arcs that end where they began', () => {
    expect(cmds(ellipsePath(200, 100))).toBe('MAAZ')
  })

  it('fills the box it was drawn in', () => {
    const v = nums(ellipsePath(200, 100))
    /* Starts at the left edge, half way down; the radii are half the box. */
    expect([v[0], v[1]]).toEqual([0, 50])
    expect([v[2], v[3]]).toEqual([100, 50])
  })
})

describe('a polygon', () => {
  it('has as many corners as it was asked for', () => {
    for (const sides of [3, 5, 6, 12]) expect(polyPoints(sides, 100, 100).length).toBe(sides)
  })

  it('will not be a shape with fewer than three sides', () => {
    expect(polyPoints(2, 100, 100).length).toBe(3)
    expect(polyPoints(0, 100, 100).length).toBe(3)
  })

  it('starts at the top', () => {
    const [first] = polyPoints(6, 100, 100)
    expect(first[0]).toBeCloseTo(50, 6)
    expect(first[1]).toBeCloseTo(0, 6)
  })

  it('is inscribed in the box, so a polygon drawn wide is wide', () => {
    const pts = polyPoints(4, 200, 100)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(200, 6)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(100, 6)
  })

  it('turns about its own middle without leaving it', () => {
    const still = polyPoints(5, 100, 100)
    const turned = polyPoints(5, 100, 100, 72)
    /* A fifth of a turn on a pentagon is the same pentagon, one corner along. */
    expect(turned[0][0]).toBeCloseTo(still[1][0], 4)
    expect(turned[0][1]).toBeCloseTo(still[1][1], 4)
  })
})

describe('a star', () => {
  it('has two points for every point, out and in', () => {
    expect(starPoints(5, 0.45, 100, 100).length).toBe(10)
    expect(starPoints(8, 0.45, 100, 100).length).toBe(16)
  })

  it('alternates them', () => {
    const mid: [number, number] = [50, 50]
    const pts = starPoints(5, 0.4, 100, 100)
    const out = pts.filter((_, i) => i % 2 === 0).map((p) => dist(p, mid))
    const inn = pts.filter((_, i) => i % 2 === 1).map((p) => dist(p, mid))
    for (const d of out) expect(d).toBeCloseTo(50, 4)
    for (const d of inn) expect(d).toBeCloseTo(20, 4)
  })

  it('keeps the inner points inside, however they are asked for', () => {
    const mid: [number, number] = [50, 50]
    /* Nought would be a five-legged asterisk with no body; one would be a
     * decagon. Neither is a star, so both are refused at the edges. */
    expect(dist(starPoints(5, 0, 100, 100)[1], mid)).toBeGreaterThan(0)
    expect(dist(starPoints(5, 9, 100, 100)[1], mid)).toBeLessThan(50)
  })
})

describe('a path', () => {
  const corner = (x: number, y: number): Node => ({ x, y })

  it('is nothing at all until it has a point', () => {
    expect(nodesPath([], false, 100, 100)).toBe('')
  })

  it('is a single move while it has one point, which is what the pen draws first', () => {
    expect(nodesPath([corner(0.5, 0.25)], false, 200, 100)).toBe('M100 25')
  })

  it('turns fractions of the card into lengths on it', () => {
    expect(nodesPath([corner(0, 0), corner(1, 0.5)], false, 200, 100)).toBe('M0 0L200 50')
  })

  it('draws straight between corners and curved between handles', () => {
    const straight = [corner(0, 0), corner(1, 1)]
    expect(cmds(nodesPath(straight, false, 100, 100))).toBe('ML')
    const curved: Node[] = [{ x: 0, y: 0, ox: 0.3, oy: 0 }, { x: 1, y: 1, ix: -0.3, iy: 0 }]
    expect(cmds(nodesPath(curved, false, 100, 100))).toBe('MC')
    expect(nodesPath(curved, false, 100, 100)).toBe('M0 0C30 0 70 100 100 100')
  })

  it('curves a segment with a handle at one end only', () => {
    const half: Node[] = [{ x: 0, y: 0 }, { x: 1, y: 1, ix: -0.4, iy: 0 }]
    /* The end without a handle keeps its own point as its control: a straight
     * departure into a curved arrival, which is what a pen does. */
    expect(nodesPath(half, false, 100, 100)).toBe('M0 0C0 0 60 100 100 100')
  })

  it('joins back up when it is closed', () => {
    const tri = [corner(0.5, 0), corner(1, 1), corner(0, 1)]
    expect(nodesPath(tri, false, 100, 100)).toBe('M50 0L100 100L0 100')
    expect(nodesPath(tri, true, 100, 100)).toBe('M50 0L100 100L0 100L50 0Z')
  })
})

describe('what each kind draws', () => {
  it('dispatches on the kind and nothing else', () => {
    expect(pathFor({ kind: 'rect' }, 200, 100)).toBe(rectPath(200, 100, 0))
    expect(pathFor({ kind: 'ellipse' }, 200, 100)).toBe(ellipsePath(200, 100))
    expect(cmds(pathFor({ kind: 'polygon', sides: 7 }, 100, 100))).toBe('M' + 'L'.repeat(6) + 'Z')
    expect(cmds(pathFor({ kind: 'star', sides: 5 }, 100, 100))).toBe('M' + 'L'.repeat(9) + 'Z')
  })

  it('draws a line with no points down the diagonal, which is what a drag gives it', () => {
    expect(pathFor({ kind: 'line' }, 200, 100)).toBe('M0 0L200 100')
  })

  it('reads the radius and the number of sides off the record', () => {
    expect(nums(pathFor({ kind: 'rect', radius: 0.5 }, 100, 100))[0]).toBe(50)
    expect(polyPoints(3, 10, 10).length).toBe(3)
  })

  it('falls back to the defaults for anything the record does not say', () => {
    /* A polygon written down as nothing but "polygon" is still a hexagon. */
    expect(cmds(pathFor({ kind: 'polygon' }, 100, 100))).toBe('M' + 'L'.repeat(DEFAULTS.sides - 1) + 'Z')
  })
})

describe('arrowheads', () => {
  const line = (heads: ShapeSpec['heads'], width = 2): ShapeSpec => ({
    kind: 'arrow',
    nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    width,
    heads,
  })

  it('are worn only where they were asked for', () => {
    expect(headsFor(line('none'), 100, 100).length).toBe(0)
    expect(headsFor(line('end'), 100, 100).length).toBe(1)
    expect(headsFor(line('start'), 100, 100).length).toBe(1)
    expect(headsFor(line('both'), 100, 100).length).toBe(2)
  })

  it('never appear on a shape that has no ends', () => {
    expect(headsFor({ kind: 'rect', heads: 'both' }, 100, 100).length).toBe(0)
    expect(headsFor({ kind: 'ellipse', heads: 'end' }, 100, 100).length).toBe(0)
  })

  it('sit on the end of the line and point the way it is going', () => {
    const [d] = headsFor(line('end'), 100, 100)
    const v = nums(d)
    /* Tip at the line's end. */
    expect([v[0], v[1]]).toEqual([100, 0])
    /* The two back corners are the same distance behind it and either side. */
    expect(v[2]).toBe(v[4])
    expect(v[3]).toBe(-v[5])
    expect(v[2]).toBeLessThan(100)
  })

  it('point the other way at the other end', () => {
    const [d] = headsFor(line('start'), 100, 100)
    const v = nums(d)
    expect([v[0], v[1]]).toEqual([0, 0])
    expect(v[2]).toBeGreaterThan(0)
  })

  it('grow with the stroke, because an arrowhead that does not is a different arrow', () => {
    const thin = nums(headsFor(line('end', 2), 100, 100)[0])
    const thick = nums(headsFor(line('end', 8), 100, 100)[0])
    expect(100 - thick[2]).toBeGreaterThan(100 - thin[2])
  })
})

describe('thinning out a freehand stroke', () => {
  it('leaves a stroke of two points alone', () => {
    const two: [number, number][] = [[0, 0], [1, 1]]
    expect(simplify(two)).toEqual(two)
  })

  it('throws away every point that was on the way', () => {
    const line: [number, number][] = [[0, 0], [0.1, 0], [0.25, 0], [0.6, 0], [0.9, 0], [1, 0]]
    expect(simplify(line)).toEqual([[0, 0], [1, 0]])
  })

  it('keeps the ones that are the shape', () => {
    const vee: [number, number][] = [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.25], [1, 0]]
    expect(simplify(vee)).toEqual([[0, 0], [0.5, 0.5], [1, 0]])
  })

  it('never moves the two ends', () => {
    const wiggle: [number, number][] = Array.from({ length: 40 }, (_, i) => [i / 39, Math.sin(i / 3) * 0.2])
    const out = simplify(wiggle)
    expect(out[0]).toEqual(wiggle[0])
    expect(out[out.length - 1]).toEqual(wiggle[wiggle.length - 1])
  })

  it('keeps nothing further off the line than the tolerance', () => {
    const wiggle: [number, number][] = Array.from({ length: 200 }, (_, i) => [i / 199, Math.sin(i / 7) * 0.3])
    const out = simplify(wiggle, 0.01)
    expect(out.length).toBeLessThan(wiggle.length / 3)
    /* And every thrown-away point is still within the tolerance of what is
     * left, which is the promise the tolerance makes. */
    for (const [px, py] of wiggle) {
      let near = Infinity
      for (let i = 0; i < out.length - 1; i++) {
        const [ax, ay] = out[i]
        const [bx, by] = out[i + 1]
        const dx = bx - ax
        const dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = Math.max(0, Math.min(1, len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0))
        near = Math.min(near, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
      }
      expect(near).toBeLessThanOrEqual(0.01 + 1e-9)
    }
  })

  it('is looser or tighter as it is asked', () => {
    const wiggle: [number, number][] = Array.from({ length: 120 }, (_, i) => [i / 119, Math.sin(i / 5) * 0.3])
    expect(simplify(wiggle, 0.05).length).toBeLessThan(simplify(wiggle, 0.002).length)
  })
})

describe('smoothing a stroke', () => {
  const pts: [number, number][] = [[0, 0], [0.25, 0.4], [0.5, 0], [0.75, 0.4], [1, 0]]

  it('passes through every point it was given, because that is where the hand went', () => {
    const nodes = smoothNodes(pts)
    expect(nodes.map((p) => [p.x, p.y])).toEqual(pts)
  })

  it('gives the two ends one handle each and the rest two', () => {
    const nodes = smoothNodes(pts)
    expect(nodes[0].ix).toBeUndefined()
    expect(nodes[0].ox).toBeDefined()
    expect(nodes[nodes.length - 1].ox).toBeUndefined()
    expect(nodes[nodes.length - 1].ix).toBeDefined()
    expect(isSmooth(nodes[2])).toBe(true)
  })

  it('points each handle along the line between its neighbours', () => {
    const [, second] = smoothNodes(pts, 0.25)
    /* Neighbours are (0,0) and (0.5,0): a quarter of that is (0.125, 0). */
    expect(second.ox).toBeCloseTo(0.125, 6)
    expect(second.oy).toBeCloseTo(0, 6)
    expect(second.ix).toBeCloseTo(-0.125, 6)
  })

  it('draws no curve at all at no tension', () => {
    expect(cmds(nodesPath(smoothNodes(pts, 0), false, 100, 100))).toBe('MCCCC')
    const flat = smoothNodes(pts, 0)
    for (const p of flat.slice(1, -1)) {
      expect(p.ox).toBe(0)
      expect(p.ix).toBe(0)
    }
  })

  it('leaves a single point as a point', () => {
    expect(smoothNodes([[0.5, 0.5]])).toEqual([{ x: 0.5, y: 0.5 }])
  })
})

describe('editing the points', () => {
  const square: Node[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

  it('finds the segment a click is nearest', () => {
    expect(nearestSegment(square, true, 0.5, 0.02).at).toBe(0)
    expect(nearestSegment(square, true, 0.98, 0.5).at).toBe(1)
    expect(nearestSegment(square, true, 0.5, 0.98).at).toBe(2)
    expect(nearestSegment(square, true, 0.02, 0.5).at).toBe(3)
  })

  it('does not offer the closing segment on an open path', () => {
    /* The left-hand side is not a side at all until the path is closed. */
    expect(nearestSegment(square, false, 0.02, 0.5).at).not.toBe(3)
  })

  it('says how far along the segment the click fell', () => {
    expect(nearestSegment(square, true, 0.25, 0).t).toBeCloseTo(0.25, 6)
    expect(nearestSegment(square, true, -5, 0).t).toBe(0)
  })

  it('adds a point into the segment it was clicked on, not onto the end', () => {
    const out = addNode(square, true, 0.5, 0)
    expect(out.length).toBe(5)
    expect(out[1]).toMatchObject({ x: 0.5, y: 0 })
    expect(out[2]).toMatchObject({ x: 1, y: 0 })
  })

  it('leaves the shape it was added to alone', () => {
    const out = addNode(square, true, 0.5, 0)
    expect(out.filter((p) => square.some((q) => q.x === p.x && q.y === p.y)).length).toBe(4)
    expect(square.length).toBe(4)
  })

  it('makes the new point smooth when the line it joined was', () => {
    const curvy: Node[] = [{ x: 0, y: 0, ox: 0.2, oy: 0 }, { x: 1, y: 0, ix: -0.2, iy: 0 }]
    expect(isSmooth(addNode(curvy, false, 0.5, 0)[1])).toBe(true)
    expect(isSmooth(addNode(square, false, 0.5, 0)[1])).toBe(false)
  })

  it('takes a point out', () => {
    expect(dropNode(square, 1).map((p) => p.x)).toEqual([0, 1, 0])
    expect(square.length).toBe(4)
  })

  it('refuses to take out the last two, because two is the fewest a path can be', () => {
    const pair = square.slice(0, 2)
    expect(dropNode(pair, 0)).toBe(pair)
    expect(dropNode(square, 9)).toBe(square)
    expect(dropNode(square, -1)).toBe(square)
  })

  it('turns a corner smooth and back again', () => {
    const smooth = toggleSmooth(square, 1)
    expect(isSmooth(smooth[1])).toBe(true)
    expect(isSmooth(toggleSmooth(smooth, 1)[1])).toBe(false)
    /* And the point itself never moves either way. */
    expect([smooth[1].x, smooth[1].y]).toEqual([1, 0])
  })

  it('points a new smooth handle along its neighbours', () => {
    /* Either side of the top-right corner are (0,0) and (1,1). */
    const [, , , ] = square
    const node = toggleSmooth(square, 1)[1]
    expect(node.ox).toBeCloseTo(0.25, 6)
    expect(node.oy).toBeCloseTo(0.25, 6)
    expect(node.ix).toBeCloseTo(-0.25, 6)
  })

  it('leaves everything alone when asked about a point that is not there', () => {
    expect(toggleSmooth(square, 7)).toBe(square)
  })
})

describe('moving the points about', () => {
  const square: Node[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

  it('moves a point and leaves the rest where they were', () => {
    const out = moveNode(square, 2, -0.5, 0.25)
    expect(out[2]).toEqual({ x: 0.5, y: 1.25 })
    expect(out[0]).toEqual(square[0])
    expect(square[2]).toEqual({ x: 1, y: 1 })
  })

  it('takes the handles with it, because they are offsets from the point', () => {
    const curvy: Node[] = [{ x: 0.5, y: 0.5, ox: 0.2, oy: 0, ix: -0.2, iy: 0 }]
    const out = moveNode(curvy, 0, 0.25, 0.25)
    expect(out[0]).toEqual({ x: 0.75, y: 0.75, ox: 0.2, oy: 0, ix: -0.2, iy: 0 })
  })

  it('leaves everything alone for a point that is not there', () => {
    expect(moveNode(square, 9, 1, 1)).toBe(square)
  })

  it('swings the other handle round with the one being moved', () => {
    const out = moveHandle(square, 1, 'out', 0.3, 0.1)
    expect(out[1]).toMatchObject({ ox: 0.3, oy: 0.1, ix: -0.3, iy: -0.1 })
  })

  it('and leaves it alone when the point is being broken', () => {
    const start = moveHandle(square, 1, 'out', 0.3, 0.1)
    const broken = moveHandle(start, 1, 'in', 0.05, 0.4, false)
    expect(broken[1]).toMatchObject({ ox: 0.3, oy: 0.1, ix: 0.05, iy: 0.4 })
  })
})

describe('bending a segment by pulling on it', () => {
  const line: Node[] = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]

  it('gives a straight segment handles, because a straight line has nowhere to put a bend', () => {
    expect(isSmooth(line[0])).toBe(false)
    const bent = bendSegment(line, false, 0, 0.5, 0, 0.2)
    expect(isSmooth(bent[0])).toBe(true)
    expect(isSmooth(bent[1])).toBe(true)
  })

  it('puts the line where it was pulled to', () => {
    const bent = bendSegment(line, false, 0, 0.5, 0, 0.25)
    const mid = pointOnSegment(bent, 0, 0.5)
    expect(mid.x).toBeCloseTo(0.5, 6)
    expect(mid.y).toBeCloseTo(0.75, 6)
  })

  it('puts it where it was pulled to from anywhere along it', () => {
    for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const bent = bendSegment(line, false, 0, t, 0.05, -0.3)
      const was = pointOnSegment(line, 0, t)
      const now = pointOnSegment(bent, 0, t)
      expect(now.x - was.x, `t=${t}`).toBeCloseTo(0.05, 6)
      expect(now.y - was.y, `t=${t}`).toBeCloseTo(-0.3, 6)
    }
  })

  it('travels a straight segment evenly, which is what half way along means', () => {
    /* A cubic whose controls sit on its own endpoints runs along its line
       fast in the middle and slow at the ends, so "a fifth of the way" would
       not be where anybody dragging it thinks it is. */
    for (const t of [0.2, 0.5, 0.8]) {
      expect(pointOnSegment(line, 0, t).x, `t=${t}`).toBeCloseTo(t, 6)
    }
  })

  it('moves an already-curved segment by exactly what it was pulled', () => {
    const arc: Node[] = [
      { x: 0, y: 0.5, ox: 0.3, oy: -0.3 },
      { x: 1, y: 0.5, ix: -0.3, iy: -0.3 },
    ]
    for (const t of [0.3, 0.5, 0.7]) {
      const bent = bendSegment(arc, false, 0, t, -0.1, 0.2)
      const was = pointOnSegment(arc, 0, t)
      const now = pointOnSegment(bent, 0, t)
      expect(now.x - was.x, `t=${t}`).toBeCloseTo(-0.1, 6)
      expect(now.y - was.y, `t=${t}`).toBeCloseTo(0.2, 6)
    }
  })

  it('never moves the two ends of the segment it bends', () => {
    const bent = bendSegment(line, false, 0, 0.4, 0.2, 0.4)
    expect([bent[0].x, bent[0].y]).toEqual([0, 0.5])
    expect([bent[1].x, bent[1].y]).toEqual([1, 0.5])
  })

  it('leaves the rest of the path alone', () => {
    const three: Node[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }]
    const bent = bendSegment(three, false, 0, 0.5, 0, 0.3)
    expect(bent[2]).toEqual(three[2])
  })

  it('will not be asked to bend a segment that is not there', () => {
    expect(bendSegment(line, false, 1, 0.5, 0, 0.2)).toBe(line)
    expect(bendSegment(line, false, -1, 0.5, 0, 0.2)).toBe(line)
    /* Closed, that last segment is the one joining the ends and is real. */
    expect(bendSegment(line, true, 1, 0.5, 0, 0.2)).not.toBe(line)
  })

  it('still bends when the grab was right on an end, where neither control has a say', () => {
    const bent = bendSegment(line, false, 0, 0, 0, 0.3)
    expect(Number.isFinite(bent[0].ox)).toBe(true)
    expect(pointOnSegment(bent, 0, 0.5).y).toBeGreaterThan(0.5)
  })
})

describe('finding the place on the line', () => {
  const bowed: Node[] = [
    { x: 0, y: 0.5, ox: 0.3, oy: -0.4 },
    { x: 1, y: 0.5, ix: -0.3, iy: -0.4 },
  ]

  it('finds it on the curve rather than on the line between the points', () => {
    /* The top of the bow is well above the straight run between its ends, so
       a point just under the bow is near the curve and far from the chord. */
    const top = pointOnSegment(bowed, 0, 0.5)
    expect(top.y).toBeLessThan(0.35)
    const found = nearestOn(bowed, false, top.x, top.y)
    expect(found.at).toBe(0)
    expect(found.t).toBeCloseTo(0.5, 1)
    expect(found.d).toBeLessThan(0.02)
  })

  it('picks the right segment out of several', () => {
    const zig: Node[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }]
    expect(nearestOn(zig, false, 0.25, 0.02).at).toBe(0)
    expect(nearestOn(zig, false, 0.52, 0.7).at).toBe(1)
  })

  it('offers the closing segment only on a closed path', () => {
    const tri: Node[] = [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    expect(nearestOn(tri, false, 0.25, 0.5).at).not.toBe(2)
    expect(nearestOn(tri, true, 0.25, 0.5).at).toBe(2)
  })
})

describe('finding the point under the pointer', () => {
  const square: Node[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

  it('names the nearest one within reach', () => {
    expect(nodeAt(square, 0.02, 0.02, 0.1)).toBe(0)
    expect(nodeAt(square, 0.97, 1.01, 0.1)).toBe(2)
  })

  it('says nothing at all when the press was nowhere near one', () => {
    expect(nodeAt(square, 0.5, 0.5, 0.1)).toBe(-1)
  })

  it('takes the nearer of two that are both within reach', () => {
    const pair: Node[] = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }]
    expect(nodeAt(pair, 0.07, 0, 0.5)).toBe(1)
    expect(nodeAt(pair, 0.03, 0, 0.5)).toBe(0)
  })
})

describe('fitting a drawing to its own box', () => {
  it('finds the box the points really occupy', () => {
    const box = boundsOfNodes([{ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.9 }])
    expect(box.x).toBeCloseTo(0.2, 6)
    expect(box.y).toBeCloseTo(0.1, 6)
    expect(box.w).toBeCloseTo(0.4, 6)
    expect(box.h).toBeCloseTo(0.8, 6)
  })

  it('rewrites the points to fill it', () => {
    const { nodes, box } = normalise([{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, { x: 0.5, y: 1 }])
    expect(box.x).toBeCloseTo(0.25, 6)
    expect(box.w).toBeCloseTo(0.5, 6)
    const xs = nodes.map((p) => p.x)
    const ys = nodes.map((p) => p.y)
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(1, 6)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(1, 6)
  })

  it('scales the handles with the points, so the curve is the same curve', () => {
    const { nodes } = normalise([
      { x: 0.25, y: 0, ox: 0.1, oy: 0 },
      { x: 0.75, y: 1, ix: -0.1, iy: 0 },
    ])
    /* The box was half the width, so a handle in it is twice the fraction. */
    expect(nodes[0].ox).toBeCloseTo(0.2, 6)
    expect(nodes[1].ix).toBeCloseTo(-0.2, 6)
  })

  it('survives a drawing with no width at all', () => {
    const { nodes } = normalise([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }])
    for (const p of nodes) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('says a unit box for no points at all', () => {
    expect(boundsOfNodes([])).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('a shape before anybody has said anything about it', () => {
  it('gives a line and a path no fill, because a fill on an open squiggle is a shape nobody drew', () => {
    expect(specFor('line').fill).toBeNull()
    expect(specFor('path').fill).toBeNull()
    expect(specFor('arrow').fill).toBeNull()
  })

  it('gives an arrow its head, which is the only thing making it not a line', () => {
    expect(specFor('arrow').heads).toBe('end')
    expect(settingOf(specFor('line'), 'heads')).toBe('none')
  })

  it('gives a polygon sides and a star its points', () => {
    expect(specFor('polygon').sides).toBe(6)
    expect(specFor('star').sides).toBe(5)
    expect(specFor('star').inner).toBeLessThan(1)
  })

  it('reads a setting off the record when it is there and off the defaults when it is not', () => {
    expect(settingOf({ kind: 'rect', width: 9 }, 'width')).toBe(9)
    expect(settingOf({ kind: 'rect' }, 'width')).toBe(DEFAULTS.width)
    expect(settingOf(undefined, 'fill')).toBe(DEFAULTS.fill)
    /* Null is a choice — no fill at all — and not the absence of one. */
    expect(settingOf({ kind: 'rect', fill: null }, 'fill')).toBeNull()
  })

  it('offers a solid line first among the dashes, and every other one is a real pattern', () => {
    expect(DASHES[0].dash).toBe('')
    for (const d of DASHES.slice(1)) {
      expect(d.dash.split(/\s+/).length).toBeGreaterThanOrEqual(2)
      for (const v of d.dash.split(/\s+/)) expect(Number(v)).toBeGreaterThan(0)
    }
  })
})

describe('the paint, written once', () => {
  it('says no fill rather than white, because those are different drawings', () => {
    expect(paintOf({ kind: 'rect', fill: null }).fill).toBe('none')
    expect(paintOf({ kind: 'rect', fill: '#fff' }).fill).toBe('#fff')
  })

  it('turns a dash written in stroke widths into the lengths SVG wants', () => {
    expect(paintOf({ kind: 'rect', dash: '4 2', width: 3 })['stroke-dasharray']).toBe('12 6')
    /* A solid line has no dash attribute at all rather than an empty one. */
    expect(paintOf({ kind: 'rect' })['stroke-dasharray']).toBeUndefined()
  })

  it('carries the cap and the join through under SVG names', () => {
    const p = paintOf({ kind: 'line', cap: 'square', join: 'bevel', width: 5 })
    expect(p['stroke-linecap']).toBe('square')
    expect(p['stroke-linejoin']).toBe('bevel')
    expect(p['stroke-width']).toBe('5')
  })
})

describe('how far the paint reaches outside the box', () => {
  it('is nothing at all when there is no line round it', () => {
    expect(outsetOf({ kind: 'rect', fill: '#000', stroke: null })).toBe(0)
  })

  it('is half the stroke, because a stroke straddles the line it is on', () => {
    expect(outsetOf({ kind: 'rect', stroke: '#000', width: 20, join: 'round' })).toBe(10)
  })

  it('is more on a sharp corner, where a mitre runs out past the stroke', () => {
    const sharp = outsetOf({ kind: 'rect', stroke: '#000', width: 20, join: 'miter' })
    expect(sharp).toBeGreaterThan(outsetOf({ kind: 'rect', stroke: '#000', width: 20, join: 'round' }))
  })

  it('is enough for an arrowhead, which reaches further than its own line', () => {
    const head = outsetOf({ kind: 'arrow', stroke: '#000', width: 4, heads: 'end' })
    expect(head).toBeGreaterThanOrEqual(Math.ceil(4 * 3.2))
  })
})

describe('a shape written out as a file of its own', () => {
  const spec: ShapeSpec = { kind: 'rect', fill: '#2F6FEB', stroke: '#111', width: 4, radius: 0.2 }

  it('is one SVG with the path in it', () => {
    const out = svgFor(spec, 200, 100)
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(out.endsWith('</svg>')).toBe(true)
    expect(out).toContain(`d="${pathFor(spec, 200, 100)}"`)
  })

  it('paints it exactly as the card does', () => {
    const out = svgFor(spec, 200, 100)
    for (const [k, v] of Object.entries(paintOf(spec))) expect(out, k).toContain(`${k}="${v}"`)
  })

  it('opens the picture out round the drawing when asked, and moves the origin with it', () => {
    const out = svgFor(spec, 200, 100, 10)
    expect(out).toContain('width="220"')
    expect(out).toContain('height="120"')
    expect(out).toContain('viewBox="-10 -10 220 120"')
  })

  it('carries the arrowheads, which are paths of their own', () => {
    const arrow: ShapeSpec = { kind: 'arrow', nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }], stroke: '#111', width: 3, heads: 'both' }
    const out = svgFor(arrow, 200, 20)
    expect((out.match(/<path/g) || []).length).toBe(3)
  })

  it('has no ids in it, because forty of these go into one page', () => {
    expect(svgFor(spec, 200, 100)).not.toContain('id=')
  })

  it('escapes what it is given rather than letting it out as markup', () => {
    const nasty: ShapeSpec = { kind: 'rect', fill: '"><script>x()</script>' }
    const out = svgFor(nasty, 10, 10)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&quot;&gt;&lt;script&gt;')
  })
})

describe('the whole reason points are fractions', () => {
  const every: ShapeSpec[] = [
    { kind: 'rect', radius: 0.25 },
    { kind: 'ellipse' },
    { kind: 'polygon', sides: 7 },
    { kind: 'star', sides: 6, inner: 0.4 },
    { kind: 'line', nodes: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }] },
    { kind: 'path', nodes: [{ x: 0, y: 0, ox: 0.2, oy: 0.1 }, { x: 1, y: 1, ix: -0.2, iy: 0 }], closed: false },
  ]

  it('is that scaling the card scales the drawing, exactly, for every kind', () => {
    for (const spec of every) {
      const small = spans(pathFor(spec, 160, 120))
      const big = spans(pathFor(spec, 320, 240))
      expect(cmds(pathFor(spec, 320, 240)), spec.kind).toBe(cmds(pathFor(spec, 160, 120)))
      expect(small.length, spec.kind).toBe(big.length)
      for (let i = 0; i < small.length; i++) {
        expect(big[i], `${spec.kind} number ${i}`).toBeCloseTo(small[i] * 2, 1)
      }
    }
  })
})
