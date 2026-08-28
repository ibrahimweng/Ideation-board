import { useEffect, useMemo, useRef, useState } from 'react'
import { findCommands } from './commandFind'

/* ---------------------------------------------------------------------------
 * Everything the board can do, in one list, found by typing.
 *
 * A toolbar can only hold what fits across the top of the window, which is why
 * the old one was eleven grey words in a row with no room for a twelfth. This
 * has no such limit, so the things that were never in the toolbar — tidy up,
 * export the selected pictures, switch the theme, present the board — are as
 * reachable as the things that were, and the toolbar is free to carry only
 * what you reach for without thinking.
 *
 * It is also how anyone finds a shortcut: every entry says which keys run it,
 * so using the list teaches you how to stop using the list.
 * ------------------------------------------------------------------------- */

export interface Command {
  id: string
  name: string
  group: string
  hint?: string
  /* Words that should find this command without being in its name. */
  keywords?: string
  disabled?: boolean
  run: () => void
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const found = useMemo(() => findCommands(commands, q), [commands, q])

  useEffect(() => setAt(0), [q])

  /* Keep the chosen row in view when arrowing past the bottom of the list. */
  useEffect(() => {
    listRef.current?.querySelector('[data-at]')?.scrollIntoView({ block: 'nearest' })
  }, [at, found])

  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return
    onClose()
    /* After the palette is out of the way, so a command that opens a dialog
     * does not have to fight it for focus. */
    requestAnimationFrame(() => c.run())
  }

  return (
    <div className="cmd-veil" onPointerDown={onClose}>
      <div className="cmd" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Commands">
        <input
          className="cmd-input"
          autoFocus
          value={q}
          placeholder="What do you want to do?"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return onClose()
            if (e.key === 'Enter') return run(found[at])
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setAt((n) => Math.min(found.length - 1, n + 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setAt((n) => Math.max(0, n - 1))
            }
          }}
        />

        <div className="cmd-list" ref={listRef}>
          {!found.length && <p className="cmd-none">Nothing here does that.</p>}
          {found.map((c, i) => (
            <button
              key={c.id}
              className="cmd-row"
              data-at={i === at || undefined}
              disabled={c.disabled}
              onPointerEnter={() => setAt(i)}
              onClick={() => run(c)}
            >
              <span className="cmd-group">{c.group}</span>
              <span className="cmd-name">{c.name}</span>
              {c.hint && <em className="cmd-hint">{c.hint}</em>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
