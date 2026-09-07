import { describe, expect, it } from 'vitest'
import { clock, coverFromId3, wavePath } from '../../src/store/audio'

/* ---------------------------------------------------------------------------
 * The three parts of a sound card that are arithmetic rather than a browser.
 *
 * Reading the samples needs a real audio context and belongs in the browser
 * suite. Turning peaks into a shape, turning seconds into a time, and finding
 * a cover inside an ID3 tag are all pure, and the last of those is the fiddly
 * one: two versions of the format store their frame sizes differently, and
 * reading one as the other truncates the picture rather than failing, which is
 * exactly the kind of bug that ships.
 * ------------------------------------------------------------------------- */

describe('clock', () => {
  it('reads as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(9)).toBe('0:09')
    expect(clock(61)).toBe('1:01')
    expect(clock(3599)).toBe('59:59')
  })

  it('rounds down, so a track never claims a second it has not reached', () => {
    expect(clock(1.99)).toBe('0:01')
  })

  it('says nothing rather than NaN for a length nobody knows yet', () => {
    expect(clock(NaN)).toBe('0:00')
    expect(clock(Infinity)).toBe('0:00')
    expect(clock(-5)).toBe('0:00')
  })
})

describe('wavePath', () => {
  const bars = (d: string) => d.split('M').length - 1

  it('draws one bar per peak', () => {
    expect(bars(wavePath([10, 20, 30]))).toBe(3)
    expect(bars(wavePath(new Array(160).fill(50)))).toBe(160)
  })

  it('is nothing at all when there is nothing to draw', () => {
    expect(wavePath([])).toBe('')
  })

  it('draws a louder peak taller', () => {
    /* Each bar is M x y H x V y H x Z, so the two y values are its extent. */
    const height = (d: string) => {
      const n = d.match(/M[\d.]+ ([\d.]+)H[\d.]+V([\d.]+)/)
      return n ? Number(n[2]) - Number(n[1]) : 0
    }
    expect(height(wavePath([100]))).toBeGreaterThan(height(wavePath([50])))
    expect(height(wavePath([50]))).toBeGreaterThan(height(wavePath([10])))
  })

  it('keeps a floor, so silence is a line rather than a gap', () => {
    /* A track that opens quietly should still look like a track from the
       first bar, rather than starting somewhere in the middle. */
    expect(wavePath([0])).not.toBe('')
    expect(wavePath([0])).toContain('M')
  })

  it('stays inside the box it is drawn in', () => {
    const d = wavePath([100, 0, 100])
    for (const n of d.match(/[VH]([\d.]+)/g) || []) {
      expect(Number(n.slice(1))).toBeLessThanOrEqual(3)
    }
    /* The tallest possible bar fills the height exactly and no more. */
    expect(wavePath([100])).toMatch(/M[\d.]+ 0\.0000H[\d.]+V1\.0000/)
  })
})

/* ---------------------------------------------------------------------------
 * A cover inside a tag.
 * ------------------------------------------------------------------------- */

const enc = new TextEncoder()

/* Builds an ID3 tag with one APIC frame in it, in either of the two versions
 * that are still current. `syncsafe` is what tells them apart: v2.4 stores
 * frame sizes seven bits to the byte and v2.3 stores them as plain integers. */
function id3({ major = 3, kind = 3, mime = 'image/jpeg', picture = new Uint8Array(300).fill(7), desc = '' } = {}) {
  const body = [
    new Uint8Array([0]),                 /* text encoding: latin1 */
    enc.encode(mime), new Uint8Array([0]),
    new Uint8Array([kind]),
    enc.encode(desc), new Uint8Array([0]),
    picture,
  ]
  const size = body.reduce((n, b) => n + b.length, 0)
  const frame = new Uint8Array(10 + size)
  frame.set(enc.encode('APIC'), 0)
  const fv = new DataView(frame.buffer)
  if (major === 4) {
    frame[4] = (size >> 21) & 0x7f
    frame[5] = (size >> 14) & 0x7f
    frame[6] = (size >> 7) & 0x7f
    frame[7] = size & 0x7f
  } else {
    fv.setUint32(4, size)
  }
  let at = 10
  for (const b of body) { frame.set(b, at); at += b.length }

  const tag = new Uint8Array(10 + frame.length)
  tag.set(enc.encode('ID3'), 0)
  tag[3] = major
  tag[4] = 0
  tag[5] = 0
  const total = frame.length
  tag[6] = (total >> 21) & 0x7f
  tag[7] = (total >> 14) & 0x7f
  tag[8] = (total >> 7) & 0x7f
  tag[9] = total & 0x7f
  tag.set(frame, 10)
  return tag.buffer
}

describe('coverFromId3', () => {
  it('finds the cover in a version 2.3 tag', async () => {
    const out = coverFromId3(id3({ major: 3 }))
    expect(out).toBeTruthy()
    expect(out!.size).toBe(300)
    expect(out!.type).toBe('image/jpeg')
  })

  it('and in a version 2.4 tag, whose sizes are counted differently', async () => {
    /* The one that matters: reading a 2.4 size as a plain integer gives a
       number far too large and the frame is rejected, so the cover silently
       goes missing on every file written by anything modern. */
    const out = coverFromId3(id3({ major: 4 }))
    expect(out).toBeTruthy()
    expect(out!.size).toBe(300)
  })

  it('takes a front cover, and "other" when that is all there is', () => {
    expect(coverFromId3(id3({ kind: 3 }))).toBeTruthy()
    expect(coverFromId3(id3({ kind: 0 }))).toBeTruthy()
  })

  it('leaves the back cover and the band photograph alone', () => {
    /* 4 is the back, 8 is the artist. Showing one of those in place of the
       cover is worse than showing no picture at all. */
    expect(coverFromId3(id3({ kind: 4 }))).toBeNull()
    expect(coverFromId3(id3({ kind: 8 }))).toBeNull()
  })

  it('reads past a description to the picture behind it', () => {
    const out = coverFromId3(id3({ desc: 'Front cover' }))
    expect(out?.size).toBe(300)
  })

  it('keeps the picture type the tag declared', () => {
    expect(coverFromId3(id3({ mime: 'image/png' }))?.type).toBe('image/png')
  })

  it('refuses a mime type that is not a picture at all', () => {
    expect(coverFromId3(id3({ mime: 'text/html' }))?.type).toBe('image/jpeg')
  })

  it('says nothing for a file with no tag on it', () => {
    expect(coverFromId3(new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer)).toBeNull()
    expect(coverFromId3(new ArrayBuffer(0))).toBeNull()
  })

  it('does not fall over on a tag that has been cut short', () => {
    const full = new Uint8Array(id3({}))
    for (const cut of [12, 20, 40, full.length - 50]) {
      expect(() => coverFromId3(full.slice(0, cut).buffer)).not.toThrow()
    }
  })

  it('ignores a picture too small to be one', () => {
    /* A few bytes where a cover should be is a broken tag, not a thumbnail. */
    expect(coverFromId3(id3({ picture: new Uint8Array(20).fill(1) }))).toBeNull()
  })
})
