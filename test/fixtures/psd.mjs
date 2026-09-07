/* A Photoshop document, written by hand.
 *
 * Reading one is the only part of the design file work that is real parsing,
 * so it needs a real file to be read. A checked-in binary is a thing nobody
 * can change; this is a hundred lines and it produces a document with a shape
 * that can be asserted on — orange on the left, blue on the right, a dark band
 * across the bottom. Orange against blue catches a red and blue channel swap,
 * which is the classic way to get this wrong and look nearly right; the band
 * catches the picture arriving upside down.
 *
 * Both compressions are here. Real documents are almost always the packed one,
 * and the packing is the part with the arithmetic in it, so a fixture that
 * only wrote raw would be testing the easy half.
 */

const SIG = '8BPS'

/* The picture, as three planes. Photoshop stores a channel at a time rather
 * than a pixel at a time, which is the other thing easy to get backwards. */
function planes(w, h) {
  const r = new Uint8Array(w * h)
  const g = new Uint8Array(w * h)
  const b = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      /* The band along the bottom fifth. */
      if (y > h * 0.8) {
        r[i] = 24; g[i] = 24; b[i] = 28
      } else if (x < w / 2) {
        r[i] = 230; g[i] = 90; b[i] = 30
      } else {
        r[i] = 40; g[i] = 90; b[i] = 200
      }
    }
  }
  return [r, g, b]
}

/* PackBits. A run of three or more of the same byte is written as a count and
 * the byte; anything else is written out as it stands. */
function packbits(row) {
  const out = []
  let i = 0
  while (i < row.length) {
    let run = 1
    while (run < 128 && i + run < row.length && row[i + run] === row[i]) run++
    if (run >= 3) {
      out.push(257 - run, row[i])
      i += run
      continue
    }
    /* Literals, up to a hundred and twenty eight, stopping early if a run
       worth encoding starts. */
    const from = i
    while (i < row.length && i - from < 128) {
      let ahead = 1
      while (ahead < 3 && i + ahead < row.length && row[i + ahead] === row[i]) ahead++
      if (ahead >= 3) break
      i++
    }
    const n = i - from
    out.push(n - 1)
    for (let k = 0; k < n; k++) out.push(row[from + k])
  }
  return out
}

/* `compression` is 0 for raw and 1 for packed. */
export function makePsd({ w = 200, h = 140, compression = 1 } = {}) {
  const [r, g, b] = planes(w, h)
  const parts = []
  const push = (bytes) => parts.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))

  const u16 = (n) => [(n >> 8) & 0xff, n & 0xff]
  const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

  /* The header: signature, version 1, six reserved bytes, then the shape of
     the document. Mode 3 is RGB. */
  push([...SIG].map((c) => c.charCodeAt(0)))
  push(u16(1))
  push([0, 0, 0, 0, 0, 0])
  push(u16(3))          /* channels */
  push(u32(h))
  push(u32(w))
  push(u16(8))          /* bits a channel */
  push(u16(3))          /* mode: RGB */

  /* The three sections between the header and the picture. Each gives its own
     length first, and this writes all three empty — which is what the reader
     has to step over to find the picture. */
  push(u32(0))          /* colour mode data */
  push(u32(0))          /* image resources */
  push(u32(0))          /* layer and mask information */

  push(u16(compression))
  if (compression === 0) {
    push(r); push(g); push(b)
  } else {
    /* Every row of every channel packed, with all of the packed lengths
       written out in front of all of the data. */
    const rows = []
    for (const plane of [r, g, b]) {
      for (let y = 0; y < h; y++) rows.push(packbits(plane.subarray(y * w, (y + 1) * w)))
    }
    for (const row of rows) push(u16(row.length))
    for (const row of rows) push(row)
  }

  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
