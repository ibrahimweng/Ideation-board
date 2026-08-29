import { useCallback, useEffect, useRef, useState } from 'react'
import { listRoots, newRoot, tabOrder, urlForBoard } from '../state/roots'
import type { Root } from '../state/roots'

/* ---------------------------------------------------------------------------
 * One tab per project.
 *
 * A board used to be the board, with everything else nested inside it — a fine
 * way to keep one project and a poor way to keep four. This is the row along
 * the top: every project you have, which one you are in, and the two things
 * you do to that list, which are add and remove.
 *
 * It is not the breadcrumbs. The crumbs say where you are *inside* a project,
 * and the tabs say which project. Two rows because they are two questions, and
 * folding them together would mean a board four levels down looked like a
 * fifth project.
 *
 * The tabs are links, and switching does not reload. The link is there so the
 * address can follow the tab — a reload comes back where you were — and so the
 * browser's own "open in a new tab" still works for anybody who wants it. The
 * click is handled here, so the ordinary case is instant.
 * ------------------------------------------------------------------------- */

/* The board itself is what these tabs show, so it is the panel they name.
 * One panel for all of them, because there is one board on screen. */
export const BOARD_PANEL = 'board-panel'

export interface BoardTabsProps {
  /* The project on screen. */
  current: string
  /* Its name as it is being typed, so the tab follows the field in the bar
   * rather than lagging a save behind it. */
  currentName?: string
  /* How many there are, for whoever needs to know without reading the list
   * again — this has just read it. */
  onCount?: (n: number) => void
  /* Switch to one, without a reload. */
  onOpen: (id: string) => void
  /* Made and switched to. */
  onNew: (id: string) => void
  /* Gone, along with everything in it. Answering is this component's job; the
   * asking belongs to whoever knows how much is about to be destroyed. */
  onClose: (id: string, name: string) => void
  /* Bumped by the app whenever the list could have changed underneath: a
   * rename, a board added from a card, an import. */
  revision?: number
}

export function BoardTabs({ current, currentName, onOpen, onNew, onClose, onCount, revision = 0 }: BoardTabsProps) {
  const [roots, setRoots] = useState<Root[]>([])
  const [making, setMaking] = useState(false)
  const strip = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    const list = await listRoots()
    setRoots(list)
    onCount?.(list.length)
  }, [onCount])

  useEffect(() => {
    void refresh()
  }, [refresh, current, revision])

  /* Enough projects and the row runs off the end of the window. Switching to
   * one you cannot see — from the command list, or by landing somewhere after
   * closing the tab you were in — would otherwise leave the row apparently
   * unchanged, with the tab you are in scrolled out of sight. */
  useEffect(() => {
    const on = strip.current?.querySelector('.tab[data-on]')
    on?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current, roots])

  const make = async () => {
    if (making) return
    setMaking(true)
    try {
      onNew(await newRoot())
    } finally {
      setMaking(false)
    }
  }

  const shown = tabOrder(roots)
  const nameOf = (r: Root) => (r.id === current && currentName !== undefined ? currentName : r.name)

  /* The keyboard contract a row of tabs owes.
   *
   * Saying `role="tablist"` is a promise that the arrow keys move along the
   * row, and it was a promise this did not keep: every tab sat in the page's
   * own tab order and nothing answered an arrow. Either the promise goes or it
   * is kept, and keeping it is worth more — a row of projects is exactly the
   * kind of thing somebody wants to walk along.
   *
   * Focus moves, and Enter opens. Not automatic activation, which is what
   * browser tabs do: opening a project here means reading a board off disk and
   * replacing everything on screen, and arrowing past four of them should not
   * do that four times. */
  const onKeys = (e: React.KeyboardEvent) => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('.tab') || [])]
    const at = tabs.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    const go = (i: number) => {
      e.preventDefault()
      tabs[(i + tabs.length) % tabs.length]?.focus()
    }
    if (e.key === 'ArrowRight') return go(at + 1)
    if (e.key === 'ArrowLeft') return go(at - 1)
    if (e.key === 'Home') return go(0)
    if (e.key === 'End') return go(tabs.length - 1)
    /* The × is out of the page's tab order — a tab is not allowed to hold
     * something else you can land on — so this is how it is reached without a
     * mouse. It still asks before it destroys anything. */
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const r = shown[at]
      if (!r) return
      e.preventDefault()
      onClose(r.id, nameOf(r) || 'this board')
    }
  }

  return (
    <div className="tabs">
      <div className="tabs-strip" ref={strip} role="tablist" aria-label="Your projects" onKeyDown={onKeys}>
        {shown.map((r) => (
          <a
            key={r.id}
            role="tab"
            className="tab"
            href={urlForBoard(r.id)}
            aria-selected={r.id === current}
            aria-controls={BOARD_PANEL}
            /* Named outright rather than from what is inside it, or the × in
             * the corner would be read out as part of the project's name. */
            aria-label={nameOf(r) || 'Untitled board'}
            /* One stop for the whole row, and the arrows to move inside it —
             * so tabbing through the app does not mean tabbing through every
             * project you have. */
            tabIndex={r.id === current ? 0 : -1}
            data-on={r.id === current || undefined}
            title={`${nameOf(r)} — ${r.cards} card${r.cards === 1 ? '' : 's'}`}
            onClick={(e) => {
              /* A modifier means the browser's own gesture: let it have it. */
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault()
              if (r.id !== current) onOpen(r.id)
            }}
          >
            <span className="tab-name">{nameOf(r) || 'Untitled board'}</span>
            <button
              className="tab-close"
              /* Reachable by pointer, and by Delete on the tab itself. Not by
               * Tab: a tab that holds its own focusable button is not a tab
               * any more, and the row would take two stops per project. */
              tabIndex={-1}
              aria-label={`Delete ${nameOf(r) || 'this board'} and everything in it`}
              title="Delete this project"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onClose(r.id, nameOf(r) || 'this board')
              }}
            >
              ×
            </button>
          </a>
        ))}
      </div>
      <button className="tab-new" onClick={() => void make()} disabled={making} title="New project">
        {making ? '…' : '+'}
      </button>
    </div>
  )
}
