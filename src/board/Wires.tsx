import { memo } from 'react'
import { store, useItem } from '../state/store'
import { wirePath } from './wire'

/* ---------------------------------------------------------------------------
 * The layer connections are drawn on.
 *
 * One SVG for the whole board, sitting under the cards and over the sections.
 * It is one pixel and overflows: the paths are drawn in board coordinates,
 * which are unbounded and can be negative, and the surface's own transform
 * pans and zooms them with everything else.
 *
 * Each wire subscribes to the two cards it joins and to nothing else, so
 * dragging a card redraws its own wires and no others.
 * ------------------------------------------------------------------------- */

export function Wires({ ids, selected }: { ids: string[]; selected: string[] }) {
  return (
    <svg className="wires" width="1" height="1" aria-hidden="true">
      <defs>
        <marker id="wire-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" />
        </marker>
      </defs>
      {ids.map((id) => (
        <Wire key={id} id={id} on={selected.includes(id)} />
      ))}
      {/* The wire being dragged. Its shape is written straight to this node
          during the gesture rather than through React, the same way the board
          is panned. */}
      <path className="wire-preview" />
    </svg>
  )
}

const Wire = memo(function Wire({ id, on }: { id: string; on: boolean }) {
  const e = useItem(id)
  const a = useItem(e?.from || '')
  const b = useItem(e?.to || '')
  if (!e || !a || !b) return null

  const d = wirePath(a, b)
  return (
    <g className="wire" data-sel={on || undefined}>
      {/* A two pixel line is hard to hit, so the clickable path is a wide
          invisible one following the same curve. */}
      <path
        className="wire-hit"
        d={d}
        onPointerDown={(ev) => {
          ev.stopPropagation()
          store.select([id])
        }}
      />
      <path className="wire-line" d={d} markerEnd="url(#wire-head)" />
    </g>
  )
})
