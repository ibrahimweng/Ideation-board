import { describe, expect, it } from 'vitest'
import { DEV_0, developed, trimDev } from '../../src/state/develop'
import {
  BLUR_CODE,
  KIND_CODE,
  MASK_KEYS,
  MAX_PARTS,
  brushKey,
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
    expect(calls[calls.length - 1]).toBe('op:source-over')
  })

  it('leaves a mask with nothing painted as no place at all', () => {
    expect(maskEmpty({ ...newMask('brush') })).toBe(true)
    expect(maskEmpty(newMask('radial'))).toBe(false)
  })
})

/* A 2D context that records what was asked of it. The real one needs a canvas,
 * and what is being checked here is the decisions rather than the pixels. */
function fakeCtx(calls: string[]) {
  const rec = (name: string) => () => void calls.push(name)
  return {
    clearRect: rec('clearRect'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    filter: '',
    set globalCompositeOperation(v: string) {
      calls.push('op:' + v)
    },
    get globalCompositeOperation() {
      return ''
    },
  }
}
