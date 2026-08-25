import type { Item } from './types'
import { isWire } from './kinds'

/* ---------------------------------------------------------------------------
 * Where the sheet sits, and how it becomes paper.
 *
 * The arithmetic behind the board poster, kept apart from the painting of it.
 * None of this touches a canvas or a document: it works out the rectangle
 * everything fits inside, how many pixels that rectangle can afford, and how
 * to wrap a finished picture in a PDF. That makes it testable in a second
 * rather than only through a browser — which matters most for the PDF, whose
 * cross-reference table is a list of byte offsets into itself and is wrong in
 * a way nothing on screen would show.
 * ------------------------------------------------------------------------- */

/* An edge past which browsers start refusing to allocate, and a total past
 * which they refuse even when neither edge is large. A wide, shallow board
 * hits the first; a big square one hits the second. */
const MAX_EDGE = 12000
const MAX_PIXELS = 40e6

/* The rectangle everything sits inside, in board pixels. */
export function posterBounds(items: Item[], pad: number) {
  const boxes = items.filter((i) => !isWire(i))
  if (!boxes.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of boxes) {
    x0 = Math.min(x0, i.x)
    y0 = Math.min(y0, i.y)
    x1 = Math.max(x1, i.x + i.w)
    y1 = Math.max(y1, i.y + i.h)
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }
}

/* How many device pixels per board pixel a sheet this size can afford. */
export function posterScale(w: number, h: number, want: number) {
  const byEdge = MAX_EDGE / Math.max(w, h)
  const byArea = Math.sqrt(MAX_PIXELS / (w * h))
  return Math.max(0.25, Math.min(want, byEdge, byArea))
}

/* --------------------------------------------------------------------------
 * The same sheet as paper.
 *
 * A PDF by hand, which is less alarming than it sounds: one page, one image
 * on it, and five objects to say so. The picture goes in as a JPEG because
 * PDF understands JPEG bytes directly — /DCTDecode is a copy rather than a
 * re-encode — so nothing here has to implement a compressor.
 *
 * The only fiddly part is the cross-reference table, which is a list of byte
 * offsets into the file itself, each entry exactly twenty bytes long. So the
 * file is assembled as bytes from the start and the offsets are recorded as
 * they are passed.
 * ------------------------------------------------------------------------ */

/* PostScript points, at the 96 dpi a board pixel is drawn at, so a board
 * comes out the size it looks on screen. */
export const PT = 72 / 96

export function pdfBytes(jpeg: Uint8Array, iw: number, ih: number, pw: number, ph: number): Blob {
  const parts: Uint8Array[] = []
  const enc = new TextEncoder()
  let at = 0
  const offsets: number[] = []
  const put = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk
    parts.push(bytes)
    at += bytes.length
  }
  /* Records where this object starts, which is what the table below is. */
  const obj = (n: number, body: string) => {
    offsets[n] = at
    put(`${n} 0 obj\n${body}\nendobj\n`)
  }

  const content = `q\n${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`

  put('%PDF-1.4\n')
  /* A comment of high bytes, which is how a PDF says "treat me as binary". */
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] ` +
      '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'
  )
  obj(4, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`)

  offsets[5] = at
  put(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  )
  put(jpeg)
  put('\nendstream\nendobj\n')

  const startxref = at
  let table = `xref\n0 6\n0000000000 65535 f \n`
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  put(table)
  put(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`)

  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}
