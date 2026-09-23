/* The mask model lives next door and imports this one for its parameters, so
 * this edge is deliberately type-only: erased at build, no cycle at runtime. */
import type { Mask } from './mask'

/* ---------------------------------------------------------------------------
 * Developing a picture.
 *
 * Until now the tone controls on this board were six CSS filter functions:
 * `brightness`, `contrast`, `saturate`, `sepia`, `blur`, and nothing else.
 * That is a compositor trick, and as a compositor trick it was the right
 * answer — it costs no GPU pass and never invalidates a cached render. It is
 * also the reason none of the things a photograph actually needs were
 * possible. `brightness` multiplies in sRGB, so it crushes highlights rather
 * than exposing; `sepia` is a fixed brown matrix, so warmth could tint a
 * picture but never white balance one; and a CSS blur is uniform over a whole
 * card, so there was no way to say where the blur comes from.
 *
 * This is the parameter model for doing it properly: the develop pipeline as
 * Lightroom lays it out, in the order Lightroom applies it, with the ranges
 * Lightroom uses. The arithmetic that reads it lives in the shader; what is
 * here is what a card remembers, what it means, and what it falls back to.
 *
 * Three rules run through all of it.
 *
 * Everything is optional and everything has a default. A card that has been
 * developed carries only the figures that were moved, so a board of four
 * hundred untouched photographs costs nothing, and a build that learns a new
 * slider reads an old board without a migration.
 *
 * Nothing that exists already changes. The six CSS functions are reproduced
 * in the shader exactly — the Filter Effects specification gives the matrices,
 * and `test/unit/develop.test.ts` checks this model against them figure by
 * figure — so a board made last year opens looking the same to the pixel,
 * whichever path draws it.
 *
 * And the whole of it is one flat record of numbers. A curve is its points, a
 * mask is its shape and its own copy of these same numbers. Nothing here holds
 * a pixel, a canvas or a promise, which is what lets the awkward half — what
 * a slider means, what an old board migrates to, whether anything was moved at
 * all — be checked without a browser.
 * ------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
 * What a develop record holds.
 * ------------------------------------------------------------------------ */

/* One point on a tone curve, in 0..1 on both axes. */
export interface CurvePt {
  x: number
  y: number
}

/* A colour grading wheel: a hue in degrees, a saturation in 0..100, and a
 * luminance shift in -100..100. Said this way rather than as a colour, because
 * that is what the wheel actually is and what a preset has to carry. */
export interface Wheel {
  h: number
  s: number
  l: number
}

export const WHEEL_0: Wheel = { h: 0, s: 0, l: 0 }

/* The eight colour bands Lightroom splits the spectrum into, at their centre
 * hues in degrees. Eight rather than six or twelve because it is the set
 * everybody who has used one of these already knows, and because the two extra
 * over a colour wheel's six — orange and aqua — are skin and sky. */
export const BANDS: { k: string; name: string; hue: number }[] = [
  { k: 'red', name: 'Red', hue: 0 },
  { k: 'orange', name: 'Orange', hue: 30 },
  { k: 'yellow', name: 'Yellow', hue: 60 },
  { k: 'green', name: 'Green', hue: 120 },
  { k: 'aqua', name: 'Aqua', hue: 180 },
  { k: 'blue', name: 'Blue', hue: 240 },
  { k: 'purple', name: 'Purple', hue: 280 },
  { k: 'magenta', name: 'Magenta', hue: 320 },
]

/* Hue, saturation and luminance for each of the eight, each -100..100. Held as
 * three flat arrays rather than eight objects so it reaches the shader as
 * three uniform arrays without being taken apart first. */
export interface HSL {
  h: number[]
  s: number[]
  l: number[]
}

export const HSL_0: HSL = { h: [0, 0, 0, 0, 0, 0, 0, 0], s: [0, 0, 0, 0, 0, 0, 0, 0], l: [0, 0, 0, 0, 0, 0, 0, 0] }

export const isFlatHSL = (v?: HSL): boolean =>
  !v || (v.h.every((n) => !n) && v.s.every((n) => !n) && v.l.every((n) => !n))

/* --------------------------------------------------------------------------
 * The numbers.
 *
 * Every one of these is optional, and `devOf` below reads it against the
 * defaults table. The ranges are Lightroom's own: exposure in stops, the tone
 * and presence sliders in -100..100, because those are the figures anybody who
 * has developed a photograph before already has a feel for.
 * ------------------------------------------------------------------------ */
export interface Develop {
  /* ---- white balance ---- */
  /* Blue to yellow, and green to magenta. Not a Kelvin figure: a Kelvin
     temperature is only meaningful against a raw file's own illuminant, and
     what arrives on this board is already a rendered picture. This is the
     shift from where it is now, which is what the slider on a rendered picture
     honestly means. */
  temp?: number
  tint?: number

  /* ---- tone ---- */
  /* Stops, doubling the light at +1 the way a camera does, applied in linear
     light rather than on the sRGB numbers. */
  exposure?: number
  contrast?: number
  /* The four that make a photograph rather than a brightness knob: two that
     pull the ends of the range in, and two that say where the ends are. */
  highlights?: number
  shadows?: number
  whites?: number
  blacks?: number

  /* ---- presence ---- */
  /* Three kinds of local contrast at three radii: fine detail, mid-radius
     edges, and a whole-picture haze lift. */
  texture?: number
  clarity?: number
  dehaze?: number
  /* Saturation that leaves the already-saturated alone, and saturation that
     does not. */
  vibrance?: number
  saturation?: number

  /* ---- curve ---- */
  /* The points of the composite curve, and of each channel. Absent means a
     straight line, which is what an untouched curve is. */
  curve?: CurvePt[]
  curveR?: CurvePt[]
  curveG?: CurvePt[]
  curveB?: CurvePt[]

  /* ---- colour ---- */
  hsl?: HSL
  /* Three wheels and a global one, with the balance between the three and how
     far they are allowed to overlap. */
  gradeShadow?: Wheel
  gradeMid?: Wheel
  gradeHigh?: Wheel
  gradeGlobal?: Wheel
  gradeBlend?: number
  gradeBalance?: number

  /* ---- detail ---- */
  sharpen?: number
  sharpenRadius?: number
  sharpenDetail?: number
  /* The one that makes sharpening usable: an edge mask, so the sky does not
     get the treatment the eyelashes needed. */
  sharpenMask?: number
  noise?: number
  noiseDetail?: number
  noiseColour?: number

  /* ---- effects ---- */
  vignette?: number
  vignetteMid?: number
  vignetteRound?: number
  vignetteFeather?: number
  grain?: number
  grainSize?: number
  grainRough?: number

  /* ---- what the six CSS functions used to do ----
   *
   * Kept, and reproduced exactly, so that a board made before any of this
   * existed opens looking the same to the pixel. They are not Lightroom's and
   * they are not in the panel under these names; they are what an old record
   * migrates into, and what `adjustCSS` used to say. */
  cssBright?: number
  cssContrast?: number
  cssSaturate?: number
  cssWarm?: number

  /* ---- where an edit happens ----
   *
   * Masks live on the develop rather than beside it, because a mask is a
   * develop parameter in every sense that matters: a look that carries a
   * develop carries its masks, undo treats them as one edit, and a card with
   * nothing but a masked exposure is a developed card. */
  masks?: Mask[]
}

/* What every one of them is when it has not been moved.
 *
 * One table rather than a default per reader: a slider, the shader, the
 * migration and the "has anything been done to this" test all have to agree
 * about what nothing looks like, and four copies of that agreement is three
 * copies too many. */
export const DEV_0 = {
  temp: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
  gradeBlend: 50,
  gradeBalance: 0,
  sharpen: 0,
  sharpenRadius: 1,
  sharpenDetail: 25,
  sharpenMask: 0,
  noise: 0,
  noiseDetail: 50,
  noiseColour: 0,
  vignette: 0,
  vignetteMid: 50,
  vignetteRound: 0,
  vignetteFeather: 50,
  grain: 0,
  grainSize: 25,
  grainRough: 50,
  cssBright: 0,
  cssContrast: 0,
  cssSaturate: 100,
  cssWarm: 0,
} as const

export type DevKey = keyof typeof DEV_0

/* Read a figure, falling back to what it is when nothing has been done to it.
 * The same shape as `settingOf` next door in shapes.ts, for the same reason:
 * a record written by an older build is missing fields a newer one reads. */
export const devOf = <K extends DevKey>(d: Develop | undefined, k: K): number =>
  d && typeof d[k] === 'number' ? (d[k] as number) : DEV_0[k]

/* --------------------------------------------------------------------------
 * The ranges, in one place.
 *
 * The panel reads these to build itself, and the tests read them to check that
 * nothing can be set to a figure the shader was not written for. A slider whose
 * bounds are typed out beside it is a slider whose bounds drift.
 * ------------------------------------------------------------------------ */
export interface Range {
  k: DevKey
  label: string
  min: number
  max: number
  step: number
  unit?: string
}

export const RANGES: Range[] = [
  { k: 'temp', label: 'Temperature', min: -100, max: 100, step: 1 },
  { k: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  /* Five stops either way, which is the range a raw file actually holds and
     the range every other tool offers. */
  { k: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.05, unit: ' EV' },
  { k: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { k: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { k: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { k: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
  { k: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
  { k: 'texture', label: 'Texture', min: -100, max: 100, step: 1 },
  { k: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1 },
  { k: 'dehaze', label: 'Dehaze', min: -100, max: 100, step: 1 },
  { k: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1 },
  { k: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { k: 'sharpen', label: 'Amount', min: 0, max: 150, step: 1 },
  { k: 'sharpenRadius', label: 'Radius', min: 0.5, max: 3, step: 0.1, unit: 'px' },
  { k: 'sharpenDetail', label: 'Detail', min: 0, max: 100, step: 1 },
  { k: 'sharpenMask', label: 'Masking', min: 0, max: 100, step: 1 },
  { k: 'noise', label: 'Luminance', min: 0, max: 100, step: 1 },
  { k: 'noiseDetail', label: 'Detail', min: 0, max: 100, step: 1 },
  { k: 'noiseColour', label: 'Colour', min: 0, max: 100, step: 1 },
  { k: 'vignette', label: 'Amount', min: -100, max: 100, step: 1 },
  { k: 'vignetteMid', label: 'Midpoint', min: 0, max: 100, step: 1 },
  { k: 'vignetteRound', label: 'Roundness', min: -100, max: 100, step: 1 },
  { k: 'vignetteFeather', label: 'Feather', min: 0, max: 100, step: 1 },
  { k: 'grain', label: 'Amount', min: 0, max: 100, step: 1 },
  { k: 'grainSize', label: 'Size', min: 0, max: 100, step: 1 },
  { k: 'grainRough', label: 'Roughness', min: 0, max: 100, step: 1 },
  { k: 'gradeBlend', label: 'Blending', min: 0, max: 100, step: 1 },
  { k: 'gradeBalance', label: 'Balance', min: -100, max: 100, step: 1 },
]

export const rangeOf = (k: DevKey): Range | undefined => RANGES.find((r) => r.k === k)

/* --------------------------------------------------------------------------
 * Has anything been done to it?
 *
 * Asked on every render, so it has to be cheap, and asked by the card to
 * decide whether to spend a GPU pass at all. A picture nobody has developed
 * goes on being an <img> the browser draws for nothing.
 * ------------------------------------------------------------------------ */
const STRAIGHT = (pts?: CurvePt[]): boolean =>
  !pts || pts.length < 2 || pts.every((p) => Math.abs(p.y - p.x) < 1e-4)

export function developed(d?: Develop): boolean {
  if (!d) return false
  for (const k of Object.keys(DEV_0) as DevKey[]) {
    if (typeof d[k] === 'number' && d[k] !== DEV_0[k]) return true
  }
  if (!STRAIGHT(d.curve) || !STRAIGHT(d.curveR) || !STRAIGHT(d.curveG) || !STRAIGHT(d.curveB)) return true
  if (!isFlatHSL(d.hsl)) return true
  for (const w of [d.gradeShadow, d.gradeMid, d.gradeHigh, d.gradeGlobal]) {
    if (w && (w.s !== 0 || w.l !== 0)) return true
  }
  /* A card whose only edit is inside a mask is a developed card. Asked
   * directly rather than through the mask module, which asks this one the same
   * question about the mask's own parameters and would otherwise go round for
   * ever. */
  for (const m of d.masks || []) {
    if (!m.off && m.parts.length && (m.amount ?? 100) > 0 && (developed(m.dev) || (m.blur && m.blur.amount > 0)))
      return true
  }
  return false
}

/* Everything that was moved, and nothing that was not.
 *
 * What goes on the record, so a developed card carries its edit and an
 * untouched one carries nothing at all. Undoing the last slider back to where
 * it started leaves no trace, which is what makes "is this developed" a
 * question with an honest answer. */
export function trimDev(d: Develop): Develop | undefined {
  const out: Develop = {}
  for (const k of Object.keys(DEV_0) as DevKey[]) {
    const v = d[k]
    if (typeof v === 'number' && v !== DEV_0[k]) (out[k] as number) = v
  }
  if (!STRAIGHT(d.curve)) out.curve = d.curve
  if (!STRAIGHT(d.curveR)) out.curveR = d.curveR
  if (!STRAIGHT(d.curveG)) out.curveG = d.curveG
  if (!STRAIGHT(d.curveB)) out.curveB = d.curveB
  if (!isFlatHSL(d.hsl)) out.hsl = d.hsl
  if (d.gradeShadow && (d.gradeShadow.s || d.gradeShadow.l)) out.gradeShadow = d.gradeShadow
  if (d.gradeMid && (d.gradeMid.s || d.gradeMid.l)) out.gradeMid = d.gradeMid
  if (d.gradeHigh && (d.gradeHigh.s || d.gradeHigh.l)) out.gradeHigh = d.gradeHigh
  if (d.gradeGlobal && (d.gradeGlobal.s || d.gradeGlobal.l)) out.gradeGlobal = d.gradeGlobal
  /* A mask that has been drawn but not yet given a parameter is kept: it is
   * work somebody did, it is on the screen, and losing it the moment the
   * panel re-renders would be unforgivable. An empty list is not. */
  if (d.masks && d.masks.length) out.masks = d.masks
  return Object.keys(out).length ? out : undefined
}

/* ---------------------------------------------------------------------------
 * What the six CSS functions did, written down exactly.
 *
 * The board drew its tone adjustments with `filter: brightness() contrast()
 * saturate() sepia() hue-rotate()`, and thousands of cards are saved with
 * those figures on them. Moving the work onto the GPU is only safe if the GPU
 * does the same arithmetic, so the arithmetic is here, taken from the Filter
 * Effects specification rather than from memory, and checked against it in
 * test/unit/develop.test.ts.
 *
 * All five reduce to one affine step and one 3x3 matrix, because brightness
 * and contrast are per-channel lines and the other three are matrices, and a
 * run of matrices is a matrix. So the whole legacy chain reaches the shader as
 * nine numbers and two more, and costs nothing to carry.
 *
 * It is done on the sRGB numbers, unlinearised, because that is what a CSS
 * filter does. Everything Lightroom-shaped that follows is done in linear
 * light, which is what it should be; this part is bug-compatible on purpose.
 * ------------------------------------------------------------------------- */

/* Row-major, nine numbers. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const I3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0] as number[]
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
    }
  }
  return out as Mat3
}

export const apply3 = (m: Mat3, rgb: [number, number, number]): [number, number, number] => [
  m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2],
  m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2],
  m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2],
]

/* The luminance weights the filter specification uses for `saturate` and
 * `hue-rotate`. They are Rec. 601, not Rec. 709 — which is a quirk of the
 * specification and not a mistake here: matching it is the whole point. */
const LR = 0.213
const LG = 0.715
const LB = 0.072

export function satMatrix(s: number): Mat3 {
  return [
    LR + (1 - LR) * s, LG - LG * s, LB - LB * s,
    LR - LR * s, LG + (1 - LG) * s, LB - LB * s,
    LR - LR * s, LG - LG * s, LB + (1 - LB) * s,
  ]
}

export function sepiaMatrix(a: number): Mat3 {
  const k = 1 - a
  return [
    0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k,
    0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k,
    0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k,
  ]
}

export function hueRotateMatrix(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [
    LR + c * (1 - LR) + s * -LR, LG + c * -LG + s * -LG, LB + c * -LB + s * (1 - LB),
    LR + c * -LR + s * 0.143, LG + c * (1 - LG) + s * 0.14, LB + c * -LB + s * -0.283,
    LR + c * -LR + s * -(1 - LR), LG + c * -LG + s * LG, LB + c * (1 - LB) + s * LB,
  ]
}

/* The chain, as the stages it actually is.
 *
 * It was one affine step and one matrix until a browser was asked. It is not:
 * a filter list clamps to 0..1 between every function in it, so a picture
 * brightened past white comes back to white before the next filter sees it,
 * and the matrices that follow read a different colour than they would have.
 * Collapsing the chain loses that, and the loss is not small — a bright cyan
 * put through brightness, contrast, saturation and warmth came out 68 levels
 * wrong out of 255.
 *
 * So the stages stay stages, and `test/develop.mjs` holds a real browser to
 * every one of them. */
export type Stage =
  | { t: 'affine'; scale: number; lift: number }
  | { t: 'matrix'; m: Mat3 }

export interface LegacyFour {
  exp: number
  con: number
  sat: number
  warm: number
}

/* In the order `adjustCSS` wrote them, which is the order a browser runs
 * them: left to right, each on what the one before it produced. A filter that
 * was not set is not in the list at all, the same as it was not in the string,
 * because a no-op filter still costs a clamp. */
export function legacyStages(v: LegacyFour): Stage[] {
  const out: Stage[] = []
  if (v.exp) out.push({ t: 'affine', scale: 1 + v.exp / 100, lift: 0 })
  if (v.con) {
    const k = 1 + v.con / 100
    out.push({ t: 'affine', scale: k, lift: 0.5 * (1 - k) })
  }
  if (v.sat !== 100) out.push({ t: 'matrix', m: satMatrix(v.sat / 100) })
  if (v.warm > 0) {
    out.push({ t: 'matrix', m: sepiaMatrix(v.warm / 150) })
    out.push({ t: 'matrix', m: satMatrix(1 + v.warm / 300) })
  } else if (v.warm < 0) {
    out.push({ t: 'matrix', m: hueRotateMatrix(v.warm * 0.4) })
    out.push({ t: 'matrix', m: satMatrix(1 + -v.warm / 400) })
  }
  return out
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/* One colour through the whole chain, clamped between every stage.
 *
 * The reference the shader is written against and the test measures. Kept
 * here rather than in either of them so there is one answer and not three. */
export function runStages(stages: Stage[], rgb: [number, number, number]): [number, number, number] {
  let v = rgb
  for (const st of stages) {
    v = st.t === 'affine'
      ? [v[0] * st.scale + st.lift, v[1] * st.scale + st.lift, v[2] * st.scale + st.lift]
      : apply3(st.m, v)
    v = [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])]
  }
  return v
}

/* --------------------------------------------------------------------------
 * Bringing an old card across.
 *
 * The four figures a card has always carried become the four this model calls
 * them, unchanged and meaning exactly what they meant. Nothing is approximated
 * and nothing is reinterpreted.
 *
 * Blur and grain are not here. Both already have somewhere better to be — blur
 * becomes the blur gallery's own amount, and grain is a develop effect with a
 * size and a roughness that a CSS filter never had.
 * ------------------------------------------------------------------------ */

export function fromLegacy(fx: LegacyFour): Develop {
  const out: Develop = {}
  if (fx.exp) out.cssBright = fx.exp
  if (fx.con) out.cssContrast = fx.con
  if (fx.sat !== 100) out.cssSaturate = fx.sat
  if (fx.warm) out.cssWarm = fx.warm
  return out
}

/* And the stages a develop record implies, for the shader. */
export const toneOf = (d?: Develop): Stage[] =>
  legacyStages({
    exp: devOf(d, 'cssBright'),
    con: devOf(d, 'cssContrast'),
    sat: devOf(d, 'cssSaturate'),
    warm: devOf(d, 'cssWarm'),
  })

/* ---------------------------------------------------------------------------
 * The tone curve.
 *
 * Drawn through its points with a monotone cubic rather than a plain spline.
 * A Catmull-Rom through hand-placed points overshoots between them, and an
 * overshoot in a tone curve is not a wobble: it is a stretch of the range
 * where making the picture brighter makes it darker. The Fritsch-Carlson
 * conditioning below is the standard fix and costs three lines.
 *
 * What comes out is a table, because four curves evaluated per pixel with an
 * arbitrary number of points is a loop with a branch in it, and a table is one
 * texture read that is exact everywhere a point was placed.
 * ------------------------------------------------------------------------- */

export const CURVE_W = 256

const LINE: CurvePt[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }]

/* One curve, evaluated at x in 0..1. */
export function evalCurve(pts: CurvePt[] | undefined, x: number): number {
  const p = pts && pts.length >= 2 ? [...pts].sort((a, b) => a.x - b.x) : LINE
  if (x <= p[0].x) return p[0].y
  if (x >= p[p.length - 1].x) return p[p.length - 1].y

  let i = 0
  while (i < p.length - 2 && x > p[i + 1].x) i++
  const x0 = p[i].x
  const x1 = p[i + 1].x
  const y0 = p[i].y
  const y1 = p[i + 1].y
  const h = x1 - x0
  if (h <= 1e-9) return y1

  /* The secant either side of each end, and the tangents conditioned so the
     curve cannot leave the box its two points make. */
  const slope = (a: CurvePt, b: CurvePt) => (b.y - a.y) / Math.max(b.x - a.x, 1e-9)
  const d = slope(p[i], p[i + 1])
  const dPrev = i > 0 ? slope(p[i - 1], p[i]) : d
  const dNext = i < p.length - 2 ? slope(p[i + 1], p[i + 2]) : d
  const tame = (a: number, b: number) => (a * b <= 0 ? 0 : (a + b) / 2)
  let m0 = i > 0 ? tame(dPrev, d) : d
  let m1 = i < p.length - 2 ? tame(d, dNext) : d
  if (Math.abs(d) < 1e-9) {
    m0 = 0
    m1 = 0
  } else {
    const a = m0 / d
    const b = m1 / d
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m0 = t * a * d
      m1 = t * b * d
    }
  }

  const t = (x - x0) / h
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * m1
  )
}

/* All four curves as one table: 256 wide, four rows — composite, red, green,
 * blue — as RGBA bytes with the answer in the red channel, which is the one
 * the shader reads. */
export function curveTable(d?: Develop): Uint8Array {
  const rows = [d?.curve, d?.curveR, d?.curveG, d?.curveB]
  const out = new Uint8Array(CURVE_W * 4 * 4)
  for (let row = 0; row < 4; row++) {
    const pts = rows[row]
    for (let i = 0; i < CURVE_W; i++) {
      const x = i / (CURVE_W - 1)
      const y = pts ? evalCurve(pts, x) : x
      const v = Math.round(Math.min(1, Math.max(0, y)) * 255)
      const at = (row * CURVE_W + i) * 4
      out[at] = v
      out[at + 1] = v
      out[at + 2] = v
      out[at + 3] = 255
    }
  }
  return out
}

/* What identifies the four curves, and nothing else about the record.
 *
 * The table is a texture upload. Keyed on the whole develop record it would be
 * re-uploaded every time the exposure slider moved; keyed on the curves it is
 * uploaded when a curve is dragged, which is the only time it changed. */
export const curveKeyOf = (d?: Develop): string =>
  !d ? '' : JSON.stringify([d.curve, d.curveR, d.curveG, d.curveB])

export const hasCurve = (d?: Develop): boolean =>
  !!d && (!STRAIGHT(d.curve) || !STRAIGHT(d.curveR) || !STRAIGHT(d.curveG) || !STRAIGHT(d.curveB))

/* ---------------------------------------------------------------------------
 * What the shader is handed.
 *
 * The sliders are in the figures a person reads — stops, and minus a hundred
 * to a hundred — and the shader wants them in the figures the arithmetic
 * reads. Converting here rather than in GLSL means the conversion can be
 * checked without a GPU, and means there is one place that knows a Clarity of
 * fifty is 0.5 and not 50.
 * ------------------------------------------------------------------------- */

export interface DevUniforms {
  wb: [number, number]
  tone: [number, number, number, number]
  tone2: [number, number, number, number]
  presence: [number, number, number, number]
  sharp: [number, number, number, number]
  noise: [number, number, number]
  vign: [number, number, number, number]
  grain: [number, number, number]
  hslH: number[]
  hslS: number[]
  hslL: number[]
  gradeS: [number, number, number]
  gradeM: [number, number, number]
  gradeH: [number, number, number]
  gradeG: [number, number, number]
  gradeMix: [number, number]
  /* The radius the blur chain should be run at for clarity and dehaze, in the
     same units the effects use — zero when neither is asked for, so the chain
     is skipped entirely. */
  blurRadius: number
}

const pct = (n: number) => n / 100
const wheel = (w?: Wheel): [number, number, number] => [w?.h ?? 0, pct(w?.s ?? 0), pct(w?.l ?? 0)]

export function devUniforms(d?: Develop): DevUniforms {
  const clarity = pct(devOf(d, 'clarity'))
  const dehaze = pct(devOf(d, 'dehaze'))
  const hsl = d?.hsl
  return {
    wb: [pct(devOf(d, 'temp')), pct(devOf(d, 'tint'))],
    tone: [devOf(d, 'exposure'), pct(devOf(d, 'contrast')), pct(devOf(d, 'highlights')), pct(devOf(d, 'shadows'))],
    tone2: [pct(devOf(d, 'whites')), pct(devOf(d, 'blacks')), pct(devOf(d, 'texture')), clarity],
    presence: [dehaze, pct(devOf(d, 'vibrance')), pct(devOf(d, 'saturation')), hasCurve(d) ? 1 : 0],
    sharp: [pct(devOf(d, 'sharpen')), devOf(d, 'sharpenRadius'), pct(devOf(d, 'sharpenDetail')), pct(devOf(d, 'sharpenMask'))],
    noise: [pct(devOf(d, 'noise')), pct(devOf(d, 'noiseDetail')), pct(devOf(d, 'noiseColour'))],
    vign: [pct(devOf(d, 'vignette')), pct(devOf(d, 'vignetteMid')), pct(devOf(d, 'vignetteRound')), pct(devOf(d, 'vignetteFeather'))],
    grain: [pct(devOf(d, 'grain')), pct(devOf(d, 'grainSize')), pct(devOf(d, 'grainRough'))],
    hslH: hsl ? hsl.h.map(pct) : HSL_0.h,
    hslS: hsl ? hsl.s.map(pct) : HSL_0.s,
    hslL: hsl ? hsl.l.map(pct) : HSL_0.l,
    gradeS: wheel(d?.gradeShadow),
    gradeM: wheel(d?.gradeMid),
    gradeH: wheel(d?.gradeHigh),
    gradeG: wheel(d?.gradeGlobal),
    gradeMix: [pct(devOf(d, 'gradeBlend')), pct(devOf(d, 'gradeBalance'))],
    /* Clarity and dehaze are the only two that need a softened copy, so the
       chain runs only for them and only as wide as the wider of the two asks. */
    blurRadius: clarity || dehaze ? Math.max(Math.abs(clarity), Math.abs(dehaze)) * 22 + 6 : 0,
  }
}
