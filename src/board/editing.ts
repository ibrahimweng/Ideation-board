import { useSyncExternalStore } from 'react'
import type { Item } from '../state/types'

/* ---------------------------------------------------------------------------
 * Which drawing is having its points moved about.
 *
 * Scaling a shape by its corners changes how big it is. Moving its points
 * changes what it is, and those are different enough that they should not be
 * the same handles: four corners that stretch the whole thing, or every anchor
 * and every handle on the line, but not both at once on top of each other.
 *
 * So it is a mode, entered by double-clicking the shape and left with Escape
 * — the same way the words on a label are edited where they lie. One at a
 * time, and held outside React because the board's pointer handlers ask about
 * it inside a gesture, where a re-render is a frame too late.
 * ------------------------------------------------------------------------- */

let editing: string | null = null
const subs = new Set<() => void>()

export const editingNow = (): string | null => editing

/* Only a path has points of its own to move. A rectangle's corners come from
 * its radius and a star's from how many points it has, and those are settings
 * rather than places — they belong in the panel, not on the end of a drag. */
export const hasNodes = (i?: Item | null): boolean =>
  !!i && i.kind === 'shape' && (i.shape?.nodes?.length ?? 0) > 1

export function editNodes(id: string | null) {
  if (editing === id) return
  editing = id
  for (const f of subs) f()
}

export function useEditing(): string | null {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f) } },
    () => editing,
    () => null
  )
}
