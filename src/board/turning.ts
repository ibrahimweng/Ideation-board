import { store } from '../state/store'
import { dollied, isStaged, stageOf, turnTo, turned } from '../state/staging'
import type { Item } from '../state/types'

/* ---------------------------------------------------------------------------
 * Turning a model with the hand.
 *
 * The board already has a gesture for "I am looking at this one card": hold
 * Alt and drag inside it. On a photograph that pushes the picture around in
 * its frame. On a model there is no picture to push — there is a thing, and
 * what you want is to see the other side of it. So it is the same gesture
 * doing the same job, which is to move what you are looking at rather than the
 * card it is on, and Alt-scroll goes in and out rather than bigger and
 * smaller.
 *
 * Nothing new has to be learned and nothing is taken away: a plain drag still
 * moves the card, which is what people do most.
 *
 * ## In screen pixels, not board units
 *
 * A drag that frames a picture divides by the board's zoom, because it is
 * moving pixels and has to move them by what it looks like. This one is an
 * angle: half a turn should be half a turn whether the board is zoomed in or
 * out, the same way it is in every program that has ever orbited anything.
 * ------------------------------------------------------------------------- */

export const canTurn = (i?: Item | null): i is Item => isStaged(i)

/* Degrees a pixel. A full turn takes about the width of a large card, which is
 * near enough to what every 3D viewer does that a hand trained on one of them
 * is already trained on this. Up and down is slower because there is less of
 * it: the whole range is a hundred and seventy degrees and overshooting it is
 * the one way to lose the model off the top. */
const YAW_PER_PX = 0.55
const PITCH_PER_PX = 0.4

/* The same window the framing drag and the panel's sliders use, so a turn
 * paused mid-way is still one step of undo. */
const ONE_STEP = 600

export function startTurn(e: React.PointerEvent, id: string): void {
  const it = store.getItem(id)
  if (!canTurn(it)) return

  const from = { x: e.clientX, y: e.clientY }
  const start = stageOf(it)
  let moved = false

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - from.x
    const dy = ev.clientY - from.y
    /* A press that never really moved is a press. */
    if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return
    /* The first movement opens a step of its own and the rest of the turn
     * joins it, so a turn that follows a typed figure is not swallowed into
     * it by the coalescing window. */
    store.beginGesture(moved ? ONE_STEP : 0)
    moved = true
    /* Dragging right turns the model to show its left side, which is what
     * grabbing an object and pulling it round does. Dragging down looks at it
     * from above. */
    void turnTo(id, turned(start, dx * YAW_PER_PX, dy * PITCH_PER_PX))
  }

  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    document.body.removeAttribute('data-turning')
  }

  document.body.setAttribute('data-turning', '')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/* Alt and the wheel over a model: in and out. Returns whether it took the
 * wheel, so the board goes on panning over everything else. */
export function turnWheel(e: WheelEvent): boolean {
  if (!e.altKey) return false
  const card = (e.target as HTMLElement | null)?.closest?.('.card') as HTMLElement | null
  const id = card?.dataset.id
  const it = id ? store.getItem(id) : null
  if (!id || !canTurn(it)) return false
  const now = stageOf(it)
  const next = dollied(now, Math.exp(e.deltaY * 0.0022))
  if (next.dist === now.dist) return true
  store.beginGesture(ONE_STEP)
  void turnTo(id, next)
  return true
}
