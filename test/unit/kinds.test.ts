import { describe, expect, it } from 'vitest'
import { canShade, endsOf, hasPixels, hasWords, holdsMedia, isGradeable, isSection, isThing, isWire, TRAITS, wordsField } from '../../src/state/kinds'
import type { Item, Kind } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'

/* The table is the one place a new kind of card is described. These check that
 * it stays a description rather than drifting into a list of exceptions. */

const KINDS: Kind[] = ['image', 'video', 'audio', 'note', 'link', 'file', 'label', 'section', 'embed', 'board', 'edge']
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
