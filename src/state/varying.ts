import { store } from './store'
import { shuffle, vary } from './variations'
import { isSound } from './sounds'
import { shuffleSound, varySound } from './soundVary'
import { isSketch, shuffleSketch, varySketch } from './sketchVary'
import { shuffleModel, varyModel } from './modelVary'
import { isStaged } from './staging'
import type { VaryResult } from './varyGrid'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * Which dice.
 *
 * One key, four sets of dice. What is selected decides which, and the choice
 * is here rather than at the keyboard for the same reason the traits table
 * exists: a list of kinds written out where the key is handled is a list that
 * goes stale the day a fifth medium arrives.
 *
 * The rule is that a card is varied by the thing that makes it what it is. A
 * sound by what it is run through, a sketch by the throw its code was drawn
 * on, a model by where the camera stands, and everything else by what is drawn
 * on it. A sketch and a model both have pixels and would otherwise fall to the
 * picture dice — which is what they did, and it gave twelve treatments of one
 * drawing where the thing worth having twelve of was drawings.
 *
 * A mixed selection is a picture question. The grid works on one card at a
 * time anyway, so the only cost of guessing wrong is a message.
 * ------------------------------------------------------------------------- */

/* Every kind that has dice of its own, most particular first: a model and a
 * sketch are both pictures, so asking about pixels first would swallow them. */
const all = (sel: string[], is: (i?: Item | null) => boolean) =>
  sel.length > 0 && sel.every((id) => is(store.getItem(id)))

type Kind = 'sound' | 'sketch' | 'model' | 'picture'

export function diceFor(sel: string[]): Kind {
  if (all(sel, isSound)) return 'sound'
  if (all(sel, isSketch)) return 'sketch'
  if (all(sel, isStaged)) return 'model'
  return 'picture'
}

/* Whether the answer takes long enough to be worth saying so. A picture
 * variation is settings and appears at once; the other three are renders. */
export const madeToOrder = (kind: Kind): boolean => kind !== 'picture'

export async function varyAny(): Promise<VaryResult> {
  switch (diceFor(store.getSelection())) {
    case 'sound': return varySound()
    case 'sketch': return varySketch()
    case 'model': return varyModel()
    default: return vary()
  }
}

export async function shuffleAny(): Promise<VaryResult> {
  switch (diceFor(store.getSelection())) {
    case 'sound': return shuffleSound()
    case 'sketch': return shuffleSketch()
    case 'model': return shuffleModel()
    default: return shuffle()
  }
}
