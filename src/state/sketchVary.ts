import { store } from './store'
import { runSketch } from './sketches'
import { runGrid } from './varyGrid'
import type { Dice, VaryResult } from './varyGrid'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * Twelve of a sketch.
 *
 * A sketch already had this and it took twelve presses: Roll again keeps the
 * code and throws the dice, and doing that a dozen times to compare a dozen
 * throws is exactly the work the grid exists to remove.
 *
 * Pressing V on a sketch used to give twelve copies of the same drawing with
 * twelve different effects on it, because a sketch has pixels and the picture
 * dice are what pixels get. That is not wrong, it is just an answer to a
 * different question — the thing you want twelve of is the drawing.
 *
 * ## Why this one does not breed
 *
 * Every other medium here refines: a picture variation bred from a keeper is
 * the same effect nudged, a sound the same chain jittered, a model an angle
 * near the one you liked. A seed has no such neighbourhood. Two seeds one
 * apart are two unrelated pictures, so there is nothing between a keeper and
 * its child to inherit.
 *
 * So keeping three and pressing again gives nine fresh throws rather than nine
 * near the three — which is still the loop that matters, because what keeping
 * does here is protect what you found rather than steer where to look next.
 * Saying so is better than pretending: a slider dressed up as breeding, that
 * did nothing, would be worse than the plain thing.
 * ------------------------------------------------------------------------- */

export const isSketch = (i?: Item | null): i is Item => !!i && i.kind === 'sketch' && !!i.code

const throwOne = () => Math.floor(Math.random() * 1e6)

/* Rendered in order rather than at once: each is a worker, a canvas and a
 * picture written to storage, and a dozen of those in parallel is a dozen
 * workers competing for the same core. */
async function drawAll(ids: string[]): Promise<void> {
  /* Not recorded: the exchange that put these on the board is the step, and
     twelve draws finishing it are not twelve more things that happened. */
  for (const id of ids) await runSketch(id, undefined, false)
}

const dice: Dice<number> = {
  noun: 'sketch',
  batch: (_source, count) => Array.from({ length: count }, throwOne),
  /* The code comes with the card, because a copy inherits everything: what
   * changes is the throw, and the picture it drew last time has to go or the
   * card shows the drawing it was copied from until its own arrives. */
  patch: (roll) => ({ roll, poster: undefined }),
  read: (it) => it.roll ?? throwOne(),
  render: drawAll,
}

export const varySketch = (): Promise<VaryResult> => runGrid(dice, (it) => isSketch(it))

/* The same dice thrown in place: a new drawing from the same code, on every
 * sketch selected. */
export async function shuffleSketch(): Promise<VaryResult> {
  const sel = store.getSelection().filter((id) => isSketch(store.getItem(id)))
  if (!sel.length) return { made: 0, say: 'Pick a sketch to shuffle.' }
  store.beginGesture(0)
  for (const id of sel) {
    store.update(id, { roll: throwOne() }, false)
    await runSketch(id, undefined, false)
  }
  return {
    made: sel.length,
    say: sel.length === 1 ? 'Thrown again. Press again for another.' : `Thrown again on ${sel.length}.`,
  }
}
