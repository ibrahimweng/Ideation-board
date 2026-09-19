import { describe, expect, it } from 'vitest'
import { FLOOR, anchorOf, boundsOf, factorsFor, floorScale, scaleAll } from '../../src/board/scaling'
import type { Box, Corner } from '../../src/board/scaling'

/* Scaling several cards as one.
 *
 * Every one of these is arithmetic the board does inside a pointer gesture,
 * where it cannot be looked at. The browser suite checks that a drag on the
 * group's corner reaches all of them; what each card's new box should be is
 * checked here, where the answer can be written down. */

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

describe('the box round the lot', () => {
  it('holds every card', () => {
    expect(boundsOf([box(10, 20, 100, 50), box(200, 10, 40, 200)])).toEqual({ x: 10, y: 10, w: 230, h: 200 })
  })

  it('is the card itself when there is one', () => {
    expect(boundsOf([box(5, 6, 7, 8)])).toEqual({ x: 5, y: 6, w: 7, h: 8 })
  })

  it('is nothing at all for nothing at all', () => {
    expect(boundsOf([])).toBeNull()
  })
})

describe('the corner that stays put', () => {
  const b = box(100, 200, 400, 300)

  it('is the one opposite the one being dragged', () => {
    expect(anchorOf(b, 'se')).toEqual({ x: 100, y: 200 })
    expect(anchorOf(b, 'nw')).toEqual({ x: 500, y: 500 })
    expect(anchorOf(b, 'ne')).toEqual({ x: 100, y: 500 })
    expect(anchorOf(b, 'sw')).toEqual({ x: 500, y: 200 })
  })

  it('and really does stay put, whichever corner is dragged', () => {
    for (const c of CORNERS) {
      const at = anchorOf(b, c)
      const [out] = scaleAll([b], b, c, 60, 40)
      const corner = {
        x: c.includes('w') ? out.x + out.w : out.x,
        y: c.includes('n') ? out.y + out.h : out.y,
      }
      expect(corner, `${c} moved its anchor`).toEqual(at)
    }
  })
})

describe('what a drag asks for', () => {
  const b = box(0, 0, 400, 200)

  it('grows the box when the corner is dragged away from its anchor', () => {
    expect(factorsFor(b, 'se', 400, 0, true).kx).toBe(2)
    expect(factorsFor(b, 'nw', -400, 0, true).kx).toBe(2)
  })

  it('shrinks it when dragged towards it', () => {
    expect(factorsFor(b, 'se', -200, 0, true).kx).toBe(0.5)
  })

  /* A free corner drag across four photographs squashes all four, and nobody
     drags the corner of a group of photographs in order to squash them. */
  it('scales both axes by one factor unless asked not to', () => {
    const tied = factorsFor(b, 'se', 400, 0, false)
    expect(tied.kx).toBe(tied.ky)
    const free = factorsFor(b, 'se', 400, 0, true)
    expect(free.kx).not.toBe(free.ky)
  })

  it('takes that factor from whichever way the drag went further', () => {
    /* Along the box's width: 400 of 400 is a doubling; 40 of 200 is a fifth. */
    expect(factorsFor(b, 'se', 400, 40, false).kx).toBe(2)
    /* And the other way round. */
    expect(factorsFor(b, 'se', 40, 200, false).kx).toBe(2)
  })

  it('leaves an axis alone rather than dividing by a box with no size', () => {
    expect(factorsFor(box(0, 0, 0, 100), 'se', 50, 0, true).kx).toBe(1)
  })
})

describe('the floor', () => {
  it('is how far a card can shrink before it cannot be got hold of', () => {
    expect(floorScale([box(0, 0, 120, 120)])).toBeCloseTo(FLOOR / 120)
  })

  it('is set by the smallest card in the selection', () => {
    expect(floorScale([box(0, 0, 400, 400), box(0, 0, 48, 400)])).toBeCloseTo(FLOOR / 48)
  })

  /* A label is fifty-six tall the day it is made. Applying a single card's
     eighty-by-sixty here would mean a selection with one in it could not be
     shrunk at all. */
  it('does not let one card already under it freeze the rest', () => {
    expect(floorScale([box(0, 0, 400, 400), box(0, 0, 4, 4)])).toBeCloseTo(FLOOR / 400)
  })

  it('stops a drag rather than turning the selection inside out', () => {
    const items = [box(0, 0, 100, 100)]
    const out = scaleAll(items, boundsOf(items)!, 'se', -400, -400)
    expect(out[0].w).toBeGreaterThanOrEqual(FLOOR)
    expect(out[0].h).toBeGreaterThanOrEqual(FLOOR)
  })
})

describe('scaling the selection', () => {
  const items = [box(0, 0, 100, 100), box(200, 100, 100, 100)]
  const b = boundsOf(items)!

  it('takes every card with it, not just the one under the pointer', () => {
    const out = scaleAll(items, b, 'se', b.w, b.h)
    expect(out[0]).toEqual({ x: 0, y: 0, w: 200, h: 200 })
    expect(out[1]).toEqual({ x: 400, y: 200, w: 200, h: 200 })
  })

  it('moves them apart by the same factor it grows them', () => {
    const out = scaleAll(items, b, 'se', b.w, b.h)
    const gapWas = items[1].x - (items[0].x + items[0].w)
    const gapNow = out[1].x - (out[0].x + out[0].w)
    expect(gapNow).toBe(gapWas * 2)
  })

  it('keeps every card the shape it was', () => {
    const odd = [box(0, 0, 300, 100), box(0, 200, 100, 400)]
    const out = scaleAll(odd, boundsOf(odd)!, 'se', 150, 20)
    for (let i = 0; i < odd.length; i++) {
      expect(out[i].w / out[i].h).toBeCloseTo(odd[i].w / odd[i].h, 1)
    }
  })

  it('and squashes them only when asked to', () => {
    const [out] = scaleAll([box(0, 0, 200, 200)], box(0, 0, 200, 200), 'se', 200, 0, true)
    expect(out.w).toBe(400)
    expect(out.h).toBe(200)
  })

  it('leaves them exactly as they were for a drag of nothing', () => {
    expect(scaleAll(items, b, 'se', 0, 0)).toEqual(items)
  })

  it('gives back one box per card, in the order it was handed them', () => {
    expect(scaleAll(items, b, 'nw', -10, -10)).toHaveLength(items.length)
  })

  it('never hands back a card with no size', () => {
    const tiny = [box(0, 0, 3, 3)]
    const out = scaleAll(tiny, boundsOf(tiny)!, 'se', -1000, -1000)
    expect(out[0].w).toBeGreaterThan(0)
    expect(out[0].h).toBeGreaterThan(0)
  })
})
