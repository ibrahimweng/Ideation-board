import { store } from './store'
import { isWire } from './kinds'
import { readingOrder } from './order'
import { fitView, revealView } from '../board/viewport'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * Getting around the board without a mouse.
 *
 * Everything on the board could be moved with the arrow keys and deleted with
 * a key, and none of it could be reached in the first place: selecting needed
 * a pointer. So the whole of it — thirty one effects, the looks, the export,
 * the menu — was behind a gesture some people cannot make.
 *
 * Tab moves through the cards in the order the board reads, which is the order
 * the eye crosses it, and brings whatever it lands on into view. Native tab
 * order would not do: cards are virtualised, so the ones off screen are not in
 * the document to be tabbed to, and the ones that are are in painting order,
 * which is the order they were last touched.
 * ------------------------------------------------------------------------- */

/* The viewport's size, which lives in the board component. Reported here so
 * that moving the selection can also bring it into sight. */
let size = { w: 0, h: 0 }
export const noteViewportSize = (w: number, h: number) => {
  size = { w, h }
}

export function step(by: 1 | -1): Item | null {
  const list = readingOrder(store.all())
  if (!list.length) return null
  const sel = store.getSelection()
  const at = sel.length ? list.findIndex((i) => i.id === sel[sel.length - 1]) : -1
  /* From nothing, forwards starts at the beginning and backwards at the end. */
  const next = at < 0 ? (by === 1 ? 0 : list.length - 1) : (at + by + list.length) % list.length
  const item = list[next]
  store.select([item.id])
  if (size.w && size.h) {
    const view = revealView(store.peekView(), item, size.w, size.h)
    if (view !== store.peekView()) store.setView(view)
  }
  return item
}

/* What a screen reader should say when the selection moves. Position included,
 * because "3 of 12" is most of what the eye gets from seeing where it sits. */
export function announce(item: Item | null): string {
  if (!item) return 'Nothing selected'
  const list = readingOrder(store.all())
  const at = list.findIndex((i) => i.id === item.id)
  const what = item.kind === 'note' || item.kind === 'label' ? item.text || item.kind : item.name || item.kind
  return `${what}, ${item.kind}, ${at + 1} of ${list.length}`
}

/* Everything on the board on screen at once, or just what is selected. Returns
 * false when there is nothing to fit, so the caller can say so rather than
 * appearing to do nothing. */
export function fitToBoard(onlySelection = false): boolean {
  if (!size.w || !size.h) return false
  /* Sections count, unlike everywhere else that walks the board: a section is
   * a box with an extent, and somebody who selected one and asked to fit it
   * means that area. Wires have no box of their own to fit. */
  const sel = store.getSelection()
  const items = onlySelection
    ? sel.map((id) => store.getItem(id)).filter((i): i is Item => !!i && !isWire(i))
    : store.all().filter((i) => !isWire(i))
  const view = fitView(items, size.w, size.h)
  if (!view) return false
  store.setView(view)
  return true
}

/* Keeping and cutting, said out loud.
 *
 * The store does the deciding; this is the sentence that goes with it, shared
 * by the key and by the command list so a screen reader and the line along the
 * bottom of the window never disagree about what just happened. */
export function markPick(pick: 'in' | 'out', say: (text: string) => void) {
  const sel = store.getSelection()
  if (!sel.length) {
    say('Select something to decide about first')
    return
  }
  const now = store.setPick(sel, pick)
  if (!now) return
  const word = now.pick === 'in' ? 'Kept' : now.pick === 'out' ? 'Cut' : 'Unmarked'
  say(now.count > 1 ? `${word} ${now.count} items` : word)
}

/* Move the view so a set of things is on screen — but only if some of it is
 * not already.
 *
 * For a drop, which is the one moment when things appear somewhere you were
 * not looking. Nothing moves when the whole drop landed in front of you, so a
 * person adding one picture to the corner they are working in is left where
 * they were; the view only travels when it has something to show. It never
 * zooms in, either: coming back from a drop closer than you were is worse
 * than not moving. */
export function revealItems(items: Item[]): boolean {
  if (!size.w || !size.h || !items.length) return false
  const view = store.peekView()
  const onScreen = (i: Item) => {
    const x = i.x * view.z + view.x
    const y = i.y * view.z + view.y
    return x >= 0 && y >= 0 && x + i.w * view.z <= size.w && y + i.h * view.z <= size.h
  }
  if (items.every(onScreen)) return false
  const next = fitView(items, size.w, size.h, 64, view.z)
  if (!next) return false
  store.setView(next)
  return true
}

/* Move the board to one card and select it. The way in for anything that
 * knows which card it wants — a result found in another board, most of all,
 * which arrives just after that board has been opened and needs the view to
 * land on it rather than wherever the board was last left. */
export function goToItem(id: string): boolean {
  const it = store.getItem(id)
  if (!it || !size.w || !size.h) return false
  store.setView(revealView(store.peekView(), it, size.w, size.h))
  store.select([id])
  return true
}
