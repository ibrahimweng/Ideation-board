import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { store, useOrder, useSelection, useQuery, useTagFilter } from '../state/store'
import { addUrl } from '../state/ingest'
import { parseQuery, passes, filtering } from '../state/search'
import type { Item } from '../state/types'
import { Card } from './Card'
import { Wires } from './Wires'
import { visibleRect, intersects, distanceToCentre, screenToBoard, zoomAt } from './viewport'
import type { Rect } from './viewport'
import { getEngine } from '../engine/client'
import { ContextMenu } from '../ui/ContextMenu'
import type { MenuState, CanvasActions } from '../ui/ContextMenu'

/* ---------------------------------------------------------------------------
 * The board surface.
 *
 * Two rules keep this fast regardless of how many cards exist:
 *
 *   1. Pan and zoom never go through React. The gesture writes a transform
 *      straight onto the surface node, so a pan is one compositor property
 *      change rather than a re-render of every card.
 *
 *   2. Only cards intersecting the padded viewport are mounted, and the
 *      mounted set is recomputed on a frame loop that calls setState only when
 *      the set actually changes — not on every frame of a pan.
 * ------------------------------------------------------------------------- */

interface Props {
  onDropFiles: (files: FileList | File[], at: { x: number; y: number }) => void
  /* 'open' follows the card: a board card opens its board, everything else
   * opens the editor. 'edit' always means the editor. */
  onOpenEditor: (id: string, mode?: 'open' | 'edit') => void
  canvasActions: CanvasActions
}

const SNAP = 8

export function Board({ onDropFiles, onOpenEditor, canvasActions }: Props) {
  const order = useOrder()
  const selection = useSelection()
  const query = useQuery()
  const tagFilter = useTagFilter()
  const vpRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState<string[]>([])
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const sizeRef = useRef({ w: 1400, h: 900 })
  const selSet = useMemo(() => new Set(selection), [selection])
  /* Recomputed only when the text changes, not on every render. */
  const words = useMemo(() => parseQuery(query), [query])
  const edgeIds = useMemo(() => order.filter((id) => store.getItem(id)?.kind === 'edge'), [order])
  const isFiltering = filtering(words, tagFilter)

  /* Applies the current viewport to the DOM without touching React state. */
  const paintTransform = useCallback(() => {
    const v = store.peekView()
    const s = surfaceRef.current
    if (s) s.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})`
  }, [])

  /* ---------- viewport measuring ---------- */
  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      sizeRef.current = { w: r.width, h: r.height }
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    sizeRef.current = { w: r.width, h: r.height }
    return () => ro.disconnect()
  }, [])

  /* ---------- the visible set ---------- */
  const rectRef = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 })
  const paintedRef = useRef('')
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const v = store.peekView()
      /* Gestures write the transform themselves for immediacy, but anything
       * that changes the viewport without going through a gesture, such as the
       * zoom buttons, would otherwise never move the surface. Painting here
       * when the value actually changed covers both. */
      const vk = `${v.x},${v.y},${v.z}`
      if (vk !== paintedRef.current) {
        paintedRef.current = vk
        paintTransform()
      }
      const { w, h } = sizeRef.current
      const r = visibleRect(v, w, h, 320)
      rectRef.current = r
      const ids: string[] = []
      for (const id of store.getOrder()) {
        const it = store.getItem(id)
        /* Wires are not cards and are not virtualised: they have no box to
         * test, and a wire whose cards are both off screen costs one path. */
        if (it && it.kind !== 'edge' && intersects(it, r)) ids.push(id)
      }
      const key = ids.join(',')
      /* setState only when membership changed, so a pan across empty board
       * space costs nothing. */
      if (key !== last) {
        last = key
        setVisible(ids)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [order, paintTransform])

  useEffect(() => {
    paintTransform()
  }, [paintTransform])

  /* ---------- wheel: pan and zoom ---------- */
  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const engine = getEngine()
      engine.touch()
      const v = store.peekView()
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        const next = zoomAt(v, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0035))
        store.setViewSilent(next)
      } else {
        store.setViewSilent({ x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
      paintTransform()
      scheduleCommit()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [paintTransform])

  /* Viewport changes settle into React state once the gesture stops, so the
   * minimap and zoom readout update without re-rendering during the gesture. */
  const commitRef = useRef<number | null>(null)
  const scheduleCommit = useCallback(() => {
    if (commitRef.current) clearTimeout(commitRef.current)
    commitRef.current = window.setTimeout(() => store.commitView(), 180)
  }, [])

  /* ---------- pointer: drag, marquee, pan ---------- */
  const onSurfacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = vpRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top

      /* Middle mouse or space-drag pans; plain drag on empty space marquees. */
      const panning = e.button === 1 || e.altKey
      const startView = { ...store.peekView() }
      const engine = getEngine()

      if (panning) {
        const move = (ev: PointerEvent) => {
          engine.touch()
          store.setViewSilent({ x: startView.x + (ev.clientX - e.clientX), y: startView.y + (ev.clientY - e.clientY) })
          paintTransform()
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          store.commitView()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        return
      }

      if (!e.shiftKey) store.clearSel()
      const start = screenToBoard(startView, sx, sy)
      const move = (ev: PointerEvent) => {
        const cx = ev.clientX - r.left
        const cy = ev.clientY - r.top
        const cur = screenToBoard(startView, cx, cy)
        const rect = {
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          w: Math.abs(cur.x - start.x),
          h: Math.abs(cur.y - start.y),
        }
        last = rect
        setMarquee(rect)
      }
      /* The final rectangle is tracked here rather than read out of state
       * inside a setState updater. An updater has to be pure, and selecting
       * notifies subscribers, which would set state in other components while
       * React is still rendering this one. */
      let last: Rect | null = null
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setMarquee(null)
        if (last && (last.w > 4 || last.h > 4)) {
          const hits = store
            .all()
            .filter((i) => i.kind !== 'section' && i.kind !== 'edge' && intersects(i, last!))
            .map((i) => i.id)
          store.select(hits, e.shiftKey)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [paintTransform]
  )

  /* Dragging a card moves the whole selection, and dragging a section takes
   * everything inside it along. Positions are written with recording off, so
   * one snapshot is taken when the drag actually starts moving and the whole
   * drag becomes a single undo step. */
  const onCardPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if ((e.target as HTMLElement).dataset.resize) return
    e.stopPropagation()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (additive) store.toggle(id)
    else if (!store.isSelected(id)) store.select([id])
    /* Sections sit behind their contents by design, so raising one would put
     * it over the very items it holds. */
    if (store.getItem(id)?.kind !== 'section') store.raise(id)

    const selected = store.getSelection().includes(id) ? store.getSelection() : [id]
    const { ids, carried } = store.dragSet(selected)
    const z = store.peekView().z || 1
    const startX = e.clientX
    const startY = e.clientY
    const origin = new Map(ids.map((i) => [i, { ...store.getItem(i)! }]))
    /* Only what was dragged directly is re-tested against the sections.
     * Something that moved because its section moved is still in that
     * section, wherever the section went. */
    const testable = selected.filter((i) => !carried.has(i) && store.getItem(i)?.kind !== 'section')
    let moved = false
    let highlight: string | null = null
    const engine = getEngine()

    const setHighlight = (sectionId: string | null) => {
      if (sectionId === highlight) return
      document.querySelector('.card-section[data-drop]')?.removeAttribute('data-drop')
      if (sectionId) {
        document.querySelector(`.card-section[data-id="${sectionId}"]`)?.setAttribute('data-drop', '')
      }
      highlight = sectionId
    }

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / z
      const dy = (ev.clientY - startY) / z
      if (!moved && Math.hypot(dx, dy) < 2) return
      if (!moved) store.beginGesture()
      moved = true
      engine.touch()
      const snap = ev.shiftKey
      for (const [iid, o] of origin) {
        const nx = snap ? Math.round((o.x + dx) / SNAP) * SNAP : o.x + dx
        const ny = snap ? Math.round((o.y + dy) / SNAP) * SNAP : o.y + dy
        store.update(iid, { x: Math.round(nx), y: Math.round(ny) }, false)
      }
      /* Show which section would take the drop. */
      if (testable.length) {
        const lead = store.getItem(testable[0])
        setHighlight(lead ? store.sectionAt(lead.x + lead.w / 2, lead.y + lead.h / 2) : null)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setHighlight(null)
      if (moved && testable.length) store.reparentByPosition(testable)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  /* Right clicking a card that is not in the selection selects just it, so
   * the menu always acts on something the pointer is actually over. */
  const onCardContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    const sel = store.getSelection()
    const ids = sel.includes(id) ? sel : [id]
    if (!sel.includes(id)) store.select([id])
    setMenu({ x: e.clientX, y: e.clientY, ids })
  }, [])

  /* Right clicking bare board opens the add menu. Cards stop the event
   * themselves, so reaching here means nothing was under the pointer. */
  const onSurfaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const el = vpRef.current
    if (!el) return
    const t = e.target as HTMLElement
    if (!t.classList.contains('viewport') && !t.classList.contains('surface')) return
    const r = el.getBoundingClientRect()
    const board = screenToBoard(store.peekView(), e.clientX - r.left, e.clientY - r.top)
    setMenu({ x: e.clientX, y: e.clientY, ids: [], board })
  }, [])

  /* ---------- drop ---------- */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const el = vpRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const at = screenToBoard(store.peekView(), e.clientX - r.left, e.clientY - r.top)
      if (e.dataTransfer.files?.length) {
        onDropFiles(e.dataTransfer.files, at)
        return
      }
      /* Dragging a video straight out of another tab: the browser hands over
       * the address rather than the file. */
      const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '')
        .split(/[\r\n]+/)
        .find((l) => /^https?:\/\//i.test(l.trim()))
      if (url) addUrl(at, url.trim())
    },
    [onDropFiles]
  )

  /* Zooming from a button has no cursor to anchor on, so it anchors on the
   * middle of the viewport. Setting the scale alone would push the board off
   * screen, because the surface scales from its origin. */
  const zoomBy = useCallback((factor: number) => {
    const { w, h } = sizeRef.current
    store.setView(zoomAt(store.peekView(), w / 2, h / 2, factor))
  }, [])

  const resetZoom = useCallback(() => {
    const v = store.peekView()
    const { w, h } = sizeRef.current
    store.setView(zoomAt(v, w / 2, h / 2, 1 / (v.z || 1)))
  }, [])

  const rect = rectRef.current

  return (
    <div
      className="viewport"
      ref={vpRef}
      onPointerDown={onSurfacePointerDown}
      onContextMenu={onSurfaceContextMenu}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-dragover={dragOver || undefined}
    >
      <div className="surface" ref={surfaceRef}>
        <Wires ids={edgeIds} selected={selection} />
        {visible.map((id) => {
          const it = store.getItem(id)
          if (!it) return null
          return (
            <Card
              key={id}
              id={id}
              selected={selSet.has(id)}
              dim={isFiltering && !passes(it, words, tagFilter)}
              distance={distanceToCentre(it, rect)}
              onPointerDown={onCardPointerDown}
              onOpenEditor={onOpenEditor}
              onContextMenu={onCardContextMenu}
            />
          )
        })}
        {marquee && (
          <div
            className="marquee"
            style={{ transform: `translate3d(${marquee.x}px, ${marquee.y}px, 0)`, width: marquee.w, height: marquee.h }}
          />
        )}
      </div>

      {dragOver && <div className="drop-veil">Drop to add</div>}
      <ZoomBar onZoom={zoomBy} onReset={resetZoom} />
      {menu && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onOpenEditor={onOpenEditor}
          canvas={canvasActions}
        />
      )}
    </div>
  )
}

function ZoomBar({ onZoom, onReset }: { onZoom: (factor: number) => void; onReset: () => void }) {
  const [z, setZ] = useState(() => store.peekView().z)
  useEffect(() => store.subscribeView(() => setZ(store.peekView().z)), [])
  return (
    <div className="zoombar">
      <button onClick={() => onZoom(1 / 1.25)} title="Zoom out">
        −
      </button>
      <button className="zoomval" onClick={onReset} title="Reset zoom">
        {Math.round(z * 100)}%
      </button>
      <button onClick={() => onZoom(1.25)} title="Zoom in">
        +
      </button>
    </div>
  )
}

export type { Item }
