import { describe, expect, it } from 'vitest'
import { gapMarks, reorder, respace, slotAt, smartOf } from '../../src/state/smart'
import type { Item } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'

/* When a selection has a shape, and what taking hold of its gaps does.
 *
 * The negative cases matter more than the positive ones here. A set of
 * handles offered over a pile of cards is a set of handles that lie: dragging
 * one would have to invent an order the cards do not have. So most of this
 * file is about the arrangements that must say no. */

let n = 0
const box = (x: number, y: number, w = 100, h = 80): Item =>
  ({ id: `c${n++}`, kind: 'note', x, y, w, h, z: 0, fx: { ...FX_0 }, tag: null } as Item)

/* A row of `count` boxes, `gap` apart. */
const row = (count: number, gap: number, w = 100, y = 0) =>
  Array.from({ length: count }, (_, i) => box(i * (w + gap), y, w))

describe('when a selection has a shape', () => {
  it('reads a row of evenly spaced cards as a row', () => {
    const s = smartOf(row(4, 20))!
    expect(s.axis).toBe('x')
    expect(s.lanes.length).toBe(1)
    expect(s.lanes[0].length).toBe(4)
    expect(s.gap).toBeCloseTo(20, 6)
    expect(s.cross).toBeNull()
  })

  it('reads a column the same way, the other way round', () => {
    const col = [box(0, 0), box(0, 100), box(0, 200), box(0, 300)]
    const s = smartOf(col)!
    expect(s.axis).toBe('y')
    expect(s.lanes[0].length).toBe(4)
    expect(s.gap).toBeCloseTo(20, 6)
  })

  it('reads a grid as lanes with a gap between them', () => {
    const grid = [
      box(0, 0), box(120, 0), box(240, 0),
      box(0, 100), box(120, 100), box(240, 100),
    ]
    const s = smartOf(grid)!
    expect(s.lanes.length).toBe(2)
    expect(s.lanes[0].length).toBe(3)
    expect(s.gap).toBeCloseTo(20, 6)
    expect(s.cross).toBeCloseTo(20, 6)
  })

  it('forgives a card nudged a pixel out, because cards are placed by hand', () => {
    const nearly = [box(0, 0), box(121, 1), box(240, 0)]
    expect(smartOf(nearly)).not.toBeNull()
  })

  it('and says no to one nudged further than that', () => {
    const off = [box(0, 0), box(150, 0), box(240, 0)]
    expect(smartOf(off)).toBeNull()
  })

  it('says no to a pile, which is the case that matters', () => {
    const pile = [box(0, 0), box(37, 61), box(180, 12), box(90, 140)]
    expect(smartOf(pile)).toBeNull()
  })

  it('reads a grid whose last row is short, which is what tidying five gives you', () => {
    const five = [
      box(0, 0), box(120, 0), box(240, 0),
      box(0, 100), box(120, 100),
    ]
    const s = smartOf(five)!
    expect(s.lanes.map((l) => l.length)).toEqual([3, 2])
    expect(s.gap).toBeCloseTo(20, 6)
    expect(s.cross).toBeCloseTo(20, 6)
  })

  it('says no to a grid with a hole in the middle of it', () => {
    const holed = [
      box(0, 0), box(120, 0), box(240, 0),
      box(0, 100),
      box(0, 200), box(120, 200), box(240, 200),
    ]
    expect(smartOf(holed)).toBeNull()
  })


  it('says no to rows that do not start in the same place', () => {
    const stepped = [
      box(0, 0), box(120, 0),
      box(40, 100), box(160, 100),
    ]
    expect(smartOf(stepped)).toBeNull()
  })

  it('says no to one card, and to none', () => {
    expect(smartOf([box(0, 0)])).toBeNull()
    expect(smartOf([])).toBeNull()
  })

  it('prefers the reading that has gaps in it', () => {
    /* Three side by side are a row of three along x, and three lanes of one
       along y. Only the first has anything to take hold of. */
    const s = smartOf(row(3, 20))!
    expect(s.axis).toBe('x')
    expect(s.lanes[0].length).toBe(3)
  })

  it('works on cards of different sizes, since a gap is a gap', () => {
    const mixed = [box(0, 0, 100, 80), box(120, 0, 60, 80), box(200, 0, 140, 80)]
    const s = smartOf(mixed)!
    expect(s.gap).toBeCloseTo(20, 6)
  })
})

describe('taking hold of the gap', () => {
  it('opens the row out without moving the first card', () => {
    const items = row(4, 20)
    const s = smartOf(items)!
    const moves = respace(items, s, 60)
    expect(moves.has(items[0].id)).toBe(false)
    expect(moves.get(items[1].id)!.x).toBe(160)
    expect(moves.get(items[2].id)!.x).toBe(320)
    expect(moves.get(items[3].id)!.x).toBe(480)
  })

  it('closes it up again, and will sit cards edge to edge', () => {
    const items = row(3, 20)
    const s = smartOf(items)!
    const moves = respace(items, s, 0)
    expect(moves.get(items[1].id)!.x).toBe(100)
    expect(moves.get(items[2].id)!.x).toBe(200)
  })

  it('leaves the other axis alone', () => {
    const items = row(3, 20, 100, 40)
    const s = smartOf(items)!
    for (const p of respace(items, s, 50).values()) expect(p.y).toBe(40)
  })

  it('moves the rows of a grid too, when asked', () => {
    const grid = [
      box(0, 0), box(120, 0),
      box(0, 100), box(120, 100),
    ]
    const s = smartOf(grid)!
    const moves = respace(grid, s, 20, 50)
    expect(moves.get(grid[2].id)!.y).toBe(130)
    expect(moves.get(grid[3].id)!.y).toBe(130)
  })

  it('and leaves the rows where they are when it is not', () => {
    const grid = [
      box(0, 0), box(120, 0),
      box(0, 100), box(120, 100),
    ]
    const s = smartOf(grid)!
    const moves = respace(grid, s, 40)
    for (const id of [grid[2].id, grid[3].id]) {
      const p = moves.get(id)
      if (p) expect(p.y).toBe(100)
    }
  })

  it('does nothing at the gap it already has', () => {
    const items = row(4, 20)
    expect(respace(items, smartOf(items)!, 20).size).toBe(0)
  })

  it('draws a handle in every gap and nowhere else', () => {
    const items = row(4, 20)
    const marks = gapMarks(items, smartOf(items)!)
    expect(marks.length).toBe(3)
    expect(marks[0]).toEqual({ x: 100, y: 0, w: 20, h: 80, cross: false })
  })

  it('and a grid gets one in every gap of every lane, plus one between the lanes', () => {
    const grid = [
      box(0, 0), box(120, 0), box(240, 0),
      box(0, 100), box(120, 100), box(240, 100),
    ]
    const marks = gapMarks(grid, smartOf(grid)!)
    expect(marks.filter((m) => !m.cross).length).toBe(4)
    expect(marks.filter((m) => m.cross).length).toBe(1)
  })

  it('and the one between the lanes runs the whole width of them', () => {
    const grid = [
      box(0, 0), box(120, 0), box(240, 0),
      box(0, 100), box(120, 100), box(240, 100),
    ]
    const across = gapMarks(grid, smartOf(grid)!).find((m) => m.cross)!
    expect(across).toEqual({ x: 0, y: 80, w: 340, h: 20, cross: true })
  })
})

describe('moving one along the row', () => {
  it('puts it in the other place and closes up behind it', () => {
    const items = row(4, 20)
    const s = smartOf(items)!
    const moves = reorder(items, s, items[0].id, 2)
    /* The places do not move; what sits in each one does. */
    expect(moves.get(items[0].id)!.x).toBe(240)
    expect(moves.get(items[1].id)!.x).toBe(0)
    expect(moves.get(items[2].id)!.x).toBe(120)
    expect(moves.has(items[3].id)).toBe(false)
  })

  it('works the other way along too', () => {
    const items = row(4, 20)
    const moves = reorder(items, smartOf(items)!, items[3].id, 0)
    expect(moves.get(items[3].id)!.x).toBe(0)
    expect(moves.get(items[0].id)!.x).toBe(120)
  })

  it('does nothing when it is already there', () => {
    const items = row(4, 20)
    expect(reorder(items, smartOf(items)!, items[2].id, 2).size).toBe(0)
  })

  it('leaves the row alone when asked about a card that is not in it', () => {
    const items = row(3, 20)
    expect(reorder(items, smartOf(items)!, 'nobody', 1).size).toBe(0)
  })

  it('finds the slot a card is being dragged over', () => {
    const items = row(4, 20)
    const s = smartOf(items)!
    expect(slotAt(items, s, 50, 40)).toBe(0)
    expect(slotAt(items, s, 290, 40)).toBe(2)
    expect(slotAt(items, s, 999, 40)).toBe(3)
  })
})
