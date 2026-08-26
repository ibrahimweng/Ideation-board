import { useCallback, useEffect, useMemo, useState } from 'react'
import { store } from '../state/store'
import type { Item } from '../state/types'
import { readingOrder } from '../state/order'
import { Stage, fitStage } from './Stage'
import { holdKeys } from './modal'

/* ---------------------------------------------------------------------------
 * The board, shown rather than worked on.
 *
 * A board is where a set of pictures is arrived at, and then it has to be
 * shown to somebody — and until now the only way to do that was to share a
 * screen with a toolbar, a panel, a grid of dots and eleven other cards around
 * the one being talked about. This is the same board with all of that taken
 * away: one thing at a time, as large as the screen allows, in the order it is
 * laid out in.
 *
 * Reading order, not creation order. Somebody who arranged twelve photographs
 * into three rows meant those rows, and a slideshow that ignored them would be
 * showing a different sequence from the one on the board. So the order is top
 * to bottom in bands, then left to right inside each band, which is how the
 * eye crosses a wall of pictures.
 *
 * The effect, the tone, the framing and the grain are the card's. What is
 * shown is what was made, at the size of the screen instead of the size of a
 * card.
 * ------------------------------------------------------------------------- */

export function Present({ ids, startAt, onClose }: { ids: string[]; startAt?: string; onClose: () => void }) {
  /* Handed exactly what to show. Working out whether that is the selection,
   * what a search has narrowed to, or the whole board is one question with one
   * answer, and it is answered in state/subject.ts for every action that asks
   * it rather than three times, differently, here and in two other files. */
  const items = useMemo(
    () => readingOrder(ids.map((id) => store.getItem(id)).filter((i): i is Item => !!i)),
    [ids]
  )

  /* Opened on one card — double clicking a picture to see it big — starts
   * there rather than at the beginning, and the arrows still walk the rest of
   * the board from that point. */
  const [at, setAt] = useState(() => {
    const found = startAt ? items.findIndex((i) => i.id === startAt) : -1
    return found < 0 ? 0 : found
  })
  /* The chrome fades out of the way and comes back on any movement, so the
   * picture is alone for as long as you are only looking at it. */
  const [idle, setIdle] = useState(false)

  const go = useCallback(
    (step: number) => {
      setAt((n) => Math.min(items.length - 1, Math.max(0, n + step)))
      setIdle(false)
    },
    [items.length]
  )

  /* The board's own keys stand down while this is up. Without it the arrows
     that step through the show also nudge whatever is selected underneath. */
  useEffect(holdKeys, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        return go(1)
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        return go(-1)
      }
      if (e.key === 'Home') return setAt(0)
      if (e.key === 'End') return setAt(items.length - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, items.length])

  /* Ask for the whole display. Refused is fine — a browser may only grant this
   * from a gesture, and the overlay covers the page either way. */
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  /* Leaving full screen by the browser's own means leaves the show as well,
   * since staying in it would look like a window that will not close. */
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) onClose()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [onClose])

  useEffect(() => {
    if (idle) return
    const t = window.setTimeout(() => setIdle(true), 2200)
    return () => window.clearTimeout(t)
  }, [idle, at])

  if (!items.length) {
    return (
      <div className="present" onPointerDown={onClose}>
        <p className="present-none">Nothing on this board to show.</p>
      </div>
    )
  }

  const item = items[Math.min(at, items.length - 1)]

  return (
    <div
      className="present"
      data-idle={idle || undefined}
      onPointerMove={() => setIdle(false)}
      onPointerDown={(e) => {
        /* The left third goes back, the rest goes on: a whole screen of target
           beats a pair of small arrows. */
        const back = e.clientX < window.innerWidth / 3
        go(back ? -1 : 1)
      }}
    >
      <Stage item={item} box={fitStage(item, window.innerWidth * 0.9, window.innerHeight * 0.86)} />

      <div className="present-bar">
        <span className="present-name">{item.name || ''}</span>
        <span className="present-count">
          {at + 1} / {items.length}
        </span>
        <button
          className="present-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title="Leave (Esc)"
        >
          Done
        </button>
      </div>
    </div>
  )
}
