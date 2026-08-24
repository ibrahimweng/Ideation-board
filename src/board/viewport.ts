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
