import { describe, expect, it } from 'vitest'
import { describeSweep, keysInUse } from '../../src/store/reclaim'
import type { Item } from '../../src/state/types'
import type { StoredBoard } from '../../src/store/idb'
import { FX_0 } from '../../src/engine/types'

/* Which files are still spoken for.
 *
 * Every mistake this function can make is a mistake in one direction: a name
 * left out is a picture deleted from under a card that still points at it, on
 * a board that may not even be open. There is no undo for that and this app
 * holds the only copy, so each of the ways a file can be referenced gets a
 * test of its own rather than being covered by one that happens to touch it. */

const card = (over: Partial<Item> = {}): Item => ({
  id: 'i' + Math.random().toString(36).slice(2, 7),
  kind: 'image', x: 0, y: 0, w: 10, h: 10, z: 0, fx: { ...FX_0 }, tag: null, ...over,
})
const board = (id: string, items: Item[]): StoredBoard => ({ id, name: id, items, updated: 0 })

describe('the files nothing points at', () => {
  it('keeps what a card on any board points at', () => {
    const used = keysInUse([board('a', [card({ media: 'img_1' })]), board('b', [card({ media: 'img_2' })])])
    expect(used.has('img_1')).toBe(true)
    expect(used.has('img_2')).toBe(true)
  })

  it('keeps a video first frame, which is named after the video', () => {
    /* Ingest writes it as `${key}:poster`. A sweep that only looked at `media`
     * would take the still every effected video card falls back to. */
    const used = keysInUse([board('a', [card({ kind: 'video', media: 'vid_1', poster: 'vid_1:poster' })])])
    expect(used.has('vid_1')).toBe(true)
    expect(used.has('vid_1:poster')).toBe(true)
  })

  it('keeps the derived poster name even on a record that never wrote one down', () => {
    /* Boards saved before posters were named on the item. The name is derived
     * rather than read, so an older record cannot lose its still. */
    const used = keysInUse([board('a', [card({ kind: 'video', media: 'vid_2' })])])
    expect(used.has('vid_2:poster')).toBe(true)
  })

  it('keeps what the board on screen points at, which may not be on disk yet', () => {
    /* The open board is saved after a pause. Between a drop and that save, the
     * only thing that knows about the picture is the live store. */
    const used = keysInUse([], [card({ media: 'img_live' })])
    expect(used.has('img_live')).toBe(true)
  })

  it('keeps what was taken away with Cut and not yet put down', () => {
    /* Cut cards are on no board at all — that is what cutting means — and are
     * about to be put on another one. */
    const used = keysInUse([board('a', [])], [], [card({ media: 'img_held' })])
    expect(used.has('img_held')).toBe(true)
  })

  it('keeps a file two cards share, wherever the two are', () => {
    /* Duplicating, pasting and importing all point a new card at the same
     * file. This is why nothing is deleted when a card is: the other card may
     * be on a board nobody has open. */
    const used = keysInUse([
      board('a', [card({ media: 'shared' })]),
      board('b', [card({ media: 'shared' })]),
    ])
    expect(used.has('shared')).toBe(true)
    expect(used.size).toBe(2)
  })

  it('says nothing about a file no card mentions', () => {
    const used = keysInUse([board('a', [card({ media: 'kept' })])])
    expect(used.has('gone')).toBe(false)
  })

  it('is not confused by a card with no picture at all', () => {
    const used = keysInUse([board('a', [card({ kind: 'note', text: 'hello' }), card({ kind: 'label' })])])
    expect(used.size).toBe(0)
  })

  it('copes with a board record that has no items', () => {
    expect(() => keysInUse([{ id: 'x', name: 'x', updated: 0, items: [] }])).not.toThrow()
    expect(keysInUse([{ id: 'x', name: 'x', updated: 0 } as StoredBoard]).size).toBe(0)
  })
})

describe('saying what was cleared', () => {
  it('counts in the units a person reads', () => {
    expect(describeSweep({ files: 1, bytes: 2048, young: 0 })).toBe('Cleared 1 file, 2KB')
    expect(describeSweep({ files: 3, bytes: 5.5 * 1024 * 1024, young: 0 })).toBe('Cleared 3 files, 5.5MB')
    expect(describeSweep({ files: 40, bytes: 82 * 1024 * 1024, young: 0 })).toBe('Cleared 40 files, 82MB')
  })

  it('does not claim to have done something when it did not', () => {
    expect(describeSweep({ files: 0, bytes: 0, young: 0 })).toBe('Nothing to clear up')
  })

  it('says "yet" when something was only held back for being new', () => {
    /* A drop deleted within the minute is reclaimed on the next sweep, not
     * this one. Saying "nothing to clear up" there would be a lie somebody
     * would notice. */
    expect(describeSweep({ files: 0, bytes: 0, young: 3 })).toBe('Nothing to clear up yet')
  })
})
