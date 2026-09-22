import { describe, expect, it } from 'vitest'
import { measure } from '../../src/state/measure'
import type { Box, Span } from '../../src/state/measure'

/* Holding a key and pointing at something to be told how far away it is.
 *
 * The figures are the whole feature, so most of this is arithmetic: the gap
 * between two cards side by side, the space left on each side of one sitting
 * inside another, and both at once for something away up and to the right.
 * The rest is about what must *not* appear — a zero on a flush edge, a figure
 * for an axis with nothing between the two boxes. */

const box = (x: number, y: number, w = 100, h = 80): Box => ({ x, y, w, h })

/* Only the lines that carry a figure. The rest are guides that carry the eye
 * from a box out to a measurement drawn beside it, and have no number. */
const figures = (spans: Span[]) => spans.filter((s) => s.n !== null).map((s) => s.n)
const flat = (s: Span) => s.y1 === s.y2
const len = (s: Span) => Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1)

describe('two things side by side', () => {
  it('measures the gap between the edges that face each other', () => {
    const spans = measure(box(0, 0), box(140, 0))
    expect(figures(spans)).toEqual([40])
  })

  it('and says nothing about the axis they are lined up on', () => {
    const spans = measure(box(0, 0), box(140, 0))
    expect(spans.filter(flat).length).toBe(1)
    expect(spans.filter((s) => !flat(s)).length).toBe(0)
  })

  it('draws it across the band the two of them share', () => {
    /* One box from 0 to 80 down, the other from 40 to 120: the shared band is
       40 to 80, so the line sits at 60 and crosses both. */
    const spans = measure(box(0, 0), box(140, 40))
    const line = spans.find((s) => flat(s) && s.n !== null)!
    expect(line.y1).toBe(60)
    expect(line.x1).toBe(100)
    expect(line.x2).toBe(140)
  })

  it('works the other way round, with the pointed at thing on the left', () => {
    const spans = measure(box(140, 0), box(0, 0))
    expect(figures(spans)).toEqual([40])
    const line = spans.find((s) => s.n !== null)!
    expect(line.x1).toBe(100)
    expect(line.x2).toBe(140)
  })

  it('measures nothing at all between two boxes that touch', () => {
    expect(measure(box(0, 0), box(100, 0))).toEqual([])
  })
})

describe('one thing inside another', () => {
  const outer = box(0, 0, 400, 300)

  it('measures the space left on each side', () => {
    const spans = measure(outer, box(50, 40, 100, 80))
    /* 50 in from the left, 250 from the right; 40 down from the top, 180 up
       from the bottom. */
    expect(figures(spans).sort((a, b) => a! - b!)).toEqual([40, 50, 180, 250])
  })

  it('draws no line at all on an edge that is flush', () => {
    const spans = measure(outer, box(0, 40, 100, 80))
    /* Flush on the left, so the left figure is gone rather than being a zero
       with a line of no length under it. */
    expect(figures(spans).includes(0)).toBe(false)
    expect(figures(spans).sort((a, b) => a! - b!)).toEqual([40, 180, 300])
  })

  it('measures nothing between a box and itself', () => {
    expect(measure(outer, { ...outer })).toEqual([])
  })

  it('every line it draws is as long as the figure on it', () => {
    for (const s of measure(outer, box(50, 40, 100, 80))) {
      if (s.n !== null) expect(len(s)).toBeCloseTo(s.n, 6)
    }
  })
})

describe('one thing away up and to the right', () => {
  const spans = measure(box(0, 200), box(200, 0))

  it('measures both ways at once', () => {
    expect(figures(spans).sort((a, b) => a! - b!)).toEqual([100, 120])
  })

  it('and draws a guide back to the selection for each of them', () => {
    /* The lines are drawn beside both boxes rather than across either, so
       without these the figures would float unattached to anything. */
    expect(spans.filter((s) => s.n === null).length).toBe(2)
  })

  it('puts the across measurement over the thing being pointed at', () => {
    /* Nothing is shared down the page, so it goes down the middle of the one
       under the cursor: 0 to 80, so 40. */
    const line = spans.find((s) => flat(s) && s.n !== null)!
    expect(line.y1).toBe(40)
  })
})

describe('what it refuses to invent', () => {
  it('never prints a zero', () => {
    const cases: [Box, Box][] = [
      [box(0, 0), box(100, 0)],
      [box(0, 0), box(0, 80)],
      [box(0, 0, 400, 300), box(0, 0, 400, 300)],
      [box(0, 0, 400, 300), box(0, 0, 100, 300)],
    ]
    for (const [a, b] of cases) expect(figures(measure(a, b)).includes(0)).toBe(false)
  })

  it('never draws a line running both ways at once', () => {
    for (const s of measure(box(0, 200), box(200, 0))) {
      expect(s.x1 === s.x2 || s.y1 === s.y2).toBe(true)
    }
  })

  it('measures the same distance whichever of the two is selected', () => {
    const a = box(0, 0)
    const b = box(300, 170)
    const one = figures(measure(a, b)).sort((p, q) => p! - q!)
    const two = figures(measure(b, a)).sort((p, q) => p! - q!)
    expect(one).toEqual(two)
  })
})
