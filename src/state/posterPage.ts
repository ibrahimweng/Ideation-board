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

/* --------------------------------------------------------------------------
 * Paper.
 *
 * The first PDF this wrote was the exact size of the board: a page 1386 points
 * wide by 972 tall, which is a fine thing to email and an impossible thing to
 * print. Nobody owns that paper. So the sheet is now fitted onto a real sheet,
 * turned to whichever way round suits the board, with a margin — and the PNG
 * is still there for anyone who wants the enormous exact-size version.
 * ------------------------------------------------------------------------ */

export const PAPER = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
} as const

export type PaperName = keyof typeof PAPER

/* Letter where Letter is what comes out of the printer, A4 everywhere else.
 * The countries are the whole list, not a sample: everybody else uses A4. */
const LETTER_LOCALES = /^(en-US|en-CA|fr-CA|es-MX|en-PH|es-CL|es-CO|es-CR|es-DO|es-GT|es-NI|es-PA|es-SV|es-VE)$/i

export function paperFor(locale?: string): PaperName {
  const tag = locale ?? (typeof navigator === 'undefined' ? 'en-GB' : navigator.language || 'en-GB')
  if (LETTER_LOCALES.test(tag)) return 'letter'
  /* A bare language with no region: US English is overwhelmingly US paper. */
  if (/^en-?$/i.test(tag)) return 'letter'
  return 'a4'
}

/* The page, and where the picture sits on it.
 *
 * The page turns to match the board rather than the board being squeezed onto
 * a portrait sheet, and the picture keeps its shape inside the margin. A board
 * far wider than any paper still fits: it comes out small, which is what
 * "print this on one sheet" honestly means. */
export function fitToPaper(
  boardW: number,
  boardH: number,
  paper: PaperName = 'a4',
  margin = 28
) {
  const sheet = PAPER[paper]
  /* Turned to the board's own way round, so a wide board is not printed down
   * the middle of a portrait page at a third of the size. */
  const landscape = boardW > boardH
  const pw = landscape ? sheet.h : sheet.w
  const ph = landscape ? sheet.w : sheet.h
  const room = { w: pw - margin * 2, h: ph - margin * 2 }
  const k = Math.min(room.w / boardW, room.h / boardH)
  const w = boardW * k
  const h = boardH * k
  return {
    page: { w: pw, h: ph },
    place: { x: (pw - w) / 2, y: (ph - h) / 2, w, h },
    paper,
    landscape,
  }
}

export function pdfBytes(
  jpeg: Uint8Array,
  iw: number,
  ih: number,
  pw: number,
  ph: number,
  /* Where on the page the picture goes, in points from the bottom left. The
   * page is no longer the same shape as the board, so this is no longer the
   * whole of it. */
  place: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: pw, h: ph }
): Blob {
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

  const content = `q\n${place.w.toFixed(2)} 0 0 ${place.h.toFixed(2)} ${place.x.toFixed(2)} ${place.y.toFixed(2)} cm\n/Im0 Do\nQ\n`

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
