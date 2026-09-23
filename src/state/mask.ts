import { DEV_0, developed, trimDev } from './develop'
import type { DevKey, Develop } from './develop'

/* ---------------------------------------------------------------------------
 * Masks: where an edit happens.
 *
 * Every slider in the develop panel does the same thing to every pixel, which
 * is how a photograph was edited before about 2004 and is not how anybody
 * edits one now. The sky is too bright and the face is too dark, and those are
 * two different edits; a slider that cannot be told where to work can only
 * ever split the difference between them.
 *
 * So: a mask is a place, and a set of develop parameters to apply there. The
 * place is built out of parts — a gradient, an ellipse, a brush, a range of
 * colours, a range of brightnesses, a range of distances — and the parts
 * combine, one adding to the last, subtracting from it or intersecting with
 * it. That is Lightroom's model exactly, and Lightroom's model is right: it is
 * the smallest one in which "the sky, but not where the building cuts into it"
 * is a thing you can say.
 *
 * A mask carries a whole `Develop` of its own rather than a special reduced
 * set, so everything that already knows how to draw a develop parameter — the
 * ranges table, the sliders, the shader — works on a mask with no new code.
 * The panel offers Lightroom's shorter list, because a tone curve inside a
 * radial gradient is not a thing anybody has ever wanted.
 * ------------------------------------------------------------------------- */

export type MaskKind = 'linear' | 'radial' | 'brush' | 'colour' | 'luminance' | 'depth'

/* How a part joins the ones before it. The first part in a mask is the mask;
 * `op` is what the second and later ones do to it. */
export type MaskOp = 'add' | 'sub' | 'int'

/* A brush is a list of strokes, and a stroke is a run of points with the
 * settings the brush had while it was drawn — so changing the size for the
 * next stroke does not change the one already laid down. */
export interface Stroke {
  /* Flat x,y pairs in 0..1 picture space: half the objects, half the JSON. */
  pts: number[]
  size: number
  soft: number
  flow: number
  erase?: boolean
}

export interface MaskPart {
  kind: MaskKind
  op?: MaskOp
  inv?: boolean
  /* linear: the line the gradient runs along, from no effect to full effect. */
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  /* radial: the ellipse, and which way round it is. */
  cx?: number
  cy?: number
  rx?: number
  ry?: number
  rot?: number
  /* How soft the edge is, for both of those. 0..100. */
  feather?: number
  /* colour range: the colour that was picked, in 0..1 sRGB. */
  r?: number
  g?: number
  b?: number
  /* colour range: how far from it still counts. luminance and depth: the band,
   * and how soft its ends are. All 0..100. */
  tol?: number
  lo?: number
  hi?: number
  /* brush */
  strokes?: Stroke[]
}

export interface Mask {
  id: string
  name: string
  parts: MaskPart[]
  /* What this mask does where it is. */
  dev?: Develop
  /* The whole mask's strength, 0..100. Lightroom's Amount slider: the way to
   * back a local edit off without touching the eleven sliders inside it. */
  amount?: number
  /* Switched off but kept, which is how anybody compares two ideas. */
  off?: boolean
}

/* Four parts is the most a mask can have. It is not a number chosen to save
 * uniform slots — it is the number past which nobody can say what the mask
 * means any more, and a fifth part is better spent as a second mask. */
export const MAX_PARTS = 4

export const MASK_KINDS: { k: MaskKind; name: string; hint: string }[] = [
  { k: 'linear', name: 'Linear gradient', hint: 'A sky, a foreground, one side of a room' },
  { k: 'radial', name: 'Radial gradient', hint: 'A face, a lamp, anything roughly round' },
  { k: 'brush', name: 'Brush', hint: 'Paint it in by hand' },
  { k: 'colour', name: 'Colour range', hint: 'Everything that is this colour' },
  { k: 'luminance', name: 'Luminance range', hint: 'Everything this bright' },
  { k: 'depth', name: 'Depth range', hint: 'Everything this far away — needs a depth map wired in' },
]

export const kindName = (k: MaskKind) => MASK_KINDS.find((m) => m.k === k)?.name || k

/* A new part of each kind, placed where a new one of that kind should start:
 * a gradient down the top third, an ellipse in the middle, a luminance range
 * over the highlights. Nobody's first move should be to drag a control off the
 * top-left corner to where they can see it. */
export function newPart(kind: MaskKind, op?: MaskOp): MaskPart {
  const p: MaskPart = { kind }
  if (op) p.op = op
  if (kind === 'linear') return { ...p, x1: 0.5, y1: 0.05, x2: 0.5, y2: 0.45 }
  if (kind === 'radial') return { ...p, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, rot: 0, feather: 50 }
  if (kind === 'brush') return { ...p, strokes: [] }
  if (kind === 'colour') return { ...p, r: 0.5, g: 0.5, b: 0.5, tol: 30 }
  if (kind === 'luminance') return { ...p, lo: 60, hi: 100, tol: 20 }
  if (kind === 'depth') return { ...p, lo: 0, hi: 40, tol: 20 }
  return p
}

let seq = 0
export const newMask = (kind: MaskKind, n = 1): Mask => ({
  id: `m${Date.now().toString(36)}${(seq++).toString(36)}`,
  name: `${kindName(kind)} ${n}`,
  parts: [newPart(kind)],
  amount: 100,
})

/* A part with nothing in it yet — an empty brush — is not a place, and a mask
 * whose first part is one would otherwise paint its edit over the whole
 * picture the moment it was added. */
export const partEmpty = (p: MaskPart) =>
  p.kind === 'brush' && !(p.strokes || []).some((s) => s.pts.length >= 2)

export const maskEmpty = (m: Mask) => !m.parts.length || partEmpty(m.parts[0])

/* Worth rendering: switched on, somewhere, doing something. */
export const maskLive = (m: Mask) => !m.off && !maskEmpty(m) && (m.amount ?? 100) > 0 && developed(m.dev)

export const liveMasks = (masks?: Mask[]) => (masks || []).filter(maskLive)

export const hasMasks = (masks?: Mask[]) => liveMasks(masks).length > 0

/* Does any mask here need the depth map? Asked before a render, so a card
 * without one can say so rather than quietly masking on nothing. */
export const wantsDepth = (masks?: Mask[]) =>
  liveMasks(masks).some((m) => m.parts.some((p) => p.kind === 'depth'))

/* The develop parameters a mask is allowed to set. Lightroom's list: the ones
 * that mean something inside a region. A tone curve, a colour mixer, a
 * vignette and grain are all judgements about the whole photograph, and
 * offering them per-mask would be offering nonsense. */
export const MASK_KEYS: DevKey[] = [
  'temp',
  'tint',
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'texture',
  'clarity',
  'dehaze',
  'vibrance',
  'saturation',
  'sharpen',
  'noise',
]

/* Anything outside that list is dropped on the way in, so a mask cannot carry
 * a parameter the panel will never show and the user can never find again. */
export function trimMaskDev(d?: Develop): Develop | undefined {
  if (!d) return undefined
  const out: Develop = {}
  for (const k of MASK_KEYS) {
    const v = d[k]
    if (typeof v === 'number' && v !== DEV_0[k]) (out as Record<string, number>)[k] = v
  }
  return trimDev(out)
}

/* ---------------------------------------------------------------------------
 * What the shader is told.
 *
 * One mask per pass, so only one mask's worth of numbers is ever in flight:
 * four parts, three vec4s each. The first slot of the first vec4 says which
 * kind of part it is and the rest is that kind's own geometry, which keeps the
 * uniform block the same size whatever the mask is made of.
 * ------------------------------------------------------------------------- */

export const KIND_CODE: Record<MaskKind, number> = {
  linear: 0,
  radial: 1,
  brush: 2,
  colour: 3,
  luminance: 4,
  depth: 5,
}
const OP_CODE: Record<MaskOp, number> = { add: 0, sub: 1, int: 2 }

export interface MaskUniforms {
  n: number
  amount: number
  /* kind, op, invert, feather — four floats per part, flattened. */
  a: number[]
  b: number[]
  c: number[]
  /* Whether any part of this mask is painted, and so whether the brush
   * texture has to be baked and bound. */
  brush: boolean
}

const pct = (n: number) => n / 100

export function maskUniforms(m: Mask): MaskUniforms {
  const parts = m.parts.slice(0, MAX_PARTS)
  const a: number[] = []
  const b: number[] = []
  const c: number[] = []
  for (const p of parts) {
    a.push(KIND_CODE[p.kind] ?? 0, OP_CODE[p.op || 'add'], p.inv ? 1 : 0, pct(p.feather ?? 50))
    if (p.kind === 'linear') {
      b.push(p.x1 ?? 0.5, p.y1 ?? 0.05, p.x2 ?? 0.5, p.y2 ?? 0.45)
      c.push(0, 0, 0, 0)
    } else if (p.kind === 'radial') {
      b.push(p.cx ?? 0.5, p.cy ?? 0.5, Math.max(p.rx ?? 0.3, 1e-3), Math.max(p.ry ?? 0.3, 1e-3))
      c.push(((p.rot ?? 0) * Math.PI) / 180, 0, 0, 0)
    } else if (p.kind === 'colour') {
      b.push(p.r ?? 0.5, p.g ?? 0.5, p.b ?? 0.5, pct(p.tol ?? 30))
      c.push(0, 0, 0, 0)
    } else if (p.kind === 'luminance' || p.kind === 'depth') {
      b.push(pct(p.lo ?? 0), pct(p.hi ?? 100), pct(p.tol ?? 20), 0)
      c.push(0, 0, 0, 0)
    } else {
      b.push(0, 0, 0, 0)
      c.push(0, 0, 0, 0)
    }
  }
  /* Padded out, because a uniform array is uploaded whole. */
  while (a.length < MAX_PARTS * 4) {
    a.push(0, 0, 0, 0)
    b.push(0, 0, 0, 0)
    c.push(0, 0, 0, 0)
  }
  return {
    n: parts.length,
    amount: pct(m.amount ?? 100),
    a,
    b,
    c,
    brush: parts.some((p) => p.kind === 'brush' && !partEmpty(p)),
  }
}

/* ---------------------------------------------------------------------------
 * The brush, on the CPU.
 *
 * Strokes are painted into a small single-channel picture and handed to the
 * shader as a texture, rather than evaluated as geometry in the fragment
 * shader — a hundred stamps per stroke is nothing for a 2D context to draw
 * once and far too much for every pixel to walk through every frame.
 * ------------------------------------------------------------------------- */

export const BRUSH_W = 512

/* What makes one baked brush different from another. Keyed on this so a
 * stroke that is still being drawn re-bakes and a slider that is being dragged
 * does not. */
export function brushKey(m: Mask): string {
  const out: string[] = []
  for (const p of m.parts) {
    if (p.kind !== 'brush') continue
    for (const s of p.strokes || []) {
      out.push(`${s.size},${s.soft},${s.flow},${s.erase ? 1 : 0},${s.pts.length}:${s.pts.map((n) => n.toFixed(3)).join(',')}`)
    }
    out.push('|')
  }
  return out.join(';')
}

type Ctx2D = {
  clearRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, a: number, b: number): void
  stroke(): void
  fill(): void
  lineCap: string
  lineJoin: string
  lineWidth: number
  strokeStyle: string
  fillStyle: string
  filter: string
  globalCompositeOperation: string
}

/* Paint the strokes of every brush part into a context that is `w` by `h`.
 * Kept apart from anything that knows what a canvas is, so the worker, the
 * main thread and a unit test can all drive it. */
export function paintBrush(ctx: Ctx2D, m: Mask, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  const scale = Math.min(w, h)
  for (const p of m.parts) {
    if (p.kind !== 'brush') continue
    for (const s of p.strokes || []) {
      if (s.pts.length < 2) continue
      /* Softness as a blur on the stamp rather than a gradient per stamp: one
       * setting, and it looks the same whether a stroke is one dab or two
       * hundred overlapping ones. */
      const soft = Math.max(0, Math.min(100, s.soft)) / 100
      const r = (Math.max(1, s.size) / 100) * scale * 0.5
      ctx.filter = soft > 0.01 ? `blur(${(r * soft * 0.6).toFixed(2)}px)` : 'none'
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
      const alpha = Math.max(0.02, Math.min(1, s.flow / 100))
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`
      ctx.fillStyle = ctx.strokeStyle
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = r * 2
      ctx.beginPath()
      ctx.moveTo(s.pts[0] * w, s.pts[1] * h)
      if (s.pts.length === 2) {
        /* A single tap is a dot, which a zero-length line would not draw. */
        ctx.arc(s.pts[0] * w, s.pts[1] * h, r, 0, Math.PI * 2)
        ctx.fill()
      } else {
        for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i] * w, s.pts[i + 1] * h)
        ctx.stroke()
      }
    }
  }
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'
}
