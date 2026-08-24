/* ---------------------------------------------------------------------------
 * The right click, for people with no right button.
 *
 * Nearly everything worth doing to a card lives in the context menu: export a
 * picture, pull its colours out, copy a look, line a selection up, tag it,
 * send it to the back. On a tablet there was no way to open it. Panning and
 * pinching worked, dragging a card worked, and then the half of the app behind
 * the menu simply was not there.
 *
 * iOS fires no contextmenu event for a long press — it shows its own callout
 * instead — and Android's arrives at a moment of its own choosing. So the
 * press is timed here, which also means one rule on every platform: hold still
 * for half a second and the menu opens where your finger is.
 * ------------------------------------------------------------------------- */

const HOLD = 480
/* A finger never holds perfectly still. More than this and it is a drag. */
const SLOP = 9

export interface LongPress {
  /* Call when the gesture becomes something else — a drag, a second finger —
   * so the menu does not open underneath it. */
  cancel: () => void
}

export function onLongPress(
  e: React.PointerEvent,
  fire: (x: number, y: number) => void,
  hold = HOLD
): LongPress {
  if (e.pointerType !== 'touch') return { cancel: () => undefined }

  const x0 = e.clientX
  const y0 = e.clientY
  let done = false

  const stop = () => {
    if (done) return
    done = true
    window.clearTimeout(timer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    window.removeEventListener('pointerdown', stop)
  }

  const move = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP) stop()
  }

  const timer = window.setTimeout(() => {
    if (done) return
    stop()
    fire(x0, y0)
  }, hold)

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
  /* A second finger means a pinch, not a menu. */
  window.addEventListener('pointerdown', stop)

  return { cancel: stop }
}

/* Android also fires its own contextmenu after a long press, at a moment of
 * its own choosing. Having opened the menu ourselves, the second one would
 * close and reopen it under a finger that has already moved on. */
let lastFired = 0
export const noteLongPress = () => {
  lastFired = Date.now()
}
export const justLongPressed = () => Date.now() - lastFired < 900
