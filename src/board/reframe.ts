import { store } from '../state/store'
import { hasPixels } from '../state/kinds'
import type { Item } from '../state/types'

/* ---------------------------------------------------------------------------
 * Framing a picture by hand.
 *
 * A card crops what is on it, and until now the only way to say where the crop
 * sat was two sliders in a panel called Offset X and Offset Y. Nobody frames a
 * photograph by typing coordinates into two boxes: you push the picture around
 * until it looks right, and you know it is right when you see it. Two sliders
 * make that a conversation with numbers about a thing you are looking at.
 *
 * So: hold Alt and drag the picture inside its card. Alt and the wheel scale
 * it. The same two numbers the sliders write, written by the hand instead —
 * which means the panel still shows exactly where you got to, and a framing
 * you found by dragging can still be nudged by one from the keyboard.
 *
 * Alt because that is the framing modifier in nearly every tool that has one,
 * and because a plain drag on a card has to go on moving the card: that is the
 * thing people do most, and taking it away to pay for this would be a bad
 * trade at any price.
 *
 * ## One card, not the selection
 *
 * Everything else in the effects panel works on the whole selection. This does
 * not, and deliberately: the app already takes the position that framing
 * belongs to the particular photograph it was set on — it is why a saved look
 * carries the tone and the effect but never the crop. Reframing eleven
 * pictures because one of them needed it is the same mistake, made faster.
 * ------------------------------------------------------------------------- */

/* A picture to push around. An embed can be graded but is somebody else's
 * document in a frame, and there is nothing behind it to move. */
export const canFrame = (i?: Item | null): i is Item => hasPixels(i)

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/* What the sliders allow, so a framing found by dragging is one the panel can
 * still show and a framing typed into the panel is one the drag can continue
 * from. */
const OFF = 50
const ZOOM = { min: 1, max: 3 }

/* Long enough that a drag paused mid-way is still one step of undo, short
 * enough that dragging, thinking, and dragging again is two. The same window
 * the panel's own sliders use. */
const ONE_STEP = 600

export function startReframe(e: React.PointerEvent, id: string): void {
  const it = store.getItem(id)
  if (!canFrame(it)) return

  /* The board's own zoom, so a drag moves the picture by what it looks like it
   * moved by rather than by however many board units that happened to be. */
  const view = store.peekView().z || 1
  const start = { ox: it.fx.ox, oy: it.fx.oy }
  const from = { x: e.clientX, y: e.clientY }
  /* Read once: the transform is `scale(zoom) translate(ox%, oy%)`, so the
   * offset is multiplied by the zoom on its way to the screen, and a drag has
   * to divide by it to come back. Changing the zoom mid-drag is not a thing
   * anyone does, and reading it live would make the picture jump if they did. */
  const zoom = it.fx.zoom || 1
  const w = it.w * zoom
  const h = it.h * zoom
  let moved = false

  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - from.x) / view
    const dy = (ev.clientY - from.y) / view
    /* A press that never really moved is a press, and should not file a step
     * of undo for having happened. */
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return
    const cur = store.getItem(id)
    if (!cur) return
    /* The first movement always starts a step of its own, and the rest of the
     * drag joins it. A pointer gesture has a beginning, unlike a slider being
     * pushed about, so it should not be swallowed into whatever happened to be
     * done half a second before it — which is what the coalescing window on
     * its own would do to a drag that followed a typed figure. */
    if (!moved) store.beginGesture(0)
    else store.beginGesture(ONE_STEP)
    moved = true
    store.update(
      id,
      {
        fx: {
          ...cur.fx,
          ox: clamp(start.ox + (dx / w) * 100, -OFF, OFF),
          oy: clamp(start.oy + (dy / h) * 100, -OFF, OFF),
        },
      },
      false
    )
  }

  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    document.body.removeAttribute('data-framing')
  }

  document.body.setAttribute('data-framing', '')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/* Alt and the wheel, over a picture: bigger or smaller inside its own card.
 *
 * Returns whether it took the wheel, so the board can go on panning when the
 * pointer was over anything else. */
export function reframeWheel(e: WheelEvent): boolean {
  if (!e.altKey) return false
  const card = (e.target as HTMLElement | null)?.closest?.('.card') as HTMLElement | null
  const id = card?.dataset.id
  const it = id ? store.getItem(id) : null
  if (!id || !canFrame(it)) return false
  const zoom = clamp((it.fx.zoom || 1) * Math.exp(-e.deltaY * 0.0022), ZOOM.min, ZOOM.max)
  if (zoom === it.fx.zoom) return true
  store.beginGesture(ONE_STEP)
  store.update(id, { fx: { ...it.fx, zoom } }, false)
  return true
}
