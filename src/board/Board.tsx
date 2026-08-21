import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { store, useOrder, useSelection } from '../state/store'
import type { Item } from '../state/types'
import { Card } from './Card'
import { visibleRect, intersects, distanceToCentre, screenToBoard, zoomAt, clampZoom } from './viewport'
import type { Rect } from './viewport'
import { getEngine } from '../engine/client'

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
  onOpenEditor: (id: string) => void
}

const SNAP = 8

export function Board({ onDropFiles, onOpenEditor }: Props) {
  const order = useOrder()
  const selection = useSelection()
  const vpRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState<string[]>([])
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const sizeRef = useRef({ w: 1400, h: 900 })
  const selSet = useMemo(() => new Set(selection), [selection])

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
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const v = store.peekView()
      const { w, h } = sizeRef.current
      const r = visibleRect(v, w, h, 320)
      rectRef.current = r
      const ids: string[] = []
      for (const id of store.getOrder()) {
        const it = store.getItem(id)
        if (it && intersects(it, r)) ids.push(id)
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
  }, [order])

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
        setMarquee(rect)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setMarquee((m) => {
          if (m && (m.w > 4 || m.h > 4)) {
            const hits = store
              .all()
              .filter((i) => i.kind !== 'section' && intersects(i, m))
              .map((i) => i.id)
            store.select(hits, e.shiftKey)
          }
          return null
        })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [paintTransform]
  )

  /* Dragging a card moves the whole selection. Positions are written with
   * history recording off, then committed once on release. */
  const onCardPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if ((e.target as HTMLElement).dataset.resize) return
    e.stopPropagation()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    if (additive) store.toggle(id)
    else if (!store.isSelected(id)) store.select([id])
    store.raise(id)

    const ids = store.getSelection().includes(id) ? store.getSelection() : [id]
    const z = store.peekView().z || 1
    const startX = e.clientX
    const startY = e.clientY
    const origin = new Map(ids.map((i) => [i, { ...store.getItem(i)! }]))
    let moved = false
    const engine = getEngine()

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / z
      const dy = (ev.clientY - startY) / z
      if (!moved && Math.hypot(dx, dy) < 2) return
      moved = true
      engine.touch()
      const snap = ev.shiftKey
      for (const [iid, o] of origin) {
        const nx = snap ? Math.round((o.x + dx) / SNAP) * SNAP : o.x + dx
        const ny = snap ? Math.round((o.y + dy) / SNAP) * SNAP : o.y + dy
        store.update(iid, { x: Math.round(nx), y: Math.round(ny) }, false)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
      if (e.dataTransfer.files?.length) onDropFiles(e.dataTransfer.files, at)
    },
    [onDropFiles]
  )

  const rect = rectRef.current

  return (
    <div
      className="viewport"
      ref={vpRef}
      onPointerDown={onSurfacePointerDown}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-dragover={dragOver || undefined}
    >
      <div className="surface" ref={surfaceRef}>
        {visible.map((id) => {
          const it = store.getItem(id)
          if (!it) return null
          return (
            <Card
              key={id}
              id={id}
              selected={selSet.has(id)}
              distance={distanceToCentre(it, rect)}
              onPointerDown={onCardPointerDown}
              onOpenEditor={onOpenEditor}
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
      <ZoomBar />
    </div>
  )
}

function ZoomBar() {
  const [z, setZ] = useState(() => store.peekView().z)
  useEffect(() => store.subscribeView(() => setZ(store.peekView().z)), [])
  const set = (nz: number) => {
    store.setView({ z: clampZoom(nz) })
  }
  return (
    <div className="zoombar">
      <button onClick={() => set(z / 1.25)} title="Zoom out">
        −
      </button>
      <button className="zoomval" onClick={() => set(1)} title="Reset zoom">
        {Math.round(z * 100)}%
      </button>
      <button onClick={() => set(z * 1.25)} title="Zoom in">
        +
      </button>
    </div>
  )
}

export type { Item }
