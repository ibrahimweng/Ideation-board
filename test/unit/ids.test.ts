import { describe, expect, it } from 'vitest'
import { POINTS_AT, repoint } from '../../src/state/ids'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* The fields on a card that hold another card.
 *
 * Three things copy cards — an imported board, a duplicated selection, a
 * cloned board — and each used to write out its own list of which fields to
 * fix. The lists disagreed, and they disagreed quietly: a cloned board kept
 * every wire's original ends, so a duplicated board came back with its
 * connections gone and nothing said so.
 *
 * These are about the shared list, which is the only thing that stops that
 * happening again to a field added later.
 */

const card = (extra: Partial<Item> = {}): Item =>
  ({ id: 'a', kind: 'image', x: 0, y: 0, w: 10, h: 10, z: 0, fx: { ...FX_0 }, tag: null, ...extra } as Item)

const swap = (m: Record<string, string>) => (id: string) => m[id]

describe('what a card can point at', () => {
  it('names every field, and only fields', () => {
    expect([...POINTS_AT].sort()).toEqual(['depthOf', 'from', 'parent', 'to'])
  })

  /* A board id is not a card id. It comes from a different map and the one
     caller that has one rewrites it itself. */
  it('and not the board a board card opens', () => {
    expect(POINTS_AT).not.toContain('board')
  })
})

describe('putting a copy through the new ids', () => {
  it('follows a wire by both of its ends', () => {
    const wire = card({ kind: 'edge', from: 'a', to: 'b' })
    const out = repoint(wire, swap({ a: 'a2', b: 'b2' }))
    expect(out.from).toBe('a2')
    expect(out.to).toBe('b2')
  })

  it('and a card into the section it sits in', () => {
    expect(repoint(card({ parent: 's' }), swap({ s: 's2' })).parent).toBe('s2')
  })

  it('and a depth map at the picture it was made from', () => {
    expect(repoint(card({ depthOf: 'p' }), swap({ p: 'p2' })).depthOf).toBe('p2')
  })

  /* The case each caller relies on: something outside the set being copied is
     still a real card, and a half-copied wire that lost its other end would be
     worse than one that reaches back across. */
  it('and leaves an id it was not given alone', () => {
    const out = repoint(card({ kind: 'edge', from: 'a', to: 'elsewhere' }), swap({ a: 'a2' }))
    expect(out.from).toBe('a2')
    expect(out.to).toBe('elsewhere')
  })

  it('and leaves a card that points at nothing alone', () => {
    const plain = card()
    const out = repoint(plain, swap({ a: 'a2' }))
    expect(out.from).toBeUndefined()
    expect(out.parent).toBeUndefined()
    expect(out.depthOf).toBeUndefined()
  })

  it('and never writes on the card it was given', () => {
    const wire = card({ kind: 'edge', from: 'a', to: 'b' })
    repoint(wire, swap({ a: 'a2', b: 'b2' }))
    expect(wire.from).toBe('a')
    expect(wire.to).toBe('b')
  })

  it('and carries everything else across untouched', () => {
    const it = card({ name: 'Shell', depthOf: 'p', peaks: [1, 2, 3] })
    const out = repoint(it, swap({ p: 'p2' }))
    expect(out.name).toBe('Shell')
    expect(out.peaks).toEqual([1, 2, 3])
    expect(out.kind).toBe('image')
  })

  /* A section holding a card that is not being copied keeps pointing at it,
     and null stays null rather than becoming a string. */
  it('and a card on the ground is still on the ground', () => {
    expect(repoint(card({ parent: null }), swap({ a: 'a2' })).parent).toBeNull()
  })
})
