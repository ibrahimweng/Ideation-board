import { store } from './store'
import { getBlob, putBlob } from '../store/idb'
import { ensureSource } from '../board/sources'
import { newKey } from '../store/media'
import { renderPdfPage } from '../store/pdf'

/* ---------------------------------------------------------------------------
 * Turning to another page.
 *
 * A document card shows one page at a time, and that page is a picture. Going
 * to the next one means rendering it, saving it, and pointing the card at it —
 * which is a write to storage and a decode, so it is here rather than in the
 * card, and it is guarded so that holding the arrow down cannot start twelve
 * renders of the same document at once.
 *
 * The old page is simply let go. It is a file nothing points at any more,
 * which is exactly what the sweep in `store/reclaim.ts` collects, so turning
 * pages does not quietly fill the browser with pictures of pages nobody is
 * looking at.
 * ------------------------------------------------------------------------- */

/* Cards with a render already in flight. A second request for the same card is
 * dropped rather than queued: the page you asked for last is the page you
 * want, and by the time a queue drained you would have passed it. */
const busy = new Set<string>()

export const turningPage = (id: string) => busy.has(id)

/* Which page a card would land on, kept inside the document. Returns the
 * current page when there is nowhere to go, so a caller can compare and know
 * whether to offer the move at all. */
export function pageAfter(current: number, by: number, pages: number): number {
  return Math.min(Math.max(1, (current || 1) + by), Math.max(1, pages || 1))
}

/* Goes to a page of the document on a card. Returns whether anything changed,
 * so a caller can say so or stay quiet. */
export async function goToPage(id: string, page: number): Promise<boolean> {
  const it = store.getItem(id)
  if (!it || it.kind !== 'pdf' || !it.media) return false
  const pages = it.pages || 1
  const want = Math.min(Math.max(1, Math.round(page)), pages)
  if (want === (it.page || 1)) return false
  if (busy.has(id)) return false

  busy.add(id)
  try {
    const file = await getBlob(it.media)
    if (!file) return false
    const out = await renderPdfPage(it.media, file, want)
    if (!out) return false

    const key = newKey('pg')
    await putBlob(key, out.blob)
    await ensureSource(key, out.blob)

    /* One step of undo for the whole turn, and the card keeps its size: the
     * pages of a document are the same shape as each other, and a card that
     * resized itself every time you turned a page would walk around the board.
     * `nw` and `nh` still follow the page, because those describe the picture
     * rather than the card. */
    const still = store.getItem(id)
    if (!still || still.kind !== 'pdf') return false
    store.update(id, { poster: key, page: want, nw: out.w, nh: out.h })
    return true
  } catch {
    return false
  } finally {
    busy.delete(id)
  }
}

/* The two a keyboard and a pair of buttons both want. */
export const nextPage = (id: string) => {
  const it = store.getItem(id)
  return it ? goToPage(id, pageAfter(it.page || 1, 1, it.pages || 1)) : Promise.resolve(false)
}
export const prevPage = (id: string) => {
  const it = store.getItem(id)
  return it ? goToPage(id, pageAfter(it.page || 1, -1, it.pages || 1)) : Promise.resolve(false)
}
