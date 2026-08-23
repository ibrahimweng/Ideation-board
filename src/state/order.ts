import type { Item } from './types'
import { isThing } from './kinds'

/* ---------------------------------------------------------------------------
 * Reading order.
 *
 * Somebody who arranged twelve photographs into three rows meant those rows.
 * Anything that walks a board one card at a time — showing it, and whatever
 * else wants a sequence later — has to walk it the way an eye crosses a wall
 * of pictures: top to bottom in bands, then left to right inside each band.
 *
 * Bands rather than exact rows, because a row of pictures that does not line
 * up to the pixel is still a row.
 * ------------------------------------------------------------------------- */

/* Sections are the ground and arrows are between things, so neither is a thing
 * to show. Everything else on a board is something somebody put there. */
export const showable = (i: Item) => isThing(i)

export function readingOrder(items: Item[]): Item[] {
  const list = items.filter(showable)
  if (!list.length) return []
  const band = Math.max(80, Math.min(...list.map((i) => i.h)) * 0.6)
  return [...list].sort((a, b) => {
    const ra = Math.floor(a.y / band)
    const rb = Math.floor(b.y / band)
    return ra !== rb ? ra - rb : a.x - b.x
  })
}
