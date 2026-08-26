import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { store, useQuery, useTagFilter } from '../state/store'
import { findMatches } from '../state/search'
import { isSection } from '../state/kinds'
import { findInTree, labelOf, loadTree, MAX_FOUND } from '../state/deep'
import type { Found } from '../state/deep'
import type { Crumb } from '../state/boards'
import { KEYS } from './shortcuts'
import { keysHeld } from './modal'

/* ---------------------------------------------------------------------------
 * Search.
 *
 * Cards that do not match fade out rather than disappearing. On a board, where
 * you put something is part of what you know about it, so removing the cards
 * around a result would take away the very thing that helps you recognise it.
 * ------------------------------------------------------------------------- */

export function SearchBar({ path, onGo }: { path: Crumb[]; onGo: (to: Crumb[], itemId: string) => void }) {
  const q = useQuery()
  const tag = useTagFilter()
  const ref = useRef<HTMLInputElement | null>(null)
  /* Which result stepping through has reached. */
  const [at, setAt] = useState(0)

  const results = findMatches(store.all(), q, tag)
  const total = results.length

  /* And what is inside the boards you are not looking at. */
  const [elsewhere, setElsewhere] = useState<Found[]>([])
  const [showElsewhere, setShowElsewhere] = useState(false)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    setAt(0)
  }, [q, tag])

  /* One letter matches most of a board, so the walk waits until there is
   * something worth walking for, and waits again for the typing to stop. */
  useEffect(() => {
    const words = q.trim()
    if (words.length < 2 && !tag) {
      setElsewhere([])
      setShowElsewhere(false)
      return
    }
    let live = true
    const timer = window.setTimeout(() => {
      void loadTree(store.all(), path).then((nodes) => {
        if (live) setElsewhere(findInTree(nodes, q, tag))
      })
    }, 260)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [q, tag, path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Something is covering the board — the show, comparing, a prompt. The
         search box is behind it, and pulling the focus into a field nobody can
         see is worse than the shortcut not working. */
      if (keysHeld()) return
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

  /* The bar clips its contents so nothing can spill onto the board, which
   * would also clip this, so the list is positioned against the window. */
  useLayoutEffect(() => {
    if (!showElsewhere) return
    const b = ref.current?.closest('.search')?.getBoundingClientRect()
    if (!b) return
    const w = popRef.current?.getBoundingClientRect().width ?? 280
    setPos({ x: Math.max(8, Math.min(b.left, window.innerWidth - w - 8)), y: b.bottom + 6 })
  }, [showElsewhere, elsewhere.length])

  useEffect(() => {
    if (!showElsewhere) return
    const onDown = (e: PointerEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      setShowElsewhere(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowElsewhere(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', () => setShowElsewhere(false))
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [showElsewhere])

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
    <div className="search" data-active={q.trim() || tag ? true : undefined} data-deep={elsewhere.length > 0 || undefined}>
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
      {/* Nesting is meant to be how you put work away, and without this it is
          how you lose it: a note one board down was invisible to the box that
          exists to find things. */}
      {elsewhere.length > 0 && (
        <button
          className="search-deep"
          onClick={() => setShowElsewhere((v) => !v)}
          aria-expanded={showElsewhere}
          title="Matches inside the boards on this one"
        >
          +{elsewhere.length}
          {elsewhere.length >= MAX_FOUND ? '+' : ''} elsewhere
        </button>
      )}
      {showElsewhere && (
        <div className="deep-pop" ref={popRef} style={{ left: pos.x, top: pos.y }}>
          <div className="menu-head">
            In {new Set(elsewhere.map((f) => f.where)).size === 1 ? elsewhere[0].where : 'other boards'}
          </div>
          {elsewhere.map((f) => (
            <button
              key={f.path[f.path.length - 1].id + f.item.id}
              onClick={() => {
                setShowElsewhere(false)
                ref.current?.blur()
                onGo(f.path, f.item.id)
              }}
            >
              <span className="deep-what">{labelOf(f.item)}</span>
              <em>{f.where}</em>
            </button>
          ))}
        </div>
      )}
      {!q && <kbd aria-hidden="true">{KEYS.search.hint}</kbd>}
    </div>
  )
}
