/* An animated GIF, written by hand.
 *
 * Needed because the question "does an effected GIF still move" cannot be
 * asked without one, and a checked-in binary is a thing nobody can read. The
 * LZW here emits every pixel as a literal code, which is legal and about as
 * far from compression as it is possible to get — for an eight by eight square
 * that is a rounding error, and it means the encoder is twenty lines rather
 * than a hundred.
 */
function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize
  const end = clear + 1
  let codeSize = minCodeSize + 1
  let next = end + 1
  const out = []
  let cur = 0
  let bits = 0
  const emit = (code) => {
    cur |= code << bits
    bits += codeSize
    while (bits >= 8) {
      out.push(cur & 0xff)
      cur >>= 8
      bits -= 8
    }
  }
  emit(clear)
  /* A decoder adds a dictionary entry for every code *after* the first one
   * following a clear — it has no previous string to join to the first. An
   * encoder that counts the first one too runs a code ahead, widens the code
   * size one code early, and everything after that is read at the wrong width.
   * Frame one still came out right, which is what makes this worth a comment:
   * a flat first frame hides it, and every frame after is quietly wrong. */
  let firstAfterClear = true
  for (const px of indices) {
    emit(px)
    if (firstAfterClear) {
      firstAfterClear = false
    } else {
      next++
      if (next === 1 << codeSize) {
        if (codeSize < 12) codeSize++
        else {
          emit(clear)
          codeSize = minCodeSize + 1
          next = end + 1
          firstAfterClear = true
        }
      }
    }
  }
  emit(end)
  if (bits) out.push(cur & 0xff)
  return Buffer.from(out)
}

const blocks = (buf) => {
  const parts = []
  for (let i = 0; i < buf.length; i += 255) {
    const chunk = buf.subarray(i, i + 255)
    parts.push(Buffer.from([chunk.length]), chunk)
  }
  parts.push(Buffer.from([0]))
  return Buffer.concat(parts)
}

/* `frames` is a list of palette indices, one per frame, painted flat.
 * `palette` is a list of [r,g,b]. `delay` is in hundredths of a second. */
export function animatedGif({ w = 8, h = 8, palette, frames, delay = 8 }) {
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)))
  const tableSize = 1 << bits
  const table = Buffer.alloc(tableSize * 3)
  palette.forEach((c, i) => {
    table[i * 3] = c[0]
    table[i * 3 + 1] = c[1]
    table[i * 3 + 2] = c[2]
  })

  const screen = Buffer.alloc(7)
  screen.writeUInt16LE(w, 0)
  screen.writeUInt16LE(h, 2)
  /* Global table present, colour resolution, size of the table. */
  screen[4] = 0x80 | ((bits - 1) & 7)

  const loop = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'latin1'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ])

  const minCodeSize = Math.max(2, bits)
  const parts = [Buffer.from('GIF89a', 'latin1'), screen, table, loop]

  for (const index of frames) {
    const gce = Buffer.alloc(8)
    gce[0] = 0x21; gce[1] = 0xf9; gce[2] = 0x04; gce[3] = 0x00
    gce.writeUInt16LE(delay, 4)
    gce[6] = 0; gce[7] = 0
    const desc = Buffer.alloc(10)
    desc[0] = 0x2c
    desc.writeUInt16LE(0, 1); desc.writeUInt16LE(0, 3)
    desc.writeUInt16LE(w, 5); desc.writeUInt16LE(h, 7)
    desc[9] = 0
    const px = new Array(w * h).fill(index)
    parts.push(gce, desc, Buffer.from([minCodeSize]), blocks(lzw(px, minCodeSize)))
  }

  parts.push(Buffer.from([0x3b]))
  return Buffer.concat(parts)
}
