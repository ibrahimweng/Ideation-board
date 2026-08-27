import { useEffect, useState } from 'react'
import type { Item } from '../state/types'
import { canDecodeFrames, isAnimated, mightMove } from '../store/anim'
import { getBlob } from '../store/idb'

/* ---------------------------------------------------------------------------
 * Does this card's picture move?
 *
 * Written on the card when a file arrives, because the blob is in hand and
 * asking costs nothing there. But every GIF that was already on a board when
 * this was built has no answer recorded, and a card with no answer would be
 * treated as a still for ever — the fix would work for new files and quietly
 * skip every picture anybody already had.
 *
 * So a card with nothing written on it is asked, once, the first time it is
 * rendered with an effect on it. The answer is kept in memory rather than
 * written back to the board: it is derived from a file that cannot change, so
 * working it out again next time costs one decoder, while writing it would
 * touch the record, move its timestamp, and give a second tab a change to
 * argue about — for something neither tab actually edited.
 * ------------------------------------------------------------------------- */

/* Keyed by media, not by card, so two cards holding the same picture ask once
 * between them. */
const known = new Map<string, boolean>()
const asking = new Map<string, Promise<boolean>>()

function ask(key: string): Promise<boolean> {
  const had = known.get(key)
  if (had !== undefined) return Promise.resolve(had)
  const going = asking.get(key)
  if (going) return going
  const p = (async () => {
    const blob = await getBlob(key)
    const moves = blob ? await isAnimated(blob) : false
    known.set(key, moves)
    return moves
  })()
    .catch(() => false)
    .finally(() => asking.delete(key))
  asking.set(key, p)
  return p
}

/* True when this card should be fed a reel of frames rather than one still. */
export function useMoves(it: Item | undefined): boolean {
  const key = it?.kind === 'image' ? it.media : undefined
  const written = it?.anim
  const mime = it?.mime || ''
  const [found, setFound] = useState(() => (key ? known.get(key) ?? false : false))

  useEffect(() => {
    if (!key || written !== undefined) return
    /* Only the types that can move, and only where there is something able to
     * decode their frames. Everything else is a still and always was. */
    if (!mightMove(mime) || !canDecodeFrames()) return
    const cached = known.get(key)
    if (cached !== undefined) {
      setFound(cached)
      return
    }
    let live = true
    void ask(key).then((moves) => {
      if (live) setFound(moves)
    })
    return () => {
      live = false
    }
  }, [key, written, mime])

  if (!key) return false
  /* What the card says, when it says anything. */
  return written !== undefined ? written : found
}
