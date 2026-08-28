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

  return (
    <div className="tabs" role="tablist" aria-label="Your projects">
      <div className="tabs-strip" ref={strip}>
        {shown.map((r) => (
          <a
            key={r.id}
            role="tab"
            className="tab"
            href={urlForBoard(r.id)}
            aria-selected={r.id === current}
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
