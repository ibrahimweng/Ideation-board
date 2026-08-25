import { describe, expect, it } from 'vitest'
import { findInTree, labelOf, MAX_FOUND } from '../../src/state/deep'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* Finding what is inside the boards you are not looking at.
 *
 * A board card holds a whole board and opening one loads only that record,
 * which is what makes nesting free — and what made everything filed invisible
 * to the box that exists to find things. */

const item = (p: Partial<Item>): Item => ({
  id: p.id || `i${Math.random().toString(36).slice(2, 8)}`,
  kind: p.kind || 'note',
  x: 0, y: 0, w: 100, h: 100, z: 0,
  fx: { ...FX_0 }, tag: null,
  ...p,
} as Item)

const node = (name: string, items: Item[], depth = 1) => ({
  path: Array.from({ length: depth }, (_, i) => ({ id: `b${i}`, name: i === depth - 1 ? name : `up${i}` })),
  items,
})

describe('searching the boards below this one', () => {
  it('finds nothing when nothing was asked for', () => {
    expect(findInTree([node('Kitchen', [item({ text: 'tiles' })])], '', null)).toEqual([])
  })

  it('finds a card by a word in it', () => {
    const found = findInTree([node('Kitchen', [item({ id: 'a', text: 'zellige tiles' })])], 'zellige', null)
    expect(found.map((f) => f.item.id)).toEqual(['a'])
  })

  /* The point of the whole thing: which board it is in, so the list can say. */
  it('says which board it is in', () => {
    const found = findInTree([node('Kitchen', [item({ text: 'tiles' })])], 'tiles', null)
    expect(found[0].where).toBe('Kitchen')
    expect(found[0].path[found[0].path.length - 1].name).toBe('Kitchen')
  })

  it('carries the whole way back, not just the last step', () => {
    const found = findInTree([node('Kitchen', [item({ text: 'tiles' })], 3)], 'tiles', null)
    expect(found[0].path).toHaveLength(3)
  })

  it('searches every board it was given', () => {
    const found = findInTree(
      [node('Kitchen', [item({ id: 'a', text: 'blue tiles' })]), node('Bathroom', [item({ id: 'b', text: 'blue paint' })])],
      'blue',
      null
    )
    expect(found.map((f) => f.item.id).sort()).toEqual(['a', 'b'])
  })

  it('takes every word, in any order, the way the board itself does', () => {
    const nodes = [node('Kitchen', [item({ id: 'a', text: 'blue zellige tiles' }), item({ id: 'b', text: 'blue paint' })])]
    expect(findInTree(nodes, 'tiles blue', null).map((f) => f.item.id)).toEqual(['a'])
  })

  it('takes a tag on its own, with no words typed', () => {
    const nodes = [node('Kitchen', [item({ id: 'a', tag: 'red' }), item({ id: 'b', tag: 'blue' })])]
    expect(findInTree(nodes, '', 'red').map((f) => f.item.id)).toEqual(['a'])
  })

  it('finds what was kept in a board you are not on', () => {
    const nodes = [node('Kitchen', [item({ id: 'a', pick: 'in' }), item({ id: 'b', pick: 'out' })])]
    expect(findInTree(nodes, 'kept', null).map((f) => f.item.id)).toEqual(['a'])
  })

  /* Past this a list of results is a second board, not a list. */
  it('stops rather than returning a whole tree', () => {
    const many = Array.from({ length: MAX_FOUND + 20 }, (_, i) => item({ id: `i${i}`, text: 'tiles' }))
    expect(findInTree([node('Kitchen', many)], 'tiles', null)).toHaveLength(MAX_FOUND)
  })
})

describe('what a card is called in a list where you cannot see it', () => {
  /* Every note is called "Note", so a list named that way is one word, twelve
   * times over. */
  it('calls a note by what it says', () => {
    expect(labelOf(item({ kind: 'note', name: 'Note', text: 'zellige tiles\nand a second line' }))).toBe('zellige tiles')
  })

  it('and strips the marks off a heading', () => {
    expect(labelOf(item({ kind: 'note', name: 'Note', text: '## Kitchen' }))).toBe('Kitchen')
  })

  it('calls a picture by its file name, which is the only text it has', () => {
    expect(labelOf(item({ kind: 'image', name: 'zellige.jpg' }))).toBe('zellige.jpg')
  })

  it('falls back to the address of a link', () => {
    expect(labelOf(item({ kind: 'link', name: '', url: 'https://example.com/a' }))).toBe('https://example.com/a')
  })

  it('and to what kind of thing it is, rather than to nothing', () => {
    expect(labelOf(item({ kind: 'file', name: '' }))).toBe('file')
  })

  it('never returns something too long to put in a row', () => {
    expect(labelOf(item({ kind: 'note', text: 'x'.repeat(200) })).length).toBeLessThanOrEqual(60)
  })
})
