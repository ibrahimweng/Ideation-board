import type { Item } from '../state/types'
import type { Viewport } from '../state/store'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/* Board-space rectangle currently visible, grown by `pad` so cards just off
 * screen are already rendered when they scroll in. */
export function visibleRect(view: Viewport, vpW: number, vpH: number, pad = 240): Rect {
  const z = view.z || 1
  return {
    x: -view.x / z - pad,
    y: -view.y / z - pad,
    w: vpW / z + pad * 2,
    h: vpH / z + pad * 2,
  }
}

export const intersects = (it: Item, r: Rect) =>
  it.x < r.x + r.w && it.x + it.w > r.x && it.y < r.y + r.h && it.y + it.h > r.y

/* Distance from a card's centre to the centre of the view, in board pixels.
 * Drives render ordering so the card you are looking at resolves first. */
export function distanceToCentre(it: Item, r: Rect) {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const dx = it.x + it.w / 2 - cx
  const dy = it.y + it.h / 2 - cy
  return Math.hypot(dx, dy)
}

export const screenToBoard = (view: Viewport, sx: number, sy: number) => ({
  x: (sx - view.x) / (view.z || 1),
  y: (sy - view.y) / (view.z || 1),
})

export const clampZoom = (z: number) => Math.max(0.1, Math.min(4, z))

/* Zoom about a screen point, keeping the board point under the cursor fixed. */
export function zoomAt(view: Viewport, sx: number, sy: number, factor: number): Viewport {
  const z = clampZoom((view.z || 1) * factor)
  const k = z / (view.z || 1)
  return { z, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k }
}

/* The view that brings a card into sight, or the one you already have when it
 * is in sight already. Used by keyboard navigation, where the next card in
 * reading order is often off screen and moving to something you cannot see is
 * the same as moving to nothing. */
export function revealView(view: Viewport, it: Item, vpW: number, vpH: number, pad = 60): Viewport {
  const z = view.z || 1
  const left = it.x * z + view.x
  const top = it.y * z + view.y
  const right = left + it.w * z
  const bottom = top + it.h * z
  if (left >= pad && top >= pad && right <= vpW - pad && bottom <= vpH - pad) return view
  /* Centred, rather than nudged to the edge: a card you have just moved to is
   * the thing you are looking at. */
  return {
    z,
    x: vpW / 2 - (it.x + it.w / 2) * z,
    y: vpH / 2 - (it.y + it.h / 2) * z,
  }
}

/* The view that puts a set of things on screen at once.
 *
 * A board grows past its window within a dozen cards, and until now the only
 * way to see all of it was to zoom out by guess and pan about hunting. This is
 * the answer to "show me everything", and to "show me just these".
 *
 * Never zooms past life size: a board of four cards should fill the window at
 * a hundred per cent rather than being blown up to fit it. */
export function fitView(items: Item[], vpW: number, vpH: number, pad = 64, maxZoom = 1): Viewport | null {
  const boxes = items.filter((i) => i.w > 0 && i.h > 0)
  if (!boxes.length || vpW <= 0 || vpH <= 0) return null
  const x0 = Math.min(...boxes.map((i) => i.x))
  const y0 = Math.min(...boxes.map((i) => i.y))
  const x1 = Math.max(...boxes.map((i) => i.x + i.w))
  const y1 = Math.max(...boxes.map((i) => i.y + i.h))
  const w = Math.max(1, x1 - x0)
  const h = Math.max(1, y1 - y0)
  const z = clampZoom(Math.min(maxZoom, (vpW - pad * 2) / w, (vpH - pad * 2) / h))
  return {
    z,
    x: vpW / 2 - (x0 + w / 2) * z,
    y: vpH / 2 - (y0 + h / 2) * z,
  }
}
