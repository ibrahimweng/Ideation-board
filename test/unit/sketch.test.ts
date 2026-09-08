import { describe, expect, it } from 'vitest'
import { SHELF, starter } from '../../src/state/sketches'
import { SIZE, sizeFor } from '../../src/store/sketch'

/* The shelf is the offer.
 *
 * A blank editor is a worse offer than no editor, so a card opens with
 * something on it and seven more are a click away. Which means a starter with
 * a typo in it is not a small mistake: it is the first thing somebody sees,
 * and they have no way to know the fault is ours rather than theirs.
 *
 * The browser suite runs one of them. This runs all of them, in a second, by
 * building each into the same shape the worker builds it into — which is where
 * a stray bracket shows up.
 */

describe('the shelf', () => {
  it('has something on it', () => {
    expect(SHELF.length).toBeGreaterThanOrEqual(8)
  })

  it('each with a name and an address of its own', () => {
    const ids = new Set(SHELF.map((s) => s.id))
    expect(ids.size).toBe(SHELF.length)
    for (const s of SHELF) {
      expect(s.name.length, s.id).toBeGreaterThan(2)
      expect(s.code.length, s.id).toBeGreaterThan(60)
    }
  })

  /* The worker wraps the code in exactly this, so anything that will not build
     here will not run there. */
  it('and every one of them builds', () => {
    for (const s of SHELF) {
      expect(
        () => new Function('ctx', 'w', 'h', 'rand', 'img', 'seed', s.code),
        `${s.id} does not build`
      ).not.toThrow()
    }
  })

  it('says what it draws with, so the first line is not a mystery', () => {
    for (const s of SHELF) expect(s.code, s.id).toContain('ctx.')
  })

  /* A sketch handed a card to read has to cope with there being no card: the
     wire is drawn after the fact, and a starter that threw until one existed
     would look broken on the way in. */
  it('and the one that reads another card copes with there being none', () => {
    const reads = SHELF.filter((s) => /\bimg\b/.test(s.code))
    expect(reads.length).toBeGreaterThan(0)
    for (const s of reads) expect(s.code, s.id).toMatch(/if\s*\(\s*!?\s*img/)
  })

  it('falls back to the first one when asked for a name nothing has', () => {
    expect(starter('flow').id).toBe('flow')
    expect(starter('nothing-is-called-this').id).toBe(SHELF[0].id)
  })
})

describe('the shape it is drawn at', () => {
  it('puts the long side at the size everything else decodes to', () => {
    expect(sizeFor(400, 400)).toEqual({ w: SIZE, h: SIZE })
    expect(sizeFor(800, 400)).toEqual({ w: SIZE, h: SIZE / 2 })
    expect(sizeFor(300, 600)).toEqual({ w: SIZE / 2, h: SIZE })
  })

  /* A card dragged down to nothing is still a card, and a canvas of zero
     pixels is a picture nothing can be made of. */
  it('and never draws at nothing', () => {
    const tiny = sizeFor(1, 400)
    expect(tiny.w).toBeGreaterThanOrEqual(16)
    expect(tiny.h).toBe(SIZE)
  })
})
