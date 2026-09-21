import { describe, expect, it } from 'vitest'
import { boxOf, drawnShape, opened, pressedShape, squared, straightened } from '../../src/board/drawing'
import { MIN_BOX } from '../../src/state/shapes'
import { DRAWS, KIND_OF } from '../../src/board/tool'
import type { ShapeTool } from '../../src/board/tool'

/* Turning a drag into a shape.
 *
 * All of it is arithmetic the board does inside a pointer handler, where it
 * cannot be looked at: which way round the drag went, what Shift means to
 * this tool, and how a line drawn dead across gets a box tall enough to hold
 * its own stroke. The browser suite checks that a drag on the board makes the
 * right thing; what the numbers should be is checked here. */

const at = (x: number, y: number) => ({ x, y })
const BOXES: ShapeTool[] = ['rect', 'ellipse', 'polygon', 'star']
const ENDS: ShapeTool[] = ['line', 'arrow']

describe('the box a drag covers', () => {
  it('is the same whichever corner it started from', () => {
    const want = { x: 10, y: 20, w: 90, h: 60 }
    expect(boxOf(at(10, 20), at(100, 80))).toEqual(want)
    expect(boxOf(at(100, 80), at(10, 20))).toEqual(want)
    expect(boxOf(at(100, 20), at(10, 80))).toEqual(want)
  })
})

describe('shift, which means keep it regular', () => {
  it('squares a box off at the longer side', () => {
    expect(squared(at(0, 0), at(100, 40))).toEqual({ x: 100, y: 100 })
    expect(squared(at(0, 0), at(40, 100))).toEqual({ x: 100, y: 100 })
  })

  it('squares it the way the drag went, not always down and right', () => {
    expect(squared(at(100, 100), at(0, 60))).toEqual({ x: 0, y: 0 })
    expect(squared(at(100, 100), at(160, 0))).toEqual({ x: 200, y: 0 })
  })

  it('holds a line to the nearest eighth of a turn', () => {
    /* Nearly across stays across. */
    const flat = straightened(at(0, 0), at(100, 9))
    expect(flat.y).toBeCloseTo(0, 6)
    expect(flat.x).toBeCloseTo(Math.hypot(100, 9), 6)
    /* Nearly diagonal goes diagonal, at 45 degrees exactly. */
    const slant = straightened(at(0, 0), at(100, 92))
    expect(slant.x).toBeCloseTo(slant.y, 6)
  })

  it('keeps the length of the drag while it turns it', () => {
    const p = straightened(at(20, 30), at(120, 92))
    expect(Math.hypot(p.x - 20, p.y - 30)).toBeCloseTo(Math.hypot(100, 62), 6)
  })
})

describe('opening a box out', () => {
  it('leaves a box that is already big enough alone', () => {
    const b = { x: 5, y: 6, w: 200, h: 100 }
    expect(opened(b)).toEqual(b)
  })

  it('opens a flat one out about its middle, so the line stays where it was drawn', () => {
    const b = opened({ x: 0, y: 100, w: 300, h: 0 })
    expect(b.h).toBe(MIN_BOX)
    expect(b.y + b.h / 2).toBe(100)
    expect(b.w).toBe(300)
  })
})

describe('what a drag draws', () => {
  it('gives every box tool the box that was dragged', () => {
    for (const t of BOXES) {
      const d = drawnShape(t, at(100, 100), at(340, 260))!
      expect(d, t).toMatchObject({ x: 100, y: 100, w: 240, h: 160 })
      expect(d.spec.kind, t).toBe(KIND_OF[t])
    }
  })

  it('squares every box tool under shift', () => {
    for (const t of BOXES) {
      const d = drawnShape(t, at(100, 100), at(340, 160), true)!
      expect(d.w, t).toBe(d.h)
    }
  })

  it('puts a line between the two points it was dragged between', () => {
    for (const t of ENDS) {
      const d = drawnShape(t, at(100, 100), at(300, 200))!
      expect([d.x, d.y, d.w, d.h], t).toEqual([100, 100, 200, 100])
      expect(d.spec.nodes, t).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    }
  })

  it('remembers which way round a line was drawn', () => {
    /* Up and to the left is the same box and the other arrow. */
    const back = drawnShape('arrow', at(300, 200), at(100, 100))!
    expect([back.x, back.y, back.w, back.h]).toEqual([100, 100, 200, 100])
    expect(back.spec.nodes).toEqual([{ x: 1, y: 1 }, { x: 0, y: 0 }])
  })

  it('gives a line drawn dead across a box tall enough to grab', () => {
    const flat = drawnShape('line', at(100, 400), at(400, 400))!
    expect(flat.h).toBe(MIN_BOX)
    expect(flat.spec.nodes).toEqual([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }])
  })

  it('says nothing for the tools that are not dragged from one place to another', () => {
    for (const t of ['pen', 'curve', 'pencil'] as ShapeTool[]) {
      expect(drawnShape(t, at(0, 0), at(10, 10)), t).toBeNull()
      expect(DRAWS[t], t).not.toBe('box')
    }
  })
})

describe('what a press draws', () => {
  it('makes one of every tool, because nothing at all looks like a broken tool', () => {
    for (const t of Object.keys(DRAWS) as ShapeTool[]) {
      const d = pressedShape(t, at(40, 50))
      expect(d.w, t).toBeGreaterThan(0)
      expect(d.h, t).toBeGreaterThan(0)
      expect([d.x, d.y], t).toEqual([40, 50])
      expect(d.spec.kind, t).toBe(KIND_OF[t])
    }
  })

  it('lays a pressed line across, because that is what a line is if nobody says', () => {
    for (const t of ENDS) {
      const d = pressedShape(t, at(0, 0))
      expect(d.spec.nodes, t).toEqual([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }])
    }
  })

  it('gives an arrow a head and a line none, pressed or dragged', () => {
    expect(pressedShape('arrow', at(0, 0)).spec.heads).toBe('end')
    expect(drawnShape('arrow', at(0, 0), at(9, 9))!.spec.heads).toBe('end')
    expect(pressedShape('line', at(0, 0)).spec.heads).toBeUndefined()
  })
})
