/* ---------------------------------------------------------------------------
 * Dragging a number's name to change it.
 *
 * Every figure in every panel has a name written beside it, and until now that
 * name was decoration. In every tool that does this well it is a control: put
 * the pointer on the word and drag sideways, and the number follows. It costs
 * nothing to learn, because the cursor changes the moment you are over one,
 * and it is the fastest way there is to find a value you cannot name in
 * advance — which is most of them, on a board about how something looks.
 *
 * The rates are the same bargain the arrow keys make everywhere else: one step
 * to a pixel, ten with shift, a tenth with alt. So a slider from nought to one
 * in hundredths crosses in a hundred pixels, and the same drag with alt picks
 * out a thousandth.
 * ------------------------------------------------------------------------- */

export interface Scrub {
  value: number
  /* The smallest change worth making, which is also what one pixel is worth. */
  step: number
  min?: number
  max?: number
  onChange: (v: number) => void
}

/* How many decimal places a step implies. Without this a step of 0.01 walks
 * into 0.30000000000000004 within a few pixels and puts it on screen. */
function places(step: number): number {
  const s = String(step)
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

export function startScrub(e: React.PointerEvent, o: Scrub) {
  /* The left button only: the right one is on its way to a menu. */
  if (e.button !== 0) return
  /* Or the drag selects the label's own text as it goes. */
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  const sx = e.clientX
  const from = o.value
  const dp = places(o.step)
  let began = false
  let last = from

  el.setPointerCapture(e.pointerId)
  /* So the cursor stays the scrubbing one over whatever the drag wanders
     across, which is the only sign that this is still going on. */
  document.body.dataset.scrubbing = '1'

  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx
    /* A press that never moved is a press, and clicking a label ought to go on
       putting the focus in the field beside it. */
    if (!began && Math.abs(dx) < 2) return
    began = true
    const rate = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1
    let v = from + dx * o.step * rate
    v = Number((Math.round(v / o.step) * o.step).toFixed(dp))
    if (o.min !== undefined) v = Math.max(o.min, v)
    if (o.max !== undefined) v = Math.min(o.max, v)
    if (v === last) return
    last = v
    o.onChange(v)
  }
  const up = () => {
    el.releasePointerCapture?.(e.pointerId)
    delete document.body.dataset.scrubbing
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
