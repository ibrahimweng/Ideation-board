import type { Item } from './types'
import { getBlob } from '../store/idb'
import { newId } from './ingest'
import { FX_0 } from '../engine/types'

/* ---------------------------------------------------------------------------
 * The colours a picture is made of, as cards you can keep.
 *
 * A moodboard is half about colour, and the colour was locked inside the
 * photographs: you could look at it, but you could not write it down, hand it
 * to anyone, or put it beside the colour from another picture. This reads the
 * picture and puts what it finds on the board as swatches.
 *
 * A swatch is a note whose paper is the colour and whose text is the hex. That
 * is not a shortcut — it means a swatch is something the board already knows
 * how to do everything with: move it, tag it, search it, group it in a
 * section, carry it into an exported file and back out again. A tenth kind of
 * card would have had to learn all of that over again.
 * ------------------------------------------------------------------------- */

/* Small enough to read in a few milliseconds, big enough that a colour which
 * is only in one corner still survives. */
const SAMPLE = 128
/* Four bits a channel: fine enough to keep two similar blues apart, coarse
 * enough that a gradient does not become four thousand separate colours. */
const BITS = 4

export interface Swatch {
  hex: string
  /* What fraction of the picture is this colour, before any weighting. */
  share: number
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
export const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`

/* Perceived lightness, near enough for choosing black or white to write on a
 * colour with. The weights are the usual ones for sRGB. */
export const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  if (!Number.isFinite(n)) return '#17171a'
  return luminance((n >> 16) & 255, (n >> 8) & 255, n & 255) > 0.56 ? '#17171a' : '#f4f4f5'
}

const saturation = (r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  return mx === 0 ? 0 : (mx - mn) / mx
}

/* How far apart two colours are, as a plain distance in RGB. Good enough to
 * stop two names for the same blue both making the list. */
const apart = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/* The colours in a picture, most of it first.
 *
 * Bucketed rather than clustered: a k-means would be more exact and would also
 * take long enough to need a worker, and the answer to "what colours is this
 * photograph" does not need to be exact. What it does need is not to return
 * five shades of the same beige, which is what the spacing rule is for, and
 * not to miss the one red thing in a grey picture, which is what the weighting
 * is for. */
export function paletteFrom(data: Uint8ClampedArray, want = 5): Swatch[] {
  const sums = new Map<number, { r: number; g: number; b: number; n: number }>()
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> (8 - BITS)) << (BITS * 2)) | ((g >> (8 - BITS)) << BITS) | (b >> (8 - BITS))
    const cur = sums.get(key)
    if (cur) {
      cur.r += r
      cur.g += g
      cur.b += b
      cur.n++
    } else {
      sums.set(key, { r, g, b, n: 1 })
    }
    total++
  }
  if (!total) return []

  const bins = [...sums.values()].map((s) => {
    const r = s.r / s.n
    const g = s.g / s.n
    const b = s.b / s.n
    const sat = saturation(r, g, b)
    const lum = luminance(r, g, b)
    /* Weighted, not raw: a picture that is two thirds pale sky would otherwise
     * spend three of its five swatches on the sky. Colour earns a little extra
     * room, and the very darkest and very lightest a little less, because
     * "almost black" is rarely the colour anybody meant. */
    const edge = lum < 0.06 || lum > 0.97 ? 0.35 : 1
    return { rgb: [r, g, b], n: s.n, score: s.n * (0.55 + 0.85 * sat) * edge }
  })
  bins.sort((a, b) => b.score - a.score)

  /* Far enough apart to be different colours rather than two names for one.
   * Relaxed if that leaves the list short, because five swatches from a
   * monochrome photograph should still be five. */
  const out: typeof bins = []
  for (const gap of [72, 46, 26, 12, 0]) {
    for (const bin of bins) {
      if (out.length >= want) break
      if (out.every((o) => apart(o.rgb, bin.rgb) >= gap)) out.push(bin)
    }
    if (out.length >= want) break
  }

  return out.slice(0, want).map((b) => ({
    hex: toHex(b.rgb[0], b.rgb[1], b.rgb[2]),
    share: Math.round((b.n / total) * 1000) / 1000,
  }))
}

/* The picture behind a card, small, as pixels. */
async function samplesFor(item: Item): Promise<Uint8ClampedArray | null> {
  try {
    let source: CanvasImageSource | null = null
    let sw = 0
    let sh = 0
    if (item.kind === 'video') {
      const el = document.querySelector(`.card[data-id="${item.id}"] video`) as HTMLVideoElement | null
      if (!el || !el.videoWidth) return null
      source = el
      sw = el.videoWidth
      sh = el.videoHeight
    } else {
      if (!item.media) return null
      const blob = await getBlob(item.media)
      if (!blob) return null
      const bmp = await createImageBitmap(blob)
      source = bmp
      sw = bmp.width
      sh = bmp.height
    }
    const scale = Math.min(1, SAMPLE / Math.max(sw, sh))
    const w = Math.max(1, Math.round(sw * scale))
    const h = Math.max(1, Math.round(sh * scale))
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d', { willReadFrequently: true })
    if (!cx) return null
    cx.drawImage(source, 0, 0, w, h)
    if ('close' in source) (source as ImageBitmap).close()
    return cx.getImageData(0, 0, w, h).data
  } catch {
    /* A video whose host will not let its pixels be read throws here, which is
     * the same reason its card cannot take a shader. */
    return null
  }
}

export async function paletteOf(item: Item, want = 5): Promise<Swatch[]> {
  if (item.kind !== 'image' && item.kind !== 'video') return []
  const data = await samplesFor(item)
  return data ? paletteFrom(data, want) : []
}

/* Swatches laid along the bottom edge of the card they came out of, so it is
 * obvious which picture they belong to. */
export function swatchItems(colours: Swatch[], from: Item): Item[] {
  const size = 96
  const gap = 10
  const width = colours.length * size + (colours.length - 1) * gap
  /* Centred under the card, unless the card is narrower than the row. */
  const left = Math.round(from.x + (from.w - width) / 2)
  const top = Math.round(from.y + from.h + 20)
  return colours.map((c, i) => ({
    id: newId(),
    kind: 'note' as const,
    x: left + i * (size + gap),
    y: top,
    z: 0,
    w: size,
    h: size,
    text: c.hex.toUpperCase(),
    color: c.hex,
    fx: { ...FX_0 },
    tag: null,
    /* The hex is in the body, where it is always readable. The name says which
     * picture it came out of, which is the one thing a swatch cannot show. */
    name: from.name || 'Colour',
  }))
}
