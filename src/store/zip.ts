/* ---------------------------------------------------------------------------
 * A very small zip reader and writer.
 *
 * A board leaves here as a real file that anyone can open: a listing at the
 * top and the pictures beside it. That means a zip, and a zip is little enough
 * to write by hand — a header before each file, a directory at the end, and a
 * checksum — which is a better trade than a dependency for the one format the
 * whole export rests on.
 *
 * Pictures and video are already compressed, so they go in as they are.
 * Only the listing is deflated, through the browser's own compression, and
 * both kinds are read back.
 * ------------------------------------------------------------------------- */

export interface ZipEntry {
  name: string
  blob: Blob
  /* Worth compressing. False for media, which would only grow. */
  deflate?: boolean
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => GenericTransformStream }).CompressionStream
  if (!CS) return null
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('deflate-raw') as ReadableWritablePair)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => GenericTransformStream }).DecompressionStream
  if (!DS) throw new Error('this browser cannot read a compressed board file')
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DS('deflate-raw') as ReadableWritablePair)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function zip(entries: ZipEntry[]): Promise<Blob> {
  const parts: BlobPart[] = []
  const dir: Uint8Array[] = []
  let offset = 0

  for (const e of entries) {
    const name = enc.encode(e.name)
    const raw = new Uint8Array(await e.blob.arrayBuffer())
    const sum = crc32(raw)
    let body: Uint8Array<ArrayBufferLike> = raw
    let method = 0
    if (e.deflate) {
      const packed = await deflateRaw(raw)
      if (packed && packed.length < raw.length) {
        body = packed
        method = 8
      }
    }

    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 0x0800, true) /* names are UTF-8 */
    head.setUint16(8, method, true)
    head.setUint32(14, sum, true)
    head.setUint32(18, body.length, true)
    head.setUint32(22, raw.length, true)
    head.setUint16(26, name.length, true)
    parts.push(head.buffer, name, body as BlobPart)

    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, method, true)
    cen.setUint32(16, sum, true)
    cen.setUint32(20, body.length, true)
    cen.setUint32(24, raw.length, true)
    cen.setUint16(28, name.length, true)
    cen.setUint32(42, offset, true)
    const rec = new Uint8Array(46 + name.length)
    rec.set(new Uint8Array(cen.buffer), 0)
    rec.set(name, 46)
    dir.push(rec)

    offset += 30 + name.length + body.length
  }

  const dirBytes = dir.reduce((n, r) => n + r.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, dirBytes, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...(dir as BlobPart[]), end.buffer], { type: 'application/zip' })
}

/* Read straight from the directory at the end rather than walking forward, so
 * a file with anything appended still opens. */
export async function unzip(file: Blob): Promise<Map<string, Blob>> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(buf.buffer)
  const out = new Map<string, Blob>()

  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('this is not a board file')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const dec = new TextDecoder()

  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const packed = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const at = view.getUint32(p + 42, true)
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen))

    /* The local header repeats the name and extra fields, and its lengths are
     * the ones that count: some writers put different extras in each. */
    const lname = view.getUint16(at + 26, true)
    const lextra = view.getUint16(at + 28, true)
    const from = at + 30 + lname + lextra
    const body = buf.subarray(from, from + packed)
    out.set(name, new Blob([(method === 8 ? await inflateRaw(body) : body) as BlobPart]))

    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
