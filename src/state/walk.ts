import { store } from './store'
import { readingOrder } from './order'
import { revealView } from '../board/viewport'
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
