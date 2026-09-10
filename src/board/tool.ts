import { useSyncExternalStore } from 'react'

/* ---------------------------------------------------------------------------
 * The tool that is armed.
 *
 * Almost everything on this board is made by pressing a button and having the
 * thing appear in the middle of the view. That is right for a note, which is
 * the size it is, and wrong for the two things whose size is the point: a
 * section is a region, and a piece of text written straight onto the board is
 * however wide you want the line to be. Both of those you draw.
 *
 * So those two arm instead of firing. The rail shows which one is armed, the
 * board takes the cursor for it, and the next drag on empty board draws the
 * box. One press, one thing made, and the tool stands down — a tool that stays
 * armed is a tool you make four sections with by accident.
 *
 * Kept out of React state because the board's pointer handlers read it inside
 * a gesture, where a re-render is a frame late and a stale closure is a bug
 * you cannot see.
 * ------------------------------------------------------------------------- */

export type Tool = 'section' | 'text' | null

let armed: Tool = null
const subs = new Set<() => void>()

const tell = () => { for (const f of subs) f() }

/* What is armed right now, read inside a gesture. */
export const toolNow = (): Tool => armed

/* Arm one, or press the armed one again to put it down. */
export function armTool(t: Tool) {
  armed = armed === t ? null : t
  tell()
}

/* Used up, or given up. */
export function disarm() {
  if (!armed) return
  armed = null
  tell()
}

export function useTool(): Tool {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f) } },
    () => armed,
    () => null
  )
}

/* What each one draws when the drag was a click rather than a drag — a press
 * on the board should still make something, and this is the size it would
 * have arrived at from the button. */
export const FALLBACK: Record<'section' | 'text', { w: number; h: number }> = {
  section: { w: 720, h: 480 },
  text: { w: 320, h: 64 },
}

/* Under this, a drag was a click. Four pixels is the same figure the marquee
 * uses to tell a selection from a stray press. */
export const DRAWN = 8
