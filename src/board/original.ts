import { useCallback, useSyncExternalStore } from 'react'
import { store } from '../state/store'

/* ---------------------------------------------------------------------------
 * What it looked like before.
 *
 * Judging an effect against nothing is guesswork. Every tool that grades a
 * picture has a way to hold the original up against what you have done to it,
 * and this board had none: the only way to see what a card started as was to
 * take the effect off, look, and put it back on — which is two undo steps and
 * a lost train of thought.
 *
 * Held rather than toggled. A toggle is a mode you can be in without meaning
 * to be, and a mode that hides your work is the worst kind: you would come
 * back an hour later to a board that looks like you had done nothing. Holding
 * something down cannot be left switched on.
 *
 * ## What it applies to
 *
 * The selection, when there is one, because the panel that put the effect on
 * is working on the selection and that is the picture the question is about.
 * The whole board when there is not, which turns it into "show me what all of
 * this looked like before I graded it" — a fair question on a board whose
 * point is deciding.
 *
 * The set is worked out once when the hold starts rather than read on every
 * frame, so a card cannot fall in or out of the comparison because a selection
 * changed underneath it while the key was down.
 * ------------------------------------------------------------------------- */

let held: Set<string> | null = null
const watchers = new Set<() => void>()

function tell() {
  for (const fn of [...watchers]) fn()
}

/* Starts the comparison. Doing it twice is the same as doing it once: a key
 * held down repeats, and every repeat is another keydown. */
export function holdOriginal() {
  if (held) return
  const sel = store.getSelection()
  held = new Set(sel.length ? sel : store.getOrder())
  tell()
}

export function releaseOriginal() {
  if (!held) return
  held = null
  tell()
}

/* Whether anything at all is being compared, for the button that does it. */
export const comparingNow = () => held !== null

/* Whether this card should show what it started as. */
export const plainNow = (id: string) => !!held && held.has(id)

function subscribe(fn: () => void) {
  watchers.add(fn)
  return () => void watchers.delete(fn)
}

/* True while this card is showing its original.
 *
 * A card subscribes to the flag rather than to the set, and the set only ever
 * changes at the moment the flag does, so a hold re-renders the cards that are
 * in it and nothing else re-renders twice. */
export function usePlain(id: string): boolean {
  const get = useCallback(() => plainNow(id), [id])
  return useSyncExternalStore(subscribe, get, get)
}

/* For the button, which needs to know whether it is pressed. */
export function useComparing(): boolean {
  return useSyncExternalStore(subscribe, comparingNow, comparingNow)
}
