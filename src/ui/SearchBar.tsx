import { useCallback, useEffect, useRef, useState } from 'react'
import { store, useQuery, useTagFilter } from '../state/store'
import { findMatches } from '../state/search'
import { isSection } from '../state/kinds'
import { KEYS } from './shortcuts'

/* ---------------------------------------------------------------------------
 * Search.
 *
 * Cards that do not match fade out rather than disappearing. On a board, where
 * you put something is part of what you know about it, so removing the cards
 * around a result would take away the very thing that helps you recognise it.
 * ------------------------------------------------------------------------- */

export function SearchBar() {
  const q = useQuery()
  const tag = useTagFilter()
  const ref = useRef<HTMLInputElement | null>(null)
  /* Which result stepping through has reached. */
  const [at, setAt] = useState(0)

  const results = findMatches(store.all(), q, tag)
  const total = results.length

  useEffect(() => {
    setAt(0)
  }, [q, tag])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const cmd = e.metaKey || e.ctrlKey
      if ((cmd && e.key.toLowerCase() === KEYS.search.key) || (!typing && !cmd && e.key === '/')) {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Moves the board so the result sits in the middle, without changing zoom. */
  const goTo = useCallback((index: number) => {
    const list = findMatches(store.all(), store.getQuery(), store.getTagFilter())
    if (!list.length) return
    const it = list[((index % list.length) + list.length) % list.length]
    const el = document.querySelector('.viewport')
    const r = el ? el.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight }
    const v = store.peekView()
    store.setView({
      x: r.width / 2 - (it.x + it.w / 2) * v.z,
      y: r.height / 2 - (it.y + it.h / 2) * v.z,
    })
    store.select([it.id])
  }, [])

  const step = (delta: number) => {
    if (!total) return
    const next = ((at + delta) % total + total) % total
    setAt(next)
    goTo(next)
  }

  const selectAll = () => {
    const list = findMatches(store.all(), store.getQuery(), store.getTagFilter()).filter((i) => !isSection(i))
    if (!list.length) return
    store.select(list.map((i) => i.id))
    ref.current?.blur()
  }

  const clear = () => {
    store.setQuery('')
    ref.current?.blur()
  }

  return (
    <div className="search" data-active={q.trim() || tag ? true : undefined}>
      <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="text"
        value={q}
        placeholder="Search"
        aria-label="Search cards"
        spellCheck={false}
        onChange={(e) => store.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            /* Enter walks the results one at a time. Holding the command key
               takes the lot, which is the step that was missing: narrowing a
               board to four cards and then having no way to act on those four
               left the search box a way of looking and never a way of doing. */
            if (e.metaKey || e.ctrlKey) selectAll()
            else step(e.shiftKey ? -1 : 1)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            clear()
          }
        }}
      />
      {(q.trim() || tag) && (
        <>
          {total ? (
            <button
              className="search-count"
              onClick={selectAll}
              title={`Select all ${total} (${KEYS.selectShown.hint})`}
            >
              {at + 1}/{total}
            </button>
          ) : (
            <span className="search-count">none</span>
          )}
          <button className="search-clear" onClick={clear} title="Clear search (Esc)" aria-label="Clear search">
            ×
          </button>
        </>
      )}
      {!q && <kbd aria-hidden="true">{KEYS.search.hint}</kbd>}
    </div>
  )
}
