/* ---------------------------------------------------------------------------
 * Two tabs, one board.
 *
 * Everything here is kept in one browser, and a browser has tabs. Open the app
 * twice — a bookmark, a restored session, "open in new tab" — and both copies
 * loaded the same record into memory and both wrote it back. Neither knew the
 * other existed. Whichever saved last won, and whatever the other had added in
 * the meantime was gone: no warning, no conflict, no undo, and the tab that
 * lost the work never found out.
 *
 * That is the worst thing a program like this can do, and it needed neither
 * bad luck nor an unusual setup to happen.
 *
 * Two things fix it, and both are needed. The tabs tell each other when they
 * write, so a tab that is only looking picks up what the other one did and is
 * no longer holding a stale copy to overwrite with. And every write checks the
 * record it is about to replace, in case a message was missed or the browser
 * has no way to send one — a save that would clobber a newer record does not
 * happen, and the person is asked instead.
 *
 * BroadcastChannel is the only piece of machinery involved. It is same-origin
 * and same-browser, which is exactly the scope of the problem: two tabs on one
 * machine. Two machines on one folder is a different question, and the folder
 * mirror already says it does not answer it.
 * ------------------------------------------------------------------------- */

const CHANNEL = 'ideation.tabs'

/* Enough to tell this tab apart from the others; it never leaves the browser. */
export const TAB_ID = 't' + Math.random().toString(36).slice(2, 10)

export interface Saved {
  kind: 'saved'
  board: string
  updated: number
  from: string
}

let chan: BroadcastChannel | null = null
try {
  /* In a page, and nowhere else. Node has the class too, and opening one
   * there would hold the process open for a channel with nothing on it. */
  const inPage = typeof window !== 'undefined' && typeof document !== 'undefined'
  chan = inPage && typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null
} catch {
  /* A browser without it, or one that refuses in a private window. The write
   * guard below still catches the clobber; the other tab just finds out when
   * it next tries to save rather than the moment it happens. */
  chan = null
}

const listeners = new Set<(n: Saved) => void>()

chan?.addEventListener('message', (e: MessageEvent) => {
  const n = e.data as Saved | undefined
  if (!n || n.kind !== 'saved' || n.from === TAB_ID) return
  for (const fn of listeners) fn(n)
})

/* Whether the tabs can talk at all, so the app can say so rather than
 * promising something the browser will not do. */
export const tabsTalk = () => chan !== null

/* The newest version of each board this tab knows about: what it last read,
 * or last wrote. Not the same as the board's own `updated`, which moves on
 * every local edit — the question a write has to ask is "has anyone else
 * written since I last looked", and only a watermark can answer it. */
const watermark = new Map<string, number>()

export const markSynced = (board: string, updated: number) => {
  watermark.set(board, updated)
}

export const syncedAt = (board: string): number => watermark.get(board) ?? 0

/* Whether the stored record is newer than anything this tab has seen. */
export const changedElsewhere = (board: string, storedUpdated: number | undefined) =>
  typeof storedUpdated === 'number' && storedUpdated > syncedAt(board)

export function announceSaved(board: string, updated: number) {
  markSynced(board, updated)
  try {
    chan?.postMessage({ kind: 'saved', board, updated, from: TAB_ID } satisfies Saved)
  } catch {
    /* A closed channel on the way out of the page. Nothing to do about it. */
  }
}

export function onBoardSaved(fn: (n: Saved) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
