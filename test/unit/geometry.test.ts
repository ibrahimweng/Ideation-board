import { describe, expect, it } from 'vitest'
import { coverUv } from '../../src/engine/gl'
import { exportSize } from '../../src/state/exportImage'
import { readingOrder, showable } from '../../src/state/order'
import type { Item } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'

/* The arithmetic that decides what part of a picture you see, how big the file
 * that comes out of it is, and what order a board is read in. */

const item = (p: Partial<Item>): Item => ({
  id: p.id || 'i', kind: p.kind || 'image', x: 0, y: 0, z: 0, w: 100, h: 100,
  fx: { ...FX_0 }, tag: null, ...p,
} as Item)

describe('coverUv', () => {
  it('takes the whole picture when the shapes agree', () => {
    const c = coverUv(800, 600, 400, 300)
    expect(c.sx).toBeCloseTo(1, 5)
    expect(c.sy).toBeCloseTo(1, 5)
    expect(c.ox).toBeCloseTo(0, 5)
    expect(c.oy).toBeCloseTo(0, 5)
  })

  it('crops the sides of a wide picture in a square hole', () => {
    const c = coverUv(1200, 600, 300, 300)
    /* Half the width, all the height, centred. */
    expect(c.sx).toBeCloseTo(0.5, 5)
    expect(c.sy).toBeCloseTo(1, 5)
    expect(c.ox).toBeCloseTo(0.25, 5)
    expect(c.oy).toBeCloseTo(0, 5)
  })

  it('crops the top and bottom of a tall picture in a square hole', () => {
    const c = coverUv(600, 1200, 300, 300)
    expect(c.sx).toBeCloseTo(1, 5)
    expect(c.sy).toBeCloseTo(0.5, 5)
    expect(c.oy).toBeCloseTo(0.25, 5)
  })

  it('never asks for more of the picture than there is', () => {
    for (const [sw, sh, w, h] of [[100, 900, 900, 100], [4000, 10, 10, 4000], [7, 7, 1000, 3]]) {
      const c = coverUv(sw, sh, w, h)
      expect(c.sx).toBeLessThanOrEqual(1.0001)
      expect(c.sy).toBeLessThanOrEqual(1.0001)
      expect(c.ox + c.sx).toBeLessThanOrEqual(1.0001)
      expect(c.oy + c.sy).toBeLessThanOrEqual(1.0001)
    }
  })
})

describe('exportSize', () => {
  it('is the picture’s own resolution when the card is its shape', () => {
    const s = exportSize(1800, 1200, 420, 280)
    expect(s.w).toBe(1800)
    expect(s.h).toBe(1200)
  })

  it('is the crop, not a stretch, when the card is a different shape', () => {
    /* A square card on a wide picture keeps the full height and takes a square
       out of the middle. */
    const s = exportSize(1800, 1200, 300, 300)
    expect(s.h).toBe(1200)
    expect(s.w).toBe(1200)
  })

  it('takes the card’s shape, whatever the picture is', () => {
    const s = exportSize(1800, 1200, 400, 200)
    expect(s.w / s.h).toBeCloseTo(2, 2)
  })

  it('caps an enormous picture without changing its shape', () => {
    const s = exportSize(12000, 8000, 300, 200)
    expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(4096)
    expect(s.w / s.h).toBeCloseTo(1.5, 2)
  })

  it('survives a picture with no size', () => {
    expect(exportSize(0, 0, 100, 100)).toEqual({ w: 2, h: 2 })
  })
})

describe('readingOrder', () => {
  it('reads rows across before it moves down', () => {
    const cards = [
      item({ id: 'br', x: 400, y: 400 }),
      item({ id: 'tr', x: 400, y: 0 }),
      item({ id: 'bl', x: 0, y: 400 }),
      item({ id: 'tl', x: 0, y: 0 }),
    ]
    expect(readingOrder(cards).map((c) => c.id)).toEqual(['tl', 'tr', 'bl', 'br'])
  })

  it('treats a row that does not line up to the pixel as a row', () => {
    const cards = [
      item({ id: 'b', x: 300, y: 8 }),
      item({ id: 'a', x: 0, y: 0 }),
      item({ id: 'c', x: 600, y: 15 }),
    ]
    expect(readingOrder(cards).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('leaves out the things that are not things to show', () => {
    const cards = [item({ id: 'pic' }), item({ id: 's', kind: 'section' }), item({ id: 'e', kind: 'edge' })]
    expect(readingOrder(cards).map((c) => c.id)).toEqual(['pic'])
    expect(showable(cards[1])).toBe(false)
  })

  it('does not mind an empty board', () => {
    expect(readingOrder([])).toEqual([])
    expect(readingOrder([item({ kind: 'section' })])).toEqual([])
  })
})
