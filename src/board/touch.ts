import { store } from '../state/store'
import { getEngine } from '../engine/client'
import { screenToBoard, zoomAt } from './viewport'
import { noteLongPress, onLongPress } from './longpress'
import type { MenuState } from '../ui/ContextMenu'
import type { Viewport } from '../state/store'

/* ---------------------------------------------------------------------------
 * Fingers.
 *
 * One pans, two pinch and pan together, and one held still opens the menu. A
 * mouse never gets here: a marquee is a mouse idea, and on a tablet a drag
 * across the board is how you get about, with nothing else to pan with. A
 * press that starts on a card never reaches here either, so dragging a card
 * with one finger still does.
 *
 * The awkward part is that fingers arrive and leave mid-gesture. Everything is
 * measured from an anchor — the view, the midpoint between the fingers and the
 * distance between them at the moment the count last changed — and re-anchored
 * whenever it changes again, because without that the board jumps by whatever
 * the new arrangement happens to measure.
 * ------------------------------------------------------------------------- */

export interface TouchContext {
  /* Live map of the fingers currently down, shared with the caller so a press
     that begins on a card can be counted too. */
  points: Map<number, { x: number; y: number }>
  /* The viewport's box, for turning page coordinates into board ones. */
  rect: DOMRect
  /* Where the view was when the gesture began. */
  startView: Viewport
  /* Paints the surface transform without going through React. */
  paint: () => void
  openMenu: (m: MenuState) => void
}

export function startTouch(e: React.PointerEvent, ctx: TouchContext) {
  const pts = ctx.points
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pts.size > 1) return

  /* Hold still on empty board and the canvas menu opens, which is the
     only way to reach it without a right button. */
  const held = onLongPress(e, (px, py) => {
    noteLongPress()
    store.clearSel()
    ctx.openMenu({ x: px, y: py, ids: [], board: screenToBoard(store.peekView(), px - ctx.rect.left, py - ctx.rect.top) })
  })

  let anchor = { count: 1, view: ctx.startView, mid: { x: e.clientX - ctx.rect.left, y: e.clientY - ctx.rect.top }, gap: 1 }
  let far = 0

  const read = () => {
    const list = [...pts.values()]
    const mid = list.reduce((a, p) => ({ x: a.x + p.x / list.length, y: a.y + p.y / list.length }), { x: 0, y: 0 })
    const gap =
      list.length > 1 ? Math.max(1, Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y)) : 1
    return { list, mid: { x: mid.x - ctx.rect.left, y: mid.y - ctx.rect.top }, gap }
  }

  const move = (ev: PointerEvent) => {
    if (!pts.has(ev.pointerId)) return
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    const now = read()
    /* Re-anchor whenever a finger arrives or leaves, or the board would
     * jump by whatever the new arrangement happens to measure. */
    if (now.list.length !== anchor.count) {
      anchor = { count: now.list.length, view: { ...store.peekView() }, mid: now.mid, gap: now.gap }
      return
    }
    getEngine().touch()
    const dx = now.mid.x - anchor.mid.x
    const dy = now.mid.y - anchor.mid.y
    far = Math.max(far, Math.hypot(dx, dy))
    if (far > 9) held.cancel()
    if (now.list.length > 1) {
      const zoomed = zoomAt(anchor.view, anchor.mid.x, anchor.mid.y, now.gap / anchor.gap)
      store.setViewSilent({ x: zoomed.x + dx, y: zoomed.y + dy, z: zoomed.z })
    } else {
      store.setViewSilent({ x: anchor.view.x + dx, y: anchor.view.y + dy })
    }
    ctx.paint()
  }

  const up = (ev: PointerEvent) => {
    pts.delete(ev.pointerId)
    held.cancel()
    if (pts.size) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    store.commitView()
    /* A tap on empty board clears the selection, the same as a click. */
    if (far < 6) store.clearSel()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
