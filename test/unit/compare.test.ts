import { describe, expect, it } from 'vitest'
import { bestGrid, MOST } from '../../src/ui/compare'

/* How to lay two, three or four things out against each other.
 *
 * Only one question: of the ways a few boxes fit in a rectangle, which leaves
 * each box biggest. Four wide photographs want two rows and four tall ones
 * want four columns, and which is which depends on the shape of the window as
 * much as on the pictures. */

const area = (g: { tile: { w: number; h: number } }) => g.tile.w * g.tile.h

describe('laying a few things out against each other', () => {
  it('puts two side by side on a wide screen', () => {
    const g = bestGrid(2, 1400, 800)
    expect(g.cols).toBe(2)
    expect(g.rows).toBe(1)
  })

  it('and one above the other on a tall one', () => {
    const g = bestGrid(2, 500, 1600)
    expect(g.cols).toBe(1)
    expect(g.rows).toBe(2)
  })

  it('puts four in a square on a screen that is roughly square', () => {
    const g = bestGrid(4, 1200, 1000)
    expect(g.cols).toBe(2)
    expect(g.rows).toBe(2)
  })

  it('and four in a row on a very wide one', () => {
    const g = bestGrid(4, 4000, 500)
    expect(g.cols).toBe(4)
    expect(g.rows).toBe(1)
  })

  it('never leaves a hole it could have filled', () => {
    for (const n of [1, 2, 3, 4]) {
      const g = bestGrid(n, 1400, 800)
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n)
      expect((g.cols - 1) * g.rows).toBeLessThan(n)
    }
  })

  /* The point of choosing rather than writing one down. */
  it('picks the arrangement that leaves each one biggest', () => {
    const chosen = bestGrid(4, 1400, 800)
    for (let cols = 1; cols <= 4; cols++) {
      const rows = Math.ceil(4 / cols)
      const other = { tile: { w: (1400 - 20 * (cols - 1)) / cols, h: (800 - 20 * (rows - 1)) / rows } }
      expect(area(chosen)).toBeGreaterThanOrEqual(area(other) - 0.001)
    }
  })

  it('leaves room between them', () => {
    const g = bestGrid(2, 1000, 800, 40)
    expect(g.tile.w).toBe((1000 - 40) / 2)
  })

  it('gives one thing the whole of it', () => {
    const g = bestGrid(1, 1000, 800)
    expect(g).toMatchObject({ cols: 1, rows: 1 })
    expect(g.tile).toEqual({ w: 1000, h: 800 })
  })

  /* Past four they are too small to be held against each other, and what you
   * want at that point is the board. */
  it('never lays out more than four', () => {
    const g = bestGrid(12, 1400, 800)
    expect(g.cols * g.rows).toBeLessThanOrEqual(MOST)
  })

  it('and never fewer than one, whatever it is asked for', () => {
    expect(bestGrid(0, 1400, 800).cols).toBe(1)
    expect(bestGrid(-3, 1400, 800).cols).toBe(1)
  })

  it('gives something back even in a window too small to divide', () => {
    const g = bestGrid(4, 40, 30)
    expect(g.tile.w).toBeGreaterThan(0)
    expect(g.tile.h).toBeGreaterThan(0)
  })
})
