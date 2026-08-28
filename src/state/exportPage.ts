import type { Item } from './types'
import { boardTree } from './boards'
import { getBlob } from '../store/idb'
import { renderCardPicture } from './exportImage'
import { TRAITS } from './kinds'
import { parse } from './rich'
import type { Span } from './rich'
import { safeName } from '../store/fs'
import { pageHtml } from './pageHtml'
import type { PageBoard, PageItem } from './pageHtml'

/* ---------------------------------------------------------------------------
 * A board somebody else can open.
 *
 * There was no way to hand a board to a person. The zip is a backup — it holds
 * everything and it is worth having, and it is also useless to anyone without
 * this app, because it is a format rather than a document. The poster is a
 * picture: one flat sheet, no walking into the boards inside, nothing to read
 * at full size. So the honest answer to "can you send me that board" was no.
 *
 * This is one HTML file. Every picture is inside it as data, every board in
 * the tree is in there too, and it opens in any browser with no network, no
 * server and nothing installed. Effects are baked in, because the person
 * opening it has no GPU pipeline of ours to run them through — what they get
 * is what was on the screen.
 *
 * WHAT IT IS NOT
 *
 * It is not the board coming back. Nothing here can be imported: an exported
 * page has thrown away the original files and kept a picture of each card at
 * the size it was being shown. That is the trade that makes it small enough to
 * send, and the zip is still the thing to keep. Two exports for two jobs, and
 * the names say which is which.
 * ------------------------------------------------------------------------- */

export interface PageResult {
  blob: Blob
  name: string
  boards: number
  cards: number
  pictures: number
  bytes: number
}

/* How big a baked picture is allowed to get.
 *
 * A card is a few hundred units across on the board and this is a page for
 * looking at, so twice the card's own size is enough to stay crisp when
 * somebody zooms in a little, and the cap stops one enormous photograph from
 * being most of the file. Both were chosen by exporting a real board and
 * looking at what came out — at 1400 a full-width picture is still sharp on a
 * laptop screen and a twenty-card board lands around three megabytes. */
const SCALE = 2
const MAX_EDGE = 1400

/* The colour a label is made with, which is to say the one nobody picked. */
const LABEL_INK = '#111114'

/* WebP first: for a page whose whole point is being small enough to send, it
 * is a third of the size of PNG at a quality nobody can tell apart. Every
 * browser that can open the result can decode it. PNG is the way out for
 * anything that will not encode. */
async function encode(cv: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/webp', 0.82))
  if (webp && webp.type === 'image/webp') return webp
  return new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'))
}

async function dataUri(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(fr.error)
    fr.readAsDataURL(blob)
  })
}

/* The picture behind a card, whatever kind of card it is.
 *
 * A video on a board you are not looking at has no element to read a frame
 * from, so it falls back to the still that was kept when it was brought in.
 * Without that, every video on every nested board would come out blank. */
async function sourceFor(item: Item): Promise<ImageBitmap | null> {
  const keys = [item.media, item.poster].filter(Boolean) as string[]
  if (item.kind === 'video') {
    const el = document.querySelector(`.card[data-id="${item.id}"] video`) as HTMLVideoElement | null
    if (el && el.videoWidth) {
      try {
        return await createImageBitmap(el)
      } catch { /* a host that will not let its pixels be read */ }
    }
    keys.reverse()
  }
  for (const key of keys) {
    try {
      const blob = await getBlob(key)
      if (blob) return await createImageBitmap(blob)
    } catch { /* try the next one */ }
  }
  return null
}

/* A note's own little bit of formatting, as HTML rather than as marks.
 *
 * Done here rather than in the page, because the parser is a hundred lines and
 * the page is meant to be the board rather than a copy of the app. */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const spansToHtml = (spans: Span[]) =>
  spans
    .map((s) => {
      let out = esc(s.text)
      if (s.code) out = `<code>${out}</code>`
      if (s.b) out = `<b>${out}</b>`
      if (s.i) out = `<i>${out}</i>`
      /* Only the schemes a document should be able to send you to. */
      if (s.href && /^https?:\/\//i.test(s.href)) {
        out = `<a href="${esc(s.href)}" target="_blank" rel="noreferrer noopener">${out}</a>`
      }
      return out
    })
    .join('')

export function noteHtml(text: string): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const shut = () => {
    if (list) out.push(`</${list}>`)
    list = null
  }
  for (const b of parse(text || '')) {
    if (b.t !== 'li' && list) shut()
    if (b.t === 'h') out.push(`<h${b.level}>${spansToHtml(b.spans)}</h${b.level}>`)
    else if (b.t === 'p') out.push(`<p>${spansToHtml(b.spans)}</p>`)
    else if (b.t === 'quote') out.push(`<blockquote>${spansToHtml(b.spans)}</blockquote>`)
    else if (b.t === 'hr') out.push('<hr>')
    else if (b.t === 'todo') {
      out.push(
        `<p class="todo" data-done="${b.done ? 1 : 0}"><span>${b.done ? '☑' : '☐'}</span>${spansToHtml(b.spans)}</p>`
      )
    } else if (b.t === 'li') {
      const want = b.ordered ? 'ol' : 'ul'
      if (list !== want) {
        shut()
        out.push(`<${want}>`)
        list = want
      }
      out.push(`<li>${spansToHtml(b.spans)}</li>`)
    }
  }
  shut()
  return out.join('')
}

/* One card, ready for the page. Pictures are baked; everything else is
 * described and drawn by the page itself, so a note stays selectable text and
 * costs a few hundred bytes rather than a photograph. */
async function toPageItem(item: Item, onPicture: () => void): Promise<PageItem | null> {
  const base = {
    id: item.id,
    kind: item.kind,
    x: Math.round(item.x),
    y: Math.round(item.y),
    w: Math.round(item.w),
    h: Math.round(item.h),
    z: item.z || 0,
    name: item.name || '',
    tag: item.tag || null,
    pick: item.pick || null,
    color: item.color || '',
  }

  /* Compared by kind rather than through the trait guards, which narrow an
   * Item to an Item and leave every branch after them typed as nothing. */
  if (item.kind === 'edge') return { ...base, from: item.from || '', to: item.to || '' }

  if (TRAITS[item.kind].pixels || item.kind === 'embed') {
    const src = await sourceFor(item)
    if (src) {
      const scale = Math.min(SCALE, MAX_EDGE / Math.max(base.w, base.h))
      const w = Math.max(2, Math.round(base.w * Math.max(1, scale)))
      const h = Math.max(2, Math.round(base.h * Math.max(1, scale)))
      const cv = await renderCardPicture(item, w, h, src)
      if (cv) {
        const blob = await encode(cv)
        if (blob) {
          onPicture()
          return { ...base, img: await dataUri(blob), alt: item.name || item.kind }
        }
      }
    }
    /* Nothing readable behind it. It still has a place on the board, so it
     * comes out as the box it was rather than as a hole. */
    return { ...base, missing: true }
  }

  if (item.kind === 'note') return { ...base, html: noteHtml(item.text || '') }
  if (item.kind === 'label') {
    /* A label with the colour it is made with is a label nobody coloured, and
     * baking that near-black in would make it unreadable on a page being read
     * in the dark. One somebody actually chose is kept exactly. */
    return { ...base, color: base.color === LABEL_INK ? '' : base.color, text: item.text || '' }
  }
  if (item.kind === 'section') return { ...base, text: item.text || '' }
  if (item.kind === 'link') return { ...base, url: item.url || '', text: item.text || '' }
  if (item.kind === 'board') return { ...base, board: item.board || '' }
  /* Audio and files: named, placed, and not playable from a page that has no
   * copy of them. Said plainly rather than pretended. */
  return { ...base, text: item.text || '' }
}

export interface PageOptions {
  /* Called as each board is finished, so a long export can say where it is. */
  onProgress?: (done: number, total: number) => void
}

export async function exportPage(rootId: string, opts: PageOptions = {}): Promise<PageResult> {
  const boards = await boardTree(rootId)
  const out: PageBoard[] = []
  let cards = 0
  let pictures = 0

  for (let i = 0; i < boards.length; i++) {
    const b = boards[i]
    const items: PageItem[] = []
    for (const raw of (b.items || []) as Item[]) {
      const made = await toPageItem(raw, () => pictures++)
      if (made) items.push(made)
    }
    cards += items.filter((it) => it.kind !== 'edge').length
    out.push({ id: b.id, name: b.name || 'Untitled board', items })
    opts.onProgress?.(i + 1, boards.length)
  }

  const html = pageHtml({ root: rootId, boards: out, made: Date.now() })
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const root = boards.find((b) => b.id === rootId)
  return {
    blob,
    name: `${safeName(root?.name || 'board') || 'board'}.html`,
    boards: out.length,
    cards,
    pictures,
    bytes: blob.size,
  }
}

/* Bytes as something to read in a sentence. */
export function saySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
