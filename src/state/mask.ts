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

export type MaskKind = 'whole' | 'linear' | 'radial' | 'brush' | 'colour' | 'luminance' | 'depth'

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

/* ---------------------------------------------------------------------------
 * The blur gallery.
 *
 * Photoshop has five of these on a submenu — field, iris, tilt-shift, path,
 * spin — and every one of them is the same two questions: how the blur is
 * shaped, and where it happens. The second question is a mask, and the masks
 * are already here, which leaves only the first.
 *
 * So there are four shapes rather than five names. Defocus is what a lens out
 * of focus does and what field, iris and tilt-shift all are — those three
 * differ only in the mask, so they are three starting points rather than
 * three features. Spin turns around a point, zoom runs out from one, and
 * motion runs along a line: the three that cannot be got by softening evenly,
 * and so the three that have to be their own arithmetic.
 *
 * Which means the thing the gallery is actually for — saying where the blur
 * comes from — is not a special mode. It is a linear gradient, or an ellipse,
 * or something painted by hand, exactly like every other local edit.
 * ------------------------------------------------------------------------- */
export type BlurKind = 'defocus' | 'spin' | 'zoom' | 'motion'

export interface Blur {
  kind: BlurKind
  /* 0..100 */
  amount: number
  /* motion: which way it runs, in degrees. */
  angle?: number
  /* spin and zoom: the point it turns or runs out from, in the picture's own
   * nought to one. Draggable on the picture, like every other place. */
  cx?: number
  cy?: number
}

export const BLUR_KINDS: { k: BlurKind; name: string; hint: string }[] = [
  { k: 'defocus', name: 'Defocus', hint: 'What a lens out of focus does' },
  { k: 'spin', name: 'Spin', hint: 'Turning around a point' },
  { k: 'zoom', name: 'Zoom', hint: 'Running out from a point' },
  { k: 'motion', name: 'Motion', hint: 'Along a line, at an angle' },
]

export const BLUR_CODE: Record<BlurKind, number> = { defocus: 0, spin: 1, zoom: 2, motion: 3 }

/* ---------------------------------------------------------------------------
 * Taking something out.
 *
 * The one everyday tool a photograph needs that no slider can be: a mark on a
 * wall, a bin in the corner, a spot on a face. Photoshop calls it the clone
 * stamp and the healing brush, Lightroom calls it Remove; they are the same
 * gesture — paint over the thing, then say where to take the good pixels from.
 *
 * The difference between the two is one line. Clone puts those pixels down as
 * they are, which is right for a repeating texture — brickwork, grass, sky.
 * Heal puts down their texture and the destination's own tone, which is right
 * for anything the light falls across unevenly: a cheek, a wall in sun. The
 * arithmetic for that is the oldest trick there is — take the difference
 * between a blurred copy of here and a blurred copy of there, and add it.
 * ------------------------------------------------------------------------- */
export interface Clone {
  /* Where the good pixels come from, as an offset in the picture's own nought
   * to one. Nought and nought is no repair at all, which is also what a repair
   * nobody has placed yet looks like. */
  ox: number
  oy: number
  /* Whether the tone of the destination is kept. */
  heal?: boolean
}

export const cloneOn = (m: Mask) => !!m.clone && (Math.abs(m.clone.ox) > 0.002 || Math.abs(m.clone.oy) > 0.002)

export interface Mask {
  id: string
  name: string
  parts: MaskPart[]
  /* A blur, and the mask says where it comes from. */
  blur?: Blur
  /* Or good pixels from somewhere else on the same photograph. */
  clone?: Clone
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
  { k: 'whole', name: 'The whole picture', hint: 'All of it — something to take pieces out of' },
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
  if (kind === 'whole') return p
  if (kind === 'linear') return { ...p, x1: 0.5, y1: 0.05, x2: 0.5, y2: 0.45 }
  if (kind === 'radial') return { ...p, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, rot: 0, feather: 50 }
  if (kind === 'brush') return { ...p, strokes: [] }
  if (kind === 'colour') return { ...p, r: 0.5, g: 0.5, b: 0.5, tol: 30 }
  if (kind === 'luminance') return { ...p, lo: 60, hi: 100, tol: 20 }
  if (kind === 'depth') return { ...p, lo: 0, hi: 40, tol: 20 }
  return p
}

/* The five entries on Photoshop's own submenu, as five starting points: the
 * shape of the blur, and a mask already put where that shape belongs. Every
 * one of them can then be dragged, softened, inverted and added to like any
 * other mask, which is the whole point of building them out of masks. */
export const BLUR_STARTS: { k: string; name: string; hint: string }[] = [
  { k: 'field', name: 'Field blur', hint: 'The whole picture, softened' },
  { k: 'iris', name: 'Iris blur', hint: 'Sharp inside an ellipse, soft outside it' },
  { k: 'tilt', name: 'Tilt-shift', hint: 'Sharp across a band, soft above and below' },
  { k: 'spin', name: 'Spin blur', hint: 'Turning, inside a circle' },
  { k: 'motion', name: 'Motion blur', hint: 'The whole picture, along a line' },
]

export function newBlurMask(start: string, n = 1): Mask {
  const base = newMask('whole', n)
  if (start === 'iris') {
    return {
      ...base,
      name: `Iris blur ${n}`,
      parts: [{ ...newPart('radial'), rx: 0.32, ry: 0.32, feather: 65, inv: true }],
      blur: { kind: 'defocus', amount: 55 },
    }
  }
  if (start === 'tilt') {
    /* Two gradients pointing away from each other: full above the top line,
       full below the bottom one, and nothing in the band between. Which is
       what a tilt-shift is, and why it takes two parts rather than a mode. */
    return {
      ...base,
      name: `Tilt-shift ${n}`,
      parts: [
        { ...newPart('linear'), x1: 0.5, y1: 0.3, x2: 0.5, y2: 0.45 },
        { ...newPart('linear', 'add'), x1: 0.5, y1: 0.7, x2: 0.5, y2: 0.55 },
      ],
      blur: { kind: 'defocus', amount: 55 },
    }
  }
  if (start === 'spin') {
    return {
      ...base,
      name: `Spin blur ${n}`,
      parts: [{ ...newPart('radial'), rx: 0.35, ry: 0.35, feather: 45 }],
      blur: { kind: 'spin', amount: 35, cx: 0.5, cy: 0.5 },
    }
  }
  if (start === 'motion') {
    return { ...base, name: `Motion blur ${n}`, blur: { kind: 'motion', amount: 35, angle: 0 } }
  }
  return { ...base, name: `Field blur ${n}`, blur: { kind: 'defocus', amount: 45 } }
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
export const blurOn = (m: Mask) => !!m.blur && m.blur.amount > 0
export const maskLive = (m: Mask) =>
  !m.off && !maskEmpty(m) && (m.amount ?? 100) > 0 && (developed(m.dev) || blurOn(m) || cloneOn(m))

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
  whole: 6,
  linear: 0,
  radial: 1,
  brush: 2,
  colour: 3,
  luminance: 4,
  depth: 5,
}
const OP_CODE: Record<MaskOp, number> = { add: 0, sub: 1, int: 2 }

/* A kind this version has never heard of — a board saved by a later one. Past
 * every code the shader knows, so it falls through to the branch that covers
 * nothing: an edit that has gone missing is a thing somebody can see and put
 * back, and an edit smeared over the whole photograph is a thing they would
 * have to work out. Zero would have been a linear gradient with no geometry,
 * which is a full-strength ramp across the lot. */
export const UNKNOWN_KIND = 99

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
  /* kind, amount, angle in radians, spare — and where it turns or runs from. */
  blur: [number, number, number, number]
  blurAt: [number, number]
  /* offset x, offset y, on, heal. */
  clone: [number, number, number, number]
  /* How wide the gaussian chain has to be run for this mask, in the units the
   * effects use. Zero for every mask that is not a defocus. */
  blurRadius: number
}

const pct = (n: number) => n / 100

export function maskUniforms(m: Mask): MaskUniforms {
  const parts = m.parts.slice(0, MAX_PARTS)
  const tiles = brushTiles(m)
  const a: number[] = []
  const b: number[] = []
  const c: number[] = []
  parts.forEach((p, slot) => {
    /* A linear gradient's feather starts at the whole of the drag, because the
       drag is the gradient; every other kind starts half soft. */
    a.push(KIND_CODE[p.kind] ?? UNKNOWN_KIND, OP_CODE[p.op || 'add'], p.inv ? 1 : 0, pct(p.feather ?? (p.kind === 'linear' ? 100 : 50)))
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
    } else if (p.kind === 'brush') {
      /* Which tile of the baked strip this part's strokes are in, and how many
         tiles there are to divide by. */
      b.push(slot, Math.max(1, tiles), 0, 0)
      c.push(0, 0, 0, 0)
    } else {
      b.push(0, 0, 0, 0)
      c.push(0, 0, 0, 0)
    }
  })
  /* Padded out, because a uniform array is uploaded whole. */
  while (a.length < MAX_PARTS * 4) {
    a.push(0, 0, 0, 0)
    b.push(0, 0, 0, 0)
    c.push(0, 0, 0, 0)
  }
  const bl = m.blur
  const amt = bl ? pct(Math.max(0, Math.min(100, bl.amount))) : 0
  return {
    n: parts.length,
    amount: pct(m.amount ?? 100),
    a,
    b,
    c,
    brush: parts.some((p) => p.kind === 'brush' && !partEmpty(p)),
    blur: [bl ? BLUR_CODE[bl.kind] : 0, amt, (((bl?.angle ?? 0) * Math.PI) / 180), 0],
    blurAt: [bl?.cx ?? 0.5, bl?.cy ?? 0.5],
    clone: [m.clone?.ox ?? 0, m.clone?.oy ?? 0, cloneOn(m) ? 1 : 0, m.clone?.heal ? 1 : 0],
    /* Wide enough to be a defocus rather than a softening, and no wider: the
       chain downsamples by a sixth of the radius, so asking for more than the
       picture needs costs resolution the blur cannot get back. */
    /* A heal needs a softened copy of the picture too, to read the tone it is
       repairing into. Not as wide as a defocus: wide enough to be the lighting
       and not the thing being taken out. */
    blurRadius: bl && bl.kind === 'defocus' && amt > 0 ? amt * 46 + 5 : m.clone?.heal && cloneOn(m) ? 26 : 0,
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
  /* The slot as well as the strokes: the same strokes in a different part are
     painted into a different tile of the strip, so a key that named only the
     strokes would hand back the last bake with the tiles in the wrong places. */
  m.parts.slice(0, MAX_PARTS).forEach((p, i) => {
    if (p.kind !== 'brush') return
    out.push(`@${i}`)
    for (const s of p.strokes || []) {
      out.push(`${s.size},${s.soft},${s.flow},${s.erase ? 1 : 0},${s.pts.length}:${s.pts.map((n) => n.toFixed(3)).join(',')}`)
    }
    out.push('|')
  })
  return out.join(';')
}

/* How many tiles the strip needs: one for every part up to and including the
 * last painted one. A mask whose only brush is its first part gets a single
 * tile, which is the square texture this was before there were tiles at all. */
export const brushTiles = (m: Mask): number => {
  let n = 0
  m.parts.slice(0, MAX_PARTS).forEach((p, i) => {
    if (p.kind === 'brush') n = i + 1
  })
  return n
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
  save(): void
  restore(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
}

/* Paint the strokes into a strip `w` wide and `h` tall per tile, one tile per
 * part: part 0 at the top, part 1 under it, and so on down as far as the last
 * painted part. One picture for the lot of them was the same picture read back
 * for every part, so a mask that painted an area in and then painted a hole
 * out of it with a second brush cancelled itself to nothing — both parts were
 * reading the same strokes. A tile each is what makes the fold mean anything.
 *
 * Each tile is clipped to itself, so a soft stamp at the bottom of one cannot
 * bleed into the top of the next, and an erase stroke rubs out its own part
 * and not its neighbour's.
 *
 * Kept apart from anything that knows what a canvas is, so the worker, the
 * main thread and a unit test can all drive it. */
export function paintBrush(ctx: Ctx2D, m: Mask, w: number, h: number) {
  const tiles = Math.max(1, brushTiles(m))
  ctx.clearRect(0, 0, w, h * tiles)
  const scale = Math.min(w, h)
  m.parts.slice(0, MAX_PARTS).forEach((p, slot) => {
    if (p.kind !== 'brush') return
    const top = slot * h
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, top, w, h)
    ctx.clip()
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
      ctx.moveTo(s.pts[0] * w, top + s.pts[1] * h)
      if (s.pts.length === 2) {
        /* A single tap is a dot, which a zero-length line would not draw. */
        ctx.arc(s.pts[0] * w, top + s.pts[1] * h, r, 0, Math.PI * 2)
        ctx.fill()
      } else {
        for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i] * w, top + s.pts[i + 1] * h)
        ctx.stroke()
      }
    }
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  })
}
