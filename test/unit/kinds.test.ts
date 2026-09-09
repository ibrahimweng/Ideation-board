import { describe, expect, it } from 'vitest'
import { canShade, endsOf, hasPixels, hasWords, holdsMedia, isGradeable, isSection, isThing, isWire, TRAITS, wordsField, pixelKey, isKnownKind, traitsOf } from '../../src/state/kinds'
import type { Item, Kind } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'

/* The table is the one place a new kind of card is described. These check that
 * it stays a description rather than drifting into a list of exceptions. */

const KINDS: Kind[] = ['image', 'video', 'audio', 'note', 'link', 'file', 'label', 'section', 'embed', 'board', 'pdf', 'design', 'model', 'sketch', 'edge']
const of = (kind: Kind, extra: Partial<Item> = {}): Item =>
  ({ id: 'i', kind, x: 0, y: 0, z: 0, w: 10, h: 10, fx: { ...FX_0 }, tag: null, ...extra } as Item)

describe('the table', () => {
  it('describes every kind there is, and nothing that is not one', () => {
    expect(Object.keys(TRAITS).sort()).toEqual([...KINDS].sort())
  })

  it('gives anything with readable pixels a look to wear', () => {
    for (const k of KINDS) {
      if (TRAITS[k].pixels) expect(TRAITS[k].graded, k).toBe(true)
    }
  })

  it('keeps the ground and the lines out of the boxes', () => {
    expect(TRAITS.section.thing).toBe(false)
    expect(TRAITS.edge.thing).toBe(false)
    for (const k of KINDS) {
      if (!TRAITS[k].thing) expect(TRAITS[k].graded, k).toBe(false)
    }
  })

  it('gives a look only to something with a box to put it on', () => {
    for (const k of KINDS) {
      if (TRAITS[k].graded) expect(TRAITS[k].thing, k).toBe(true)
    }
  })
})

describe('the questions', () => {
  it('answers no for something that is not there, rather than throwing', () => {
    for (const q of [isThing, hasPixels, isGradeable, holdsMedia, hasWords, isSection, isWire, canShade]) {
      expect(q(null)).toBe(false)
      expect(q(undefined)).toBe(false)
    }
  })

  it('knows what has pixels this side can read', () => {
    expect(hasPixels(of('image'))).toBe(true)
    expect(hasPixels(of('video'))).toBe(true)
    /* The player's pixels belong to the provider. */
    expect(hasPixels(of('embed'))).toBe(false)
    expect(hasPixels(of('note'))).toBe(false)
  })

  it('knows what can wear a look, which is wider', () => {
    expect(isGradeable(of('embed'))).toBe(true)
    expect(isGradeable(of('note'))).toBe(false)
    expect(isGradeable(of('section'))).toBe(false)
  })

  it('will not shade a video whose host refuses to hand the pixels over', () => {
    expect(canShade(of('video'))).toBe(true)
    expect(canShade(of('video', { readable: true }))).toBe(true)
    expect(canShade(of('video', { readable: false }))).toBe(false)
  })

  it('counts the cards and leaves out the ground and the lines', () => {
    const board = KINDS.map((k) => of(k))
    expect(board.filter(isThing).map((i) => i.kind)).not.toContain('section')
    expect(board.filter(isThing).map((i) => i.kind)).not.toContain('edge')
    expect(board.filter(isThing)).toHaveLength(KINDS.length - 2)
  })

  it('names the two ends of a wire, and nothing else’s', () => {
    expect(endsOf(of('edge', { from: 'a', to: 'b' }))).toEqual(['a', 'b'])
    expect(endsOf(of('edge'))).toBeNull()
    expect(endsOf(of('image', { from: 'a', to: 'b' }))).toBeNull()
  })
})

describe('where a kind keeps its words', () => {
  const of = (kind: Kind): Item => ({
    id: 'x', kind, x: 0, y: 0, w: 10, h: 10, z: 0, fx: { ...FX_0 }, tag: null,
  })

  it('puts a note and a label in text', () => {
    expect(wordsField(of('note'))).toBe('text')
    expect(wordsField(of('label'))).toBe('text')
  })

  it('names a section instead', () => {
    /* The one kind where this differs from hasWords, and the reason the two
     * questions are asked separately: a section's words are its title, written
     * across the top of it, and `text` is not what draws that. */
    expect(hasWords(of('section'))).toBe(true)
    expect(wordsField(of('section'))).toBe('name')
  })

  it('names everything that has no words of its own', () => {
    expect(wordsField(of('image'))).toBe('name')
    expect(wordsField(of('board'))).toBe('name')
    expect(wordsField(of('link'))).toBe('name')
  })

  it('names nothing at all rather than throwing', () => {
    expect(wordsField(undefined)).toBe('name')
  })
})

/* ---------------------------------------------------------------------------
 * Where a card's pixels are.
 *
 * Most cards keep them under `media`, because the file is the picture. The two
 * whose file is not itself an image keep a rendered still beside it. Three
 * places used to ask this with the same ternary written out by hand, and a
 * third kind was exactly the sort of thing that gets missed in two of them.
 * ------------------------------------------------------------------------- */
describe('pixelKey', () => {
  it('is the file itself for a picture', () => {
    expect(pixelKey(of('image', { media: 'm1' }))).toBe('m1')
  })

  it('is the still beside it for the ones whose file is not a picture', () => {
    expect(pixelKey(of('video', { media: 'v1', poster: 'p1' }))).toBe('p1')
    expect(pixelKey(of('pdf', { media: 'd1', poster: 'p2' }))).toBe('p2')
    expect(pixelKey(of('design', { media: 'd2', poster: 'p3' }))).toBe('p3')
    expect(pixelKey(of('model', { media: 'g1', poster: 'p4' }))).toBe('p4')
    /* A sketch has no file of its own at all: the code is on the card and the
       picture it drew is beside it. */
    expect(pixelKey(of('sketch', { poster: 'p5' }))).toBe('p5')
  })

  it('is nothing when there is nothing', () => {
    expect(pixelKey(undefined)).toBeUndefined()
    expect(pixelKey(null)).toBeUndefined()
    expect(pixelKey(of('note'))).toBeUndefined()
    expect(pixelKey(of('video', { media: 'v1' }))).toBeUndefined()
  })

  it('answers for every kind that claims to have pixels', () => {
    /* If a kind says it has pixels, something has to be able to say where they
       are, or the export and the palette both quietly get nothing. */
    for (const k of KINDS) {
      if (!TRAITS[k].pixels) continue
      const item = of(k, { media: 'm', poster: 'p' })
      expect(pixelKey(item), k).toBeTruthy()
    }
  })
})

describe('a document', () => {
  it('is a card with pixels, and can wear a look like any other', () => {
    expect(TRAITS.pdf.thing).toBe(true)
    expect(TRAITS.pdf.pixels).toBe(true)
    expect(TRAITS.pdf.graded).toBe(true)
  })

  it('holds a file, so a copy carries it and a delete takes it away', () => {
    expect(TRAITS.pdf.media).toBe(true)
  })

  it('has no words of its own for the search to read', () => {
    /* The words are inside the document, not typed onto the card. Saying it
       has them would have the search looking in a field that is always empty. */
    expect(TRAITS.pdf.words).toBe(false)
  })
})

describe('a design file', () => {
  it('is the same shape as a document: a card with pixels that can wear a look', () => {
    expect(TRAITS.design.thing).toBe(true)
    expect(TRAITS.design.pixels).toBe(true)
    expect(TRAITS.design.graded).toBe(true)
    expect(TRAITS.design.media).toBe(true)
  })

  it('has no words of its own', () => {
    /* Whatever type is set inside a Photoshop document is inside the picture,
       not typed onto the card. */
    expect(TRAITS.design.words).toBe(false)
  })
})

/* A kind this build has never heard of.
 *
 * The table is written so that adding a kind is adding a row — but reading a
 * row that is not there was fatal, and the ways it happens are ordinary: a
 * second tab running a newer deploy, a `.board.zip` exported by one. Every
 * question below used to throw on such a card, and throwing during a render
 * takes the whole app down, which on an app holding the only copy of somebody's
 * work is the worst thing it can do.
 *
 * The answers are chosen so that nothing is lost and nothing is guessed: it is
 * a box, so it can be moved out of the way and deleted; it holds a file, so
 * nothing goes hunting for one to collect; and everything that would need to
 * understand it says no.
 */
describe('a card from a later build', () => {
  const ahead = { ...of('image', { name: 'From a later build' }), kind: 'hologram' } as unknown as Item

  it('is a thing on the board, so it can be moved and deleted', () => {
    expect(isThing(ahead)).toBe(true)
  })

  it('and is said to hold a file, so nothing sweeps one away under it', () => {
    expect(holdsMedia(ahead)).toBe(true)
  })

  it('but claims nothing this build would have to understand', () => {
    expect(hasPixels(ahead)).toBe(false)
    expect(isGradeable(ahead)).toBe(false)
    expect(hasWords(ahead)).toBe(false)
  })

  it('and none of the questions throw, which is the whole of it', () => {
    for (const ask of [isThing, hasPixels, isGradeable, holdsMedia, hasWords]) {
      expect(() => ask(ahead)).not.toThrow()
    }
  })

  it('says plainly that it is not a kind this build knows', () => {
    expect(isKnownKind('hologram')).toBe(false)
    expect(isKnownKind('image')).toBe(true)
    expect(isKnownKind('')).toBe(false)
    expect(isKnownKind(undefined)).toBe(false)
  })

  /* The table itself still answers for everything it does know, which is what
     says the fallback has not quietly become the answer for everyone. */
  it('and every kind this build does know still answers from its own row', () => {
    expect(traitsOf('image').pixels).toBe(true)
    expect(traitsOf('note').words).toBe(true)
    expect(traitsOf('section').thing).toBe(false)
    expect(traitsOf('edge').thing).toBe(false)
  })
})
