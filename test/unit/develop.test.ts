import { describe, expect, it } from 'vitest'
import {
  BANDS, DEV_0, HSL_0, RANGES, apply3, developed, devOf, fromLegacy, hueRotateMatrix,
  CURVE_W, curveKeyOf, curveTable, devUniforms, evalCurve, hasCurve,
  isFlatHSL, legacyStages, mul3, rangeOf, runStages, satMatrix, sepiaMatrix, toneOf, trimDev,
} from '../../src/state/develop'
import type { Develop, Mat3 } from '../../src/state/develop'

/* Developing a picture.
 *
 * Two jobs here, and the second matters more than the first.
 *
 * The first is the ordinary one: ranges are the ranges, a record knows whether
 * it has been touched, and what goes on disk is only what was moved.
 *
 * The second is that a board made before any of this existed has to open
 * looking the same to the pixel. Its tone was six CSS filter functions, and the
 * shader now does that arithmetic instead, so the arithmetic is checked here
 * against the Filter Effects specification figure by figure — and in
 * test/develop.mjs against a browser actually running the filters. */

const ID: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const close = (m: Mat3, to: Mat3, dp = 6) => m.forEach((v, i) => expect(v).toBeCloseTo(to[i], dp))

describe('the shape of a develop record', () => {
  it('reads a figure that is there and falls back to the one that is not', () => {
    expect(devOf({ exposure: 1.5 }, 'exposure')).toBe(1.5)
    expect(devOf({}, 'exposure')).toBe(0)
    expect(devOf(undefined, 'sharpenRadius')).toBe(1)
  })

  it('every range names a figure the defaults know about', () => {
    for (const r of RANGES) expect(DEV_0[r.k]).toBeTypeOf('number')
  })

  it('and every range has its default inside it', () => {
    /* A slider whose starting point is outside its own track is a slider that
       jumps the first time it is touched. */
    for (const r of RANGES) {
      expect(DEV_0[r.k]).toBeGreaterThanOrEqual(r.min)
      expect(DEV_0[r.k]).toBeLessThanOrEqual(r.max)
    }
  })

  it('has the eight colour bands, in order round the wheel', () => {
    expect(BANDS.length).toBe(8)
    const hues = BANDS.map((b) => b.hue)
    expect([...hues].sort((a, b) => a - b)).toEqual(hues)
  })

  it('finds a range by its key', () => {
    expect(rangeOf('exposure')?.unit).toBe(' EV')
    expect(rangeOf('nonesuch' as never)).toBeUndefined()
  })
})

describe('whether anything has been done to it', () => {
  it('says no to nothing at all', () => {
    expect(developed(undefined)).toBe(false)
    expect(developed({})).toBe(false)
  })

  it('says no to a record holding only the defaults', () => {
    /* A slider dragged and put back is a slider nobody moved. */
    expect(developed({ exposure: 0, sharpenRadius: 1, cssSaturate: 100 })).toBe(false)
  })

  it('says yes to one figure moved', () => {
    expect(developed({ exposure: 0.01 })).toBe(true)
    expect(developed({ sharpenRadius: 1.1 })).toBe(true)
  })

  it('says yes to a bent curve and no to a straight one', () => {
    expect(developed({ curve: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(false)
    expect(developed({ curve: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] })).toBe(true)
    expect(developed({ curveB: [{ x: 0, y: 0.05 }, { x: 1, y: 1 }] })).toBe(true)
  })

  it('says yes to a colour band moved, and no to eight flat ones', () => {
    expect(isFlatHSL(HSL_0)).toBe(true)
    expect(developed({ hsl: HSL_0 })).toBe(false)
    const band = { ...HSL_0, s: [0, 40, 0, 0, 0, 0, 0, 0] }
    expect(developed({ hsl: band })).toBe(true)
  })

  it('says yes to a grading wheel with strength, and no to one with only a hue', () => {
    /* A hue with no saturation behind it tints nothing, which is why the wheel
       starts in the middle rather than at red. */
    expect(developed({ gradeShadow: { h: 210, s: 0, l: 0 } })).toBe(false)
    expect(developed({ gradeShadow: { h: 210, s: 30, l: 0 } })).toBe(true)
    expect(developed({ gradeHigh: { h: 0, s: 0, l: -10 } })).toBe(true)
  })
})

describe('what goes on the record', () => {
  it('writes nothing at all for an untouched picture', () => {
    expect(trimDev({})).toBeUndefined()
    expect(trimDev({ exposure: 0, contrast: 0, cssSaturate: 100 })).toBeUndefined()
  })

  it('writes what was moved and drops what was not', () => {
    const out = trimDev({ exposure: 1, contrast: 0, clarity: 20, sharpenRadius: 1 })!
    expect(out).toEqual({ exposure: 1, clarity: 20 })
  })

  it('keeps a bent curve and drops a straight one', () => {
    const bent = [{ x: 0, y: 0 }, { x: 0.4, y: 0.6 }, { x: 1, y: 1 }]
    const out = trimDev({ curve: bent, curveR: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })!
    expect(out.curve).toBe(bent)
    expect(out.curveR).toBeUndefined()
  })

  it('and what it writes reads back the same', () => {
    const d: Develop = { exposure: -1.25, dehaze: 15, hsl: { ...HSL_0, l: [0, 0, 0, -20, 0, 0, 0, 0] } }
    const round = JSON.parse(JSON.stringify(trimDev(d))) as Develop
    expect(devOf(round, 'exposure')).toBe(-1.25)
    expect(devOf(round, 'dehaze')).toBe(15)
    expect(round.hsl?.l[3]).toBe(-20)
  })
})

/* -------------------------------------------------------------------------
 * The part a board made last year depends on.
 * ----------------------------------------------------------------------- */

describe('the CSS filters, written down exactly', () => {
  it('saturate(1) is the identity, and saturate(0) is a grey', () => {
    close(satMatrix(1), ID)
    const grey = apply3(satMatrix(0), [0.2, 0.6, 0.9])
    expect(grey[0]).toBeCloseTo(grey[1], 9)
    expect(grey[1]).toBeCloseTo(grey[2], 9)
    /* Rec. 601 weights, which is what the specification says — not Rec. 709. */
    expect(grey[0]).toBeCloseTo(0.213 * 0.2 + 0.715 * 0.6 + 0.072 * 0.9, 9)
  })

  it('sepia(0) is the identity and sepia(1) is the specification matrix', () => {
    close(sepiaMatrix(0), ID)
    close(sepiaMatrix(1), [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131])
  })

  it('hue-rotate(0) is the identity, and a full turn comes back', () => {
    close(hueRotateMatrix(0), ID)
    close(hueRotateMatrix(360), ID, 5)
  })

  it('multiplies two matrices the way a browser chains two filters', () => {
    close(mul3(ID, satMatrix(0.4)), satMatrix(0.4))
    close(mul3(satMatrix(0.4), ID), satMatrix(0.4))
  })
})

describe('an old card, brought across', () => {
  const four = (exp: number, con: number, sat: number, warm: number) => ({ exp, con, sat, warm })

  it('an untouched one runs no stages at all, so nothing is drawn differently', () => {
    expect(legacyStages(four(0, 0, 100, 0))).toEqual([])
    const grey: [number, number, number] = [0.3, 0.5, 0.7]
    expect(runStages([], grey)).toEqual(grey)
  })

  it('brightness is the multiply it always was', () => {
    expect(legacyStages(four(40, 0, 100, 0))).toEqual([{ t: 'affine', scale: 1.4, lift: 0 }])
  })

  it('contrast is the multiply about the half-way point it always was', () => {
    const st = legacyStages(four(0, 50, 100, 0))[0] as { scale: number; lift: number }
    /* A mid grey is the fixed point of `contrast()`, whatever it is set to. */
    expect(st.scale * 0.5 + st.lift).toBeCloseTo(0.5, 9)
    expect(st.scale).toBeCloseTo(1.5, 9)
  })

  it('warmth above zero is sepia and then a little saturation', () => {
    const st = legacyStages(four(0, 0, 100, 60))
    expect(st.length).toBe(2)
    close((st[0] as { m: Mat3 }).m, sepiaMatrix(60 / 150), 9)
    close((st[1] as { m: Mat3 }).m, satMatrix(1 + 60 / 300), 9)
  })

  it('warmth below zero is a hue rotation and then a little saturation', () => {
    const st = legacyStages(four(0, 0, 100, -60))
    close((st[0] as { m: Mat3 }).m, hueRotateMatrix(-60 * 0.4), 9)
    close((st[1] as { m: Mat3 }).m, satMatrix(1 + 60 / 400), 9)
  })

  it('runs them in the order the browser ran them', () => {
    /* Saturation before warmth, because that is the order `adjustCSS` wrote
       them and a browser applies a filter list left to right. */
    const st = legacyStages(four(0, 0, 40, 60))
    close((st[0] as { m: Mat3 }).m, satMatrix(0.4), 9)
    close((st[1] as { m: Mat3 }).m, sepiaMatrix(60 / 150), 9)
  })

  it('clamps between every stage, which is the thing a matrix cannot do', () => {
    /* The finding that made this a list rather than one matrix: a browser
       clamps to 0..1 after each filter, so a picture brightened past white
       comes back to white before the next one sees it. Collapsed into a single
       matrix, a bright cyan came out 68 levels of 255 wrong. */
    const bright: [number, number, number] = [0, 1, 1]
    const withClamp = runStages(legacyStages(four(25, 30, 140, 55)), bright)
    /* The same chain with nothing clamped until the end. */
    let raw = bright
    for (const st of legacyStages(four(25, 30, 140, 55))) {
      raw = st.t === 'affine'
        ? [raw[0] * st.scale + st.lift, raw[1] * st.scale + st.lift, raw[2] * st.scale + st.lift]
        : apply3(st.m, raw)
    }
    const clamped = raw.map((c) => Math.min(1, Math.max(0, c)))
    expect(Math.abs(withClamp[0] - clamped[0])).toBeGreaterThan(0.2)
  })

  it('never lets a colour out of the cube', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0.5, 0.9, 0.1]] as [number, number, number][]) {
      for (const v of runStages(legacyStages(four(90, 90, 200, 90)), c)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('carries the four figures across without reinterpreting any of them', () => {
    expect(fromLegacy(four(40, 0, 100, 0))).toEqual({ cssBright: 40 })
    expect(fromLegacy(four(0, 0, 100, 0))).toEqual({})
    expect(fromLegacy(four(0, 0, 60, -20))).toEqual({ cssSaturate: 60, cssWarm: -20 })
  })

  it('and a record carrying none of them asks the shader for nothing', () => {
    expect(toneOf(undefined)).toEqual([])
    expect(toneOf({ exposure: 2 })).toEqual([])
  })
})

/* -------------------------------------------------------------------------
 * The tone curve, and what the shader is handed.
 * ----------------------------------------------------------------------- */

describe('the tone curve', () => {
  const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }]

  it('a straight line is the identity, everywhere', () => {
    for (const x of [0, 0.01, 0.25, 0.5, 0.731, 0.99, 1]) {
      expect(evalCurve(line, x)).toBeCloseTo(x, 6)
    }
  })

  it('passes exactly through every point it was drawn through', () => {
    const pts = [{ x: 0, y: 0.05 }, { x: 0.3, y: 0.2 }, { x: 0.7, y: 0.85 }, { x: 1, y: 0.95 }]
    for (const p of pts) expect(evalCurve(pts, p.x)).toBeCloseTo(p.y, 6)
  })

  it('holds flat outside its own ends rather than running off', () => {
    const pts = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 }]
    expect(evalCurve(pts, 0)).toBeCloseTo(0.3, 9)
    expect(evalCurve(pts, 1)).toBeCloseTo(0.7, 9)
  })

  it('never overshoots, which in a tone curve is an inversion', () => {
    /* A plain spline through these overshoots past the flat stretch and makes
       a band where brighter input comes out darker. */
    const pts = [{ x: 0, y: 0 }, { x: 0.4, y: 0.4 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }]
    let last = -1
    for (let i = 0; i <= 512; i++) {
      const y = evalCurve(pts, i / 512)
      expect(y).toBeGreaterThanOrEqual(-1e-9)
      expect(y).toBeLessThanOrEqual(1 + 1e-9)
      /* Monotone: a curve drawn through rising points never falls. */
      expect(y).toBeGreaterThanOrEqual(last - 1e-9)
      last = y
    }
  })

  it('reads a curve given out of order, because a dragged point crosses others', () => {
    const jumbled = [{ x: 1, y: 1 }, { x: 0.5, y: 0.8 }, { x: 0, y: 0 }]
    expect(evalCurve(jumbled, 0.5)).toBeCloseTo(0.8, 6)
  })

  it('and with no curve at all is the identity', () => {
    expect(evalCurve(undefined, 0.4)).toBeCloseTo(0.4, 9)
  })
})

describe('the table the shader reads', () => {
  it('is four rows of two hundred and fifty six', () => {
    expect(curveTable().length).toBe(CURVE_W * 4 * 4)
  })

  it('an untouched record gives four straight ramps', () => {
    const t = curveTable()
    for (let row = 0; row < 4; row++) {
      for (const i of [0, 64, 128, 255]) {
        expect(t[(row * CURVE_W + i) * 4]).toBe(i)
      }
    }
  })

  it('a bent composite bends row zero and leaves the channels alone', () => {
    const t = curveTable({ curve: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] })
    expect(t[(0 * CURVE_W + 128) * 4]).toBeGreaterThan(160)
    expect(t[(1 * CURVE_W + 128) * 4]).toBe(128)
    expect(t[(3 * CURVE_W + 128) * 4]).toBe(128)
  })

  it('and a blue curve bends only blue', () => {
    const t = curveTable({ curveB: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }] })
    expect(t[(3 * CURVE_W + 0) * 4]).toBeGreaterThan(20)
    expect(t[(1 * CURVE_W + 0) * 4]).toBe(0)
  })

  it('says whether there is a curve worth uploading at all', () => {
    expect(hasCurve(undefined)).toBe(false)
    expect(hasCurve({ curve: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(false)
    expect(hasCurve({ curveG: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] })).toBe(true)
  })
})

describe('what the shader is handed', () => {
  it('turns the figures a person reads into the figures the arithmetic reads', () => {
    const u = devUniforms({ contrast: 50, clarity: -25, exposure: 1.5 })
    expect(u.tone[0]).toBe(1.5)
    expect(u.tone[1]).toBeCloseTo(0.5, 9)
    expect(u.tone2[3]).toBeCloseTo(-0.25, 9)
  })

  it('an untouched record is zero everywhere it should be', () => {
    const u = devUniforms(undefined)
    expect(u.wb).toEqual([0, 0])
    expect(u.tone).toEqual([0, 0, 0, 0])
    expect(u.presence[3]).toBe(0)
    expect(u.hslH.every((n) => n === 0)).toBe(true)
    expect(u.blurRadius).toBe(0)
  })

  it('asks for no softened copy unless clarity or dehaze wants one', () => {
    /* The blur chain is two draws. A card that is not asking for local
       contrast must not pay for them. */
    expect(devUniforms({ exposure: 2, vibrance: 40, sharpen: 60 }).blurRadius).toBe(0)
    expect(devUniforms({ clarity: 30 }).blurRadius).toBeGreaterThan(6)
    expect(devUniforms({ dehaze: -30 }).blurRadius).toBeGreaterThan(6)
  })

  it('and asks for a wider one the harder it is pushed', () => {
    const small = devUniforms({ clarity: 10 }).blurRadius
    const large = devUniforms({ clarity: 100 }).blurRadius
    expect(large).toBeGreaterThan(small)
  })

  it('carries the eight bands across in order', () => {
    const u = devUniforms({ hsl: { h: [10, 0, 0, 0, 0, 0, 0, 0], s: [0, 0, 0, 0, 0, 0, 0, 50], l: [...HSL_0.l] } })
    expect(u.hslH[0]).toBeCloseTo(0.1, 9)
    expect(u.hslS[7]).toBeCloseTo(0.5, 9)
  })

  it('and a grading wheel keeps its hue in degrees and its strength in parts', () => {
    const u = devUniforms({ gradeShadow: { h: 210, s: 40, l: -20 } })
    expect(u.gradeS[0]).toBe(210)
    expect(u.gradeS[1]).toBeCloseTo(0.4, 9)
    expect(u.gradeS[2]).toBeCloseTo(-0.2, 9)
  })

  it('tells the shader there is a curve only when there is one', () => {
    expect(devUniforms({ curve: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }).presence[3]).toBe(0)
    expect(devUniforms({ curve: [{ x: 0, y: 0 }, { x: 0.3, y: 0.5 }, { x: 1, y: 1 }] }).presence[3]).toBe(1)
  })

  /* The renderer skips the table upload when the name of the curves has not
     changed, and starts out holding the empty name to mean "nothing uploaded
     yet". That only works while no real record can be called nothing — which
     is a property of this function and is checked here rather than left as a
     comment beside the renderer. */
  it('gives every record a name, and only a record that is not there none', () => {
    expect(curveKeyOf(undefined)).toBe('')
    expect(curveKeyOf({})).not.toBe('')
    expect(curveKeyOf({ exposure: 2 })).not.toBe('')
    /* And the name follows the curves and nothing else, which is why moving
       the exposure does not cost an upload. */
    expect(curveKeyOf({ exposure: 2 })).toBe(curveKeyOf({ exposure: -1 }))
    const bent = curveKeyOf({ curve: [{ x: 0, y: 0 }, { x: 0.3, y: 0.5 }, { x: 1, y: 1 }] })
    expect(bent).not.toBe(curveKeyOf({}))
    expect(bent).not.toBe(curveKeyOf({ curve: [{ x: 0, y: 0 }, { x: 0.3, y: 0.6 }, { x: 1, y: 1 }] }))
  })
})
