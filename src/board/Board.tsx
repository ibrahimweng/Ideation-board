import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { store, useOrder, useSelection, useQuery, useTagFilter } from '../state/store'
import { addUrl } from '../state/ingest'
import { urlFromDrag } from '../state/dragged'
import { parseQuery, passes, filtering } from '../state/search'
import type { Item } from '../state/types'
import { Card } from './Card'
import { Wires } from './Wires'
import { guidesFrom, snap } from './snap'
import type { Guides } from './snap'
import { visibleRect, intersects, distanceToCentre, screenToBoard, zoomAt } from './viewport'
import type { Rect } from './viewport'
import { getEngine } from '../engine/client'
import { holdPress } from './press'
import { ContextMenu } from '../ui/ContextMenu'
import { FirstRun } from '../ui/FirstRun'
import { justLongPressed, noteLongPress, onLongPress } from './longpress'
import { noteViewportSize } from '../state/walk'
import { startTouch } from './touch'
import { isSection, isThing, isWire } from '../state/kinds'
import { DRAWN, DRAWS, FALLBACK, disarm, isShapeTool, toolNow, useTool } from './tool'
import type { ShapeTool } from './tool'
import { curveShape, drawnShape, freehandShape, pathShape, pressedShape, strokeDraft } from './drawing'
import { Nodes } from './Nodes'
import { SmartHandles } from './Smart'
import { Measure } from './Measure'
import { editNodes, hasNodes, useEditing } from './editing'
import type { Drawn, Pt } from './drawing'
import { pathFor } from '../state/shapes'
import type { Node } from '../state/shapes'
import { boundsOf, scaleAll } from './scaling'
import type { Box, Corner } from './scaling'
import { canFrame, reframeWheel, startReframe } from './reframe'
import { canTurn, startTurn, turnWheel } from './turning'
import { ThemeButton } from '../ui/ThemeButton'
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
  onExportPictures: (ids: string[]) => void
  onPullColours: (ids: string[]) => void
  onDepth: (ids: string[]) => void
  /* The two that move cards around rather than change them: gathering a
     selection into a place of its own, and taking it off this board to put on
     another. Both belong to the app, which knows where the boards are. */
  onGather: () => void
  onTakeAway: () => void
  canvasActions: CanvasActions
}

const SNAP = 8

/* How near a press has to land to count as being on a point you already put
   down, in screen pixels rather than board units: it is about how well
   somebody can aim, which does not change with the zoom. */
const GRAB = 10

/* A shape under the pointer, ready to draw: where it is, its path, and — for
   a pen — the points placed so far, in the draft's own coordinates. */
type Draft = Drawn & { d: string; dots?: Pt[] }

/* A path being placed a press at a time, in board units. */
interface Pen { tool: ShapeTool; nodes: Node[]; to: Pt | null }

export function Board({ onGather, onTakeAway, onDropFiles, onOpenEditor, onExportPictures, onPullColours, onDepth, canvasActions }: Props) {
  const order = useOrder()
  const selection = useSelection()
  const query = useQuery()
  const tagFilter = useTagFilter()
  const vpRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  /* Drawn straight to the DOM during a drag, like the surface transform: they
   * change every frame and mean nothing to anything else. */
  const guideV = useRef<HTMLElement | null>(null)
  const guideH = useRef<HTMLElement | null>(null)
  /* Fingers currently on the board, by pointer id. Kept here rather than in
   * the gesture, because a second finger arrives as a separate press. */
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const [visible, setVisible] = useState<string[]>([])
  const [marquee, setMarquee] = useState<Rect | null>(null)
  /* The shape under the pointer while one is being drawn. Its own state
     rather than the marquee's, because it is a different thing said in a
     different way: the marquee is what is about to be picked up, this is
     what is about to exist. */
  const [draft, setDraft] = useState<Draft | null>(null)
  /* And what a pen has placed so far. Held twice on purpose: the ref is what
     a pointer handler reads, because inside a gesture a re-render is a frame
     too late; the state is what the draft is drawn from, because between two
     presses there is nothing running to paint from. */
  const pen = useRef<Pen | null>(null)
  const [penView, setPenView] = useState<Pen | null>(null)
  /* For the cursor and for what the drawn box looks like. The gesture itself
     reads the module directly; this is only what is on screen. */
  const tool = useTool()
  /* Which drawing, if any, is having its points moved about. */
  const editing = useEditing()
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const sizeRef = useRef({ w: 1400, h: 900 })
  const selSet = useMemo(() => new Set(selection), [selection])
  /* The cards a single box is drawn round. A wire has no box of its own — it
     is drawn from the two cards it joins — so it comes along when they move
     and has nothing to scale. */
  const scaling = useMemo(
    () => selection.filter((id) => { const i = store.getItem(id); return !!i && !isWire(i) }),
    [selection]
  )
  /* One card keeps its own handles: resizing it freely is right, and there is
     no arrangement to hold together. */
  const grouped = scaling.length > 1
  /* Recomputed only when the text changes, not on every render. */
  const words = useMemo(() => parseQuery(query), [query])
  const edgeIds = useMemo(() => order.filter((id) => isWire(store.getItem(id))), [order])
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
  /* Viewport, window size and store revision, as of the last frame that
     actually did the work. See the note in the loop. */
  const restRef = useRef('')
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
      const moved = vk !== paintedRef.current
      if (moved) {
        paintedRef.current = vk
        paintTransform()
      }
      /* Nothing has moved and nothing has changed, so the answer is the one
       * from last frame and working it out again would produce the same set.
       *
       * The scan itself is cheap — a few tenths of a millisecond on a board of
       * eight thousand — so this is not about the cost of one frame. It is that
       * without it the loop walked every item and built two strings sixty times
       * a second forever, on a board nobody was touching, and a tab that never
       * goes quiet is one that keeps a laptop awake.
       *
       * Three things in the key, and each is a way the set can change without
       * the other two moving. The viewport, for a pan or a zoom. The size, for
       * a window resized while the viewport stayed put. And the store's
       * revision, which covers everything else: a card added, deleted, dragged,
       * tidied, undone, or moved by the relay. `touch()` sits on every write
       * path, so there is no fourth way. */
      const { w, h } = sizeRef.current
      const restKey = `${vk}|${w}x${h}|${store.rev}`
      if (restKey === restRef.current) return
      restRef.current = restKey
      noteViewportSize(w, h)
      const r = visibleRect(v, w, h, 320)
      rectRef.current = r
      const ids: string[] = []
      for (const id of store.getOrder()) {
        const it = store.getItem(id)
        /* Wires are not cards and are not virtualised: they have no box to
         * test, and a wire whose cards are both off screen costs one path. */
        if (it && !isWire(it) && intersects(it, r)) ids.push(id)
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

  /* What the modifiers say they will do, under the pointer. A cursor is the
   * only way a modifier gesture ever announces itself; without one it is a
   * feature you have to be told about — and there are two of them here now,
   * one key apart, so saying which is which matters more than it did.
   *
   * Alt on anything: a copy. Shift and alt on a picture: push it around
   * inside its card. */
  useEffect(() => {
    const set = (alt: boolean, shift: boolean) => {
      document.body.toggleAttribute('data-copying', alt && !shift)
      document.body.toggleAttribute('data-framable', alt && shift)
    }
    const down = (e: KeyboardEvent) => set(e.altKey, e.shiftKey)
    const up = (e: KeyboardEvent) => set(e.altKey, e.shiftKey)
    const off = () => set(false, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    /* A modifier held while the window goes away never sends its keyup. */
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
      set(false, false)
    }
  }, [])

  /* ---------- wheel: pan and zoom ---------- */
  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      /* Alt over a picture scales it inside its own card rather than moving
         the board underneath it, and over a model goes in and out. */
      if (turnWheel(e)) return
      if (reframeWheel(e)) return
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

  /* An armed tool is put down by Escape, wherever the focus is. A mode you
     cannot get out of without using it is a trap, and Escape is where
     everybody looks first. */
  useEffect(() => {
    const off = (e: KeyboardEvent) => { if (e.key === 'Escape') disarm() }
    window.addEventListener('keydown', off)
    return () => window.removeEventListener('keydown', off)
  }, [])

  /* ---------- the pens ---------- */

  const setPen = useCallback((p: Pen | null) => {
    pen.current = p
    setPenView(p)
  }, [])

  const makeShape = useCallback(
    (s: Drawn) => {
      canvasActions.addShape(
        { x: Math.round(s.x), y: Math.round(s.y) },
        { w: Math.round(s.w), h: Math.round(s.h) },
        s.spec
      )
    },
    [canvasActions]
  )

  /* The path as it stands, put on the board.
   *
   * `stand` is whether the tool goes down with it: it does when the path was
   * finished, and does not when the tool was changed out from under it —
   * which would otherwise disarm the tool somebody had just picked. */
  const finishPen = useCallback(
    (p: Pen, closed: boolean, stand = true) => {
      setPen(null)
      if (stand) disarm()
      const shape = p.tool === 'curve' ? curveShape(p.nodes, closed) : pathShape(p.tool, p.nodes, closed)
      if (shape) makeShape(shape)
    },
    [makeShape, setPen]
  )

  const placePoint = useCallback(
    (tool: ShapeTool, at: Pt, r: DOMRect, view: { x: number; y: number; z: number }) => {
      const cur = pen.current?.tool === tool ? pen.current : null
      const nodes = cur ? cur.nodes : []
      /* Pressing back onto a point you have already placed says that is the
         shape: the first one closes it, the last one leaves it open. Which
         also means a double-click ends a path without a double-click having
         to be a gesture of its own. */
      const onto = (n: Node) => Math.hypot(n.x - at.x, n.y - at.y) * view.z < GRAB
      if (nodes.length > 1 && onto(nodes[0])) return finishPen({ tool, nodes, to: null }, true)
      if (nodes.length > 1 && onto(nodes[nodes.length - 1])) return finishPen({ tool, nodes, to: null }, false)

      setPen({ tool, nodes: [...nodes, { x: at.x, y: at.y }], to: at })

      /* Dragging away from a point you have just put down pulls its handles
         out with it, which is what a pen has meant since the first one: the
         press says where the line goes, the drag says which way it leaves.
         The curvature tool has no use for it, because it bends the line
         through its points by itself. */
      if (tool !== 'pen') return
      const bend = (ev: PointerEvent) => {
        const to = screenToBoard(view, ev.clientX - r.left, ev.clientY - r.top)
        const dx = to.x - at.x
        const dy = to.y - at.y
        if (Math.hypot(dx, dy) * view.z < DRAWN) return
        setPen({ tool, nodes: [...nodes, { x: at.x, y: at.y, ox: dx, oy: dy, ix: -dx, iy: -dy }], to })
      }
      const bent = () => {
        window.removeEventListener('pointermove', bend)
        window.removeEventListener('pointerup', bent)
      }
      window.addEventListener('pointermove', bend)
      window.addEventListener('pointerup', bent)
    },
    [finishPen, setPen]
  )

  /* While a pen is running the line follows the pointer, and Enter or Escape
     says that is the shape. Taken in the capture phase, because Escape means
     something else everywhere else and a half-drawn path is the nearer
     thing to be talking about. */
  const penning = !!penView
  useEffect(() => {
    if (!penning) return
    const move = (ev: PointerEvent) => {
      const p = pen.current
      const el = vpRef.current
      if (!p || !el) return
      const box = el.getBoundingClientRect()
      setPen({ ...p, to: screenToBoard(store.peekView(), ev.clientX - box.left, ev.clientY - box.top) })
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' && ev.key !== 'Escape') return
      const p = pen.current
      if (!p) return
      ev.preventDefault()
      ev.stopPropagation()
      finishPen(p, false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('keydown', key, true)
    }
  }, [penning, finishPen, setPen])

  /* Putting the tool down finishes what it had started, rather than leaving
     half a path nowhere. */
  useEffect(() => {
    const p = pen.current
    if (p && tool !== p.tool) finishPen(p, false, false)
  }, [tool, finishPen])

  /* The path so far with a line out to the pointer, and the points on it —
     which is what a pen shows you between presses, and what tells you which
     one you would be pressing back onto to finish. */
  const penDraft = useMemo((): Draft | null => {
    const p = penView
    if (!p) return null
    const nodes = p.to ? [...p.nodes, { x: p.to.x, y: p.to.y }] : p.nodes
    const shape = p.tool === 'curve' ? curveShape(nodes, false) : pathShape(p.tool, nodes, false)
    if (!shape) return null
    return {
      ...shape,
      d: pathFor(shape.spec, shape.w, shape.h),
      dots: p.nodes.map((n) => ({ x: n.x - shape.x, y: n.y - shape.y })),
    }
  }, [penView])

  /* Only one of the two is ever set: a shape is either being dragged out or
     being placed a point at a time. */
  const shown = draft || penDraft

  /* Going to something else puts the points away. A press on the board or on
     another card changes the selection, which is the same thing said in the
     one place that already knows about it. */
  useEffect(() => {
    if (editing && !selection.includes(editing)) editNodes(null)
  }, [editing, selection])

  /* ---------- pointer: drag, marquee, pan ---------- */
  const onSurfacePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = vpRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left
      const sy = e.clientY - r.top

      /* Middle mouse or space-drag pans; plain drag on empty space marquees. */
      /* Same reason as the card drag below: a player must not be able to take
       * the end of a marquee or a pan that crosses it. */
      holdPress()
      const panning = e.button === 1 || e.altKey
      const startView = { ...store.peekView() }
      const engine = getEngine()

      /* ---------- fingers ---------- */
      if (e.pointerType === 'touch') {
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (touches.current.size > 1) return
        startTouch(e, {
          points: touches.current,
          rect: r,
          startView,
          paint: paintTransform,
          openMenu: setMenu,
        })
        return
      }

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

      /* A tool is armed, so this drag draws the box the new thing takes rather
         than selecting what is already on the board. Read out of the module
         rather than out of a hook, because this is inside a gesture and a
         re-render is a frame too late. */
      const tool = toolNow()

      /* A shape tool draws the shape itself rather than a box round it: what
         is under the pointer while the drag is running is the rectangle, the
         ellipse, the seven-pointed star or the arrow that is about to exist,
         which is the only honest preview of a tool that makes seven different
         things. Shift keeps it regular — a square, a circle, a line at an
         eighth of a turn — the same key that locks the aspect ratio when one
         is scaled. */
      if (tool && isShapeTool(tool)) {
        const from = screenToBoard(startView, sx, sy)

        /* The three pens are a gesture made of presses rather than one drag,
           so they keep their points between them and finish when you say. */
        if (DRAWS[tool] === 'points') {
          placePoint(tool, from, r, startView)
          return
        }

        /* And the pencil simply follows the hand. */
        if (DRAWS[tool] === 'free') {
          const pts: Pt[] = [from]
          const stroking = (ev: PointerEvent) => {
            pts.push(screenToBoard(startView, ev.clientX - r.left, ev.clientY - r.top))
            const d = strokeDraft(pts)
            setDraft(d && { ...d, d: pathFor(d.spec, d.w, d.h) })
          }
          const stroked = () => {
            window.removeEventListener('pointermove', stroking)
            window.removeEventListener('pointerup', stroked)
            setDraft(null)
            /* Two pixels on screen, whatever the zoom: at four hundred per
               cent the hand has not got steadier. */
            const shape = freehandShape(pts, 2 / startView.z) || pressedShape(tool, from)
            disarm()
            makeShape(shape)
          }
          window.addEventListener('pointermove', stroking)
          window.addEventListener('pointerup', stroked)
          return
        }

        let made: Drawn | null = null
        const drawing = (ev: PointerEvent) => {
          const cur = screenToBoard(startView, ev.clientX - r.left, ev.clientY - r.top)
          const far = Math.abs(cur.x - from.x) > DRAWN || Math.abs(cur.y - from.y) > DRAWN
          made = far ? drawnShape(tool, from, cur, ev.shiftKey) : null
          setDraft(made && { ...made, d: pathFor(made.spec, made.w, made.h) })
        }
        const drawn = () => {
          window.removeEventListener('pointermove', drawing)
          window.removeEventListener('pointerup', drawn)
          setDraft(null)
          /* Down before the card is made, so the thing that arrives selected
             is not immediately drawn over by a second one. */
          disarm()
          makeShape(made || pressedShape(tool, from))
        }
        window.addEventListener('pointermove', drawing)
        window.addEventListener('pointerup', drawn)
        return
      }

      if (tool) {
        const from = screenToBoard(startView, sx, sy)
        let box: Rect | null = null
        const drawing = (ev: PointerEvent) => {
          const cur = screenToBoard(startView, ev.clientX - r.left, ev.clientY - r.top)
          box = {
            x: Math.min(from.x, cur.x),
            y: Math.min(from.y, cur.y),
            w: Math.abs(cur.x - from.x),
            h: Math.abs(cur.y - from.y),
          }
          setMarquee(box)
        }
        const drawn = () => {
          window.removeEventListener('pointermove', drawing)
          window.removeEventListener('pointerup', drawn)
          setMarquee(null)
          /* A click rather than a drag still makes one, at the size the button
             would have made it. Nothing at all is the worst answer to a press
             on an armed tool: it looks like the tool is broken. */
          const made =
            box && box.w > DRAWN && box.h > DRAWN
              ? box
              : { x: from.x, y: from.y, ...FALLBACK[tool] }
          /* Down before the card is made, so the thing that arrives selected
             is not immediately drawn over by a second one. */
          disarm()
          const at = { x: Math.round(made.x), y: Math.round(made.y) }
          const size = { w: Math.round(made.w), h: Math.round(made.h) }
          if (tool === 'section') canvasActions.addSection(at, size)
          else canvasActions.addText(at, size)
        }
        window.addEventListener('pointermove', drawing)
        window.addEventListener('pointerup', drawn)
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
            .filter((i) => isThing(i) && intersects(i, last!))
            .map((i) => i.id)
          store.select(hits, e.shiftKey)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [paintTransform, canvasActions, placePoint, makeShape]
  )

/* Dragging a card moves the whole selection, and dragging a section takes
   * everything inside it along. Positions are written with recording off, so
   * one snapshot is taken when the drag actually starts moving and the whole
   * drag becomes a single undo step. */
  const onCardPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if ((e.target as HTMLElement).dataset.resize) return
    /* The curvature tool on a line that already exists means that line: it
       is the one tool here whose whole job is bending something rather than
       making it, so pressing a path with it opens the path's own points. */
    if (toolNow() === 'curve' && hasNodes(store.getItem(id))) {
      e.stopPropagation()
      disarm()
      store.select([id])
      editNodes(id)
      return
    }
    /* A tool is armed, so this press is drawing a box rather than picking
     * anything up — and it must be able to draw over what is already there.
     * Left to bubble rather than handled, so the surface underneath gets it:
     * without this a section could not have a text box written on it, which is
     * the first place anybody would put one. */
    if (toolNow()) return
    e.stopPropagation()

    /* Shift and alt and drag pushes the picture around inside its card
       instead of moving the card. It goes first because it is the one gesture
       here that must not raise, marquee, open a menu or take a long press: it
       is one card being looked at, and nothing else should happen while it
       is.
     *
     * It used to be alt alone. Alt alone is what every drawing program made
     * ever means by "copy this", which is what it means here now, and a
     * gesture that is universal outside this app should not be spent on
     * something only this app does. Alt and scroll still scales a picture in
     * its card, because nothing else wanted the wheel. */
    if (e.altKey && e.shiftKey && e.button === 0 && e.pointerType !== 'touch' && canFrame(store.getItem(id))) {
      holdPress()
      /* The panel follows what you are framing, but a selection you built on
         purpose is not thrown away to do it. */
      if (!store.isSelected(id)) store.select([id])
      /* On a model there is no picture to push about — there is a thing, and
         the same gesture turns it round to show the other side. */
      if (canTurn(store.getItem(id))) startTurn(e, id)
      else startReframe(e, id)
      return
    }
    /* Held still, a finger means the same as a right button. Cancelled below
       the moment the press turns into a drag. */
    let menued = false
    const held = onLongPress(e, (px, py) => {
      noteLongPress()
      menued = true
      const sel = store.getSelection()
      const ids = sel.includes(id) ? sel : [id]
      if (!sel.includes(id)) store.select([id])
      setMenu({ x: px, y: py, ids })
    })
    /* Take the embedded players out of the way for as long as the button is
     * down.
     *
     * A drag that passes over a player used to lose its own pointerup — an
     * iframe is a separate document and its events never reach this window —
     * so the card went on following the mouse for ever. It was worst on the
     * card that caused it: pressing an unselected player selects it, and
     * selecting it takes away the shield that was covering it, so the act of
     * starting the drag exposed the very thing that would swallow the end of
     * it.
     *
     * Pointer capture is the textbook answer and it does not work here. It is
     * set, and `hasPointerCapture` agrees it is held, and not one pointermove
     * arrives: a cross-origin frame runs in its own process, and Chromium
     * routes input into it before the parent document's capture is consulted.
     * Measured, with the capture confirmed held, before this was written.
     *
     * What does work is making the frame untargetable, so hit testing walks
     * past it. The flag goes on now rather than when the drag starts moving,
     * because "when it starts moving" needs a pointermove, and a pointermove
     * is the thing being lost.
     *
     * It is only ever set by a press that reached the card, so pressing a
     * selected player to play it — which lands in the frame and is never seen
     * here — is untouched.
     *
     * And capture is not the answer to add on top, either. Held on the card it
     * retargets the pointerup, and a click is only dispatched where the press
     * and the release agree — so the zoom buttons, and a video's own play
     * controls, quietly stop working. It was tried, it broke both, and it was
     * never fixing the thing it was there for. */
    holdPress()
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    /* The left button, or a finger. A right button is on its way to the menu,
       which acts on the whole selection and must not have it taken away. */
    const primary = e.button === 0
    if (additive) store.toggle(id)
    else if (!store.isSelected(id)) store.select([id])
    /* Sections sit behind their contents by design, so raising one would put
     * it over the very items it holds. */
    if (!isSection(store.getItem(id))) store.raise(id)

    const selected = store.getSelection().includes(id) ? store.getSelection() : [id]
    const { ids, carried } = store.dragSet(selected)
    const z = store.peekView().z || 1
    const startX = e.clientX
    const startY = e.clientY
    /* Three of these are not const, because alt turns this drag into a drag
       of a copy at the moment it starts moving, and from then on it is the
       copies that are being moved, re-tested and lined up. */
    let origin = new Map(ids.map((i) => [i, { ...store.getItem(i)! }]))
    /* Only what was dragged directly is re-tested against the sections.
     * Something that moved because its section moved is still in that
     * section, wherever the section went. */
    let testable = selected.filter((i) => !carried.has(i) && !isSection(store.getItem(i)))
    let moved = false
    let highlight: string | null = null
    const engine = getEngine()

    /* What the dragged card can line up with, worked out once: the lines every
     * other card offers, and the box the whole drag set starts in. */
    const dragging = new Set(ids)
    /* Only what is on screen: a card should not be pulled onto the edge of
     * something nobody can see, and it keeps the work per frame bounded. */
    const linesFor = (set: Set<string>): Guides =>
      guidesFrom(store.all().filter((i) => !set.has(i.id) && !isWire(i) && intersects(i, rectRef.current)))
    let lines: Guides = linesFor(dragging)
    const boxes = [...origin.values()]
    const startBox = {
      x: Math.min(...boxes.map((b) => b.x)),
      y: Math.min(...boxes.map((b) => b.y)),
      w: 0,
      h: 0,
    }
    startBox.w = Math.max(...boxes.map((b) => b.x + b.w)) - startBox.x
    startBox.h = Math.max(...boxes.map((b) => b.y + b.h)) - startBox.y
    const tol = 6 / z
    const thin = 1 / z

    const drawGuide = (el: HTMLElement | null, line: { at: number; from: number; to: number } | null, vertical: boolean) => {
      if (!el) return
      if (!line) {
        el.style.display = 'none'
        return
      }
      el.style.display = 'block'
      if (vertical) {
        el.style.left = `${line.at}px`
        el.style.top = `${line.from}px`
        el.style.width = `${thin}px`
        el.style.height = `${line.to - line.from}px`
      } else {
        el.style.left = `${line.from}px`
        el.style.top = `${line.at}px`
        el.style.width = `${line.to - line.from}px`
        el.style.height = `${thin}px`
      }
    }

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
      if (!moved) {
        held.cancel()
        /* Alt and drag leaves the original where it is and drags a copy: the
           gesture every drawing program made in thirty years means by "one
           more of these", and what this board means by it now.
         *
         * At the first movement rather than at the press, so alt and a click
         * is still a click. On the press it would lay a copy exactly on top
         * of the card you meant to click on, and you would find out about it
         * later.
         *
         * The copy inherits the drag whole: it is what is selected, what
         * moves, what gets re-tested against the sections, and what the
         * guides line up — and the guides are worked out again, because the
         * original is something to line the copy up against now. */
        const copies = ev.altKey ? store.duplicate(selected, 0, 0) : []
        if (copies.length) {
          store.select(copies)
          const set = store.dragSet(copies)
          origin = new Map(set.ids.map((i) => [i, { ...store.getItem(i)! }]))
          testable = copies.filter((i) => !set.carried.has(i) && !isSection(store.getItem(i)))
          lines = linesFor(new Set(set.ids))
        } else {
          /* A copy takes its own snapshot on the way in, so this is for the
             drags that are only a move. */
          store.beginGesture()
        }
        /* A card that is moving is a card you are already looking at, so its
           name plate stands down until the drag ends. */
        document.body.dataset.dragging = 'card'
      }
      moved = true
      engine.touch()
      /* Shift asks for the grid instead, which is the coarser of the two and
       * should not then be pulled off it by a neighbour. */
      const toGrid = ev.shiftKey
      let ox = dx
      let oy = dy
      if (toGrid) {
        ox = Math.round((startBox.x + dx) / SNAP) * SNAP - startBox.x
        oy = Math.round((startBox.y + dy) / SNAP) * SNAP - startBox.y
        drawGuide(guideV.current, null, true)
        drawGuide(guideH.current, null, false)
      } else {
        const s = snap({ x: startBox.x + dx, y: startBox.y + dy, w: startBox.w, h: startBox.h }, lines, tol)
        ox += s.dx
        oy += s.dy
        drawGuide(guideV.current, s.vLine, true)
        drawGuide(guideH.current, s.hLine, false)
      }
      for (const [iid, o] of origin) {
        store.update(iid, { x: Math.round(o.x + ox), y: Math.round(o.y + oy) }, false)
      }
      /* Show which section would take the drop. */
      if (testable.length) {
        const lead = store.getItem(testable[0])
        setHighlight(lead ? store.sectionAt(lead.x + lead.w / 2, lead.y + lead.h / 2) : null)
      }
    }
    const up = () => {
      held.cancel()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      delete document.body.dataset.dragging
      setHighlight(null)
      drawGuide(guideV.current, null, true)
      drawGuide(guideH.current, null, false)
      if (moved && testable.length) store.reparentByPosition(testable)
      /* A press that never became a drag, on a card that was already one of
         several, means that card.

         The selection has to survive the press itself, or a group could only
         be dragged from whichever card happened to be last clicked. So it
         survives until the button comes back up without having moved, which
         is the point at which the press turns out to have been a click — the
         same bargain every canvas makes. Without it, selecting a dozen cards
         and then clicking one of them to work on it left all twelve selected,
         and the next thing you did happened to all twelve. */
      if (!moved && primary && !additive && !menued && store.getSelection().length > 1 && store.isSelected(id)) {
        store.select([id])
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    /* A capture torn away — by a touch being cancelled, or the element going —
     * fires this instead of pointerup, and a drag that never ends is exactly
     * what this whole passage is about. */
    window.addEventListener('pointercancel', up)
  }, [])

  /* The middle of what is on screen, in board coordinates. */
  const centre = useCallback(() => {
    const r = vpRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return screenToBoard(store.peekView(), r.width / 2, r.height / 2)
  }, [])

  /* Right clicking a card that is not in the selection selects just it, so
   * the menu always acts on something the pointer is actually over. */
  const onCardContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    /* Android fires its own after a long press, at a moment of its choosing.
       Ours is already open; a second one would close and reopen it under a
       finger that has moved on. */
    if (justLongPressed()) return
    const sel = store.getSelection()
    const ids = sel.includes(id) ? sel : [id]
    if (!sel.includes(id)) store.select([id])
    setMenu({ x: e.clientX, y: e.clientY, ids })
  }, [])

  /* Right clicking bare board opens the add menu. Cards stop the event
   * themselves, so reaching here means nothing was under the pointer. */
  const onSurfaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (justLongPressed()) return
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
      /* Dragging a picture or a video straight out of another tab: the
       * browser hands over an address rather than a file, and which of the
       * three flavours holds it depends on the browser and on what was
       * dragged. */
      const url = urlFromDrag(e.dataTransfer)
      if (url) addUrl(at, url)
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
      role="application"
      aria-label="Board. Tab moves through the cards, arrows move the selection, Enter opens it."
      ref={vpRef}
      onPointerDown={onSurfacePointerDown}
      onContextMenu={onSurfaceContextMenu}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      /* Cards are moved with pointer events. The browser's own drag is a
         different mechanism that wants the same gesture, and when it wins it
         sends pointercancel and strands the card half way across the board.
         It starts on whatever is under the press — a run of text, an image, a
         live text selection — so the reliable place to refuse it is here,
         above all of them. Dropping files in is a different pair of events
         and is untouched by this. */
      onDragStart={(e) => e.preventDefault()}
      data-dragover={dragOver || undefined}
      /* The cursor is the cue. A tool that is armed and looks exactly like a
         tool that is not is a tool you press and then wonder about — so the
         board takes a crosshair for a section and a caret for text, and the
         rail lights the button that did it. */
      data-tool={tool || undefined}
    >
      <div className="surface" ref={surfaceRef}>
        <Wires ids={edgeIds} selected={selection} />
        <i className="guide guide-v" ref={guideV} />
        <i className="guide guide-h" ref={guideH} />
        {visible.map((id) => {
          const it = store.getItem(id)
          if (!it) return null
          return (
            <Card
              key={id}
              id={id}
              selected={selSet.has(id)}
              grouped={grouped}
              dim={isFiltering && !passes(it, words, tagFilter)}
              distance={distanceToCentre(it, rect)}
              onPointerDown={onCardPointerDown}
              onOpenEditor={onOpenEditor}
              onContextMenu={onCardContextMenu}
            />
          )
        })}
        {/* Drawn after the cards so it sits over them, and keyed on the
            selection so a new one gets a fresh box rather than an old one
            catching up. */}
        {grouped && <GroupHandles key={scaling.join(',')} ids={scaling} />}
        {/* And, when those cards happen to sit in a row or a grid, the gaps
            between them as something to take hold of. */}
        {grouped && <SmartHandles key={`s${scaling.join(',')}`} ids={scaling} />}
        {/* And, with anything at all selected, Alt and a hover says how far
            away the thing under the cursor is. */}
        {scaling.length > 0 && <Measure ids={scaling} />}
        {editing && <Nodes id={editing} />}
        {/* What is about to exist, drawn as itself. */}
        {shown && (
          <svg
            className="draft"
            width={shown.w}
            height={shown.h}
            viewBox={`0 0 ${shown.w} ${shown.h}`}
            style={{ transform: `translate3d(${shown.x}px, ${shown.y}px, 0)` }}
            aria-hidden
          >
            <path d={shown.d} />
            {shown.dots?.map((p, i) => (
              <circle key={i} className="draft-dot" cx={p.x} cy={p.y} r={3.5} />
            ))}
          </svg>
        )}
        {marquee && (
          <div
            className="marquee"
            /* Drawing a thing and selecting things are different gestures and
               must not look the same: one is where a card is about to be, the
               other is what is about to be picked up. */
            data-tool={tool || undefined}
            style={{ transform: `translate3d(${marquee.x}px, ${marquee.y}px, 0)`, width: marquee.w, height: marquee.h }}
          />
        )}
      </div>

      {dragOver && <div className="drop-veil">Drop to add</div>}
      {!order.length && !dragOver && (
        <FirstRun
          onAddFiles={() => canvasActions.pickFiles(centre())}
          onNote={() => canvasActions.addNote(centre())}
          onCommands={canvasActions.commands}
          onHelp={canvasActions.help}
        />
      )}
      <ZoomBar onZoom={zoomBy} onReset={resetZoom} />
      {menu && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onOpenEditor={onOpenEditor}
          onExportPictures={onExportPictures}
          onPullColours={onPullColours}
          onDepth={onDepth}
          onGather={onGather}
          onTakeAway={onTakeAway}
          canvas={canvasActions}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * The box round a selection, and the corner that scales it.
 *
 * It keeps itself up to date by writing its own transform rather than by going
 * through React, the same way the surface and the guides do. The box changes
 * every frame of a drag, and a re-render of the board per frame is a re-render
 * of every card on it — which is the one thing this board's structure exists
 * to avoid.
 * ------------------------------------------------------------------------- */
function GroupHandles({ ids }: { ids: string[] }) {
  const ref = useRef<HTMLDivElement | null>(null)

  const draw = useCallback(() => {
    const el = ref.current
    if (!el) return
    const box = boundsOf(ids.map((id) => store.getItem(id)).filter(Boolean) as Box[])
    if (!box) return
    el.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`
    el.style.width = `${box.w}px`
    el.style.height = `${box.h}px`
  }, [ids])

  useEffect(() => {
    draw()
    /* One subscription per card in it: the box has to follow whichever of them
       moves, and they move one at a time. */
    const offs = ids.map((id) => store.subscribeItem(id, draw))
    return () => { for (const off of offs) off() }
  }, [ids, draw])

  return (
    <div className="group-handles" ref={ref} aria-hidden="true">
      {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
        <i
          key={c}
          className={`handle handle-${c}`}
          data-resize={c}
          onPointerDown={(e) => startGroupScale(e, ids, c)}
        />
      ))}
    </div>
  )
}

/* A corner of that box, dragged.
 *
 * Every card's size and its distance from the opposite corner go up by the
 * same factor, which is what keeps an arrangement an arrangement. The
 * arithmetic is in `scaling.ts`; this is the gesture around it: one snapshot
 * for the whole drag, positions written with recording off, and the shift key
 * passed through, which ties the two axes together so everything in the box
 * comes out the shape it went in. */
function startGroupScale(e: React.PointerEvent, ids: string[], corner: Corner) {
  e.stopPropagation()
  e.preventDefault()
  const items = ids.map((id) => store.getItem(id))
  /* Read once, at the start. Scaling from where each card is *now* would
     compound every frame and run away from the pointer. */
  const start = items.map((i) => (i ? { x: i.x, y: i.y, w: i.w, h: i.h } : null))
  const live = ids.filter((_, n) => start[n])
  const from = start.filter(Boolean) as Box[]
  const box = boundsOf(from)
  if (!box) return

  const z = store.peekView().z || 1
  const sx = e.clientX
  const sy = e.clientY
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  /* Same reason a card drag holds the players: a gesture that crosses an
     embedded player would lose its own pointerup inside it. */
  holdPress()
  let began = false

  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / z
    const dy = (ev.clientY - sy) / z
    if (!began && Math.hypot(dx, dy) >= 2) {
      store.beginGesture()
      began = true
    }
    const next = scaleAll(from, box, corner, dx, dy, ev.shiftKey)
    for (let n = 0; n < live.length; n++) store.update(live[n], next[n], false)
  }
  const up = () => {
    target.releasePointerCapture(e.pointerId)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
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
      {/* Which surround the board is judged against belongs with how close you
          are standing to it, not up in a row of things that make and move
          cards. It also leaves the top bar's width to the work. */}
      <span className="zoom-sep" />
      <ThemeButton />
    </div>
  )
}

export type { Item }
