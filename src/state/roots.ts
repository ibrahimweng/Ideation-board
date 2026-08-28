import type { Item } from './types'
import { allBoards, getBoard } from '../store/idb'
import type { StoredBoard } from '../store/idb'
import { createBoard } from './boards'

/* ---------------------------------------------------------------------------
 * Boards you can have several of.
 *
 * There was one board and everything else was nested inside it. Which is a
 * fine way to keep one project and a poor way to keep four: opening last
 * month's work meant walking down into it from the same root, and there was no
 * way to have two of them on screen at once.
 *
 * A project is now a tab along the top of the app, and this is the list those
 * tabs are built from. Switching does not reload: the board is loaded in place
 * and the address is rewritten to match, so `?board=<id>` always names what is
 * on screen. That is what makes the address worth copying — a link opens the
 * project you were looking at — and it is what lets a reload, a bookmark or the
 * browser's own "open in a new tab" land back on the same one.
 *
 * WHICH BOARDS ARE TOP LEVEL
 *
 * Worked out rather than written down: a board is top level when no board card
 * anywhere points at it. Nothing to keep in step, nothing to migrate, and no
 * second list that can disagree with the boards themselves.
 *
 * It has a property worth having on purpose. Delete the card that stood for a
 * nested board and that board stops being nested — so instead of becoming a
 * record nothing can reach, it turns up in this list. Work cannot go missing
 * quietly; at worst it is somewhere you did not expect.
 * ------------------------------------------------------------------------- */

/* The board that existed before there could be more than one. Always offered,
 * so an old session opens on what it had. */
export const FIRST_BOARD = 'board_local'

export interface Root {
  id: string
  name: string
  cards: number
  updated: number
  /* When it was made, which is the order the tabs are kept in. Zero for a
   * board written before the field existed, so those sort first — they are the
   * oldest, which is where they belong. */
  created: number
}

/* Which of these boards are projects, and what each one is worth saying about.
 *
 * Pure, and separated from the read, because it is the one piece of this file
 * with a rule in it that can be got wrong quietly — a board wrongly counted as
 * nested is a project that vanishes from the row while its work is still on
 * disk. Worth being able to ask the question without a database. */
export function rootsOf(all: StoredBoard[]): Root[] {
  const nested = new Set<string>()
  for (const b of all) {
    for (const it of (b.items || []) as Item[]) {
      if (it.kind === 'board' && it.board) nested.add(it.board)
    }
  }
  const roots = all
    .filter((b) => !nested.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name || 'Untitled board',
      cards: (b.items || []).length,
      updated: b.updated || 0,
      created: b.created || 0,
    }))

  /* On a first visit nothing has been written yet, and a row with no tabs in
   * it is not a thing anybody can use. So the original board stands in for the
   * empty case — but only for the empty case. It used to be offered whenever
   * it was missing, which was harmless while this list was somewhere to open a
   * board from and wrong the moment a tab could be closed: the one project you
   * deliberately deleted would reappear in the row a second later. */
  if (!roots.length) {
    roots.push({ id: FIRST_BOARD, name: 'Untitled board', cards: 0, updated: 0, created: 0 })
  }
  /* Most recently touched first. The tab strip imposes its own order, so this
   * is for everyone else who asks: closing the project you are in has to land
   * you somewhere, and the one you were last in is the best guess there is. */
  return roots.sort((a, b) => b.updated - a.updated)
}

/* The order of the row.
 *
 * Oldest first, so a new project appears on the right and nothing already on
 * the row ever moves. Ordering by when each was last touched would put the one
 * you are working in at the front and shuffle the rest along behind it, which
 * is a row you cannot learn: the tab you want would be somewhere different
 * every time you looked for it.
 *
 * Boards made before there was a birthday to record tie at zero, so they hold
 * the left of the row in id order — arbitrary, but the same arbitrary every
 * time, which is the only property that matters here. */
export function tabOrder(roots: Root[]): Root[] {
  return [...roots].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
}

export async function listRoots(): Promise<Root[]> {
  return rootsOf(await allBoards())
}

export async function newRoot(name = 'Untitled board'): Promise<string> {
  return createBoard(name)
}

/* ---------------------------------------------------------------------------
 * The address
 * ------------------------------------------------------------------------- */

export const boardParam = 'board'

/* Which board this tab is pointed at. */
export function boardFromUrl(search = window.location.search): string {
  try {
    const id = new URLSearchParams(search).get(boardParam)
    /* Ids are ours and have a known shape. Anything else is somebody editing
     * the address bar, and is treated as no answer rather than looked up. */
    return id && /^[A-Za-z0-9_]{1,64}$/.test(id) ? id : ''
  } catch {
    return ''
  }
}

export const urlForBoard = (id: string) => `?${boardParam}=${encodeURIComponent(id)}`

/* Point this tab at a board without reloading it. The board is loaded in place;
 * the address changes so that the tab can be duplicated, bookmarked, or
 * reloaded onto the same board. */
export function pointTabAt(id: string) {
  try {
    window.history.pushState({ board: id }, '', urlForBoard(id))
  } catch {
    /* A page that cannot rewrite its own address still switches; it just will
     * not survive a reload on the same board. */
  }
}

/* Does this board exist? Asked before the app commits to an address somebody
 * may have typed, bookmarked, or kept from a project since deleted.
 *
 * The original board gets no exemption. It is a project like the others now,
 * and a project you closed has to stay closed — including when the address
 * naming it is the bare one everybody arrives on. */
export async function boardExists(id: string): Promise<boolean> {
  return !!(await getBoard(id))
}

/* Where a trail is remembered, per board, so that two tabs on two boards do
 * not overwrite each other's idea of how deep they are. */
export const trailKey = (rootId: string) => `ideation.path.${rootId}`
