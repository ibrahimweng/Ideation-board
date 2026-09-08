import { useCallback, useSyncExternalStore } from 'react'
import { store } from './store'
import { endsOf, hasPixels, pixelKey } from './kinds'

/* ---------------------------------------------------------------------------
 * One card read through another.
 *
 * Every effect on this board treats one picture. The ones that matter most on
 * a moodboard treat two: a texture pushed through a photograph, a photograph
 * knocked out of a shape, a scan used as the pattern something is filled with.
 * Doing any of that meant leaving, doing it somewhere else, and bringing the
 * answer back as a flat picture.
 *
 * ## The wire is the wiring
 *
 * The board could already draw a line between two cards, and the line meant
 * nothing — it was an annotation. Now it means something when the card it
 * points at is running an effect that wants a second picture: the card at the
 * other end is that picture.
 *
 * No picker, no second selection mode, no field in the panel holding an id
 * that means nothing to anybody reading it. You draw the line you would have
 * drawn anyway to say these two go together, and the effect reads along it.
 * A line between two cards neither of which is doing anything with it is still
 * just a line, which is what it was before.
 *
 * ## Which way
 *
 * A wire has a start and an end, so it already has a direction: the card at
 * the start feeds the card at the end. Where two wires arrive at the same
 * card, the newest wins — drawing another one is how you change your mind,
 * and the alternative is a rule about which of two identical lines is the real
 * one, which nobody could see.
 *
 * ## Watching
 *
 * A card subscribes to its own item, so a wire being drawn somewhere else on
 * the board would never reach it. This watches the board once and tells only
 * the cards whose feed actually changed, which is nearly always none of them.
 * ------------------------------------------------------------------------- */

/* target id -> the pixel key of the card feeding it */
let feeds = new Map<string, string>()
const watchers = new Map<string, Set<() => void>>()

/* Worked out from the board rather than kept alongside it: a wire is an item
 * like any other, and a second copy of where the wires are is a second copy to
 * keep right through undo, paste, board switches and another tab writing. */
function build(): Map<string, string> {
  const next = new Map<string, string>()
  /* In board order, so a wire drawn later replaces one drawn earlier. */
  for (const id of store.getOrder()) {
    const it = store.getItem(id)
    const ends = endsOf(it)
    if (!ends) continue
    const from = store.getItem(ends[0])
    const to = store.getItem(ends[1])
    if (!to || !hasPixels(from)) continue
    const key = pixelKey(from)
    if (key) next.set(ends[1], key)
  }
  return next
}

function recheck() {
  const next = build()
  /* Only the cards whose answer moved. Rebuilding the map is cheap; making
   * three hundred cards re-render because a wire was drawn is not. */
  const touched = new Set<string>([...feeds.keys(), ...next.keys()])
  feeds = next
  for (const id of touched) {
    if (feeds.get(id) === undefined && !watchers.has(id)) continue
    const subs = watchers.get(id)
    if (subs) for (const fn of [...subs]) fn()
  }
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  /* The order changes when anything is added, removed or reordered, which
   * covers every way a wire can appear or go. A wire that is only moved does
   * not change what it joins. */
  store.subscribeOrder(recheck)
}

export const feederKey = (id: string): string | undefined => feeds.get(id)

/* The pixel key of whatever is wired into this card, for the render request. */
export function useFeeder(id: string): string | undefined {
  listen()
  const get = useCallback(() => feeds.get(id), [id])
  const subscribe = useCallback(
    (fn: () => void) => {
      let set = watchers.get(id)
      if (!set) { set = new Set(); watchers.set(id, set) }
      set.add(fn)
      return () => {
        set!.delete(fn)
        if (!set!.size) watchers.delete(id)
      }
    },
    [id]
  )
  return useSyncExternalStore(subscribe, get, get)
}

/* For anything that needs the map rebuilt now rather than on the next change —
 * an export, which runs outside React and cannot wait to be told. */
export function refreshFeeds() {
  feeds = build()
}
