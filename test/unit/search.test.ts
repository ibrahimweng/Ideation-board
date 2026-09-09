import { describe, expect, it } from 'vitest'
import { matches, parseQuery } from '../../src/state/search'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* What a search is allowed to find.
 *
 * The board this app is for fills up with cards that have the same name as
 * eleven other cards: twelve variations of one sound, forty drawings all
 * called Sketch, a grid of one photograph treated twelve ways. Searching the
 * label alone is searching the one field they all agree on, which means "the
 * one with the gate" has no answer exactly where it is most needed.
 *
 * These are about the other half — the making — and about the half that was
 * already right not having broken.
 */

const card = (extra: Partial<Item> = {}): Item =>
  ({ id: 'c', kind: 'image', x: 0, y: 0, w: 10, h: 10, z: 0, fx: { ...FX_0 }, tag: null, ...extra } as Item)

const finds = (it: Item, q: string) => matches(it, parseQuery(q))

describe('what was always searched', () => {
  const note = card({ kind: 'note', name: 'Swatches', text: 'warm terracotta', tag: 'red', pick: 'in' })

  it('finds a card by its words, its name, its kind and its tag', () => {
    expect(finds(note, 'terracotta')).toBe(true)
    expect(finds(note, 'swatches')).toBe(true)
    expect(finds(note, 'note')).toBe(true)
    expect(finds(note, 'red')).toBe(true)
  })

  it('and by the mark on it, in the words on the mark', () => {
    expect(finds(note, 'kept')).toBe(true)
    expect(finds(card({ pick: 'out' }), 'cut')).toBe(true)
    expect(finds(note, 'cut')).toBe(false)
  })

  it('needs every word, in any order', () => {
    expect(finds(note, 'warm swatches')).toBe(true)
    expect(finds(note, 'swatches warm')).toBe(true)
    expect(finds(note, 'warm zellige')).toBe(false)
  })

  it('and an empty search is not a filter', () => {
    expect(finds(note, '   ')).toBe(true)
  })
})

describe('what a card is made of', () => {
  /* Twelve variations of one photograph are twelve cards with one name. What
     tells them apart is the effect on each. */
  it('finds a picture by the effect it is running', () => {
    const shot = card({ name: 'DSC_4471.jpg', fx: { ...FX_0, fxid: 'halftone' } })
    expect(finds(shot, 'halftone')).toBe(true)
    expect(finds(shot, 'kaleidoscope')).toBe(false)
  })

  it('and by any of the ones stacked after it, not only the first', () => {
    const shot = card({
      name: 'DSC_4471.jpg',
      fx: { ...FX_0, fxid: 'halftone', more: [{ fxid: 'bloom', ep: null }] },
    })
    expect(finds(shot, 'bloom')).toBe(true)
    expect(finds(shot, 'halftone bloom')).toBe(true)
  })

  it('and a card with no effect is not found by one', () => {
    expect(finds(card({ name: 'DSC_4471.jpg' }), 'halftone')).toBe(false)
  })

  /* By the name on the panel, which is the only name anybody has for it. Most
     effects are called what their id says; these two are not, so they are the
     ones that tell a real lookup from the id being matched by accident. */
  it('by the name the panel gives it rather than by its id', () => {
    expect(finds(card({ fx: { ...FX_0, fxid: 'edges' } }), 'contour')).toBe(true)
    expect(finds(card({ fx: { ...FX_0, fxid: 'gaussian' } }), 'soft blur')).toBe(true)
  })

  it('and a sound by the name of what it was run through', () => {
    const w = card({ kind: 'audio', chain: [{ fxid: 'wobble', ep: null }] })
    expect(finds(w, 'wow and flutter')).toBe(true)
    expect(finds(w, 'flutter')).toBe(true)
  })

  /* The case the whole thing is for: a grid of sounds, one name between them. */
  it('finds a sound by what it is run through', () => {
    const one = card({ kind: 'audio', name: 'room.wav', chain: [{ fxid: 'gate', ep: null }] })
    const two = card({ kind: 'audio', name: 'room.wav', chain: [{ fxid: 'reverb', ep: null }] })
    expect(finds(one, 'gate')).toBe(true)
    expect(finds(two, 'gate')).toBe(false)
    expect(finds(two, 'reverb')).toBe(true)
  })

  it('and by every effect in the chain, not just the first', () => {
    const both = card({ kind: 'audio', chain: [{ fxid: 'gate', ep: null }, { fxid: 'reverb', ep: null }] })
    expect(finds(both, 'gate reverb')).toBe(true)
  })

  /* A sketch is called Sketch. The hundred lines are the only thing that makes
     it that sketch. */
  it('finds a sketch by the code it draws with', () => {
    const s = card({ kind: 'sketch', name: 'Sketch', code: 'const k = 0.002 // a field of angles' })
    expect(finds(s, 'angles')).toBe(true)
    expect(finds(s, 'field')).toBe(true)
    expect(finds(s, 'lattice')).toBe(false)
  })

  /* Materials are the vocabulary somebody working in 3D actually has for a
     file, and the board reads them off it already. */
  it('finds a model by its materials and by what they are textured with', () => {
    const m = card({
      kind: 'model',
      name: 'lockup.glb',
      parts: [
        { name: 'Shell', maps: ['colour', 'normal'], uv: [0], tint: '#cccccc' },
        { name: 'Trim', maps: [], uv: [0], tint: '#888888' },
      ],
    })
    expect(finds(m, 'shell')).toBe(true)
    expect(finds(m, 'trim')).toBe(true)
    expect(finds(m, 'normal')).toBe(true)
    expect(finds(m, 'roughness')).toBe(false)
  })

  /* An id nobody chose is not a word anybody would type, but it should still
     find its card rather than throw. */
  it('and an effect the app no longer has is found by its id rather than lost', () => {
    const gone = card({ fx: { ...FX_0, fxid: 'no-such-effect' } })
    expect(finds(gone, 'no-such-effect')).toBe(true)
  })

  it('and a card with none of any of it is left alone', () => {
    const bare = card({ kind: 'label', name: 'Section one' })
    expect(finds(bare, 'section one')).toBe(true)
    expect(finds(bare, 'halftone')).toBe(false)
  })
})

/* Built once per card rather than once per render.
 *
 * The board asks `passes` about every card on every render while the search
 * box has anything in it, and since a sketch's whole source went into the
 * haystack there is no bound on what that costs. The answer is a cache keyed
 * on the item object, which is sound because every change in the store
 * replaces that object rather than editing it.
 *
 * That rule is what these check, from both sides: a card that has not been
 * replaced is not rebuilt, and a card that has been replaced is. The first is
 * asserted by editing an item in place — something the app never does, and the
 * only way from outside the module to tell a cached answer from a fresh one.
 */
describe('the haystack is built once per card', () => {
  it('does not rebuild for the same item object', () => {
    const it0 = card({ kind: 'note', name: 'Flow field' })
    expect(finds(it0, 'flow')).toBe(true)

    ;(it0 as { name?: string }).name = 'Something else'
    expect(finds(it0, 'flow')).toBe(true)
    expect(finds(it0, 'something')).toBe(false)
  })

  it('and a replaced item is a different card, so it is read again', () => {
    const before = card({ kind: 'note', name: 'Flow field' })
    expect(finds(before, 'flow')).toBe(true)

    const after = { ...before, name: 'Contour study' }
    expect(finds(after, 'flow')).toBe(false)
    expect(finds(after, 'contour')).toBe(true)
  })

  it('and two cards are never handed each other answers', () => {
    const a = card({ id: 'a', kind: 'note', name: 'Halftone' })
    const b = card({ id: 'b', kind: 'note', name: 'Duotone' })
    expect(finds(a, 'halftone')).toBe(true)
    expect(finds(b, 'halftone')).toBe(false)
    expect(finds(b, 'duotone')).toBe(true)
  })
})
