import { describe, expect, it } from 'vitest'
import { DEV_0, developed, trimDev } from '../../src/state/develop'
import {
  BLUR_CODE,
  KIND_CODE,
  MASK_KEYS,
  MAX_PARTS,
  UNKNOWN_KIND,
  brushKey,
  brushTiles,
  liveMasks,
  maskEmpty,
  maskUniforms,
  newBlurMask,
  newMask,
  newPart,
  paintBrush,
  partEmpty,
  trimMaskDev,
  wantsDepth,
} from '../../src/state/mask'
import type { Mask, MaskKind } from '../../src/state/mask'

/* The mask model, without a browser.
 *
 * Everything here is arithmetic and bookkeeping that the browser suite would
 * only be able to check through a photograph — which is a slow and indirect
 * way to ask whether a number reached a uniform. */

const KINDS: MaskKind[] = ['whole', 'linear', 'radial', 'brush', 'colour', 'luminance', 'depth']

describe('the parts', () => {
  it('gives the whole picture the code the shader treats as everything', () => {
    /* And every other kind a code below it, because the shader's last branch
       is the one that says "all of it" and everything past it is a kind this
       version does not know, which has to be nowhere rather than everywhere. */
    expect(KIND_CODE.whole).toBe(6)
    for (const k of KINDS) if (k !== 'whole') expect(KIND_CODE[k]).toBeLessThan(6)
  })

  it('gives every kind a code the shader can switch on', () => {
    const codes = KINDS.map((k) => KIND_CODE[k])
    expect(new Set(codes).size).toBe(KINDS.length)
    for (const c of codes) expect(Number.isInteger(c)).toBe(true)
  })

  it('places a new one where that kind should start', () => {
    const lin = newPart('linear')
    expect(lin.y1).toBeLessThan(lin.y2!)
    const rad = newPart('radial')
    expect(rad.cx).toBe(0.5)
    expect(rad.cy).toBe(0.5)
    expect(newPart('brush').strokes).toEqual([])
    expect(newPart('whole')).toEqual({ kind: 'whole' })
  })

  it('counts a brush with nothing painted as no place at all', () => {
    expect(partEmpty({ kind: 'brush' })).toBe(true)
    expect(partEmpty({ kind: 'brush', strokes: [{ pts: [], size: 1, soft: 1, flow: 1 }] })).toBe(true)
    expect(partEmpty({ kind: 'brush', strokes: [{ pts: [0.1, 0.1], size: 1, soft: 1, flow: 1 }] })).toBe(false)
    /* Every other kind is somewhere the moment it exists. */
    for (const k of KINDS) if (k !== 'brush') expect(partEmpty({ kind: k })).toBe(false)
  })
})

describe('what counts as live', () => {
  const on = (m: Partial<Mask>): Mask => ({ ...newMask('radial'), dev: { exposure: 1 }, ...m })

  it('needs a place, a strength and something to do', () => {
    expect(liveMasks([on({})])).toHaveLength(1)
    expect(liveMasks([on({ off: true })])).toHaveLength(0)
    expect(liveMasks([on({ amount: 0 })])).toHaveLength(0)
    expect(liveMasks([on({ dev: undefined })])).toHaveLength(0)
    expect(liveMasks([on({ parts: [] })])).toHaveLength(0)
  })

  it('counts a blur as something to do, even with no parameters on it', () => {
    expect(liveMasks([on({ dev: undefined, blur: { kind: 'defocus', amount: 40 } })])).toHaveLength(1)
    expect(liveMasks([on({ dev: undefined, blur: { kind: 'defocus', amount: 0 } })])).toHaveLength(0)
  })

  it('makes a card with nothing but a masked edit a developed card', () => {
    expect(developed({ masks: [on({})] })).toBe(true)
    expect(developed({ masks: [on({ off: true })] })).toBe(false)
    expect(developed({})).toBe(false)
  })

  it('keeps a mask that has been drawn but not yet given a parameter', () => {
    /* It is work somebody did and it is on the screen. An empty list is not. */
    const drawn = { ...newMask('radial'), dev: undefined }
    expect(trimDev({ masks: [drawn] })?.masks).toHaveLength(1)
    expect(trimDev({ masks: [] })).toBeUndefined()
  })

  it('says when a mask needs the depth map', () => {
    expect(wantsDepth([on({ parts: [newPart('depth')] })])).toBe(true)
    expect(wantsDepth([on({})])).toBe(false)
  })
})

describe('what a mask is allowed to set', () => {
  it('drops anything the panel would never show', () => {
    const kept = trimMaskDev({ exposure: 1, vignette: -50, grain: 40, curve: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] })
    expect(kept).toEqual({ exposure: 1 })
  })

  it('drops a figure that is back at its default', () => {
    for (const k of MASK_KEYS) {
      expect(trimMaskDev({ [k]: DEV_0[k] })).toBeUndefined()
    }
  })
})

describe('what the shader is told', () => {
  it('pads to four parts however many there are, so the upload is one shape', () => {
    const u = maskUniforms(newMask('radial'))
    expect(u.n).toBe(1)
    expect(u.a).toHaveLength(MAX_PARTS * 4)
    expect(u.b).toHaveLength(MAX_PARTS * 4)
    expect(u.c).toHaveLength(MAX_PARTS * 4)
  })

  it('never sends more parts than the shader has room for', () => {
    const m: Mask = { ...newMask('radial'), parts: Array.from({ length: 9 }, () => newPart('radial')) }
    const u = maskUniforms(m)
    expect(u.n).toBe(MAX_PARTS)
    expect(u.a).toHaveLength(MAX_PARTS * 4)
  })

  it('puts the kind first and the geometry after it', () => {
    const m: Mask = { ...newMask('linear'), parts: [{ kind: 'linear', x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4, inv: true }] }
    const u = maskUniforms(m)
    expect(u.a.slice(0, 3)).toEqual([KIND_CODE.linear, 0, 1])
    expect(u.b.slice(0, 4)).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('sends percentages as nought to one', () => {
    const m: Mask = { ...newMask('luminance'), amount: 40, parts: [{ kind: 'luminance', lo: 25, hi: 75, tol: 10 }] }
    const u = maskUniforms(m)
    expect(u.amount).toBeCloseTo(0.4)
    expect(u.b.slice(0, 3)).toEqual([0.25, 0.75, 0.1])
  })

  it('never sends a radius of nought, which would divide by it', () => {
    const m: Mask = { ...newMask('radial'), parts: [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0, ry: 0 }] }
    const u = maskUniforms(m)
    expect(u.b[2]).toBeGreaterThan(0)
    expect(u.b[3]).toBeGreaterThan(0)
  })

  it('asks for the blur chain only for a defocus', () => {
    const wide = maskUniforms({ ...newMask('whole'), blur: { kind: 'defocus', amount: 100 } })
    const spin = maskUniforms({ ...newMask('whole'), blur: { kind: 'spin', amount: 100 } })
    const none = maskUniforms(newMask('whole'))
    expect(wide.blurRadius).toBeGreaterThan(40)
    expect(spin.blurRadius).toBe(0)
    expect(none.blurRadius).toBe(0)
    expect(wide.blur[0]).toBe(BLUR_CODE.defocus)
    expect(spin.blur[0]).toBe(BLUR_CODE.spin)
  })

  it('sends the motion angle in radians', () => {
    const u = maskUniforms({ ...newMask('whole'), blur: { kind: 'motion', amount: 50, angle: 180 } })
    expect(u.blur[2]).toBeCloseTo(Math.PI)
  })
})

describe('the blur gallery', () => {
  it('starts each kind with the mask that kind of blur belongs in', () => {
    const iris = newBlurMask('iris')
    expect(iris.parts[0].kind).toBe('radial')
    expect(iris.parts[0].inv).toBe(true)
    /* A tilt-shift is two gradients pointing away from each other, which is
       what makes the band between them the sharp part. */
    const tilt = newBlurMask('tilt')
    expect(tilt.parts).toHaveLength(2)
    expect(tilt.parts[0].y1).toBeLessThan(tilt.parts[0].y2!)
    expect(tilt.parts[1].y1).toBeGreaterThan(tilt.parts[1].y2!)
    expect(newBlurMask('field').parts[0].kind).toBe('whole')
    expect(newBlurMask('spin').blur?.kind).toBe('spin')
    expect(newBlurMask('motion').blur?.kind).toBe('motion')
  })

  it('makes every one of them live the moment it is added', () => {
    for (const k of ['field', 'iris', 'tilt', 'spin', 'motion']) {
      expect(liveMasks([newBlurMask(k)]), k).toHaveLength(1)
    }
  })
})

describe('taking something out', () => {
  const at = (ox: number, oy: number, heal?: boolean): Mask => ({ ...newMask('brush'), parts: [{ kind: 'brush', strokes: [{ pts: [0.4, 0.4, 0.5, 0.5], size: 8, soft: 50, flow: 100 }] }], clone: { ox, oy, heal } })

  it('is not a repair until it has been given somewhere to take pixels from', () => {
    expect(liveMasks([at(0, 0)])).toHaveLength(0)
    expect(liveMasks([at(0.12, 0)])).toHaveLength(1)
    /* And a card with nothing on it but a repair is a developed card. */
    expect(developed({ masks: [at(0.12, 0)] })).toBe(true)
    expect(developed({ masks: [at(0, 0)] })).toBe(false)
  })

  it('tells the shader the offset, whether to do it, and whether to keep the tone', () => {
    const u = maskUniforms(at(0.1, -0.06, true))
    expect(u.clone).toEqual([0.1, -0.06, 1, 1])
    expect(maskUniforms(at(0.1, -0.06)).clone[3]).toBe(0)
    expect(maskUniforms(at(0, 0)).clone[2]).toBe(0)
  })

  it('asks for a softened copy only when it is healing', () => {
    /* Heal reads the difference between a blurred here and a blurred there,
       which is the lighting. A clone has no use for it. */
    expect(maskUniforms(at(0.1, 0, true)).blurRadius).toBeGreaterThan(0)
    expect(maskUniforms(at(0.1, 0)).blurRadius).toBe(0)
    expect(maskUniforms(at(0, 0, true)).blurRadius).toBe(0)
  })
})

describe('the brush', () => {
  const stroke = (pts: number[]) => ({ pts, size: 10, soft: 50, flow: 100 })

  it('changes its key when a stroke changes and not when it does not', () => {
    const a: Mask = { ...newMask('brush'), parts: [{ kind: 'brush', strokes: [stroke([0.1, 0.1, 0.2, 0.2])] }] }
    const same: Mask = { ...a, name: 'a different name', amount: 30 }
    const more: Mask = { ...a, parts: [{ kind: 'brush', strokes: [stroke([0.1, 0.1, 0.2, 0.2, 0.3, 0.3])] }] }
    expect(brushKey(same)).toBe(brushKey(a))
    expect(brushKey(more)).not.toBe(brushKey(a))
  })

  it('draws a single tap as a dot, which a zero-length line would not', () => {
    const calls: string[] = []
    const ctx = fakeCtx(calls)
    paintBrush(ctx, { ...newMask('brush'), parts: [{ kind: 'brush', strokes: [stroke([0.5, 0.5])] }] }, 100, 100)
    expect(calls).toContain('arc')
    expect(calls).toContain('fill')
  })

  it('draws a run of points as one line', () => {
    const calls: string[] = []
    const ctx = fakeCtx(calls)
    paintBrush(ctx, { ...newMask('brush'), parts: [{ kind: 'brush', strokes: [stroke([0.1, 0.1, 0.5, 0.5, 0.9, 0.9])] }] }, 100, 100)
    expect(calls.filter((c) => c === 'lineTo')).toHaveLength(2)
    expect(calls).toContain('stroke')
    expect(calls).not.toContain('arc')
  })

  it('rubs out with the one composite operation that takes alpha away', () => {
    const calls: string[] = []
    const ctx = fakeCtx(calls)
    paintBrush(
      ctx,
      { ...newMask('brush'), parts: [{ kind: 'brush', strokes: [{ ...stroke([0.1, 0.1, 0.4, 0.4]), erase: true }] }] },
      100,
      100
    )
    expect(calls).toContain('op:destination-out')
    /* And puts it back, or everything drawn after it would rub out too. */
    expect(calls.lastIndexOf('op:source-over')).toBeGreaterThan(calls.lastIndexOf('op:destination-out'))
  })

  it('leaves a mask with nothing painted as no place at all', () => {
    expect(maskEmpty({ ...newMask('brush') })).toBe(true)
    expect(maskEmpty(newMask('radial'))).toBe(false)
  })

  /* ---- a tile per part ----
   *
   * Every painted part used to go into one picture, and every painted part
   * read that one picture back. So a mask that brushed an area in and then
   * brushed a hole out of it with a second part did neither: both parts asked
   * the same strokes where they were, the subtract took out exactly what the
   * add put in, and the mask covered nothing at all. */
  it('counts a tile for every part up to the last painted one', () => {
    expect(brushTiles(newMask('radial'))).toBe(0)
    expect(brushTiles({ ...newMask('brush'), parts: [newPart('brush')] })).toBe(1)
    /* A brush in the third slot needs three tiles even though the first two
       are gradients: a part's tile is its own number, so the shader needs no
       table to find it. */
    expect(brushTiles({ ...newMask('radial'), parts: [newPart('radial'), newPart('linear'), newPart('brush')] })).toBe(3)
    /* And never more than the mask can hold. */
    expect(
      brushTiles({
        ...newMask('brush'),
        parts: [newPart('brush'), newPart('brush'), newPart('brush'), newPart('brush'), newPart('brush')],
      })
    ).toBe(MAX_PARTS)
  })

  const twoBrushes = (): Mask => ({
    ...newMask('brush'),
    parts: [
      { kind: 'brush', strokes: [stroke([0.2, 0.2, 0.6, 0.6])] },
      { kind: 'brush', op: 'sub', strokes: [stroke([0.3, 0.3, 0.5, 0.5])] },
    ],
  })

  it('tells each painted part which tile of the strip is its own', () => {
    const u = maskUniforms(twoBrushes())
    /* Part 0 reads tile 0 and part 1 reads tile 1, out of the two there are. */
    expect(u.b.slice(0, 2)).toEqual([0, 2])
    expect(u.b.slice(4, 6)).toEqual([1, 2])
    /* And the one that takes away really is the one that takes away, which is
       the thing that could not work while they shared a picture. */
    expect(u.a[5]).toBe(1)
  })

  it('paints each part into its own tile and clips it there', () => {
    const calls: string[] = []
    const xy: number[][] = []
    const ctx = fakeCtx(calls, xy)
    paintBrush(ctx, twoBrushes(), 100, 100)
    const where = (name: string) => calls.map((c, i) => [c, i] as const).filter(([c]) => c === name).map(([, i]) => xy[i])
    /* Cleared over the whole strip, not only the first tile. */
    expect(xy[0]).toEqual([0, 0, 100, 200])
    /* One clip per part, each to its own hundred pixels. */
    expect(where('rect')).toEqual([
      [0, 0, 100, 100],
      [0, 100, 100, 100],
    ])
    expect(calls.filter((c) => c === 'clip')).toHaveLength(2)
    expect(calls.filter((c) => c === 'save')).toHaveLength(2)
    expect(calls.filter((c) => c === 'restore')).toHaveLength(2)
    /* And the second part's line is drawn a tile further down, which is the
       whole point: it is a different picture from the first part's. */
    expect(where('moveTo')).toEqual([
      [20, 20],
      [30, 130],
    ])
  })

  it('keys the bake on which part a stroke is in, not only on the stroke', () => {
    /* The same strokes in a different slot are a different picture, because
       they are painted into a different tile. A key that named only the
       strokes handed back the last bake with the tiles in the wrong places. */
    const first: Mask = { ...newMask('brush'), parts: [{ kind: 'brush', strokes: [stroke([0.1, 0.1, 0.2, 0.2])] }] }
    const second: Mask = {
      ...newMask('brush'),
      parts: [newPart('linear'), { kind: 'brush', strokes: [stroke([0.1, 0.1, 0.2, 0.2])] }],
    }
    expect(brushKey(second)).not.toBe(brushKey(first))
  })
})

describe('what the shader is told about a part', () => {
  it('starts a gradient feathered over the whole drag and an ellipse half soft', () => {
    /* Two kinds, two numbers. A linear gradient is the drag somebody made, so
       all of it fades; an ellipse has a hard middle and a soft edge. */
    expect(maskUniforms({ ...newMask('linear'), parts: [newPart('linear')] }).a[3]).toBe(1)
    expect(maskUniforms({ ...newMask('radial'), parts: [newPart('radial')] }).a[3]).toBe(0.5)
    /* And a board saved before a gradient had a feather at all reads back as
       the gradient it was drawn as. */
    expect(maskUniforms({ ...newMask('linear'), parts: [{ kind: 'linear' }] }).a[3]).toBe(1)
  })

  it('sends a kind it has never heard of somewhere the shader covers nothing', () => {
    /* A board saved by a later version. Zero was a linear gradient, and a
       linear gradient with no geometry is a ramp at full strength across the
       whole photograph — the loudest possible way to render an edit this
       version does not know how to draw. */
    const later: Mask = { ...newMask('whole'), parts: [{ kind: 'prism' as MaskKind }] }
    expect(maskUniforms(later).a[0]).toBe(UNKNOWN_KIND)
    expect(maskUniforms(later).a[0]).not.toBe(KIND_CODE.linear)
    /* Past every code the shader knows how to draw, so it falls through to the
       branch that answers nowhere. */
    expect(UNKNOWN_KIND).toBeGreaterThan(Math.max(...Object.values(KIND_CODE)))
  })
})

/* A 2D context that records what was asked of it. The real one needs a canvas,
 * and what is being checked here is the decisions rather than the pixels. */
function fakeCtx(calls: string[], xy: number[][] = []) {
  /* Records where it was asked to draw as well as that it was asked, because
     which tile of the strip a stroke landed in is a question about the y. The
     two lists run in step, so xy[i] is where calls[i] happened. */
  const at = (name: string) => (...a: number[]) => {
    calls.push(name)
    xy.push([...a])
  }
  const rec = (name: string) => at(name)
  return {
    clearRect: at('clearRect'),
    beginPath: rec('beginPath'),
    moveTo: at('moveTo'),
    lineTo: at('lineTo'),
    arc: at('arc'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    save: rec('save'),
    restore: rec('restore'),
    rect: at('rect'),
    clip: rec('clip'),
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    filter: '',
    set globalCompositeOperation(v: string) {
      calls.push('op:' + v)
      xy.push([])
    },
    get globalCompositeOperation() {
      return ''
    },
  }
}
