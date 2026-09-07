import { unzip } from './zip'

/* ---------------------------------------------------------------------------
 * What is inside a design file.
 *
 * Photoshop, Illustrator and Sketch files all arrived as a grey card with
 * three letters on it, which on a board full of brand work is the wrong answer
 * for exactly the files somebody was sent by the studio. All three carry a
 * picture of themselves; none of them needs a library to get at it.
 *
 *   .ai      is a PDF. Illustrator has written one inside every file it saves
 *            since CS, so it goes through the reader that already exists and
 *            gets its artboards as pages for nothing. That is handled in
 *            ingest rather than here.
 *   .sketch  is a zip with previews/preview.png in it, and this app already
 *            has an unzip because a board export is a zip.
 *   .psd     keeps a flattened copy of the whole document at the end of the
 *            file, which is the one that takes real reading — and it is worth
 *            it, because it is the full size picture rather than the 256 pixel
 *            thumbnail alongside it.
 *
 * Everything here returns null rather than throwing on a file it cannot read.
 * The card then falls back to being a file card, which is where all of these
 * were before, so a format nobody anticipated costs a plainer card rather than
 * a broken board.
 * ------------------------------------------------------------------------- */

/* The same cap the other decodes use. Nothing on the board is drawn above
 * 1536 pixels, so anything larger is memory and upload time for detail that is
 * never sampled. */
const CAP = 1600

export interface Preview {
  blob: Blob
  w: number
  h: number
}

/* The bit after the last dot, and nothing at all when there is no dot: a file
 * called "psd" is not a Photoshop document, and `split('.').pop()` says it is. */
function ext(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/* The design files this can open, which is not the same question as the ones
 * a browser reports a type for: almost nothing reports a type for these. */
export const isDesign = (name: string) => ['psd', 'psb', 'sketch'].includes(ext(name))

/* Illustrator writes a PDF inside every file it saves with the compatibility
 * option on, which has been the default for twenty years. Told apart by
 * looking rather than by the extension, because an older Illustrator file is
 * PostScript and pdf.js would only fail on it slowly. */
export async function isPdfInside(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    return String.fromCharCode(...head) === '%PDF-'
  } catch {
    return false
  }
}

/* ---------------------------------------------------------------------------
 * Sketch.
 * ------------------------------------------------------------------------- */

async function fromSketch(file: Blob): Promise<Preview | null> {
  try {
    const files = await unzip(file)
    /* Sketch writes the first one; the second is what older versions wrote. */
    const blob = files.get('previews/preview.png') || files.get('previews/preview@2x.png')
    if (!blob) return null
    return await sized(blob)
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
 * Photoshop.
 *
 * The layout of the file is five sections one after another, each after the
 * fixed header giving its own length first, so the flattened picture at the
 * end is reached by stepping over the four in front of it rather than by
 * understanding any of them.
 * ------------------------------------------------------------------------- */

interface Psd {
  channels: number
  w: number
  h: number
  depth: number
  /* 1 is greyscale, 3 is RGB. Everything else — CMYK, Lab, indexed, duotone —
   * is a conversion this does not do. */
  mode: number
  /* Where the flattened picture starts, and where the resources are. */
  imageAt: number
  resAt: number
  resLen: number
  /* Photoshop's big format, which counts some things in eight bytes rather
   * than four. */
  big: boolean
}

function header(v: DataView, u: Uint8Array): Psd | null {
  if (u.length < 34) return null
  if (String.fromCharCode(u[0], u[1], u[2], u[3]) !== '8BPS') return null
  const version = v.getUint16(4)
  if (version !== 1 && version !== 2) return null
  const big = version === 2

  const psd: Psd = {
    channels: v.getUint16(12),
    h: v.getUint32(14),
    w: v.getUint32(18),
    depth: v.getUint16(22),
    mode: v.getUint16(24),
    imageAt: 0,
    resAt: 0,
    resLen: 0,
    big,
  }
  if (!psd.w || !psd.h || psd.channels < 1) return null

  let at = 26
  /* Colour mode data: only indexed and duotone files put anything here. */
  at += 4 + v.getUint32(at)
  /* Image resources, which is where the thumbnail lives. */
  psd.resLen = v.getUint32(at)
  psd.resAt = at + 4
  at = psd.resAt + psd.resLen
  /* Layers. The one section counted in eight bytes in the big format, and
   * getting that wrong lands in the middle of the layer data rather than at
   * the picture. */
  at += big ? 8 + Number(v.getBigUint64(at)) : 4 + v.getUint32(at)
  psd.imageAt = at
  return at + 2 <= u.length ? psd : null
}

/* PackBits, which is what Photoshop calls compression 1. A run of bytes is
 * either copied or repeated, and which one it is comes from the first byte.
 *
 * Exported for its own test. It is the one piece of real arithmetic in this
 * file and the two easy mistakes in it — the count of a repeat being 257 minus
 * the byte rather than 256, and 128 meaning nothing at all rather than a run
 * of one — both produce a picture that is wrong rather than an error. */
export function unpack(u: Uint8Array, from: number, to: number, out: Uint8Array, at: number): number {
  let i = from
  let o = at
  while (i < to && o < out.length) {
    const n = u[i++]
    if (n === 128) continue
    if (n < 128) {
      const count = n + 1
      for (let k = 0; k < count && i < to && o < out.length; k++) out[o++] = u[i++]
    } else {
      const count = 257 - n
      const byte = u[i++]
      for (let k = 0; k < count && o < out.length; k++) out[o++] = byte
    }
  }
  return o
}

/* The flattened picture, as one plane per channel. */
function planes(v: DataView, u: Uint8Array, psd: Psd): Uint8Array[] | null {
  /* Only eight bits a channel. Sixteen and thirty two bit files are real but
   * rare, and halving them properly is a conversion rather than a read. */
  if (psd.depth !== 8) return null
  if (psd.mode !== 1 && psd.mode !== 3) return null

  const at = psd.imageAt
  const compression = v.getUint16(at)
  const size = psd.w * psd.h
  const want = Math.min(psd.channels, psd.mode === 3 ? 4 : 2)
  const out: Uint8Array[] = []

  if (compression === 0) {
    let p = at + 2
    for (let c = 0; c < want; c++) {
      if (p + size > u.length) return null
      out.push(u.subarray(p, p + size))
      p += size
    }
    return out
  }

  if (compression === 1) {
    /* Every row of every channel, its packed length first, all of them before
     * any of the data. */
    const rows = psd.h * psd.channels
    const wide = psd.big ? 4 : 2
    let p = at + 2
    const lengths: number[] = []
    for (let r = 0; r < rows; r++) {
      if (p + wide > u.length) return null
      lengths.push(psd.big ? v.getUint32(p) : v.getUint16(p))
      p += wide
    }
    for (let c = 0; c < psd.channels; c++) {
      const plane = new Uint8Array(size)
      let o = 0
      for (let r = 0; r < psd.h; r++) {
        const len = lengths[c * psd.h + r]
        if (p + len > u.length) return null
        o = unpack(u, p, p + len, plane, o)
        p += len
      }
      if (c < want) out.push(plane)
    }
    return out.length ? out : null
  }

  /* 2 and 3 are zip, which Photoshop only writes for layer data. */
  return null
}

/* The 256 pixel picture Photoshop keeps alongside the real one, as a JPEG.
 * Used only when the flattened copy is missing or in a mode this cannot read —
 * a soft card is better than a card with nothing on it. */
function thumbnail(v: DataView, u: Uint8Array, psd: Psd): Blob | null {
  let at = psd.resAt
  const end = Math.min(u.length, psd.resAt + psd.resLen)
  while (at + 12 <= end) {
    if (String.fromCharCode(u[at], u[at + 1], u[at + 2], u[at + 3]) !== '8BIM') return null
    const id = v.getUint16(at + 4)
    /* A pascal string, padded so the whole thing stays on an even boundary. */
    let p = at + 6
    const nameLen = u[p]
    p += 1 + nameLen
    if ((p - at) % 2) p++
    const size = v.getUint32(p)
    p += 4
    /* 1036 is the JPEG one; 1033 is the same thing from Photoshop 4 with its
     * red and blue the wrong way round, which is not worth unpicking. */
    if (id === 1036 && size > 28) {
      const start = p + 28
      const bytes = u.slice(start, p + size)
      if (bytes.length > 100) return new Blob([bytes], { type: 'image/jpeg' })
    }
    at = p + size + (size % 2)
  }
  return null
}

async function fromPsd(file: Blob): Promise<Preview | null> {
  try {
    const buf = await file.arrayBuffer()
    const u = new Uint8Array(buf)
    const v = new DataView(buf)
    const psd = header(v, u)
    if (!psd) return null

    const planeList = planes(v, u, psd)
    if (planeList && planeList.length) {
      /* Backed by a plain ArrayBuffer on purpose: ImageData will not take a
       * view that might be over shared memory, and a bare `new
       * Uint8ClampedArray(n)` is typed as though it might be. */
      const rgba = new Uint8ClampedArray(new ArrayBuffer(psd.w * psd.h * 4))
      const grey = psd.mode === 1
      const [a, b, c, d] = planeList
      for (let i = 0, o = 0; i < psd.w * psd.h; i++, o += 4) {
        rgba[o] = grey ? a[i] : a[i]
        rgba[o + 1] = grey ? a[i] : (b ? b[i] : a[i])
        rgba[o + 2] = grey ? a[i] : (c ? c[i] : a[i])
        /* The fourth channel of a flattened RGB document is transparency.
         * A greyscale one puts it second. */
        const alpha = grey ? b : d
        rgba[o + 3] = alpha ? alpha[i] : 255
      }
      const out = await fromPixels(rgba, psd.w, psd.h)
      if (out) return out
    }

    /* A mode or a depth this does not read, or a file saved without the
     * flattened copy. The small one is still a picture of the document. */
    const thumb = thumbnail(v, u, psd)
    return thumb ? await sized(thumb) : null
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
 * Getting what was read onto a card.
 * ------------------------------------------------------------------------- */

/* Pixels to a picture, capped, and flattened onto white: a design file is
 * usually transparent where nothing was drawn, and a transparent card over a
 * dark board shows the board through the artwork. */
async function fromPixels(rgba: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): Promise<Preview | null> {
  const long = Math.max(w, h)
  const scale = long > CAP ? CAP / long : 1
  const outW = Math.max(1, Math.round(w * scale))
  const outH = Math.max(1, Math.round(h * scale))

  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sx = src.getContext('2d')
  if (!sx) return null
  sx.putImageData(new ImageData(rgba, w, h), 0, 0)

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ox = out.getContext('2d')
  if (!ox) return null
  ox.fillStyle = '#ffffff'
  ox.fillRect(0, 0, outW, outH)
  ox.drawImage(src, 0, 0, outW, outH)

  const blob = await new Promise<Blob | null>((r) => out.toBlob((b) => r(b), 'image/webp', 0.9))
  return blob ? { blob, w: outW, h: outH } : null
}

/* A picture that is already one, measured and capped. */
async function sized(blob: Blob): Promise<Preview | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const long = Math.max(bmp.width, bmp.height)
    if (long <= CAP) {
      const out = { blob, w: bmp.width, h: bmp.height }
      bmp.close()
      return out
    }
    const scale = CAP / long
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const cx = cv.getContext('2d')
    if (!cx) return null
    cx.fillStyle = '#ffffff'
    cx.fillRect(0, 0, w, h)
    cx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const small = await new Promise<Blob | null>((r) => cv.toBlob((b) => r(b), 'image/webp', 0.9))
    return small ? { blob: small, w, h } : null
  } catch {
    return null
  }
}

/* The picture inside a design file, whichever kind it is. */
export async function designPreview(file: Blob, name: string): Promise<Preview | null> {
  const kind = ext(name)
  if (kind === 'sketch') return fromSketch(file)
  if (kind === 'psd' || kind === 'psb') return fromPsd(file)
  return null
}
