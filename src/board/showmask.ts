import { useCallback, useSyncExternalStore } from 'react'

/* ---------------------------------------------------------------------------
 * Show me where the mask is.
 *
 * A mask is a shape nobody can see. Its whole job is to be somewhere, and
 * until an exposure has been moved inside it there is nothing on the picture
 * to say where that somewhere is — so the first thing every editor that has
 * masks gives you is a way to look at the mask itself, in a colour the
 * photograph is unlikely to contain. Lightroom's is red; so is this.
 *
 * Deliberately not on the record. Which mask is being looked at is a thing the
 * panel is doing this minute, not a thing the card is wearing: a board saved
 * while an overlay was up must not open with a red picture in it, and undo
 * must not have a step in it for looking at something.
 *
 * One at a time, board-wide. Two overlays at once would be two red shapes with
 * no way to tell which is which, and the question being asked is always about
 * one of them.
 * ------------------------------------------------------------------------- */

let shown: { card: string; mask: string } | null = null
const watchers = new Set<() => void>()

const tell = () => {
  for (const fn of [...watchers]) fn()
}

export function showMask(card: string, mask: string) {
  if (shown && shown.card === card && shown.mask === mask) return
  shown = { card, mask }
  tell()
}

export function hideMask(mask?: string) {
  /* Named, so that closing one mask's controls cannot switch off the overlay
   * somebody has just turned on for another. */
  if (!shown || (mask && shown.mask !== mask)) return
  shown = null
  tell()
}

export const shownMask = () => shown

/* The panel has moved to another card. An overlay left behind on the card it
 * was on is a red picture nobody can explain and nothing on screen can switch
 * off, since the control for it is on a panel that is now about something
 * else. */
export function hideOtherCards(card: string) {
  if (!shown || shown.card === card) return
  shown = null
  tell()
}

/* Which mask this card should draw instead of its picture, if any. */
export const maskOn = (card: string) => (shown && shown.card === card ? shown.mask : undefined)

function subscribe(fn: () => void) {
  watchers.add(fn)
  return () => void watchers.delete(fn)
}

export function useShownMask(card: string): string | undefined {
  const get = useCallback(() => maskOn(card), [card])
  return useSyncExternalStore(subscribe, get, get)
}

/* For the panel's own button, which needs to know whether it is pressed. */
export function useShowing(mask: string): boolean {
  const get = useCallback(() => !!shown && shown.mask === mask, [mask])
  return useSyncExternalStore(subscribe, get, get)
}
