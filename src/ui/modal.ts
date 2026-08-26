/* ---------------------------------------------------------------------------
 * Who has the keyboard.
 *
 * The board listens for keys on the window, and so does everything that covers
 * it: the show, and comparing two things side by side. Both are on the window
 * in the same phase, so both used to run — pressing the right arrow to move to
 * the next picture in the show also nudged whatever was selected on the board
 * behind it, eight pixels at a time, invisibly.
 *
 * A count rather than a flag, because one of these can open over another and
 * the first must not hand the keys back when the second closes.
 * ------------------------------------------------------------------------- */

let holders = 0

/* Call from an effect: `useEffect(holdKeys, [])`. */
export function holdKeys(): () => void {
  holders++
  return () => {
    holders = Math.max(0, holders - 1)
  }
}

export const keysHeld = () => holders > 0
