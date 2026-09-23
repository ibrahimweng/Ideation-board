import { useRef, useState } from 'react'
import { evalCurve } from '../state/develop'
import type { CurvePt } from '../state/develop'

/* ---------------------------------------------------------------------------
 * The tone curve.
 *
 * The one control in a develop panel that is not a slider, and the reason is
 * that what it says cannot be said with one: a slider moves a whole range, and
 * a curve says do this to the shadows and that to the highlights and leave the
 * middle alone. Nothing else in the panel can express a shape.
 *
 * Drag a point to move it. Press the line to put a point on it. Drag a point
 * off the top or bottom to take it away — which is how every curve widget has
 * worked since the first one, and is worth matching exactly, because the
 * muscle memory is thirty years old and belongs to the person using this
 * rather than to this.
 *
 * Input runs left to right and output bottom to top, so the picture reads the
 * way a photographer expects: up is brighter, right is the brighter end of the
 * range being lifted.
 * ------------------------------------------------------------------------- */

const LINE: CurvePt[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }]

/* How far off the box a point has to be dragged before it is dropped, in
 * fractions of the box. Far enough that a shaky hand does not lose a point,
 * near enough that getting rid of one does not feel like a fight. */
const DROP = 0.14

/* How near a press has to land to count as being on a point rather than on the
 * line, in fractions of the box. */
const REACH = 0.055

export function Curve({
  points, onChange, channel,
}: {
  points?: CurvePt[]
  onChange: (pts: CurvePt[] | undefined) => void
  /* Which curve is being drawn, for the colour of the line. */
  channel: 'rgb' | 'r' | 'g' | 'b'
}) {
  const box = useRef<HTMLDivElement>(null)
  const [held, setHeld] = useState(-1)
  const pts = points && points.length >= 2 ? points : LINE

  /* Where a pointer is, in the curve's own coordinates: x left to right, y
     bottom to top, both 0..1. */
  const at = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height }
  }

  const sorted = (list: CurvePt[]) => [...list].sort((a, b) => a.x - b.x)

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const p = at(e)
    const list = sorted(pts)
    let i = list.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < REACH)
    if (i < 0) {
      /* A press on the line puts a point there, and that point is the one now
         being dragged — so putting a point down and placing it is one gesture
         rather than two. */
      list.push({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) })
      list.sort((a, b) => a.x - b.x)
      i = list.findIndex((q) => q.x === Math.min(1, Math.max(0, p.x)))
      onChange(list)
    }
    setHeld(i)

    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const q = at(ev)
      /* Worked out from the list as it was when the pointer went down, not
         from the last frame's: a drag is one gesture against one starting
         shape, and reading back what the drag itself wrote would compound. */
      const next = sorted(list)
      const first = i === 0
      const last = i === next.length - 1
      /* The two ends keep their own x. A curve whose left end slid right has a
         stretch at the bottom that says nothing, and every tool that allows it
         regrets it. */
      const x = first ? next[0].x : last ? next[next.length - 1].x : Math.min(1, Math.max(0, q.x))
      next[i] = { x, y: Math.min(1, Math.max(0, q.y)) }
      /* Dragged past a neighbour, it takes that neighbour's place rather than
         crossing it, because a curve that crosses itself is not a function. */
      next.sort((a, b) => a.x - b.x)
      onChange(next)
    }
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setHeld(-1)
      const q = at(ev)
      /* The list as it stands, which includes a point this gesture put down —
         `pts` is the render the drag started from and is one point short, so
         reading it here would take the index past the end or, worse, name a
         different point than the one being held. */
      const list2 = sorted(list)
      /* Off the top or the bottom and it is gone, unless it is an end or there
         is nothing left to be a curve. */
      const inner = i > 0 && i < list2.length - 1
      if (inner && (q.y > 1 + DROP || q.y < -DROP)) {
        const next = list2.filter((_, n) => n !== i)
        onChange(next.length >= 2 ? next : undefined)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* The line itself, sampled rather than drawn as a spline path: the curve is
     evaluated the same way the shader evaluates it, so what is on screen is
     what is on the picture. */
  const d = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64
    const y = Math.min(1, Math.max(0, evalCurve(pts, x)))
    return `${i ? 'L' : 'M'}${(x * 100).toFixed(2)} ${((1 - y) * 100).toFixed(2)}`
  }).join('')

  return (
    <div className="curve" ref={box} data-ch={channel} onPointerDown={down}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {/* Quarters, so the eye has something to place a point against. */}
        {[25, 50, 75].map((n) => (
          <g key={n}>
            <line className="curve-grid" x1={n} y1="0" x2={n} y2="100" />
            <line className="curve-grid" x1="0" y1={n} x2="100" y2={n} />
          </g>
        ))}
        {/* Where the curve would be if nothing had been done to it. */}
        <line className="curve-flat" x1="0" y1="100" x2="100" y2="0" />
        <path className="curve-line" d={d} />
      </svg>
      {sorted(pts).map((p, i) => (
        <i
          key={i}
          className="curve-pt"
          data-on={held === i || undefined}
          style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%` }}
        />
      ))}
      <span className="curve-say">
        {pts.length > 2 ? `${pts.length} points` : 'Press the line to put a point on it'}
      </span>
    </div>
  )
}
