import { useRef } from 'react'
import { WHEEL_0 } from '../state/develop'
import type { Wheel } from '../state/develop'

/* ---------------------------------------------------------------------------
 * A colour grading wheel.
 *
 * Three of these — shadows, midtones, highlights — plus a fourth for the whole
 * picture, which is how colour grading has been said since it was done on film
 * with three printer lights.
 *
 * The reason it is a wheel and not two sliders is that a hue and a strength are
 * one decision. Warm shadows and cool shadows are a step apart on the wheel and
 * nowhere near each other on a hue slider, and the thing anybody actually does
 * here is push a little way in a direction and then feel whether it was the
 * right direction — which is a gesture, not two numbers.
 *
 * Luminance is the slider underneath, because it is a different decision: how
 * bright that part of the range is, rather than what colour it leans.
 * ------------------------------------------------------------------------- */

export function GradeWheel({
  label, value, onChange,
}: {
  label: string
  value?: Wheel
  onChange: (w: Wheel) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const w = value || WHEEL_0

  const grab = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)
    const move = (ev: { clientX: number; clientY: number }) => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      const dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2)
      const d = Math.min(1, Math.hypot(dx, dy))
      /* Degrees, counted the way a colour wheel is read: red at the top and
         round through yellow. */
      const hue = (Math.atan2(dx, -dy) * 180) / Math.PI
      onChange({ h: (hue + 360) % 360, s: Math.round(d * 100), l: w.l })
    }
    move(e)
    const up = () => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', move as (e: PointerEvent) => void)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move as (e: PointerEvent) => void)
    window.addEventListener('pointerup', up)
  }

  /* Where the dot sits: the hue round, the strength out from the middle. */
  const a = ((w.h - 90) * Math.PI) / 180
  const r = (w.s / 100) * 50
  const left = 50 + Math.cos(a) * r
  const top = 50 + Math.sin(a) * r

  return (
    <div className="wheel">
      <div
        className="wheel-face"
        ref={box}
        onPointerDown={grab}
        /* Back to no colour at all, which is the one thing a wheel cannot be
           dragged to reliably: the middle is a small target and overshooting it
           leaves a tint nobody asked for. */
        onDoubleClick={() => onChange({ h: w.h, s: 0, l: w.l })}
        title={`${label} — drag for colour, double-click to clear`}
      >
        <i className="wheel-dot" style={{ left: `${left}%`, top: `${top}%` }} />
      </div>
      <span className="wheel-name">{label}</span>
      <input
        className="wheel-lum"
        type="range"
        min={-100}
        max={100}
        step={1}
        value={w.l}
        aria-label={`${label} luminance`}
        onChange={(e) => onChange({ ...w, l: Number(e.target.value) })}
        onDoubleClick={() => onChange({ ...w, l: 0 })}
      />
    </div>
  )
}
