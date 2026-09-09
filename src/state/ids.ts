import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * The fields on a card that hold another card.
 *
 * Three things here copy cards and have to rewrite the ids inside them: an
 * imported board, a duplicated selection, and a cloned board. Each one wrote
 * out its own list of which fields to fix, and the three lists disagreed.
 *
 * They disagreed quietly, which is the point. Cloning a board rewrote `parent`
 * and nothing else, so every wire in a duplicated board pointed at cards on
 * the board it was copied from — and a wire whose ends are not there is not
 * drawn and is not read, so a copied board came back with its connections
 * silently gone. On a board where a wire is only an annotation that is a
 * blemish; on this one it is the thing Displace, Stencil, the depth effects, a
 * sketch's second picture and a material's Wear all read along.
 *
 * So the list is here, once, and the three of them share it. Adding a fifth
 * field that points at a card is one line, in one place, and cannot be half
 * done.
 *
 * `board` is deliberately not on it. A board id is not a card id and is
 * rewritten from a different map by the one caller that has one.
 * ------------------------------------------------------------------------- */

export const POINTS_AT = ['parent', 'from', 'to', 'depthOf'] as const

/* A copy of the card with every card it names put through `to`.
 *
 * An id the map does not know is left exactly as it was, which is what each of
 * the three callers wants and for the same reason: a card pointing at
 * something outside the set being copied is still pointing at a real card, and
 * a section, a wire or a depth map that lost its other end would be worse than
 * one that still reaches across. */
export function repoint(it: Item, to: (id: string) => string | undefined): Item {
  const out = { ...it } as Item & Record<string, unknown>
  for (const k of POINTS_AT) {
    const was = out[k]
    if (typeof was !== 'string' || !was) continue
    const now = to(was)
    if (now) out[k] = now
  }
  return out
}
