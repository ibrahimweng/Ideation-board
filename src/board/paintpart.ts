import { useCallback, useSyncExternalStore } from 'react'

/* ---------------------------------------------------------------------------
 * Which brush the picture paints into.
 *
 * A mask can hold more than one painted part, and it has to: "this area, but
 * not the bit in the middle of it" is two brushes, one adding and one taking
 * away, and it is the ordinary way anybody masks a thing with a hole in it.
 * Two brushes only mean two things if they are two pictures — which they are,
 * a tile of the baked strip each — and that leaves the question this file
 * answers: when somebody drags on the photograph, which of them is it?
 *
 * The last one, until they say otherwise. Adding a brush is asking to paint
 * with it, and going back to an earlier one is the rarer move, so it is the
 * one that takes a click.
 *
 * Deliberately not on the record, for the same reason the overlay is not:
 * which brush is in your hand is a thing you are doing this minute, not a
 * thing the card is wearing. A board saved mid-stroke must not come back a
 * week later with an opinion about it, and undo must not have a step in it
 * for picking up a different brush.
 * ------------------------------------------------------------------------- */

let held: { mask: string; part: number } | null = null
const watchers = new Set<() => void>()

const tell = () => {
  for (const fn of [...watchers]) fn()
}

export function holdBrush(mask: string, part: number) {
  if (held && held.mask === mask && held.part === part) return
  held = { mask, part }
  tell()
}

export function dropBrush(mask?: string) {
  if (!held || (mask && held.mask !== mask)) return
  held = null
  tell()
}

/* Which part of this mask is being painted into: the one that was picked up,
 * if it is still a brush, and otherwise the last brush in the mask. Falls back
 * rather than refuses, because the part that was picked up can be deleted
 * while a stroke is half drawn and the answer still has to be a brush. */
export function brushSlot(mask: string, kinds: string[]): number {
  const brushes = kinds.map((k, i) => (k === 'brush' ? i : -1)).filter((i) => i >= 0)
  if (!brushes.length) return -1
  if (held && held.mask === mask && brushes.includes(held.part)) return held.part
  return brushes[brushes.length - 1]
}

function subscribe(fn: () => void) {
  watchers.add(fn)
  return () => void watchers.delete(fn)
}

export function useBrushSlot(mask: string, kinds: string[]): number {
  const key = kinds.join(',')
  const get = useCallback(() => brushSlot(mask, key ? key.split(',') : []), [mask, key])
  return useSyncExternalStore(subscribe, get, get)
}
