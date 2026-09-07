import { describe, expect, it } from 'vitest'
import { isDesign, isPdfInside, unpack } from '../../src/store/design'

/* ---------------------------------------------------------------------------
 * The parts of reading a design file that are arithmetic.
 *
 * Getting the picture out and onto a card needs a canvas and belongs in the
 * browser suite, which drops real Photoshop and Sketch files and checks the
 * colours that come back. What is here is the decompression, because it is
 * pure and because both of the easy mistakes in it produce a picture that is
 * wrong rather than an error: a repeat counted as 256 minus the byte instead
 * of 257 is every run one pixel short, and 128 read as a run of one rather
 * than as nothing at all shifts everything after it.
 * ------------------------------------------------------------------------- */

const run = (packed: number[], size: number) => {
  const out = new Uint8Array(size)
  const u = new Uint8Array(packed)
  const wrote = unpack(u, 0, u.length, out, 0)
  return { bytes: [...out], wrote }
}

describe('PackBits', () => {
  it('copies a literal run', () => {
    /* 2 means "the next three bytes are themselves". */
    expect(run([2, 10, 20, 30], 3).bytes).toEqual([10, 20, 30])
  })

  it('repeats a run, and counts it from 257', () => {
    /* 254 means "the next byte, three times": the count is 257 minus it.
       Counting from 256 instead would give two, and every flat area of every
       picture would come out one pixel short of where it should end. */
    expect(run([254, 99], 3).bytes).toEqual([99, 99, 99])
    expect(run([253, 4], 4).bytes).toEqual([4, 4, 4, 4])
    expect(run([255, 7], 2).bytes).toEqual([7, 7])
    expect(run([129, 5], 128).bytes.filter((b) => b === 5)).toHaveLength(128)
  })

  it('treats 128 as nothing at all', () => {
    /* Not a run of one. Reading it as one shifts everything after it by a
       byte, which tilts the whole picture. */
    expect(run([128, 2, 1, 2, 3], 3).bytes).toEqual([1, 2, 3])
  })

  it('reads a mixture in order', () => {
    expect(run([1, 1, 2, 253, 9, 0, 4], 8).bytes).toEqual([1, 2, 9, 9, 9, 9, 4, 0])
  })

  it('says how far it got, so the next row starts in the right place', () => {
    expect(run([2, 10, 20, 30], 8).wrote).toBe(3)
  })

  it('stops at the end of what it was given rather than running on', () => {
    /* A row whose length was wrong, or a file cut short. Reading past the end
       would take the next channel's bytes into this one. */
    const out = new Uint8Array(10)
    const u = new Uint8Array([2, 10, 20, 30, 2, 40, 50, 60])
    const wrote = unpack(u, 0, 4, out, 0)
    expect(wrote).toBe(3)
    expect([...out.slice(0, 4)]).toEqual([10, 20, 30, 0])
  })

  it('stops at the end of the room it was given', () => {
    /* A run claiming more than the row holds must not write past it. */
    const out = new Uint8Array(3)
    const u = new Uint8Array([129, 5])
    expect(() => unpack(u, 0, u.length, out, 0)).not.toThrow()
    expect([...out]).toEqual([5, 5, 5])
  })
})

describe('which files are design files', () => {
  it('knows the three by name, because nothing reports a type for them', () => {
    expect(isDesign('lockup.psd')).toBe(true)
    expect(isDesign('huge.psb')).toBe(true)
    expect(isDesign('wordmark.sketch')).toBe(true)
    expect(isDesign('LOCKUP.PSD')).toBe(true)
  })

  it('and leaves everything else alone', () => {
    expect(isDesign('photo.jpg')).toBe(false)
    expect(isDesign('deck.pdf')).toBe(false)
    expect(isDesign('psd')).toBe(false)
    expect(isDesign('')).toBe(false)
  })
})

describe('an Illustrator file', () => {
  const blob = (s: string) => new Blob([new TextEncoder().encode(s)])

  it('is recognised by what is inside it rather than by its name', async () => {
    /* Illustrator writes a PDF inside every file it saves with the
       compatibility option on. An older one is PostScript, and the difference
       is only visible in the bytes. */
    expect(await isPdfInside(blob('%PDF-1.5\nrest of the file'))).toBe(true)
    expect(await isPdfInside(blob('%!PS-Adobe-3.0\nrest of the file'))).toBe(false)
    expect(await isPdfInside(blob(''))).toBe(false)
  })
})
