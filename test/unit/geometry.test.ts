import { describe, expect, it } from 'vitest'
import { coverUv } from '../../src/engine/gl'
import { fitPad, fitView } from '../../src/board/viewport'
import { exportSize } from '../../src/state/exportImage'
import { readingOrder, showable } from '../../src/state/order'
import { alignTo, distributeAlong, tidyOnto } from '../../src/state/arrange'
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

/* ---------------------------------------------------------------------------
 * Lining up, spacing out, tidying.
 *
 * The arithmetic moved out of the store so it could be checked without a board
 * in front of it. These are the same questions the browser suite asks by
 * dragging cards about, asked directly.
 * ------------------------------------------------------------------------- */

describe('alignTo', () => {
  const three = [
    item({ id: 'a', x: 100, y: 0, w: 100, h: 50 }),
    item({ id: 'b', x: 40, y: 200, w: 300, h: 50 }),
    item({ id: 'c', x: 300, y: 400, w: 60, h: 90 }),
  ]

  it('puts every left edge on the leftmost', () => {
    const m = alignTo(three, 'left')
    expect([...m.values()].map((p) => p.x)).toEqual([40, 40])
    expect(m.has('b')).toBe(false)
  })

  it('puts every right edge on the rightmost, whatever the widths', () => {
    const m = alignTo(three, 'right')
    for (const it of three) {
      const at = m.get(it.id) || it
      expect(at.x + it.w).toBe(360)
    }
  })

  it('lists only what moves', () => {
    expect(alignTo(three, 'left').has('b')).toBe(false)
    expect(alignTo([item({ id: 'x' })], 'left').size).toBe(0)
  })

  it('centres on the middle of what is there, both ways', () => {
    const m = alignTo(three, 'hcentre')
    const middles = three.map((it) => (m.get(it.id)?.x ?? it.x) + it.w / 2)
    expect(new Set(middles).size).toBe(1)
    const v = alignTo(three, 'vmiddle')
    const rows = three.map((it) => (v.get(it.id)?.y ?? it.y) + it.h / 2)
    expect(new Set(rows).size).toBe(1)
  })
})

describe('distributeAlong', () => {
  it('leaves the ends alone and evens out the gaps between', () => {
    const list = [
      item({ id: 'a', x: 0, w: 100 }),
      item({ id: 'b', x: 120, w: 100 }),
      item({ id: 'c', x: 500, w: 100 }),
    ]
    const m = distributeAlong(list, 'x')
    expect(m.has('a')).toBe(false)
    expect(m.has('c')).toBe(false)
    const at = (i: number) => m.get(list[i].id)?.x ?? list[i].x
    expect(at(1) - (at(0) + 100)).toBeCloseTo(at(2) - (at(1) + 100), 0)
  })

  it('has nothing to even out with fewer than three', () => {
    expect(distributeAlong([item({ id: 'a' }), item({ id: 'b', x: 500 })], 'x').size).toBe(0)
  })
})

describe('tidyOnto', () => {
  it('never leaves two of them overlapping', () => {
    const list = Array.from({ length: 7 }, (_, i) => item({ id: `t${i}`, x: i * 130, y: (i % 3) * 20, w: 100, h: 80 }))
    const m = tidyOnto(list)
    const at = list.map((it) => ({ ...it, ...(m.get(it.id) || {}) }))
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        const p = at[i]
        const q = at[j]
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false)
      }
    }
  })

  it('keeps the footprint: a wide spread stays wide, a pile stays a column', () => {
    const wide = Array.from({ length: 6 }, (_, i) => item({ id: `w${i}`, x: i * 130, w: 100, h: 80 }))
    const tops = new Set([...tidyOnto(wide).values()].map((p) => p.y))
    expect(tops.size).toBeLessThan(6)

    const pile = Array.from({ length: 5 }, (_, i) => item({ id: `p${i}`, x: i * 4, y: i * 4, w: 100, h: 80 }))
    const cols = new Set([...tidyOnto(pile).values()].map((p) => p.x))
    expect(cols.size).toBe(1)
  })

  it('anchors at the top left of what was there, so tidying does not also move it', () => {
    const list = Array.from({ length: 4 }, (_, i) => item({ id: `t${i}`, x: 400 + i * 130, y: 300 + i * 9, w: 100, h: 80 }))
    const m = tidyOnto(list)
    const at = list.map((it) => ({ ...it, ...(m.get(it.id) || {}) }))
    expect(Math.min(...at.map((p) => p.x))).toBe(400)
    expect(Math.min(...at.map((p) => p.y))).toBe(300)
  })
})

describe('the margin a fit leaves round the board', () => {
  /* It was a flat 64 on every side. That is a comfortable frame on a laptop
     and a third of the screen on a phone: three cards fitted to a 390 pixel
     window came out at 43% when they would have gone in at 56%, with the whole
     board huddled in the middle of an empty page. */
  it('is small enough on a phone to leave the board the screen', () => {
    expect(fitPad(390, 780)).toBeLessThan(30)
  })

  it('and stays a proper frame on a laptop', () => {
    expect(fitPad(1440, 900)).toBeGreaterThan(40)
  })

  it('never puts a card against the very edge', () => {
    expect(fitPad(200, 120)).toBeGreaterThanOrEqual(16)
    expect(fitPad(1, 1)).toBeGreaterThanOrEqual(16)
  })

  it('and never grows the frame instead of the board', () => {
    expect(fitPad(4000, 3000)).toBeLessThanOrEqual(64)
  })

  it('follows the short side, because that is the one that runs out', () => {
    /* A wide, short window is short. Taking the width would leave a frame
       taller than the space it is framing. */
    expect(fitPad(1600, 300)).toBe(fitPad(300, 1600))
  })

  it('leaves more of a small window to the board than the old flat margin did', () => {
    const items = [{ x: 0, y: 0, w: 700, h: 500 }] as Item[]
    const was = fitView(items, 390, 690, 64)
    const now = fitView(items, 390, 690)
    expect(now!.z).toBeGreaterThan(was!.z * 1.2)
  })
})
