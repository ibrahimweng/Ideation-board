import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { store, useTagFilter, useOrder } from '../state/store'
import { TAGS } from '../state/types'
import { UNTAGGED } from '../state/search'
import { isSection } from '../state/kinds'

/* ---------------------------------------------------------------------------
 * Filter the board down to one tag.
 *
 * Works with the search box rather than against it. A card has to satisfy both
 * to stay lit, so the two together narrow the board.
 * ------------------------------------------------------------------------- */

export function TagFilter() {
  const tag = useTagFilter()
  /* Counts change as cards are added or removed. */
  const order = useOrder()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  /* The top bar clips its contents so nothing can spill onto the board, which
   * would also clip this. Positioning it against the window instead lets it
   * hang below the bar. */
  useLayoutEffect(() => {
    if (!open) return
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const w = popRef.current?.getBoundingClientRect().width ?? 180
    setPos({ x: Math.max(8, Math.min(b.left, window.innerWidth - w - 8)), y: b.bottom + 6 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', () => setOpen(false))
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = store.all().filter((i) => !isSection(i))
  const countFor = (t: string | null) =>
    t === null ? items.length : t === UNTAGGED ? items.filter((i) => !i.tag).length : items.filter((i) => i.tag === t).length
  void order

  const active = TAGS.find((t) => t.id === tag)
  const label = tag === UNTAGGED ? 'Untagged' : active ? active.id : 'All tags'

  const choose = (next: string | null) => {
    store.setTagFilter(next)
    setOpen(false)
  }

  const Row = ({ value, name, colour }: { value: string | null; name: string; colour?: string }) => (
    <button data-on={tag === value || undefined} onClick={() => choose(value)}>
      <span className="tf-dot" style={colour ? { background: colour } : undefined} data-any={value === null || undefined} />
      <span className="tf-name">{name}</span>
      <em>{countFor(value)}</em>
    </button>
  )

  return (
    <>
      <button
        ref={btnRef}
        className="tagfilter"
        data-active={tag ? true : undefined}
        aria-label={`Filter by tag, currently ${label}`}
        aria-expanded={open}
        title={`Filter by tag (${label})`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tf-dot" style={active ? { background: active.c } : undefined} data-any={!tag || undefined} />
        <span className="tf-label">{label}</span>
        <svg viewBox="0 0 10 6" aria-hidden="true" className="tf-caret">
          <path d="M1 1.5 L5 5 L9 1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="tf-pop" ref={popRef} style={{ left: pos.x, top: pos.y }}>
          <Row value={null} name="All tags" />
          <div className="menu-sep" />
          {TAGS.map((t) => (
            <Row key={t.id} value={t.id} name={t.id} colour={t.c} />
          ))}
          <div className="menu-sep" />
          <Row value={UNTAGGED} name="Untagged" />
        </div>
      )}
    </>
  )
}
