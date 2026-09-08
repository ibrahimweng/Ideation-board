import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { findCommands } from './commandFind'
import { useDialog } from './dialog'

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
  const dialog = useDialog(onClose)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  /* One prefix per open list, so a row can be pointed at by name. */
  const rowId = useId()
  const nameOf = (id: string) => `${rowId}-${id.replace(/[^a-zA-Z0-9]/g, '-')}`

  const found = useMemo(() => findCommands(commands, q), [commands, q])

  useEffect(() => setAt(0), [q])

  /* Keep the chosen row in view when arrowing past the bottom of the list. */
  useEffect(() => {
    listRef.current?.querySelector('[data-at]')?.scrollIntoView({ block: 'nearest' })
  }, [at, found])

  /* Whether there is more below.
   *
   * Forty commands in a box that holds fourteen, and the only sign of the
   * other twenty six was the last row happening to be cut in half — at
   * ninety four percent of its height, which does not read as cut at all. So
   * the list ended, as far as anyone could tell, at "Put them on this board".
   *
   * The hint is a screen that dots the last row out into the surface, in the
   * same ink as everything else here, and it goes when there is nothing left
   * to scroll to. */
  const [more, setMore] = useState(false)
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const look = () => setMore(list.scrollTop + list.clientHeight < list.scrollHeight - 2)
    look()
    list.addEventListener('scroll', look, { passive: true })
    /* The list gets shorter as you type, and a hint left behind on a list of
     * three is worse than no hint at all. */
    const watch = new ResizeObserver(look)
    watch.observe(list)
    return () => {
      list.removeEventListener('scroll', look)
      watch.disconnect()
    }
  }, [found])

  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return
    onClose()
    /* After the palette is out of the way, so a command that opens a dialog
     * does not have to fight it for focus. */
    requestAnimationFrame(() => c.run())
  }

  return (
    <div className="cmd-veil" onPointerDown={onClose}>
      <div
        ref={dialog}
        className="cmd"
        data-more={more || undefined}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Commands"
      >
        {/* A field with a list under it that the arrows move through, which is
            a combobox — and saying so is the only way anything reading the
            page finds out which row is about to run. The focus never leaves
            the field, so the highlighted row has to be named rather than
            focused. */}
        <input
          className="cmd-input"
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${rowId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={found[at] ? nameOf(found[at].id) : undefined}
          value={q}
          placeholder="What do you want to do?"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
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

        <div className="cmd-list" ref={listRef} id={`${rowId}-list`} role="listbox" aria-label="Commands">
          {!found.length && <p className="cmd-none">Nothing here does that.</p>}
          {found.map((c, i) => (
            <button
              key={c.id}
              id={nameOf(c.id)}
              className="cmd-row"
              role="option"
              aria-selected={i === at}
              /* Out of the tab order on purpose: the field keeps the focus and
                 names the row it is on, and a list you could also Tab into
                 would be two ways of being somewhere at once. */
              tabIndex={-1}
              data-at={i === at || undefined}
              disabled={c.disabled}
              onPointerEnter={() => setAt(i)}
              onClick={() => run(c)}
            >
              {/* The part of the board this belongs to, unless the name
                  already opens with it: "Add · Add files" is one word twice
                  and reads like a stutter. The column keeps its width either
                  way, so the names still line up down the list. */}
              <span className="cmd-group">
                {c.name.toLowerCase().startsWith(c.group.toLowerCase()) ? '' : c.group}
              </span>
              <span className="cmd-name">{c.name}</span>
              {c.hint && <em className="cmd-hint">{c.hint}</em>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
