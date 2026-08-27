import { describe, expect, it } from 'vitest'
import { canDecodeFrames, isAnimated, mightMove, openReel } from '../../src/store/anim'
import { animatedGif } from '../fixtures/agif.mjs'

/* Pictures that move, and the two ways of being wrong about them: treating a
 * photograph as a reel of frames, which would make every card on the board
 * cost what a video costs, and treating a GIF as a still, which is the bug
 * this was written for. */

describe('which files are worth asking about', () => {
  it('asks about the ones that can move', () => {
    expect(mightMove('image/gif')).toBe(true)
    expect(mightMove('image/webp')).toBe(true)
    expect(mightMove('image/apng')).toBe(true)
    expect(mightMove('image/png')).toBe(true)
    expect(mightMove('image/avif')).toBe(true)
  })

  it('does not open a decoder for a photograph', () => {
    /* The reason this matters: dropping a folder of two hundred JPEGs would
     * otherwise mean two hundred decoders opened to be told what the type
     * already said. */
    expect(mightMove('image/jpeg')).toBe(false)
    expect(mightMove('image/jpg')).toBe(false)
    expect(mightMove('video/mp4')).toBe(false)
    expect(mightMove('')).toBe(false)
  })
})

describe('with no decoder at all', () => {
  it('says so rather than pretending', () => {
    /* Node has no WebCodecs, which stands in for an older browser. The card
     * falls back to the still it always showed. */
    expect(canDecodeFrames()).toBe(false)
  })

  it('calls nothing animated, rather than throwing', async () => {
    const gif = new Blob([animatedGif({ palette: [[1, 2, 3], [4, 5, 6]], frames: [0, 1] })], { type: 'image/gif' })
    await expect(isAnimated(gif)).resolves.toBe(false)
    await expect(openReel(gif)).resolves.toBeNull()
  })
})

/* The fixture is the only reason the browser suite can ask its question, so a
 * silent break in it would turn that suite green for the wrong reason. Parsed
 * here rather than trusted. */
function frameCount(buf: Uint8Array): number {
  let i = 13
  const bits = (buf[10] & 7) + 1
  if (buf[10] & 0x80) i += 3 * (1 << bits)
  let frames = 0
  while (i < buf.length) {
    if (buf[i] === 0x21) {
      i += 2
      while (buf[i]) i += buf[i] + 1
      i++
    } else if (buf[i] === 0x2c) {
      frames++
      i += 10
      i++
      while (buf[i]) i += buf[i] + 1
      i++
    } else break
  }
  return frames
}

describe('the animated GIF the browser suite is asked to play', () => {
  it('is a GIF', () => {
    const g = animatedGif({ palette: [[220, 40, 40], [30, 80, 220]], frames: [0, 1] })
    expect(Buffer.from(g.subarray(0, 6)).toString('latin1')).toBe('GIF89a')
    expect(g[g.length - 1]).toBe(0x3b)
  })

  it('holds as many frames as it was asked for', () => {
    expect(frameCount(animatedGif({ palette: [[1, 1, 1]], frames: [0] }))).toBe(1)
    expect(frameCount(animatedGif({ palette: [[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]], frames: [0, 1, 2, 3] }))).toBe(4)
  })

  it('is large enough that its LZW has to widen its codes', () => {
    /* The bug worth guarding. A decoder adds a dictionary entry for every code
     * after the first one following a clear; an encoder that counts the first
     * one too widens the code size a code early and everything after is read
     * at the wrong width. A flat first frame still comes out right, which is
     * exactly what made it hard to see — so the fixture is big enough to cross
     * the boundary, and the browser suite checks the later frames' colours by
     * painting them. */
    const g = animatedGif({ w: 64, h: 64, palette: [[1, 1, 1], [2, 2, 2]], frames: [0, 1] })
    expect(64 * 64).toBeGreaterThan(1 << 6)
    expect(frameCount(g)).toBe(2)
  })
})
