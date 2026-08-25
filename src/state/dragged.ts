/* ---------------------------------------------------------------------------
 * What a browser hands over when you drag a picture out of a page.
 *
 * Not the file. A drag from another tab carries a small bundle of flavours,
 * and which of them holds the address depends on the browser and on what was
 * dragged:
 *
 *   text/uri-list   the address, when the thing dragged was a link
 *   text/html       a fragment — usually <img src="…"> — when it was a picture
 *   text/plain      the address again, or the page's address, or the alt text
 *
 * Dragging a photograph out of a search results page is the commonest case and
 * the worst behaved: text/plain is often the page it sits on rather than the
 * picture itself, and only the HTML fragment names the file. So all three are
 * read, and the most specific one wins.
 * ------------------------------------------------------------------------- */

const ABSOLUTE = /^https?:\/\//i

/* The src of the first <img> in a fragment, resolved against the page it came
 * from where the fragment says which that was. */
export function imageFromHtml(html: string): string | null {
  if (!html) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const img = doc.querySelector('img')
  const src = img?.getAttribute('src')?.trim()
  if (!src) return null
  if (ABSOLUTE.test(src)) return src
  /* A relative src with nothing to resolve it against is no use to anyone. */
  if (src.startsWith('data:')) return src
  return null
}

const firstUrl = (text: string): string | null =>
  (text || '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .find((l) => ABSOLUTE.test(l)) || null

/* The best address in a drag, or null. `types` is checked before each read
 * because asking a DataTransfer for a flavour it has not got is not free in
 * every browser and returns an empty string in the rest. */
export function urlFromDrag(dt: DataTransfer | null): string | null {
  if (!dt) return null
  const has = (t: string) => Array.from(dt.types || []).includes(t)

  /* The picture itself, where the fragment names one. */
  if (has('text/html')) {
    const src = imageFromHtml(dt.getData('text/html'))
    if (src) return src
  }
  if (has('text/uri-list')) {
    const u = firstUrl(dt.getData('text/uri-list'))
    if (u) return u
  }
  if (has('text/plain')) {
    const u = firstUrl(dt.getData('text/plain'))
    if (u) return u
  }
  return null
}

/* The same question of a paste. A screenshot arrives as a file and is handled
 * before this; what is left is an address, which may be an image's. */
export function urlFromPaste(dt: DataTransfer | null): string | null {
  if (!dt) return null
  const has = (t: string) => Array.from(dt.types || []).includes(t)
  if (has('text/html')) {
    const src = imageFromHtml(dt.getData('text/html'))
    if (src) return src
  }
  const text = dt.getData('text/plain')?.trim()
  return text && ABSOLUTE.test(text) ? text : null
}
