import type { Item } from './types'
import { delBoard, getBoard, putBoard } from '../store/idb'
import type { StoredBoard } from '../store/idb'
import { hasPixels } from './kinds'

/* ---------------------------------------------------------------------------
 * Boards inside boards.
 *
 * A board is a record of its own, and a board card is a card that points at
 * one. Nesting therefore costs nothing: a board card on a board that is itself
 * a board card's target is just two records, and opening one loads only that
 * record's items. A board of a thousand cards does not slow down the board it
 * sits on, which is the whole reason for doing it this way rather than folding
 * everything into one document.
 *
 * Nothing here touches the live store. These functions read and write stored
 * records, so they work on boards that are not open — which is what makes it
 * possible to rename a card on a board you are not looking at, or copy a whole
 * tree without loading any of it.
 * ------------------------------------------------------------------------- */

export const newBoardId = () => 'b_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const newItemId = () => 'i_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const EMPTY_VIEW = { x: 0, y: 0, z: 1 }

export function emptyBoard(id: string, name: string): StoredBoard {
  return { id, name, items: [], view: { ...EMPTY_VIEW }, updated: Date.now() }
}

export async function createBoard(name = 'Board'): Promise<string> {
  const id = newBoardId()
  await putBoard(emptyBoard(id, name))
  return id
}

/* A board and every board under it, once each.
 *
 * The same walk whether it is being written out to a zip, copied to a folder,
 * or destroyed, which is why it lives here rather than in whichever of those
 * needed it first. `seen` is not tidiness: a board card can point at a board
 * that is already somewhere above it, and without it this recurses for ever. */
export async function boardTree(rootId: string): Promise<StoredBoard[]> {
  const seen = new Set<string>()
  const out: StoredBoard[] = []
  const walk = async (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const rec = await getBoard(id)
    if (!rec) return
    out.push(rec)
    for (const it of rec.items as Item[]) {
      if (it.kind === 'board' && it.board) await walk(it.board)
    }
  }
  await walk(rootId)
  return out
}

/* What deleting a board would take with it, so it can be said out loud before
 * it is done rather than discovered afterwards. This app holds the only copy
 * of the work, so "74 cards, and 3 boards inside it" is the difference between
 * a decision and an accident. */
export async function weighBoard(id: string): Promise<{ boards: number; cards: number }> {
  const tree = await boardTree(id)
  return {
    boards: tree.length,
    cards: tree.reduce((n, b) => n + (b.items?.length || 0), 0),
  }
}

/* Gone, along with every board inside it.
 *
 * The files they used are not touched here. They may be shared with a board
 * that is staying, so which of them are really unreferenced is a question
 * about the whole store rather than about this board — `store/reclaim.ts`
 * answers it, and is what actually gets the room back. */
export async function deleteBoardTree(id: string): Promise<number> {
  const tree = await boardTree(id)
  for (const b of tree) {
    await delBoard(b.id)
    invalidateSummary(b.id)
  }
  return tree.length
}

/* ---------- summaries ---------- */

export interface Summary {
  name: string
  count: number
  /* Media keys of the first few pictures inside, for the card's preview. */
  thumbs: string[]
}

const cache = new Map<string, Summary>()
const pending = new Map<string, Promise<Summary>>()
const listeners = new Set<(id: string) => void>()

export function onSummary(fn: (id: string) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function peekSummary(id: string): Summary | undefined {
  return cache.get(id)
}

/* Called after a board is written, so the card standing for it upstairs shows
 * what is now inside rather than what was there when it was last looked at. */
export function invalidateSummary(id: string) {
  cache.delete(id)
  pending.delete(id)
  for (const fn of listeners) fn(id)
}

export function loadSummary(id: string): Promise<Summary> {
  const hit = cache.get(id)
  if (hit) return Promise.resolve(hit)
  const cur = pending.get(id)
  if (cur) return cur
  const p = getBoard(id).then((rec) => {
    const items = (rec?.items || []) as Item[]
    const s: Summary = {
      name: rec?.name || 'Board',
      count: items.length,
      thumbs: items
        .filter((i) => hasPixels(i) && (i.poster || i.media))
        .slice(0, 4)
        .map((i) => (i.kind === 'video' ? i.poster! : i.media!))
        .filter(Boolean),
    }
    cache.set(id, s)
    pending.delete(id)
    for (const fn of listeners) fn(id)
    return s
  })
  pending.set(id, p)
  return p
}

/* ---------- editing a board you are not looking at ---------- */

/* The name of a nested board lives in two places: on the card that opens it,
 * and in the record itself. Renaming from inside a board has to reach back up
 * to the card, which may be on a board that is not loaded. */
export async function renameCardIn(parentId: string, cardId: string, name: string) {
  const rec = await getBoard(parentId)
  if (!rec) return
  const items = rec.items as Item[]
  const i = items.findIndex((it) => it.id === cardId)
  if (i < 0 || items[i].name === name) return
  const next = items.slice()
  next[i] = { ...next[i], name }
  await putBoard({ ...rec, items: next, updated: Date.now() })
  invalidateSummary(parentId)
}

export async function renameBoard(id: string, name: string) {
  const rec = await getBoard(id)
  if (!rec || rec.name === name) return
  await putBoard({ ...rec, name, updated: Date.now() })
  invalidateSummary(id)
}

/* ---------- copying ---------- */

/* Duplicating a board card has to duplicate what is inside it, or both cards
 * would open the same board and editing one would edit the other. Nested
 * boards are copied too, down to a depth no real board reaches; the guard is
 * there because a record could in principle be hand-edited into a loop. */
export async function cloneBoard(id: string, depth = 0): Promise<string> {
  const rec = await getBoard(id)
  const copyId = newBoardId()
  if (!rec || depth > 12) {
    await putBoard(emptyBoard(copyId, rec?.name || 'Board'))
    return copyId
  }

  const src = rec.items as Item[]
  const remap = new Map<string, string>()
  for (const it of src) remap.set(it.id, newItemId())

  const items: Item[] = []
  for (const it of src) {
    const copy: Item = { ...it, id: remap.get(it.id)! }
    if (it.parent) copy.parent = remap.get(it.parent) || it.parent
    /* Media blobs are shared rather than copied: they are immutable, keyed by
     * content identity, and copying them would double the space a duplicate
     * costs for no gain. */
    if (it.kind === 'board' && it.board) copy.board = await cloneBoard(it.board, depth + 1)
    items.push(copy)
  }

  await putBoard({ id: copyId, name: rec.name, items, view: { ...(rec.view || EMPTY_VIEW) }, updated: Date.now() })
  return copyId
}

/* One step of the trail back out of a nested board. Lives here rather than in
 * the component that draws it, because the trail is a fact about the board
 * tree and two things now need to name it. */
export interface Crumb {
  id: string
  name: string
  /* The board card that was opened to get here, so closing this board can put
   * the trail back where it came from. Absent on the root. */
  card?: string | null
}
