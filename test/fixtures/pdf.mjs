/* A PDF, written by hand.
 *
 * The suites need one to drop on a board, and a checked-in binary is a thing
 * nobody can read or change. This is about ninety lines and it produces a real
 * document: several pages, each a different colour with its own number set in
 * Helvetica, which is enough to tell page one from page two by looking at the
 * card rather than by trusting a counter.
 *
 * The only fiddly part of the format is the cross reference table at the end.
 * It is a list of byte offsets, one per object, and a reader trusts it
 * absolutely — so the bytes are assembled first and the offsets recorded as
 * each object is written, rather than worked out afterwards and hoped over.
 */

const enc = new TextEncoder()

/* Content stream for one page: a filled rectangle with its number on top.
 * PDF's own operators, which are postfix and take their colours as 0..1. */
function pageStream(n, total, rgb) {
  const [r, g, b] = rgb
  /* Dark text on a light page, light text on a dark one, so the number can be
     read either way. */
  const ink = r * 0.299 + g * 0.587 + b * 0.114 > 0.6 ? '0 0 0' : '1 1 1'
  return [
    `${r} ${g} ${b} rg`,
    '0 0 400 300 re f',
    `${ink} rg`,
    'BT /F1 48 Tf 40 130 Td',
    `(Page ${n} of ${total}) Tj`,
    'ET',
    /* A band along the bottom, so a thumbnail that has been cropped or scaled
       wrongly is obvious at a glance rather than merely wrong. */
    `${ink} rg`,
    '0 0 400 24 re f',
  ].join('\n')
}

const COLOURS = [
  [0.93, 0.35, 0.12],
  [0.16, 0.42, 0.78],
  [0.18, 0.62, 0.42],
  [0.55, 0.28, 0.72],
  [0.95, 0.82, 0.25],
]

/* Returns the bytes of a PDF with `pages` pages. */
export function makePdf(pages = 3) {
  const chunks = []
  let length = 0
  const push = (s) => {
    const bytes = typeof s === 'string' ? enc.encode(s) : s
    chunks.push(bytes)
    length += bytes.length
    return length
  }

  /* Object numbers: 1 catalog, 2 page tree, 3 font, then a page and a content
     stream for each page. */
  const fontId = 3
  const pageId = (i) => 4 + i * 2
  const contentId = (i) => 5 + i * 2
  const total = 4 + pages * 2

  /* Byte offset of each object, indexed by object number. */
  const at = new Array(total).fill(0)
  const obj = (id, body) => {
    at[id] = length
    push(`${id} 0 obj\n${body}\nendobj\n`)
  }

  push('%PDF-1.4\n')
  /* A comment of high bytes, which is what tells anything sniffing the file
     that it is binary rather than text. */
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(
    2,
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`
  )
  obj(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  for (let i = 0; i < pages; i++) {
    obj(
      pageId(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId(i)} 0 R >>`
    )
    const body = pageStream(i + 1, pages, COLOURS[i % COLOURS.length])
    obj(contentId(i), `<< /Length ${enc.encode(body).length} >>\nstream\n${body}\nendstream`)
  }

  /* The cross reference table. Entry zero is the head of the free list and is
     always this exact line; the rest are the offsets recorded above, each
     padded to ten digits because a reader takes the entries as fixed width. */
  const xref = length
  const rows = ['xref', `0 ${total}`, '0000000000 65535 f ']
  for (let id = 1; id < total; id++) rows.push(`${String(at[id]).padStart(10, '0')} 00000 n `)
  push(rows.join('\n') + '\n')
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let n = 0
  for (const c of chunks) {
    out.set(c, n)
    n += c.length
  }
  return out
}
