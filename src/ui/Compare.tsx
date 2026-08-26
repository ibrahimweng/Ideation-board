import { useCallback, useEffect, useMemo, useState } from 'react'
import { store } from '../state/store'
import type { Item } from '../state/types'
import { readingOrder } from '../state/order'
import { Stage, fitStage } from './Stage'
import { bestGrid, MOST } from './compare'
import { holdKeys } from './modal'

/* ---------------------------------------------------------------------------
 * Two, three or four things, held up against each other.
 *
 * Everything else here helps you gather and record. This is the deciding, and
 * it was the one part with nothing behind it: the show puts one thing on the
 * screen at a time, and the question when you are choosing is always what the
 * other one looked like. On a board they are the size of cards, side by side
 * with thirty others; here they are the size of the screen, with nothing else
 * on it, which is the only way two photographs can honestly be compared.
 *
 * And the decision is made from inside it, because that is the moment you have
 * made up your mind: I keeps what is focused, O cuts it, and the marks are the
 * same ones the board shows.
 * ------------------------------------------------------------------------- */

export function Compare({ ids, onClose, say }: { ids: string[]; onClose: () => void; say: (t: string) => void }) {
  /* Reading order, so what was arranged deliberately is held up in the order
   * it was arranged, and never more than four. */
  const [at, setAt] = useState(0)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  /* Counted rather than subscribed to: a mark made here has to be read back
     out of the store for the labels below to be current, and this is what
     tells the list to look again. */
  const [marks, setMarks] = useState(0)

  const items = useMemo(() => {
    const chosen = ids.map((id) => store.getItem(id)).filter((i): i is Item => !!i)
    return readingOrder(chosen).slice(0, MOST)
  }, [ids, marks])
  const tooMany = ids.length - items.length

  useEffect(holdKeys, [])

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const mark = useCallback(
    (pick: 'in' | 'out') => {
      const item = items[at]
      if (!item) return
      const now = store.setPick([item.id], pick)
      setMarks((n) => n + 1)
      if (!now) return
      say(now.pick === 'in' ? `Kept ${item.name || 'it'}` : now.pick === 'out' ? `Cut ${item.name || 'it'}` : 'Unmarked')
    },
    [items, at, say]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault()
        return setAt((n) => (n + 1) % Math.max(1, items.length))
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        return setAt((n) => (n - 1 + items.length) % Math.max(1, items.length))
      }
      /* The number of the one you mean, which is written on it. */
      const n = Number(e.key)
      if (n >= 1 && n <= items.length) {
        e.preventDefault()
        return setAt(n - 1)
      }
      const k = e.key.toLowerCase()
      if (k === 'i') {
        e.preventDefault()
        return mark('in')
      }
      if (k === 'o') {
        e.preventDefault()
        return mark('out')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length, mark, onClose])

  if (!items.length) {
    return (
      <div className="present compare" onPointerDown={onClose}>
        <p className="present-none">Pick out two or more things to hold up against each other.</p>
      </div>
    )
  }

  /* The room the tiles have: the screen, less the bar along the bottom and a
   * margin, and less the line under each one that says what it is. */
  const CAPTION = 34
  const grid = bestGrid(items.length, size.w - 48, size.h - 128, 20)
  const focused = items[Math.min(at, items.length - 1)]

  return (
    <div className="present compare">
      <div
        className="compare-grid"
        style={{ gridTemplateColumns: `repeat(${grid.cols}, ${Math.floor(grid.tile.w)}px)` }}
      >
        {items.map((item, i) => {
          const box = fitStage(item, grid.tile.w, grid.tile.h - CAPTION)
          return (
            <div
              key={item.id}
              className="compare-cell"
              data-on={i === at || undefined}
              data-pick={item.pick || undefined}
              onPointerDown={(e) => {
                e.stopPropagation()
                setAt(i)
              }}
            >
              <div className="compare-hold" style={{ height: grid.tile.h - CAPTION }}>
                <Stage item={item} box={box} tag="compare" />
              </div>
              <div className="compare-say">
                <b>{i + 1}</b>
                <span>{item.name || item.text || item.kind}</span>
                {item.pick && <em data-pick={item.pick}>{item.pick === 'in' ? 'Kept' : 'Cut'}</em>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="present-bar">
        <span className="present-name">
          {focused.name || focused.text || focused.kind}
          {tooMany > 0 && <i className="compare-more"> — {tooMany} more not shown</i>}
        </span>
        <span className="present-count">{items.length} side by side</span>
        <button
          className="compare-do"
          data-pick="in"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => mark('in')}
          title="Keep this one (I)"
        >
          Keep
        </button>
        <button
          className="compare-do"
          data-pick="out"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => mark('out')}
          title="Cut this one (O)"
        >
          Cut
        </button>
        <button className="present-close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} title="Leave (Esc)">
          Done
        </button>
      </div>
    </div>
  )
}
