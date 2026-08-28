import { allBlobKeys, allBoards, delBlob, getBlob, writtenAt } from './idb'
import type { StoredBoard } from './idb'
import type { Item } from '../state/types'

/* ---------------------------------------------------------------------------
 * Getting the room back.
 *
 * Deleting a card never deleted its picture. Neither did deleting the card
 * that stood for a whole board. So the store only ever grew, and the corner of
 * the screen would eventually say the disk was filling up while offering three
 * buttons, none of which freed a single byte — an app telling you it is
 * running out of room, holding the only copy of your work, with nothing you
 * could do about it.
 *
 * WHY A SWEEP AND NOT A DELETE
 *
 * A file is keyed by its own name and any number of cards may point at it:
 * duplicating a card, pasting one onto another board, importing a board twice.
 * Deleting the file when one of those cards goes would blank the others, on
 * boards that are not even open. So nothing is deleted when a card is; instead
 * every board is read, every name still pointed at is collected, and what
 * nothing points at goes.
 *
 * THREE THINGS THAT ARE NOT GARBAGE AND LOOK LIKE IT
 *
 *   - The board on screen, which may hold cards not yet written to disk.
 *   - Cards taken away with Cut, which are on no board at all until they are
 *     put down somewhere.
 *   - A file written moments ago, because a drop writes the file first and
 *     puts the card down after.
 *
 * Each of those is a way to delete a picture somebody is still using, so each
 * is asked about before anything is removed.
 * ------------------------------------------------------------------------- */

/* A file younger than this is assumed to belong to something still arriving.
 *
 * The gap it covers is small and precise: a drop writes the file, then the
 * card goes into the live store, and only between those two is the file spoken
 * for by nothing this can see. That is milliseconds. Ten seconds is a thousand
 * times over, which is the right kind of margin — long enough that no drop,
 * draw or fetch could still be in that gap, short enough that a picture
 * deleted a moment ago is reclaimed on the next sweep rather than the one
 * after lunch.
 *
 * Everything else is covered by looking rather than waiting: once the card is
 * in the live store it is passed in as `live`, and once the board is saved it
 * is found by reading the boards. */
const GRACE_MS = 10_000

/* Both names a card can point a file by. A video keeps its first frame under a
 * name derived from its own, and a poster nobody claims is a card with nothing
 * to show while it loads. */
function keysOf(item: Item, into: Set<string>) {
  if (item.media) {
    into.add(item.media)
    /* Written by ingest as `${key}:poster`. Added whether or not this item
     * names one, because an older record may not have. */
    into.add(item.media + ':poster')
  }
  if (item.poster) into.add(item.poster)
}

/* Every file name anything still points at. Exported so a test can ask the
 * question separately from acting on the answer. */
export function keysInUse(boards: StoredBoard[], live: Item[] = [], held: Item[] = []): Set<string> {
  const out = new Set<string>()
  for (const b of boards) for (const it of (b.items || []) as Item[]) keysOf(it, out)
  for (const it of live) keysOf(it, out)
  for (const it of held) keysOf(it, out)
  return out
}

export interface Swept {
  /* How many files were let go, and what they came to. */
  files: number
  bytes: number
  /* How many were kept only because they were too new to judge. */
  young: number
}

export interface SweepWhat {
  /* The board on screen, which may be ahead of what is on disk. */
  live?: Item[]
  /* Cards taken away with Cut and not yet put down. */
  held?: Item[]
  /* Report what would go without going through with it. */
  dryRun?: boolean
  now?: number
}

export async function sweep(what: SweepWhat = {}): Promise<Swept> {
  const [boards, keys] = await Promise.all([allBoards(), allBlobKeys()])
  const used = keysInUse(boards, what.live || [], what.held || [])
  const now = what.now ?? Date.now()

  let files = 0
  let bytes = 0
  let young = 0

  for (const key of keys) {
    if (used.has(key)) continue
    if (now - writtenAt(key) < GRACE_MS) {
      young++
      continue
    }
    const blob = await getBlob(key)
    const size = blob ? blob.size : 0
    if (!what.dryRun) await delBlob(key)
    files++
    bytes += size
  }

  return { files, bytes, young }
}

/* "Freed 41 files, 82MB" in the one form anybody reads. */
export function describeSweep(s: Swept): string {
  if (!s.files) return s.young ? 'Nothing to clear up yet' : 'Nothing to clear up'
  const mb = s.bytes / (1024 * 1024)
  const size = mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)}MB` : `${Math.max(1, Math.round(s.bytes / 1024))}KB`
  return `Cleared ${s.files} file${s.files === 1 ? '' : 's'}, ${size}`
}
