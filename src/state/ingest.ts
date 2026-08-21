import type { Item, Kind } from './types'
import { FX_0 } from '../engine/types'
import { saveMedia, newKey, posterFrom, isImage, isVideo, isAudio, decodeCapped } from '../store/media'
import { putBlob } from '../store/idb'
import { ensureSource, markReady } from '../board/sources'
import { getEngine } from '../engine/client'

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
  return { w: Math.round(nw * s), h: Math.round(nh * s) + 30 }
}

export function kindOf(mime: string, name: string): Kind {
  if (isImage(mime)) return 'image'
  if (isVideo(mime)) return 'video'
  if (isAudio(mime)) return 'audio'
  if (/^text\/|\.(md|txt)$/i.test(mime + name)) return 'note'
  return 'file'
}

export const newId = () => 'i_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/* Yields one item per file, in order, as each becomes ready. */
export async function* ingest(files: File[], at: { x: number; y: number }): AsyncGenerator<Item> {
  let col = 0
  let row = 0

  for (const file of files) {
    const kind = kindOf(file.type || '', file.name || '')
    const x = at.x + col * (MAX_W + 24)
    const y = at.y + row * (MAX_H + 40)
    col++
    if (col >= 4) {
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
      yield { ...base, kind: 'image', media: key, nw, nh, ...box }
      continue
    }

    if (kind === 'video') {
      const url = URL.createObjectURL(file)
      const poster = await posterFrom(url)
      URL.revokeObjectURL(url)
      const nw = poster?.w || 640
      const nh = poster?.h || 360
      /* The poster is what effects run against, so a video card can be
       * effected without decoding frames until it plays. */
      if (poster) {
        await putBlob(key + ':poster', poster.blob)
        void ensureSource(key, poster.blob)
      }
      const box = fitBox(nw, nh)
      yield { ...base, kind: 'video', media: key, nw, nh, ...box }
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
