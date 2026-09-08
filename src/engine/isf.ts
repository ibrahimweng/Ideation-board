import type { Control, EffectSpec } from './types'

/* ---------------------------------------------------------------------------
 * ISF, translated.
 *
 * ISF — Interactive Shader Format — is a GLSL fragment shader with a JSON blob
 * at the top describing its inputs. It has been the way video people share
 * effects since 2013, it is supported in twenty-odd applications, and the free
 * editor alone ships two hundred open shaders.
 *
 * The reason to care is that this engine's own effects are already the same
 * shape: a list of controls and a fragment function. So an ISF file is not a
 * foreign format to be supported, it is this format written down differently,
 * and the distance between them is a rename.
 *
 * ## What this is for
 *
 * Growing the effect list, not opening it. The list stays curated: this
 * translates a shader at the point where an effect is written, so that adding
 * one is finding a good shader rather than writing a new one from nothing.
 * There is deliberately no way for someone using the board to paste one in.
 *
 * ## What it maps
 *
 *   INPUTS float / bool          -> a slider, p0 to p5
 *   INPUTS long                  -> a segmented control from LABELS
 *   INPUTS point2D               -> two sliders, which costs two slots
 *   INPUTS color                 -> a colour, c0 to c2
 *   INPUTS image                 -> the card itself, or the card wired into it
 *   isf_FragNormCoord            -> uv
 *   RENDERSIZE                   -> uRes
 *   IMG_NORM_PIXEL(img, p)       -> T(p) or S(p)
 *   IMG_PIXEL(img, p)            -> T(p / uRes)
 *   IMG_THIS_PIXEL(img)          -> T(uv)
 *   IMG_SIZE(img)                -> uRes
 *   TIME                         -> a slider, because these are still pictures
 *
 * TIME is the interesting one. A board of photographs has no clock, and a
 * shader written to animate would otherwise be stuck on its first frame — so
 * where a shader asks for time it gets a control instead, and what was an
 * animation becomes a dial you turn to find the frame you wanted. That is more
 * useful here than the animation would have been.
 *
 * ## What it refuses
 *
 * Multi-pass shaders, persistent buffers and audio inputs. All three need
 * something the engine does not have, and a translator that quietly dropped
 * them would produce a shader that compiles and draws the wrong thing — which
 * is worse than one that says no. Anything past six numbers or three colours
 * is refused for the same reason: the slots are the slots.
 * ------------------------------------------------------------------------- */

export interface IsfInput {
  NAME: string
  TYPE: string
  LABEL?: string
  DEFAULT?: number | number[] | string
  MIN?: number | number[]
  MAX?: number | number[]
  VALUES?: number[]
  LABELS?: string[]
}

export interface IsfHeader {
  DESCRIPTION?: string
  CREDIT?: string
  CATEGORIES?: string[]
  INPUTS?: IsfInput[]
  PASSES?: unknown[]
  IMPORTED?: Record<string, unknown>
}

export interface Translated {
  spec: EffectSpec
  /* What the shader said about itself, for the person adding it. */
  about: { description?: string; credit?: string }
}

export class IsfError extends Error {}

/* The JSON blob is a block comment at the very top. Deliberately strict about
 * that: a file whose first comment is a licence header is not one this can
 * read, and guessing which comment is the header is how the wrong thing gets
 * parsed. */
export function headerOf(src: string): { header: IsfHeader; body: string } {
  const open = src.indexOf('/*')
  if (open < 0 || src.slice(0, open).trim()) throw new IsfError('no header comment at the top')
  const close = src.indexOf('*/', open)
  if (close < 0) throw new IsfError('the header comment never closes')
  const raw = src.slice(open + 2, close).trim()
  let header: IsfHeader
  try {
    header = JSON.parse(raw) as IsfHeader
  } catch (e) {
    throw new IsfError(`the header is not JSON: ${(e as Error).message}`)
  }
  return { header, body: src.slice(close + 2) }
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback)

/* A step small enough to reach anything and big enough to land on. ISF says
 * nothing about steps, so this is read off the range. */
const stepFor = (min: number, max: number) => {
  const span = Math.abs(max - min)
  if (span <= 2) return 0.01
  if (span <= 20) return 0.1
  return 1
}

/* A colour comes out of ISF as four floats and goes in here as hex, because
 * that is what a colour input on this side is. */
function hexOf(v: unknown): string {
  const a = Array.isArray(v) ? (v as number[]) : [0, 0, 0]
  const to = (n: number) => Math.round(Math.max(0, Math.min(1, num(n, 0))) * 255).toString(16).padStart(2, '0')
  return `#${to(a[0])}${to(a[1])}${to(a[2])}`
}

interface Slots {
  controls: Control[]
  /* ISF name -> what it is called on this side. */
  rename: Map<string, string>
  floats: number
  colours: number
  /* The image inputs, in the order they were declared. */
  images: string[]
}

function takeFloat(s: Slots, label: string, min: number, max: number, def: number, unit = ''): string {
  if (s.floats >= 6) throw new IsfError('more than six numbers, and there are six slots')
  const k = 'p' + s.floats++
  s.controls.push({ k, label, min, max, step: stepFor(min, max), def, unit })
  return k
}

function readInputs(inputs: IsfInput[]): Slots {
  const s: Slots = { controls: [], rename: new Map(), floats: 0, colours: 0, images: [] }
  for (const i of inputs) {
    const label = i.LABEL || i.NAME
    switch (i.TYPE) {
      case 'image':
        s.images.push(i.NAME)
        break
      case 'color': {
        if (s.colours >= 3) throw new IsfError('more than three colours, and there are three slots')
        const k = 'c' + s.colours++
        s.controls.push({ k, label, def: hexOf(i.DEFAULT), color: true })
        s.rename.set(i.NAME, k)
        break
      }
      case 'bool': {
        const k = takeFloat(s, label, 0, 1, num(i.DEFAULT, 0))
        s.rename.set(i.NAME, k)
        break
      }
      case 'long': {
        if (!i.LABELS?.length) throw new IsfError(`the menu ${i.NAME} has no labels`)
        if (s.floats >= 6) throw new IsfError('more than six numbers, and there are six slots')
        const k = 'p' + s.floats++
        /* ISF numbers a menu by its VALUES; this side numbers it by position,
         * so the body reads the position and the values are folded into the
         * shader as a lookup only where they differ from the position. */
        const values = i.VALUES && i.VALUES.length === i.LABELS.length ? i.VALUES : i.LABELS.map((_, n) => n)
        const at = Math.max(0, values.indexOf(num(i.DEFAULT, values[0])))
        s.controls.push({ k, label, def: at, options: i.LABELS.slice() })
        s.rename.set(i.NAME, values.every((v, n) => v === n) ? k : `${k}_v`)
        break
      }
      case 'point2D': {
        const min = Array.isArray(i.MIN) ? i.MIN : [0, 0]
        const max = Array.isArray(i.MAX) ? i.MAX : [1, 1]
        const def = Array.isArray(i.DEFAULT) ? i.DEFAULT : [0.5, 0.5]
        const kx = takeFloat(s, `${label} across`, num(min[0], 0), num(max[0], 1), num(def[0], 0.5))
        const ky = takeFloat(s, `${label} down`, num(min[1], 0), num(max[1], 1), num(def[1], 0.5))
        s.rename.set(i.NAME, `vec2(${kx}, ${ky})`)
        break
      }
      case 'float': {
        const min = num(i.MIN as number, 0)
        const max = num(i.MAX as number, 1)
        const k = takeFloat(s, label, min, max, num(i.DEFAULT as number, min))
        s.rename.set(i.NAME, k)
        break
      }
      case 'event':
        /* A button press has no meaning on a still card. */
        throw new IsfError(`${i.NAME} is an event, and a still picture has no moment for it`)
      case 'audio':
      case 'audioFFT':
        throw new IsfError(`${i.NAME} wants audio, which does not reach the renderer`)
      default:
        throw new IsfError(`${i.NAME} is a ${i.TYPE}, which is not one of the kinds handled here`)
    }
  }
  return s
}

/* A whole-word replace, so a name that is part of a longer one is left alone. */
const swap = (src: string, from: string, to: string) =>
  src.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), to)

/* IMG_NORM_PIXEL(image, coord) and friends, which are macros rather than
 * functions and so cannot be defined in the preamble: the first argument is a
 * name and has to be read at translation time to know which sampler it means. */
function macros(body: string, images: string[]): string {
  const sampler = (name: string) => (images.length > 1 && name === images[1] ? 'S' : 'T')
  const call = (fn: string, argc: number) => {
    const re = new RegExp(`${fn}\\s*\\(`, 'g')
    let out = ''
    let at = 0
    for (;;) {
      re.lastIndex = at
      const m = re.exec(body)
      if (!m) break
      out += body.slice(at, m.index)
      /* Walk the brackets rather than matching them with a pattern: the second
       * argument is an expression and may hold brackets of its own. */
      let depth = 1
      let i = m.index + m[0].length
      const args: string[] = []
      let cur = ''
      for (; i < body.length && depth > 0; i++) {
        const ch = body[i]
        if (ch === '(') depth++
        else if (ch === ')') { depth--; if (!depth) break }
        if (depth === 1 && ch === ',') { args.push(cur); cur = '' } else cur += ch
      }
      args.push(cur)
      const name = (args[0] || '').trim()
      const s = sampler(name)
      if (argc === 1) out += `${s}(uv)`
      else if (fn === 'IMG_PIXEL') out += `${s}((${(args[1] || 'uv').trim()}) / uRes)`
      else if (fn === 'IMG_SIZE') out += 'uRes'
      else out += `${s}(${(args[1] || 'uv').trim()})`
      at = i + 1
    }
    body = out + body.slice(at)
  }
  call('IMG_THIS_NORM_PIXEL', 1)
  call('IMG_THIS_PIXEL', 1)
  call('IMG_NORM_PIXEL', 2)
  call('IMG_PIXEL', 2)
  call('IMG_SIZE', 1)
  return body
}

/* main() becomes the effect's own function. Everything declared before it is
 * left where it is, because a shader's helpers belong at the top level. */
function wrap(body: string): string {
  const m = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/.exec(body)
  if (!m) throw new IsfError('no main()')
  const head = body.slice(0, m.index)
  let depth = 1
  let i = m.index + m[0].length
  const start = i
  for (; i < body.length && depth > 0; i++) {
    if (body[i] === '{') depth++
    else if (body[i] === '}') depth--
  }
  if (depth) throw new IsfError('main() never closes')
  let inner = body.slice(start, i - 1)
  inner = swap(inner, 'gl_FragColor', 'isf_out')
  /* A bare return leaves main early; here it has to hand the colour back. */
  inner = inner.replace(/\breturn\s*;/g, 'return isf_out;')
  return `${head}
vec4 fx(vec2 uv){
  vec4 isf_out = vec4(0.0);
  ${inner}
  return isf_out;
}`
}

export interface FromIsfOptions {
  id: string
  name: string
  group: string
  /* Range for the slider a shader gets in place of a clock. */
  timeMax?: number
}

export function fromISF(src: string, o: FromIsfOptions): Translated {
  const { header, body } = headerOf(src)
  if (header.PASSES && header.PASSES.length > 1) {
    throw new IsfError('more than one pass, which this engine renders as stacked effects instead')
  }
  if (header.IMPORTED && Object.keys(header.IMPORTED).length) {
    throw new IsfError('it loads an image of its own, and there is nowhere to put one')
  }

  const slots = readInputs(header.INPUTS || [])

  let out = macros(body, slots.images)
  /* Substitute after the macros, or a name used as a macro's first argument
   * would be renamed out from under it. */
  for (const [from, to] of slots.rename) out = swap(out, from, to)
  /* A menu whose values are not its positions reads through a lookup written
   * beside it, so the body can go on comparing against the numbers it knows. */
  for (const c of slots.controls) {
    if (!('options' in c)) continue
    const src2 = header.INPUTS?.find((i) => (i.LABEL || i.NAME) === c.label)
    if (!src2?.VALUES || src2.VALUES.every((v, n) => v === n)) continue
    const table = src2.VALUES.map((v, n) => `${c.k} < ${n + 0.5} ? ${v.toFixed(1)}`).join(' : ')
    out = swap(out, `${c.k}_v`, `(${table} : ${src2.VALUES[src2.VALUES.length - 1].toFixed(1)})`)
  }
  out = swap(out, 'isf_FragNormCoord', 'uv')
  out = swap(out, 'RENDERSIZE', 'uRes')
  out = swap(out, 'texture2D', 'texture')
  /* Still pictures have no clock, so a shader that wanted one is given a dial.
   * Allocated last, and only if it is used, so a shader with six numbers of
   * its own is not refused for a slot it never asked for. */
  if (/\bTIME\b/.test(out)) {
    const k = takeFloat(slots, 'Time', 0, o.timeMax ?? 20, 0, 's')
    out = swap(out, 'TIME', k)
  }
  out = swap(out, 'TIMEDELTA', '0.0')
  out = swap(out, 'FRAMEINDEX', '0.0')
  out = swap(out, 'PASSINDEX', '0')

  if (/\bIMG_/.test(out)) throw new IsfError('a picture macro this does not know how to read')

  return {
    spec: { id: o.id, name: o.name, group: o.group, controls: slots.controls, frag: wrap(out) },
    about: { description: header.DESCRIPTION, credit: header.CREDIT },
  }
}
