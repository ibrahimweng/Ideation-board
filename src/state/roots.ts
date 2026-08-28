import type { Item } from './types'
import { allBoards, getBoard } from '../store/idb'
import { createBoard } from './boards'

/* ---------------------------------------------------------------------------
 * Boards you can have several of.
 *
 * There was one board and everything else was nested inside it. Which is a
 * fine way to keep one project and a poor way to keep four: opening last
 * month's work meant walking down into it from the same root, and there was no
 * way to have two of them on screen at once.
 *
 * A board's address is now in the page's own address — `?board=<id>` — so a
 * board is a thing a browser tab can be pointed at. Two tabs, two boards, side
 * by side, which is what the browser is for and what an in-app switcher could
 * never do. The list below is rendered as ordinary links, so opening one in a
 * new tab is the browser's own gesture rather than something this had to
 * invent.
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
}

export async function listRoots(): Promise<Root[]> {
  const all = await allBoards()
  const nested = new Set<string>()
  for (const b of all) {
    for (const it of (b.items || []) as Item[]) {
      if (it.kind === 'board' && it.board) nested.add(it.board)
    }
  }
  const roots = all
    .filter((b) => !nested.has(b.id))
    .map((b) => ({ id: b.id, name: b.name || 'Untitled board', cards: (b.items || []).length, updated: b.updated || 0 }))

  /* The original board is offered even before it has been written for the
   * first time, or the list would be empty on a first visit. */
  if (!roots.some((r) => r.id === FIRST_BOARD)) {
    roots.push({ id: FIRST_BOARD, name: 'Untitled board', cards: 0, updated: 0 })
  }
  /* Most recently touched first: the one you want is nearly always the one you
   * were last in. */
  return roots.sort((a, b) => b.updated - a.updated)
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

/* Does this board exist? Asked before a tab commits to an address somebody may
 * have typed or kept from a board since deleted. */
export async function boardExists(id: string): Promise<boolean> {
  if (id === FIRST_BOARD) return true
  return !!(await getBoard(id))
}

/* Where a trail is remembered, per board, so that two tabs on two boards do
 * not overwrite each other's idea of how deep they are. */
export const trailKey = (rootId: string) => `ideation.path.${rootId}`
