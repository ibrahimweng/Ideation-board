import { describe, expect, it } from 'vitest'
import { clearGround, gatherInto } from '../../src/state/arrange'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* Putting a set of things in one place — the last step of curating, and the
 * one that had no arithmetic behind it. */

const card = (p: Partial<Item>): Item => ({
  id: p.id || `i${Math.random().toString(36).slice(2, 8)}`,
  kind: 'image', x: 0, y: 0, w: 300, h: 200, z: 0,
  fx: { ...FX_0 }, tag: null,
  ...p,
} as Item)

/* Six keepers, scattered the way six keepers are. */
const scattered = () => [
  card({ id: 'a', x: 40, y: 30 }),
  card({ id: 'b', x: 1400, y: 900 }),
  card({ id: 'c', x: -600, y: 500 }),
  card({ id: 'd', x: 900, y: -200 }),
  card({ id: 'e', x: 200, y: 1800 }),
  card({ id: 'f', x: 2400, y: 400 }),
]

describe('gathering a set into one place', () => {
  it('is nothing at all when there is nothing to gather', () => {
    expect(gatherInto([], { x: 0, y: 0 })).toBe(null)
  })

  it('moves every one of them', () => {
    const g = gatherInto(scattered(), { x: 0, y: 0 })!
    expect(g.moves.size).toBe(6)
  })

  it('puts them all inside the frame it asks for', () => {
    const list = scattered()
    const g = gatherInto(list, { x: 100, y: 200 })!
    for (const it of list) {
      const at = g.moves.get(it.id)!
      expect(at.x).toBeGreaterThanOrEqual(g.frame.x)
      expect(at.y).toBeGreaterThanOrEqual(g.frame.y)
      expect(at.x + it.w).toBeLessThanOrEqual(g.frame.x + g.frame.w)
      expect(at.y + it.h).toBeLessThanOrEqual(g.frame.y + g.frame.h)
    }
  })

  /* A section carries its name along the top, and a card under it would be
   * a card with a label lying across it. */
  it('leaves room at the top for the name', () => {
    const list = scattered()
    const g = gatherInto(list, { x: 0, y: 0 })!
    const highest = Math.min(...list.map((i) => g.moves.get(i.id)!.y))
    expect(highest - g.frame.y).toBeGreaterThanOrEqual(30)
  })

  it('starts where it was told to', () => {
    const g = gatherInto(scattered(), { x: 777, y: -333 })!
    expect(g.frame.x).toBe(777)
    expect(g.frame.y).toBe(-333)
  })

  /* A block to be read as one thing, not a trail of where they used to be. */
  it('lays them out squarish rather than in one long row', () => {
    const g = gatherInto(scattered(), { x: 0, y: 0 })!
    const ratio = g.frame.w / g.frame.h
    expect(ratio).toBeGreaterThan(0.4)
    expect(ratio).toBeLessThan(4)
  })

  it('puts one thing in a frame of its own size', () => {
    const g = gatherInto([card({ id: 'a', w: 300, h: 200 })], { x: 0, y: 0 })!
    expect(g.frame.w).toBe(300 + 40)
    expect(g.moves.size).toBe(1)
  })

  it('takes the widest and tallest as the cell, so nothing overlaps', () => {
    const list = [card({ id: 'a', w: 200, h: 150 }), card({ id: 'b', w: 500, h: 400 }), card({ id: 'c', w: 300, h: 200 })]
    const g = gatherInto(list, { x: 0, y: 0 })!
    const boxes = list.map((i) => ({ ...i, ...g.moves.get(i.id)! }))
    for (const p of boxes) {
      for (const q of boxes) {
        if (p.id === q.id) continue
        const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y
        expect(apart).toBe(true)
      }
    }
  })

  it('keeps the order they were read in', () => {
    const list = [
      card({ id: 'topleft', x: 0, y: 0 }),
      card({ id: 'topright', x: 400, y: 10 }),
      card({ id: 'below', x: 0, y: 600 }),
    ]
    const g = gatherInto(list, { x: 0, y: 0 })!
    const a = g.moves.get('topleft')!
    const b = g.moves.get('topright')!
    const c = g.moves.get('below')!
    expect(a.y).toBeLessThanOrEqual(b.y)
    expect(a.x).toBeLessThan(b.x)
    expect(c.y).toBeGreaterThan(a.y)
  })
})

describe('where to put it', () => {
  it('is under everything, with a gap', () => {
    const all = [card({ x: 0, y: 0, h: 200 }), card({ x: 500, y: 400, h: 200 })]
    const at = clearGround(all, 80)
    expect(at.y).toBe(600 + 80)
  })

  it('lines up with the left edge of what is there', () => {
    const all = [card({ x: 300, y: 0 }), card({ x: -120, y: 400 })]
    expect(clearGround(all).x).toBe(-120)
  })

  it('is the origin on a board with nothing on it', () => {
    expect(clearGround([])).toEqual({ x: 0, y: 0 })
  })

  /* Clear means clear: nothing already on the board may reach into it. */
  it('really is clear of everything', () => {
    const all = scattered()
    const at = clearGround(all)
    for (const it of all) expect(it.y + it.h).toBeLessThan(at.y)
  })
})
