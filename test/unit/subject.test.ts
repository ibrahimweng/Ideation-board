import { beforeEach, describe, expect, it } from 'vitest'
import { store } from '../../src/state/store'
import { subject, subjectLabel, narrowed } from '../../src/state/subject'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* What "this board" means when Present, the poster and the PDF ask.
 *
 * Three actions used to answer this question three times, and all three
 * ignored the search box, so a board narrowed to four cards presented and
 * exported all thirty. One answer now, and this is it. */

const add = (p: Partial<Item>): Item =>
  store.add({
    id: p.id || `i${Math.random().toString(36).slice(2, 8)}`,
    kind: p.kind || 'image',
    x: 0, y: 0, w: 100, h: 100,
    fx: { ...FX_0 }, tag: null,
    ...p,
  } as Item)

const ids = () => subject().items.map((i) => i.id).sort()

beforeEach(() => {
  store.load({ id: 'b', name: 'test', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
  store.setQuery('')
  store.setTagFilter(null)
})

describe('with nothing picked out and nothing narrowed', () => {
  it('is the whole board', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    expect(ids()).toEqual(['a', 'b'])
    expect(subject().why).toBe('board')
    expect(subjectLabel(subject())).toBe('this board')
  })

  it('is nothing at all on an empty board', () => {
    expect(subject().items).toEqual([])
  })
})

describe('with a selection', () => {
  it('is the selection, once there is more than one thing in it', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    add({ id: 'c' })
    store.select(['a', 'c'])
    expect(ids()).toEqual(['a', 'c'])
    expect(subject().why).toBe('selection')
    expect(subjectLabel(subject())).toBe('the 2 selected')
  })

  /* One card is a card, not a board: every one of these actions already has a
   * single-card equivalent. */
  it('is still the whole board when only one thing is selected', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    store.select(['a'])
    expect(subject().why).toBe('board')
  })
})

describe('with a search running', () => {
  it('is what the search let through', () => {
    add({ id: 'a', name: 'kitchen.jpg' })
    add({ id: 'b', name: 'bathroom.jpg' })
    add({ id: 'c', name: 'kitchen-2.jpg' })
    store.setQuery('kitchen')
    expect(narrowed()).toBe(true)
    expect(ids()).toEqual(['a', 'c'])
    expect(subject().why).toBe('filter')
    expect(subjectLabel(subject())).toBe('the 2 shown')
  })

  it('says how much of the board it is', () => {
    add({ id: 'a', name: 'kitchen.jpg' })
    add({ id: 'b', name: 'bathroom.jpg' })
    store.setQuery('kitchen')
    expect(subject().total).toBe(2)
  })

  it('is narrowed by a tag on its own, with no words typed', () => {
    add({ id: 'a', tag: 'red' })
    add({ id: 'b', tag: 'blue' })
    store.setTagFilter('red')
    expect(narrowed()).toBe(true)
    expect(ids()).toEqual(['a'])
  })

  /* The decision is the thing worth narrowing to, and the reason all of this
   * exists: marking a board up and then not being able to act on the marks. */
  it('finds what was kept, and what was cut', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    add({ id: 'c' })
    store.setPick(['a', 'b'], 'in')
    store.setPick(['c'], 'out')
    store.setQuery('kept')
    expect(ids()).toEqual(['a', 'b'])
    store.setQuery('cut')
    expect(ids()).toEqual(['c'])
  })

  it('gives the board back rather than nothing when the search finds none', () => {
    add({ id: 'a' })
    store.setQuery('zzzznothing')
    expect(subject().why).toBe('board')
    expect(ids()).toEqual(['a'])
  })

  it('is beaten by a selection, which is the more deliberate of the two', () => {
    add({ id: 'a', name: 'kitchen.jpg' })
    add({ id: 'b', name: 'bathroom.jpg' })
    add({ id: 'c', name: 'kitchen-2.jpg' })
    store.setQuery('kitchen')
    store.select(['b', 'c'])
    expect(subject().why).toBe('selection')
    expect(ids()).toEqual(['b', 'c'])
  })
})

describe('the wires that come with it', () => {
  it('carries an arrow whose two ends are both in the set', () => {
    add({ id: 'a', name: 'kitchen one' })
    add({ id: 'b', name: 'kitchen two' })
    const wire = store.connect('a', 'b')!
    store.setQuery('kitchen')
    expect(ids()).toEqual(['a', 'b', wire].sort())
  })

  /* An arrow to something that is not on the sheet is a line into nowhere. */
  it('leaves behind one that points at something outside it', () => {
    add({ id: 'a', name: 'kitchen one' })
    add({ id: 'b', name: 'bathroom' })
    store.connect('a', 'b')
    store.setQuery('kitchen')
    expect(ids()).toEqual(['a'])
  })
})
