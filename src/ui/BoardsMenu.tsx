import { useEffect, useRef, useState } from 'react'
import { listRoots, newRoot, urlForBoard } from '../state/roots'
import type { Root } from '../state/roots'

/* ---------------------------------------------------------------------------
 * The other boards.
 *
 * Every entry is a real link to a real address, which is the whole design.
 * Clicking one switches this tab; holding the usual modifier opens it in
 * another, because that is what a browser does with a link and nothing here
 * has to reinvent it. Two boards side by side is then two tabs, which an
 * in-app switcher could never have given you.
 *
 * The list is only fetched when it is opened. It is a pass over every board
 * record, and nobody needs that on the way into a board they already know
 * the name of.
 * ------------------------------------------------------------------------- */

export function BoardsMenu({ current, onNew }: { current: string; onNew: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [roots, setRoots] = useState<Root[] | null>(null)
  const [making, setMaking] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    void listRoots().then((list) => {
      if (live) setRoots(list)
    })
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      live = false
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const make = async () => {
    if (making) return
    setMaking(true)
    try {
      onNew(await newRoot())
    } finally {
      setMaking(false)
      setOpen(false)
    }
  }

  return (
    <div className="boards" ref={box}>
      <button
        className="boards-open"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Your boards"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M4 6.5 8 10.5l4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="boards-list" role="menu">
          {roots === null ? (
            <span className="boards-wait">Looking…</span>
          ) : (
            <>
              {roots.map((r) => (
                <a
                  key={r.id}
                  role="menuitem"
                  href={urlForBoard(r.id)}
                  data-on={r.id === current || undefined}
                  /* Left alone entirely when a modifier is held, so the
                     browser's own "open in a new tab" happens instead. */
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                    setOpen(false)
                  }}
                >
                  <span className="boards-name">{r.name}</span>
                  <span className="boards-count">{r.cards || 'empty'}</span>
                </a>
              ))}
              <button className="boards-new" onClick={() => void make()} disabled={making}>
                {making ? 'Making…' : 'New board'}
              </button>
              <p className="boards-hint">Hold ⌘ or Ctrl to open one in another tab</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
