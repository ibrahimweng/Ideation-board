import { describe, expect, it } from 'vitest'
import { FIRST_BOARD, rootsOf, tabOrder } from '../../src/state/roots'
import type { Root } from '../../src/state/roots'
import type { Item } from '../../src/state/types'
import type { StoredBoard } from '../../src/store/idb'
import { FX_0 } from '../../src/engine/types'

/* Which boards are projects, and what order their tabs sit in.
 *
 * Both rules are quiet when they are wrong. A board wrongly counted as nested
 * is a project missing from the row while its work is still on disk; an order
 * that is not stable is a row where the tab you want has moved since the last
 * time you looked. Neither shows up as an error and neither is visible in a
 * screenshot, so they are pinned here rather than left to the browser suite.
 */

const boardCard = (to: string): Item => ({
  id: 'i' + to, kind: 'board', board: to, x: 0, y: 0, w: 10, h: 10, z: 0,
  fx: { ...FX_0 }, tag: null,
})
const note = (): Item => ({
  id: 'i' + Math.random().toString(36).slice(2, 7), kind: 'note',
  x: 0, y: 0, w: 10, h: 10, z: 0, fx: { ...FX_0 }, tag: null,
})
const board = (id: string, over: Partial<StoredBoard> = {}): StoredBoard =>
  ({ id, name: id, items: [], updated: 0, ...over })

const ids = (rs: Root[]) => rs.map((r) => r.id)

describe('which boards are projects', () => {
  it('counts a board nothing points at', () => {
    expect(ids(rootsOf([board('a'), board('b')])).sort()).toEqual(['a', 'b'])
  })

  it('does not count one that a board card opens', () => {
    const all = [board('a', { items: [boardCard('b')] }), board('b')]
    expect(ids(rootsOf(all))).toEqual(['a'])
  })

  it('counts a board again once the card that opened it is gone', () => {
    /* The property the derived list is for: deleting the card that stood for a
       nested board turns that board into a project rather than a record
       nothing can reach. Work is never lost quietly; at worst it turns up
       somewhere unexpected. */
    const all = [board('a'), board('b')]
    expect(ids(rootsOf(all)).sort()).toEqual(['a', 'b'])
  })

  it('survives a board card pointing at something above it', () => {
    const all = [board('a', { items: [boardCard('b')] }), board('b', { items: [boardCard('a')] })]
    /* Both are nested, so neither is a project — and the empty case stands the
       original board in rather than leaving a row with nothing in it. */
    expect(ids(rootsOf(all))).toEqual([FIRST_BOARD])
  })

  it('stands the original board in when there is nothing at all', () => {
    expect(ids(rootsOf([]))).toEqual([FIRST_BOARD])
  })

  it('does not resurrect the original board once there is a project without it', () => {
    /* Closing a tab deletes the project. Offering the first board back
       whenever it was missing meant the one project you deliberately deleted
       reappeared in the row a second later. */
    expect(ids(rootsOf([board('b_kept')]))).toEqual(['b_kept'])
  })

  it('says how much each one is holding', () => {
    const [only] = rootsOf([board('a', { items: [note(), note(), note()] })])
    expect(only.cards).toBe(3)
  })

  it('names an unnamed board rather than offering a blank tab', () => {
    expect(rootsOf([board('a', { name: '' })])[0].name).toBe('Untitled board')
  })

  it('offers the most recently touched first, for whoever has to pick one', () => {
    /* Not the tab order — this is the answer to "you just closed the project
       you were in, where do you go now". */
    const all = [board('old', { updated: 1 }), board('new', { updated: 9 }), board('mid', { updated: 5 })]
    expect(ids(rootsOf(all))).toEqual(['new', 'mid', 'old'])
  })
})

describe('the order of the row', () => {
  const at = (id: string, created: number): Root => ({ id, name: id, cards: 0, updated: 0, created })

  it('puts a new project on the right and moves nothing already there', () => {
    const row = [at('a', 100), at('b', 200)]
    expect(ids(tabOrder([...row, at('c', 300)]))).toEqual(['a', 'b', 'c'])
  })

  it('does not rearrange when a project is worked on', () => {
    /* The one thing the row must never do. `updated` differs wildly here and
       changes nothing. */
    const row = [
      { ...at('a', 100), updated: 999 },
      { ...at('b', 200), updated: 1 },
      { ...at('c', 300), updated: 500 },
    ]
    expect(ids(tabOrder(row))).toEqual(['a', 'b', 'c'])
  })

  it('does not care what order it is handed them in', () => {
    const row = [at('c', 300), at('a', 100), at('b', 200)]
    expect(ids(tabOrder(row))).toEqual(['a', 'b', 'c'])
  })

  it('leaves the list it was given alone', () => {
    const row = [at('c', 300), at('a', 100)]
    tabOrder(row)
    expect(ids(row)).toEqual(['c', 'a'])
  })

  it('holds boards made before there was a birthday on the left, in a fixed order', () => {
    /* Arbitrary, but the same arbitrary every time — which is the only
       property that matters for a row you have to be able to learn. */
    const row = [at('new', 500), at('z_old', 0), at('a_old', 0)]
    expect(ids(tabOrder(row))).toEqual(['a_old', 'z_old', 'new'])
    expect(ids(tabOrder([...row].reverse()))).toEqual(['a_old', 'z_old', 'new'])
  })
})
