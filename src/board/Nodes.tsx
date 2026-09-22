import { useEffect, useRef, useState } from 'react'
import { store, useItem, useViewport } from '../state/store'
import {
  addNode, bendSegment, dropNode, dropNodes, isSmooth, moveHandle, moveNode, moveNodes,
  nearestOn, nodeAt, nodesIn, pathFor, toggleSmooth,
} from '../state/shapes'
import type { Node } from '../state/shapes'
import { refit } from './drawing'
import { editNodes } from './editing'
import { holdPress } from './press'

/* ---------------------------------------------------------------------------
 * Moving the points of a drawing.
 *
 * The four corner handles on a card change how big a shape is. These change
 * what it is, and the two should never be on screen at once on top of each
 * other — so this is a mode: double-click the shape to come in, Escape to go
 * out, and while you are in it the card's own handles stand down.
 *
 * Nine gestures, and no menu:
 *
 *   drag an anchor        move the point, handles and all
 *   drag a handle         shape the curve either side of it
 *   alt-drag a handle     break the pair, for a corner with a curve on one side
 *   drag the line         bend that segment to where the pointer is
 *   double-click the line put a point there
 *   alt-click an anchor   take it away
 *   double-click an anchor   corner becomes smooth, and back again
 *   drag the empty space  a box round several points at once
 *   shift-click an anchor add it to those, or take it out again
 *
 * Several points picked out is the difference between editing a drawing and
 * fiddling with it: one side of a shape is four points, and moving them one at
 * a time is four drags that each have to end in the same place. Picked points
 * move together, nudge together with the arrows, and go together with Delete.
 *
 * Everything is written straight onto the record as it moves, with one undo
 * snapshot for a whole drag. The box is pulled back round the points only
 * when the drag lets go: a box that followed them would be a card sliding
 * about under the hand that is dragging it.
 * ------------------------------------------------------------------------- */

/* How near a press has to land to be on an anchor, and how big the marks are.
 * In screen pixels, divided back out by the zoom, because both are questions
 * about how well somebody can aim rather than about the drawing. */
const REACH = 10
const ANCHOR = 4.5
const GRIP = 3.5

export function Nodes({ id }: { id: string }) {
  const it = useItem(id)
  const view = useViewport()
  const box = useRef<HTMLDivElement>(null)
  /* Which points are picked out, by their place in the path. Kept here rather
     than on the record: it is a thing about this editing session and not about
     the drawing, and a board file carrying somebody's old selection would be a
     board file carrying noise. */
  const [picked, setPicked] = useState<number[]>([])
  /* The box being dragged round several of them, in fractions of the card. */
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  /* One change to the points, applied to whatever the record holds now rather
     than to a snapshot. The keyboard handler is a window listener that outlives
     any one render, and working from the render it was hung in would put back
     the points as they were when the key was first pressed. */
  const act = (step: (ns: Node[]) => Node[], settle = true) => {
    const cur = store.getItem(id)
    if (cur?.kind !== 'shape' || !cur.shape?.nodes) return
    const next = step(cur.shape.nodes)
    if (!settle) {
      store.update(id, { shape: { ...cur.shape, nodes: next } }, false)
      return
    }
    /* The box pulled back round them, the same as when a drag lets go. */
    const fitted = refit(cur, next)
    store.update(
      id,
      {
        x: Math.round(fitted.box.x),
        y: Math.round(fitted.box.y),
        w: Math.round(fitted.box.w),
        h: Math.round(fitted.box.h),
        shape: { ...cur.shape, nodes: fitted.nodes },
      },
      false
    )
  }

  /* Escape leaves, and so does the card being deleted out from under it — but
     with points picked out it lets go of those first, because one press
     undoing two things is one press too many.
     Delete and the arrow keys act on what is picked, which is the whole point
     of picking: the board's own Delete would take the card away instead. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setPicked((was) => {
          if (!was.length) editNodes(null)
          return []
        })
        return
      }
      if (!picked.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        store.beginGesture()
        act((ns) => dropNodes(ns, picked))
        setPicked([])
        return
      }
      if (!e.key.startsWith('Arrow')) return
      e.preventDefault()
      e.stopPropagation()
      const cur = store.getItem(id)
      if (!cur) return
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      /* A burst of nudges collapses into one step of undo. */
      store.beginGesture(700)
      act((ns) => moveNodes(ns, picked, dx / cur.w, dy / cur.h))
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [picked])

  const spec = it?.shape
  const nodes = spec?.nodes
  useEffect(() => {
    if (!nodes || nodes.length < 2) editNodes(null)
  }, [nodes])

  if (!it || it.kind !== 'shape' || !spec || !nodes || nodes.length < 2) return null

  const { w, h } = it
  const closed = !!spec.closed
  const z = view.z || 1
  /* The marks, in board units, so they come out the same size on screen at
     any zoom — a four-pixel anchor at a quarter zoom is a pixel. */
  const mark = ANCHOR / z
  const grip = GRIP / z

  /* Where in the card a pointer event landed, as fractions of it. */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const put = (next: Node[], record = true) =>
    store.update(id, { shape: { ...spec, nodes: next } }, record)

  /* Every drag in here is the same shape: one snapshot when it really starts,
     the points written straight onto the record while it runs, and the box
     pulled back round them when it lets go. */
  const drag = (e: React.PointerEvent, step: (dx: number, dy: number, alt: boolean) => Node[]) => {
    e.stopPropagation()
    e.preventDefault()
    holdPress()
    const sx = e.clientX
    const sy = e.clientY
    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)
    let began = false
    let last: Node[] | null = null
    const move = (ev: PointerEvent) => {
      if (!began && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 2) return
      if (!began) {
        store.beginGesture()
        began = true
      }
      /* In fractions of the card, which is the only unit the record knows. */
      last = step((ev.clientX - sx) / z / w, (ev.clientY - sy) / z / h, ev.altKey)
      put(last, false)
    }
    const up = () => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!last) return
      const fitted = refit(it, last)
      store.update(
        id,
        {
          x: Math.round(fitted.box.x),
          y: Math.round(fitted.box.y),
          w: Math.round(fitted.box.w),
          h: Math.round(fitted.box.h),
          shape: { ...spec, nodes: fitted.nodes },
        },
        false
      )
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className="nodes"
      ref={box}
      style={{ transform: `translate3d(${it.x}px, ${it.y}px, 0)`, width: w, height: h }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
        {/* The line itself: press it to bend it, press it twice to put a
            point on it. Drawn as a fat invisible stroke over the real one so
            a hairline is still something you can catch. */}
        <path
          className="node-line"
          d={pathFor(spec, w, h)}
          strokeWidth={REACH / z}
          onPointerDown={(e) => {
            const at = local(e)
            const near = nearestOn(nodes, closed, at.x, at.y)
            if (near.at < 0) return
            drag(e, (dx, dy) => bendSegment(nodes, closed, near.at, near.t, dx, dy))
          }}
          onDoubleClick={(e) => {
            const at = local(e)
            put(addNode(nodes, closed, at.x, at.y))
          }}
        />

        {/* The handles, each on a leash from its own point. */}
        {nodes.map((n, i) =>
          (['in', 'out'] as const).map((side) => {
            const hx = side === 'in' ? n.ix : n.ox
            const hy = side === 'in' ? n.iy : n.oy
            if (hx === undefined && hy === undefined) return null
            const px = (n.x + (hx ?? 0)) * w
            const py = (n.y + (hy ?? 0)) * h
            return (
              <g key={`${i}${side}`}>
                <line className="node-leash" x1={n.x * w} y1={n.y * h} x2={px} y2={py} />
                <rect
                  className="node-grip"
                  x={px - grip}
                  y={py - grip}
                  width={grip * 2}
                  height={grip * 2}
                  onPointerDown={(e) =>
                    /* Alt breaks the pair, which is how a point gets a curve
                       on one side of it and a corner on the other. */
                    drag(e, (dx, dy, alt) =>
                      moveHandle(nodes, i, side, (hx ?? 0) + dx, (hy ?? 0) + dy, !alt)
                    )
                  }
                />
              </g>
            )
          })
        )}

        {/* And the anchors on top, because they are what you aim at. A
            smooth one is drawn round and a corner square, so what a point is
            can be seen rather than discovered by dragging it. */}
        {nodes.map((n, i) => {
          const cx = n.x * w
          const cy = n.y * h
          const down = (e: React.PointerEvent) => {
            /* Alt takes it away, which is the one thing you cannot ask for by
               dragging. A path of two points has nothing to spare. */
            if (e.altKey) {
              e.stopPropagation()
              e.preventDefault()
              put(dropNode(nodes, i))
              setPicked((was) => was.filter((p) => p !== i).map((p) => (p > i ? p - 1 : p)))
              return
            }
            /* Shift adds it to what is picked, or takes it back out, and does
               not drag: a gesture that both changed the selection and moved
               what it changed would be one you could not take back by eye. */
            if (e.shiftKey) {
              e.stopPropagation()
              e.preventDefault()
              setPicked((was) => (was.includes(i) ? was.filter((p) => p !== i) : [...was, i]))
              return
            }
            /* Pressing one that is not picked picks it alone; pressing one
               that is picked keeps the others, so a handful can be dragged
               from any of them. */
            const set = picked.includes(i) ? picked : [i]
            if (!picked.includes(i)) setPicked(set)
            drag(e, (dx, dy) =>
              set.length > 1 ? moveNodes(nodes, set, dx, dy) : moveNode(nodes, i, dx, dy)
            )
          }
          return isSmooth(n) ? (
            <circle
              key={i}
              className="node-dot"
              data-on={picked.includes(i) || undefined}
              cx={cx}
              cy={cy}
              r={mark}
              onPointerDown={down}
              onDoubleClick={() => put(toggleSmooth(nodes, i))}
            />
          ) : (
            <rect
              key={i}
              className="node-dot"
              data-on={picked.includes(i) || undefined}
              x={cx - mark}
              y={cy - mark}
              width={mark * 2}
              height={mark * 2}
              onPointerDown={down}
              onDoubleClick={() => put(toggleSmooth(nodes, i))}
            />
          )
        })}
      </svg>
      {/* Which point a press would land on is worth knowing without pressing,
          but it is not worth a re-render per frame: the anchors are drawn big
          enough to aim at instead. */}
      <span className="said">
        {nodes.length} points. Drag to move, alt-click to remove, double-click to add or to change a corner, escape to finish.
      </span>
    </div>
  )
}

/* Which anchor is under a point, for anything outside this file that needs to
 * ask. In fractions, with the reach given in screen pixels. */
export const anchorUnder = (nodes: Node[], x: number, y: number, z: number, w: number) =>
  nodeAt(nodes, x, y, REACH / z / w)
