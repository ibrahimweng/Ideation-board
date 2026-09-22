import { useEffect, useState } from 'react'
import { store, useViewport } from '../state/store'
import { measure } from '../state/measure'
import { boundsOf } from './scaling'
import type { Box } from './scaling'

/* ---------------------------------------------------------------------------
 * Hold a key and point at something.
 *
 * The board knows where everything is, and until now it kept that to itself.
 * This is the other half of arranging: not moving things, but being told how
 * far apart they already are — the gap between two cards, the space left round
 * one sitting inside a section, both at once for something away up and to the
 * right. Every figure here is one the board already had.
 *
 * Held rather than switched on, because it is something you do for a second in
 * the middle of doing something else. Alt is the key: it already means "tell me
 * more" on this board, where Alt and a drag makes a copy, and the two do not
 * collide — one is a hover and the other is a press, and a press puts what it
 * lands on into the selection, which is the one thing there is nothing to say
 * about.
 *
 * The arithmetic — which lines, and what they say — is in state/measure.ts.
 * This is the holding, the pointing and the drawing.
 * ------------------------------------------------------------------------- */

/* Screen pixels, divided back out by the zoom so a line stays a hairline and a
 * figure stays readable however far out the board is. */
const THIN = 1
const TICK = 5

export function Measure({ ids }: { ids: string[] }) {
  const view = useViewport()
  const [held, setHeld] = useState(false)
  const [over, setOver] = useState<string | null>(null)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      /* A held key repeats, and every repeat arrives as another keydown. */
      if (e.key !== 'Alt' || e.repeat) return
      setHeld(true)
    }
    /* Letting go, and every other way a hold can end without one. A key held
       while the window loses focus never sends its keyup — the window that
       takes the focus gets that — so blur has to end it too. */
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') stop()
    }
    const stop = () => {
      setHeld(false)
      setOver(null)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', stop)
    }
  }, [])

  /* Only while it is being held: a listener on every pointer move is not
     something to leave running for the sake of a key nobody is pressing. */
  useEffect(() => {
    if (!held) return
    const chosen = new Set(ids)
    const at = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const card = el?.closest('.card') as HTMLElement | null
      const id = card?.dataset.id || null
      /* Pointing at part of what you have selected asks nothing. */
      setOver(id && !chosen.has(id) ? id : null)
    }
    window.addEventListener('pointermove', at)
    return () => window.removeEventListener('pointermove', at)
  }, [held, ids])

  const from = boundsOf(ids.map((id) => store.getItem(id)).filter(Boolean) as Box[])
  const to = over ? store.getItem(over) : null
  /* Nothing to say about a thing and itself, which is also what makes a press
     harmless: pressing a card selects it, and a card measured against itself
     measures nothing. Alt and a drag goes on making a copy, undisturbed. */
  if (!held || !from || !to) return null

  const spans = measure(from, to)
  /* Two things flush against each other have no distance between them, and an
     outline round something with no figures beside it is an answer to a
     question nobody asked. */
  if (!spans.length) return null

  const z = view.z || 1
  const thin = THIN / z
  const tick = TICK / z

  return (
    <div className="measure" aria-hidden="true">
      {/* What is being pointed at, so the figures are plainly about it. */}
      <i
        className="measure-box"
        style={{
          transform: `translate3d(${to.x}px, ${to.y}px, 0)`,
          width: to.w,
          height: to.h,
          boxShadow: `0 0 0 ${thin}px var(--measure)`,
        }}
      />
      {spans.map((s, i) => {
        const flat = s.y1 === s.y2
        return (
          <i
            key={i}
            className="measure-line"
            data-guide={s.n === null || undefined}
            data-down={!flat || undefined}
            style={{
              transform: `translate3d(${Math.min(s.x1, s.x2)}px, ${Math.min(s.y1, s.y2)}px, 0)`,
              width: flat ? Math.abs(s.x2 - s.x1) : thin,
              height: flat ? thin : Math.abs(s.y2 - s.y1),
              ['--tick' as string]: `${tick}px`,
              ['--thin' as string]: `${thin}px`,
            }}
          />
        )
      })}
      {spans.map((s, i) =>
        s.n === null ? null : (
          <b
            key={`n${i}`}
            className="measure-say"
            style={{
              transform: `translate3d(${(s.x1 + s.x2) / 2}px, ${(s.y1 + s.y2) / 2}px, 0) scale(${1 / z}) translate(-50%, -50%)`,
            }}
          >
            {Math.round(s.n)}
          </b>
        )
      )}
    </div>
  )
}
