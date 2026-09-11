import { useSyncExternalStore } from 'react'

/* ---------------------------------------------------------------------------
 * Which card is being written on, in place.
 *
 * A note opens a sheet, because a note is a document: it has headings and
 * lists and a row of buttons for marking them up. A label is a line of type
 * lying on the board, and opening a modal dialogue to change one word of it is
 * the difference between a board you write on and a board you file things in.
 *
 * So a label is edited where it is. The card puts a field over itself, set in
 * exactly the type it draws in, and what you type is what you see — which is
 * the whole of what people mean when they say they want to write on the
 * artboard.
 *
 * One at a time, and held outside React for the same reason the armed tool is:
 * the board's pointer handlers ask about it mid-gesture.
 * ------------------------------------------------------------------------- */

let writing: string | null = null
const subs = new Set<() => void>()

export const writingNow = (): string | null => writing

export function startWriting(id: string) {
  if (writing === id) return
  writing = id
  for (const f of subs) f()
}

export function stopWriting(id?: string) {
  if (writing === null || (id && writing !== id)) return
  writing = null
  for (const f of subs) f()
}

export function useWriting(): string | null {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f) } },
    () => writing,
    () => null
  )
}
