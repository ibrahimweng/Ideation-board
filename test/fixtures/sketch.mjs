import zlib from 'node:zlib'

/* A Sketch file, written by hand.
 *
 * A .sketch is a zip, and the picture of the document is one entry inside it
 * at previews/preview.png. So this is a small PNG in a small zip, which is
 * fifty lines of two very well documented formats and means the suite can drop
 * a real one rather than a mock of one.
 *
 * The entry is stored rather than deflated. The app's own unzip reads both,
 * and stored means this file needs no compressor of its own beyond the one
 * inside the PNG.
 */

/* ---------------------------------------------------------------------------
 * The PNG.
 * ------------------------------------------------------------------------- */

const CRC = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return (bytes) => {
    let c = -1
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  v.setUint32(8 + body.length, CRC(out.subarray(4, 8 + body.length)))
  return out
}

/* A picture with a shape worth asserting on: green on the left, magenta on the
 * right, so a channel swap or a mirrored read is visible rather than subtle. */
export function makePng({ w = 240, h = 160 } = {}) {
  /* Raw scanlines, each with its filter byte in front. */
  const raw = new Uint8Array(h * (1 + w * 3))
  let at = 0
  for (let y = 0; y < h; y++) {
    raw[at++] = 0 /* filter: none */
    for (let x = 0; x < w; x++) {
      if (x < w / 2) { raw[at++] = 40; raw[at++] = 170; raw[at++] = 90 }
      else { raw[at++] = 210; raw[at++] = 50; raw[at++] = 160 }
    }
  }

  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w)
  v.setUint32(4, h)
  ihdr[8] = 8   /* bits a channel */
  ihdr[9] = 2   /* colour type: truecolour */

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/* ---------------------------------------------------------------------------
 * The zip around it.
 * ------------------------------------------------------------------------- */

export function makeSketch({ name = 'previews/preview.png', png = makePng() } = {}) {
  const enc = new TextEncoder()
  const nameBytes = enc.encode(name)
  const crc = CRC(png)

  const local = new Uint8Array(30 + nameBytes.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)   /* local file header */
  lv.setUint16(4, 20, true)           /* version needed */
  lv.setUint16(8, 0, true)            /* stored */
  lv.setUint32(14, crc, true)
  lv.setUint32(18, png.length, true)  /* packed size */
  lv.setUint32(22, png.length, true)  /* real size */
  lv.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)

  const central = new Uint8Array(46 + nameBytes.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)   /* central directory header */
  cv.setUint16(4, 20, true)
  cv.setUint16(6, 20, true)
  cv.setUint16(10, 0, true)           /* stored */
  cv.setUint32(16, crc, true)
  cv.setUint32(20, png.length, true)
  cv.setUint32(24, png.length, true)
  cv.setUint16(28, nameBytes.length, true)
  cv.setUint32(42, 0, true)           /* where the local header is */
  central.set(nameBytes, 46)

  const centralAt = local.length + png.length
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)   /* end of central directory */
  ev.setUint16(8, 1, true)            /* entries on this disk */
  ev.setUint16(10, 1, true)           /* entries in total */
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, centralAt, true)

  const out = new Uint8Array(centralAt + central.length + end.length)
  let at = 0
  for (const p of [local, png, central, end]) { out.set(p, at); at += p.length }
  return out
}
