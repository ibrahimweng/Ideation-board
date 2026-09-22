import { useEffect, useRef, useState } from 'react'
import { store, useViewport } from '../state/store'
import { gapMarks, reorder, respace, slotAt, smartOf } from '../state/smart'
import type { Smart } from '../state/smart'
import type { Item } from '../state/types'
import { holdPress } from './press'

/* ---------------------------------------------------------------------------
 * The gaps, as something you can take hold of.
 *
 * The moment a handful of cards sit in a row, the space between them stops
 * being empty and becomes the control: drag it and they all open out or close
 * up together, with the figure under the cursor. No dialogue, no field, no
 * menu — the thing you want to change is the thing you grab.
 *
 * A ring on each card is the other half. Drag one along the row and it swaps
 * into the place it is nearest and everything else closes up behind it, which
 * is what dragging a card along a row has always looked like it would do and
 * never did: it used to land on top of whatever was there and leave a hole
 * where it came from.
 *
 * None of it appears over a pile. `smartOf` says no unless the cards really
 * are evenly spaced, because a handle over a pile is a handle that lies —
 * dragging it would have to invent an order the cards do not have. A pile
 * becomes a row with one press of Tidy, and then the handles are there.
 * ------------------------------------------------------------------------- */

/* The marks, in screen pixels: divided back out by the zoom so a ring is the
 * same size to aim at however far out the board is. */
const RING = 5
const GRIP = 3

export function SmartHandles({ ids }: { ids: string[] }) {
  const view = useViewport()
  /* Redrawn when any of them moves. The shape of the selection is worked out
     again each time, because moving one card out of line is exactly the thing
     that should take the handles away. */
  const [, bump] = useState(0)
  /* The figure under the cursor while a gap is being dragged. */
  const [say, setSay] = useState<{ x: number; y: number; n: number } | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const redraw = () => bump((n) => n + 1)
    const offs = ids.map((id) => store.subscribeItem(id, redraw))
    return () => {
      for (const off of offs) off()
    }
  }, [ids])

  const items = ids.map((id) => store.getItem(id)).filter(Boolean) as Item[]
  const smart = items.length === ids.length ? smartOf(items) : null
  if (!smart) return null

  const z = view.z || 1
  const ring = RING / z
  const grip = GRIP / z
  const marks = gapMarks(items, smart)

  /* Every drag in here is the same shape: a snapshot at the press, positions
     written from that snapshot each frame — never from where the cards are
     now, which is moving — and one undo step for the whole thing. */
  const drag = (
    e: React.PointerEvent,
    step: (dx: number, dy: number, from: Item[], at: Smart) => void
  ) => {
    e.stopPropagation()
    e.preventDefault()
    holdPress()
    dragging.current = true
    const from = items.map((i) => ({ ...i }))
    const at = smart
    const sx = e.clientX
    const sy = e.clientY
    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)
    let began = false
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / z
      const dy = (ev.clientY - sy) / z
      if (!began && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 2) return
      if (!began) {
        store.beginGesture()
        began = true
      }
      step(dx, dy, from, at)
    }
    const up = () => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      dragging.current = false
      setSay(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const put = (moves: Map<string, { x: number; y: number }>) => {
    for (const [id, p] of moves) store.update(id, p, false)
  }

  return (
    <div className="smart" aria-hidden="true">
      {/* The gaps. Along a lane, and between the lanes of a grid — two
          different figures, so two sets of handles. */}
      {marks.map((m, i) => {
        const along = m.cross ? (smart.axis === 'x' ? 'y' : 'x') : smart.axis
        const was = m.cross ? (smart.cross ?? 0) : smart.gap
        return (
          <i
            key={i}
            className="smart-gap"
            data-across={along === 'y' || undefined}
            style={{
              transform: `translate3d(${m.x}px, ${m.y}px, 0)`,
              width: m.w,
              height: m.h,
              ['--grip' as string]: `${grip}px`,
            }}
            onPointerDown={(e) =>
              drag(e, (dx, dy, from, at) => {
                const d = along === 'x' ? dx : dy
                const gap = Math.max(0, Math.round(was + d))
                setSay({ x: m.x + m.w / 2, y: m.y + m.h / 2, n: gap })
                put(m.cross ? respace(from, at, at.gap, gap) : respace(from, at, gap, at.cross ?? undefined))
              })
            }
          />
        )
      })}

      {/* And a ring on each card, to move it along the row. */}
      {items.map((it) => (
        <i
          key={it.id}
          className="smart-ring"
          style={{
            transform: `translate3d(${it.x + it.w / 2 - ring}px, ${it.y + it.h / 2 - ring}px, 0)`,
            width: ring * 2,
            height: ring * 2,
          }}
          onPointerDown={(e) =>
            drag(e, (dx, dy, from, at) => {
              const to = slotAt(from, at, it.x + it.w / 2 + dx, it.y + it.h / 2 + dy)
              put(reorder(from, at, it.id, to))
            })
          }
        />
      ))}

      {say && (
        <b className="smart-say" style={{ transform: `translate3d(${say.x}px, ${say.y}px, 0)` }}>
          {say.n}
        </b>
      )}
    </div>
  )
}
