import type { Item, Kind } from './types'
import { FX_0 } from '../engine/types'
import { saveMedia, newKey, posterFrom, isImage, isVideo, isAudio, decodeCapped } from '../store/media'
import { putBlob } from '../store/idb'
import { isAnimated, mightMove } from '../store/anim'
import { ensureSource, markReady } from '../board/sources'
import { getEngine } from '../engine/client'
import { classifyUrl, fetchImage, probeVideo, hostOf } from './urls'
import { store } from './store'

/* ---------------------------------------------------------------------------
 * Turning dropped files into board items.
 *
 * Ingest is streaming: each file becomes a card as soon as its dimensions are
 * known, rather than waiting for the whole drop to finish. Decoding runs off
 * the main thread and the decoded bitmap is handed straight to the GPU, so
 * dropping fifty photographs does not lock the interface.
 * ------------------------------------------------------------------------- */

const MAX_W = 420
const MAX_H = 420

function fitBox(nw: number, nh: number) {
  const s = Math.min(MAX_W / nw, MAX_H / nh, 1)
  return { w: Math.round(nw * s), h: Math.round(nh * s) }
}

export function kindOf(mime: string, name: string): Kind {
  if (isImage(mime)) return 'image'
  if (isVideo(mime)) return 'video'
  if (isAudio(mime)) return 'audio'
  if (/^text\/|\.(md|txt)$/i.test(mime + name)) return 'note'
  return 'file'
}

export const newId = () => 'i_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/* How wide to lay a drop out.
 *
 * Four across, always, meant that dropping a folder of twenty photographs
 * built a column five rows deep that marched off the bottom of the window.
 * Eight arrived on screen and twelve did not, with nothing to say they were
 * there — which looks exactly like a drop that half failed. A block shaped
 * roughly like the window is one you can take in at a glance once the view
 * moves to it. */
export function dropColumns(count: number, vpW = 0, vpH = 0): number {
  if (count <= 1) return 1
  const cell = { w: MAX_W + 24, h: MAX_H + 40 }
  /* The board's own proportions if we know them, otherwise a squarish block. */
  const aspect = vpW > 0 && vpH > 0 ? vpW / vpH : 1
  const cols = Math.round(Math.sqrt((count * aspect * cell.h) / cell.w))
  return Math.max(1, Math.min(count, cols || 1))
}

/* Yields one item per file, in order, as each becomes ready. */
export async function* ingest(
  files: File[],
  at: { x: number; y: number },
  columns = 4
): AsyncGenerator<Item> {
  const across = Math.max(1, Math.round(columns))
  let col = 0
  let row = 0

  for (const file of files) {
    const kind = kindOf(file.type || '', file.name || '')
    const x = at.x + col * (MAX_W + 24)
    const y = at.y + row * (MAX_H + 40)
    col++
    if (col >= across) {
      col = 0
      row++
    }

    const base: Omit<Item, 'w' | 'h'> = {
      id: newId(),
      kind,
      x: Math.round(x),
      y: Math.round(y),
      z: 0,
      name: file.name,
      mime: file.type,
      fx: { ...FX_0 },
      tag: null,
    }

    if (kind === 'note') {
      const text = await file.text().catch(() => '')
      yield { ...base, kind: 'note', text: text.slice(0, 4000), w: 300, h: 220, color: '#FBEFC4' }
      continue
    }

    const key = newKey(kind === 'image' ? 'img' : kind === 'video' ? 'vid' : 'med')
    await saveMedia(key, file)

    if (kind === 'image') {
      const bmp = await decodeCapped(file)
      const nw = bmp?.width || 800
      const nh = bmp?.height || 600
      /* Hand the decode straight to the GPU rather than throwing it away and
       * decoding a second time when the card mounts. */
      if (bmp) {
        getEngine().putSource(key, bmp)
        markReady(key)
      }
      const box = fitBox(nw, nh)
      /* Asked only of the types that can move at all, so a folder of two
       * hundred photographs does not open two hundred decoders to be told
       * what the mime type already said. */
      const anim = mightMove(file.type) ? await isAnimated(file) : false
      yield { ...base, kind: 'image', media: key, nw, nh, ...box, ...(anim ? { anim } : {}) }
      continue
    }

    if (kind === 'video') {
      const url = URL.createObjectURL(file)
      const poster = await posterFrom(url)
      URL.revokeObjectURL(url)
      const nw = poster?.w || 640
      const nh = poster?.h || 360
      /* The poster is a still of the first frame. It is what an effected
       * video card shows until the video itself has decoded something, and
       * what it falls back to on a reload.
       *
       * It gets its own key. Keying it to the video would mean that after a
       * reload the source loader is handed the video file and asked to decode
       * it as an image, which fails, and the card would never render. */
      const posterKey = poster ? key + ':poster' : undefined
      if (poster && posterKey) {
        await putBlob(posterKey, poster.blob)
        void ensureSource(posterKey, poster.blob)
      }
      const box = fitBox(nw, nh)
      yield { ...base, kind: 'video', media: key, poster: posterKey, nw, nh, ...box }
      continue
    }

    if (kind === 'audio') {
      yield { ...base, kind: 'audio', media: key, w: 320, h: 130 }
      continue
    }

    yield { ...base, kind: 'file', media: key, w: 260, h: 150 }
  }
}

export function noteItem(at: { x: number; y: number }, text = ''): Item {
  return {
    id: newId(), kind: 'note', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 300, h: 220, text, color: '#FBEFC4', fx: { ...FX_0 }, tag: null, name: 'Note',
  }
}

export function linkItem(at: { x: number; y: number }, url: string): Item {
  let name = 'link'
  try {
    name = new URL(url).hostname.replace(/^www\./, '')
  } catch { /* keep the fallback */ }
  return {
    id: newId(), kind: 'link', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 300, h: 130, url, name, fx: { ...FX_0 }, tag: null,
  }
}

/* A picture named by its address. It shows immediately from the URL, and the
 * bytes are fetched behind it so that it becomes a picture this board holds
 * rather than one it points at. Square until the file says otherwise. */
export function imageUrlItem(at: { x: number; y: number }, url: string, name: string): Item {
  return {
    id: newId(), kind: 'image', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 320, h: 320, url, name, fx: { ...FX_0 }, tag: null,
    /* Until the fetch says otherwise, assume its pixels are not ours. */
    readable: false,
  }
}

export function videoUrlItem(at: { x: number; y: number }, url: string, name: string): Item {
  return {
    id: newId(), kind: 'video', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    /* Sixteen by nine until the file itself says otherwise. */
    w: 420, h: 266, url, name, fx: { ...FX_0 }, tag: null,
  }
}

export function embedItem(at: { x: number; y: number }, url: string, embed: string, name: string): Item {
  return {
    id: newId(), kind: 'embed', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 480, h: 300, url, embed, name, fx: { ...FX_0 }, tag: null,
  }
}

/* ---------------------------------------------------------------------------
 * The one way a URL becomes a card, used by paste, drop, the Link button and
 * the right click menu alike.
 *
 * A card appears immediately, from the URL's shape alone, and is then
 * corrected once the browser has told us what is actually at the other end: a
 * link that turns out to be a video becomes a video card, a `.mp4` that turns
 * out to be a dead end goes back to being a link, and a video card learns its
 * real proportions and whether its pixels can be read.
 * ------------------------------------------------------------------------- */
export function addUrl(at: { x: number; y: number }, raw: string): Item {
  const c = classifyUrl(raw)
  if (c.kind === 'embed') {
    const it = embedItem(at, c.url, c.embed, c.name)
    store.add(it)
    return it
  }
  if (c.kind === 'image') {
    const it = imageUrlItem(at, c.url, c.name)
    store.add(it)
    void refineImage(it, c.url)
    return it
  }
  const it = c.kind === 'video' ? videoUrlItem(at, c.url, c.name) : linkItem(at, c.url)
  store.add(it)
  if (/^https?:\/\//i.test(c.url)) void refine(it, c.url)
  return it
}

/* Fetch the picture behind the address, and become the picture rather than a
 * pointer at it. A host that refuses the read leaves the card showing from the
 * URL, which works for looking at and not for shading — the same bargain a
 * cross-origin video makes. An address that was never a picture goes back to
 * being a link. */
async function refineImage(made: Item, url: string) {
  const got = await fetchImage(url)
  if (!store.getItem(made.id)) return

  if (!got) {
    store.update(made.id, { kind: 'link', w: 300, h: 130, name: hostOf(url) }, false)
    return
  }

  const cur = store.getItem(made.id)!
  const patch: Partial<Item> = { nw: got.nw, nh: got.nh }
  /* Leave the card alone if it has been resized in the meantime. */
  if (cur.w === made.w && cur.h === made.h) Object.assign(patch, fitBox(got.nw, got.nh))

  if (got.blob) {
    const key = newKey('img')
    await putBlob(key, got.blob)
    if (!store.getItem(made.id)) return
    void ensureSource(key, got.blob)
    patch.media = key
    patch.mime = got.blob.type
    patch.readable = true
    /* A GIF dragged out of another tab moves exactly as much as one dragged
     * off the disk. */
    if (mightMove(got.blob.type) && (await isAnimated(got.blob))) patch.anim = true
    if (!store.getItem(made.id)) return
  }
  store.update(made.id, patch, false)
}

async function refine(made: Item, url: string) {
  const probe = await probeVideo(url)
  const cur = store.getItem(made.id)
  /* Deleted, or undone, while we were asking. */
  if (!cur) return

  if (!probe) {
    if (cur.kind === 'video') {
      store.update(made.id, { kind: 'link', w: 300, h: 130, name: hostOf(url) }, false)
    }
    return
  }

  const patch: Partial<Item> = { kind: 'video', url, nw: probe.nw, nh: probe.nh, readable: probe.readable }
  /* Leave the card alone if it has been resized in the meantime. */
  if (cur.w === made.w && cur.h === made.h) Object.assign(patch, fitBox(probe.nw, probe.nh))
  store.update(made.id, patch, false)

  /* A still of the first frame, on the same terms as a dropped file: it backs
   * the effect previews in the panel and is what the card shows before the
   * video itself has decoded anything. Only possible when the host lets us
   * read the picture in the first place. */
  if (!probe.readable) return
  const poster = await posterFrom(url, true)
  if (!poster || !store.getItem(made.id)) return
  const posterKey = newKey('vid') + ':poster'
  await putBlob(posterKey, poster.blob)
  void ensureSource(posterKey, poster.blob)
  store.update(made.id, { poster: posterKey }, false)
}

export function boardItem(at: { x: number; y: number }, board: string, name = 'Board'): Item {
  return {
    id: newId(), kind: 'board', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 260, h: 190, board, name, fx: { ...FX_0 }, tag: null,
  }
}

export function sectionItem(at: { x: number; y: number }): Item {
  return {
    id: newId(), kind: 'section', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 720, h: 480, name: 'Section', fx: { ...FX_0 }, tag: null,
  }
}

export function labelItem(at: { x: number; y: number }): Item {
  return {
    id: newId(), kind: 'label', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 260, h: 56, text: 'Label', color: '#111114', fx: { ...FX_0 }, tag: null,
  }
}
