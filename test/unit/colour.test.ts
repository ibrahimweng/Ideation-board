import { describe, expect, it } from 'vitest'
import { inkOn, luminance, paletteFrom, swatchItems, toHex } from '../../src/state/palette'
import type { Item } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'

/* The colours read out of a picture. The browser suite drops a real picture in
 * and checks the swatches that land on the board; this checks the counting
 * itself, on pixels made here, where the right answer is known exactly. */

/* A block of pixels, as the canvas would hand them over. */
const pixels = (parts: [string, number][]): Uint8ClampedArray => {
  const out: number[] = []
  for (const [hex, n] of parts) {
    const v = parseInt(hex.slice(1), 16)
    for (let i = 0; i < n; i++) out.push((v >> 16) & 255, (v >> 8) & 255, v & 255, 255)
  }
  return new Uint8ClampedArray(out)
}

const near = (a: string, b: string, tol = 24) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) <= tol
}

describe('toHex and luminance', () => {
  it('writes a colour the way CSS does', () => {
    expect(toHex(255, 90, 31)).toBe('#ff5a1f')
    expect(toHex(0, 0, 0)).toBe('#000000')
  })

  it('clamps rather than wrapping', () => {
    expect(toHex(300, -20, 128)).toBe('#ff0080')
  })

  it('puts white at the top and black at the bottom', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 3)
    expect(luminance(0, 0, 0)).toBe(0)
    /* Green reads far lighter than blue at the same number. */
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(0, 0, 255))
  })
})

describe('inkOn', () => {
  it('writes dark on pale and light on dark', () => {
    expect(inkOn('#ffffff')).toBe('#17171a')
    expect(inkOn('#000000')).toBe('#f4f4f5')
    expect(inkOn('#FBEFC4')).toBe('#17171a')
    expect(inkOn('#274763')).toBe('#f4f4f5')
  })

  it('falls back to dark rather than throwing on nonsense', () => {
    expect(inkOn('#zzzzzz')).toBe('#17171a')
  })
})

describe('paletteFrom', () => {
  it('finds the colours that are actually there', () => {
    const data = pixels([['#e5251f', 400], ['#1c8f5e', 400], ['#2f6feb', 400]])
    const found = paletteFrom(data, 3).map((s) => s.hex)
    expect(found.some((h) => near(h, '#e5251f'))).toBe(true)
    expect(found.some((h) => near(h, '#1c8f5e'))).toBe(true)
    expect(found.some((h) => near(h, '#2f6feb'))).toBe(true)
  })

  it('does not return the same colour twice under two names', () => {
    /* Four blues a hair apart, and one red. */
    const data = pixels([
      ['#2f6feb', 300], ['#3070ec', 300], ['#2e6eea', 300], ['#3171ed', 300], ['#e5251f', 60],
    ])
    const found = paletteFrom(data, 3)
    expect(new Set(found.map((s) => s.hex)).size).toBe(found.length)
    expect(found.some((s) => near(s.hex, '#e5251f'))).toBe(true)
  })

  it('does not spend the whole list on a big flat background', () => {
    /* Two thirds pale sky, then three real colours in the corner. */
    const data = pixels([
      ['#dfe8f2', 3000], ['#e5251f', 200], ['#1c8f5e', 200], ['#f2c14e', 200],
    ])
    const found = paletteFrom(data, 4).map((s) => s.hex)
    expect(found.some((h) => near(h, '#e5251f'))).toBe(true)
    expect(found.some((h) => near(h, '#1c8f5e'))).toBe(true)
    expect(found.some((h) => near(h, '#f2c14e'))).toBe(true)
  })

  it('still gives the number asked for from a picture of one colour', () => {
    const data = pixels([['#808080', 900]])
    expect(paletteFrom(data, 5).length).toBeGreaterThan(0)
    expect(paletteFrom(data, 5).length).toBeLessThanOrEqual(5)
  })

  it('shares add up to roughly the whole picture', () => {
    const data = pixels([['#e5251f', 500], ['#1c8f5e', 500]])
    const total = paletteFrom(data, 2).reduce((n, s) => n + s.share, 0)
    expect(total).toBeGreaterThan(0.9)
    expect(total).toBeLessThanOrEqual(1.001)
  })

  it('ignores what is transparent, and says nothing about nothing', () => {
    const clear = new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 0])
    expect(paletteFrom(clear, 5)).toEqual([])
    expect(paletteFrom(new Uint8ClampedArray([]), 5)).toEqual([])
  })
})

describe('swatchItems', () => {
  const from: Item = {
    id: 'pic', kind: 'image', x: 100, y: 100, z: 1, w: 400, h: 300,
    fx: { ...FX_0 }, tag: null, name: 'scene.png',
  } as Item

  it('lays them in a row under the picture', () => {
    const made = swatchItems([{ hex: '#111111', share: 0.5 }, { hex: '#eeeeee', share: 0.5 }], from)
    expect(made).toHaveLength(2)
    expect(new Set(made.map((m) => m.y)).size).toBe(1)
    expect(made[0].y).toBeGreaterThan(from.y + from.h)
    expect(made[1].x).toBeGreaterThan(made[0].x)
  })

  it('centres the row on the picture', () => {
    const made = swatchItems([{ hex: '#111111', share: 1 }], from)
    const middle = made[0].x + made[0].w / 2
    expect(middle).toBeCloseTo(from.x + from.w / 2, 0)
  })

  it('is a note with the colour as its paper and the hex as its text', () => {
    const made = swatchItems([{ hex: '#1c8f5e', share: 1 }], from)
    expect(made[0].kind).toBe('note')
    expect(made[0].color).toBe('#1c8f5e')
    expect(made[0].text).toBe('#1C8F5E')
    /* The name says where it came from, which is the one thing a swatch
       cannot show for itself. */
    expect(made[0].name).toBe('scene.png')
  })

  it('gives every one of them an identity of its own', () => {
    const made = swatchItems([1, 2, 3, 4, 5].map((n) => ({ hex: `#00000${n}`, share: 0.2 })), from)
    expect(new Set(made.map((m) => m.id)).size).toBe(5)
  })
})
