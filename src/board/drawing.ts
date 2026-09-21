import { MIN_BOX, boundsOfNodes, intoBox, simplify, smoothNodes, specFor } from '../state/shapes'
import type { Node, ShapeSpec } from '../state/shapes'
import { DRAWS, FALLBACK, KIND_OF } from './tool'
import type { ShapeTool } from './tool'

/* ---------------------------------------------------------------------------
 * A gesture, turned into a shape.
 *
 * Between the pointer and the record there is a little arithmetic that has
 * nothing to do with either: which way round the drag went, what Shift means
 * to this tool, and how to give a line that was drawn dead horizontal a box
 * tall enough to hold its own stroke. All of it is here, where it can be
 * checked, rather than inside a pointer handler where it cannot.
 * ------------------------------------------------------------------------- */

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Drawn extends Rect { spec: ShapeSpec }

/* Shift, which means something different to each gesture and the same thing
 * to a person: keep it regular. */

/* A box with equal sides, as far out as the drag went on its longer axis. */
export const squared = (from: Pt, to: Pt): Pt => {
  const s = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  return {
    x: from.x + (to.x < from.x ? -s : s),
    y: from.y + (to.y < from.y ? -s : s),
  }
}

/* A line at the nearest eighth of a turn, the length the drag was.
 *
 * Eighths rather than quarters: the diagonals are half of what anybody holds
 * shift on a line for. */
export const straightened = (from: Pt, to: Pt): Pt => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  const step = Math.PI / 4
  const a = Math.round(Math.atan2(dy, dx) / step) * step
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len }
}

/* The box a drag between two corners covers, whichever way round it went. */
export const boxOf = (from: Pt, to: Pt): Rect => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  w: Math.abs(to.x - from.x),
  h: Math.abs(to.y - from.y),
})

/* The same box, opened out about its middle to at least the smallest a card
 * can be. A line drawn dead across has no height at all, and a card of no
 * height is one nobody can pick up again. */
export const opened = (b: Rect): Rect => {
  const w = Math.max(MIN_BOX, b.w)
  const h = Math.max(MIN_BOX, b.h)
  return { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h }
}

/* The shape a drag has drawn so far.
 *
 * Null for the tools that are not drawn by dragging from one place to
 * another — the pens place points, which is a gesture of its own. */
export function drawnShape(tool: ShapeTool, from: Pt, to: Pt, regular = false): Drawn | null {
  const how = DRAWS[tool]
  const spec = specFor(KIND_OF[tool])
  if (how === 'box') return { ...opened(boxOf(from, regular ? squared(from, to) : to)), spec }
  if (how === 'ends') {
    const end = regular ? straightened(from, to) : to
    const box = opened(boxOf(from, end))
    /* The ends as fractions of the box they were opened out into, so which
       way the line was drawn survives: a drag up and to the left is not the
       same arrow as a drag down and to the right, and the box is the same
       box either way. */
    const at = (p: Pt) => ({ x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h })
    return { ...box, spec: { ...spec, nodes: [at(from), at(end)] } }
  }
  return null
}

/* What a press rather than a drag makes.
 *
 * Nothing at all is the worst answer to a press on an armed tool: it looks
 * like the tool is broken. So a press makes the same shape at the size the
 * button would have given it, placed where the press was. */
export function pressedShape(tool: ShapeTool, at: Pt): Drawn {
  const size = FALLBACK[tool]
  const spec = specFor(KIND_OF[tool])
  if (DRAWS[tool] === 'ends') {
    /* Across, because that is what a line is if you do not say otherwise. */
    return { x: at.x, y: at.y, ...size, spec: { ...spec, nodes: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] } }
  }
  return { x: at.x, y: at.y, ...size, spec }
}

/* ---------------------------------------------------------------------------
 * The pens.
 *
 * A pen is a gesture made of presses rather than one drag, so the points
 * arrive in board coordinates over several seconds and the box they turn out
 * to occupy is not known until the last one is in. That is what these three
 * are for: they take what was placed and work out afterwards what card it
 * was placed on.
 * ------------------------------------------------------------------------- */

/* A run of placed points, turned into a shape. */
export function pathShape(tool: ShapeTool, nodes: Node[], closed: boolean): Drawn | null {
  if (nodes.length < 2) return null
  const box = opened(boundsOfNodes(nodes))
  return { ...box, spec: { ...specFor(KIND_OF[tool]), nodes: intoBox(nodes, box), closed } }
}

/* The curvature tool: the points you placed, with the line run through them.
 *
 * Not near them — through them. A smoothing that only comes close is no use
 * for a drawing, because the points are where you said the line goes. */
export function curveShape(pts: Pt[], closed: boolean): Drawn | null {
  return pathShape('curve', smoothNodes(pts.map((p) => [p.x, p.y]), 0.25, closed), closed)
}

/* The pencil: a stroke the hand made, tidied up after it.
 *
 * A couple of hundred sampled positions become eight or ten. The ones that
 * were on the way are thrown out and the rest are smoothed through, so what
 * is kept is the shape that was drawn rather than the polygon that was
 * sampled at sixty a second.
 *
 * The tolerance comes in from the view rather than being a constant, because
 * a wobble is a wobble on screen: at four hundred per cent the hand has not
 * got steadier, it is only being read more closely. */
export function freehandShape(pts: Pt[], tol: number): Drawn | null {
  if (pts.length < 2) return null
  const kept = simplify(pts.map((p) => [p.x, p.y] as [number, number]), tol)
  return pathShape('pencil', smoothNodes(kept, 0.22), false)
}

/* A shape's box pulled back round its own points.
 *
 * Moving a point can push a drawing outside the card it is on. Nothing is
 * clipped — a shape has no card under it — but the box is what the corner
 * handles scale, what decides whether the card is on screen and what the
 * fractions on the record are fractions of. A drawing that has wandered out
 * of its own box is one that stops being drawn when its box goes over the
 * edge, and one whose handles are nowhere near it.
 *
 * Only when the drag lets go, never during it: a box that followed the points
 * would be a card sliding about under the hand that is dragging them. */
export function refit(it: Rect, nodes: Node[]): { box: Rect; nodes: Node[] } {
  const b = boundsOfNodes(nodes)
  const box = opened({ x: it.x + b.x * it.w, y: it.y + b.y * it.h, w: b.w * it.w, h: b.h * it.h })
  /* The new box said in the old box's fractions, which is the space the
     points are still written in. */
  const same = { x: (box.x - it.x) / it.w, y: (box.y - it.y) / it.h, w: box.w / it.w, h: box.h / it.h }
  return { box, nodes: intoBox(nodes, same) }
}

/* What is under the pointer while a stroke is still being drawn: the raw
 * samples, straight, because tidying a stroke that is not finished would
 * make the line move about under the hand that is drawing it. */
export function strokeDraft(pts: Pt[]): Drawn | null {
  return pathShape('pencil', pts.map((p) => ({ x: p.x, y: p.y })), false)
}
