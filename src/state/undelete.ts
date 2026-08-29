import type { Item } from './types'
import type { StoredBoard } from '../store/idb'

/* ---------------------------------------------------------------------------
 * A moment to change your mind.
 *
 * Closing a tab deletes the project, which is the one thing this app does that
 * destroys work outright — there is no file behind a board, no undo that
 * reaches across boards, and this browser holds the only copy. It asked first
 * and it said what it was about to take, and that was the whole of the safety
 * net. One confirm, and a month of work is gone; and since a focused tab
 * answers the Delete key, the whole thing is two keystrokes.
 *
 * So the records are kept for a few seconds after the boards are gone from
 * disk. The project disappears from the row, from search and from everywhere
 * else immediately — a half-deleted project that still turns up in answers
 * would be worse than either state — and for as long as the offer stands it
 * can be put back exactly, under its own ids, in its own place in the row.
 *
 * THE PICTURES
 *
 * Deleting the boards leaves their pictures referenced by nothing, which is
 * exactly what the sweep exists to collect. So the sweep has to be told to
 * leave them alone while the offer stands, or undo would bring back a project
 * of empty frames. That is what `heldItems` is for, and it is why the sweep
 * that follows a delete is the one thing here that waits.
 * ------------------------------------------------------------------------- */

interface Pending {
  /* What was deleted, ready to be written back under the same ids. */
  boards: StoredBoard[]
  /* Which of them was the project itself. */
  root: string
  name: string
  /* Runs when the offer lapses: the sweep that was put off. */
  after: () => void
  timer: number
}

let pending: Pending | null = null

/* Hold what was just deleted, and say when to stop holding it.
 *
 * A second delete while one is still held lets the first go at once rather
 * than keeping both: two offers cannot be shown, and holding the pictures of a
 * project nobody can put back any more is just room not being returned. */
export function holdDeleted(
  boards: StoredBoard[],
  root: string,
  name: string,
  ms: number,
  after: () => void
) {
  release()
  const p: Pending = { boards, root, name, after, timer: 0 }
  p.timer = window.setTimeout(() => {
    if (pending === p) pending = null
    after()
  }, ms)
  pending = p
}

/* Let the held one go now, running whatever was waiting on it. The only caller
 * is a second delete arriving: two offers cannot be shown at once, and holding
 * the pictures of a project nobody can put back any more is only room not
 * being returned. */
function release() {
  const p = pending
  if (!p) return
  pending = null
  window.clearTimeout(p.timer)
  p.after()
}

/* The offer, taken. Hands back the records to write, and cancels the sweep
 * that was going to follow — those files are spoken for again. */
export function takeBack(): { boards: StoredBoard[]; root: string; name: string } | null {
  const p = pending
  if (!p) return null
  pending = null
  window.clearTimeout(p.timer)
  return { boards: p.boards, root: p.root, name: p.name }
}

export const heldName = () => pending?.name || null

/* Every card of every board being held, in the shape a sweep asks for. The
 * sweep works out which files are spoken for from items, so this hands it
 * items rather than trying to name the files itself — one place deciding what
 * a card refers to, rather than two that can disagree. */
export function heldItems(): Item[] {
  if (!pending) return []
  return pending.boards.flatMap((b) => (b.items || []) as Item[])
}
