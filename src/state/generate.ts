import { useEffect, useState } from 'react'
import type { Item } from './types'
import { FX_0 } from '../engine/types'
import { store } from './store'
import { newId } from './ingest'
import { newKey, decodeCapped } from '../store/media'
import { putBlob } from '../store/idb'
import { ensureSource, markReady } from '../board/sources'
import { getEngine } from '../engine/client'
import { AiError, generate, type GenOpts } from '../ai/gemini'

/* ---------------------------------------------------------------------------
 * A picture that did not exist until you asked for it.
 *
 * It lands the same way a dropped file does and is the same thing afterwards:
 * a blob in the local store, a card that owns it, a source on the GPU. Nothing
 * downstream — effects, export, the poster, the folder mirror — knows or cares
 * that it was drawn rather than photographed.
 *
 * The card appears before the picture does, at the size the aspect ratio asks
 * for, because a request that takes ten seconds with nothing on screen looks
 * like a request that failed.
 * ------------------------------------------------------------------------- */

/* Which cards are still waiting on an answer.
 *
 * Held in memory rather than on the item, so that a tab closed mid-draw cannot
 * leave a card marked as drawing for ever, and a board saved mid-draw does not
 * carry the state into the file. */
const drawing = new Set<string>()
const watchers = new Set<() => void>()

function mark(id: string, on: boolean) {
  if (on) drawing.add(id)
  else drawing.delete(id)
  for (const fn of [...watchers]) fn()
}

export const isDrawing = (id: string) => drawing.has(id)
export const drawingCount = () => drawing.size

export function useDrawing(id: string): boolean {
  const [on, setOn] = useState(() => drawing.has(id))
  useEffect(() => {
    const fn = () => setOn(drawing.has(id))
    fn()
    watchers.add(fn)
    return () => {
      watchers.delete(fn)
    }
  }, [id])
  return on
}

const MAX = 420

/* The box a card gets before anyone knows the real size. A ratio the model was
 * asked for is a better guess than a square, and a square is a better guess
 * than nothing. */
export function boxFor(aspect: string): { w: number; h: number } {
  const m = /^(\d+):(\d+)$/.exec(aspect.trim())
  if (!m) return { w: MAX, h: MAX }
  const rw = Number(m[1])
  const rh = Number(m[2])
  if (!rw || !rh) return { w: MAX, h: MAX }
  const s = Math.min(MAX / rw, MAX / rh)
  return { w: Math.round(rw * s), h: Math.round(rh * s) }
}

function fitBox(nw: number, nh: number) {
  const s = Math.min(MAX / nw, MAX / nh, 1)
  return { w: Math.round(nw * s), h: Math.round(nh * s) }
}

/* A prompt is a sentence and a card title is a few words. Cut it at a word. */
export function titleFrom(prompt: string): string {
  const one = prompt.trim().replace(/\s+/g, ' ')
  if (one.length <= 40) return one
  const cut = one.slice(0, 40)
  const sp = cut.lastIndexOf(' ')
  return (sp > 16 ? cut.slice(0, sp) : cut) + '…'
}

/* base64 to bytes, without a data URL round trip. */
export function bytesFrom(b64: string): Uint8Array<ArrayBuffer> {
  /* Some encoders use the URL-safe alphabet and drop the padding. */
  let s = b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (s.length % 4) s += '='.repeat(4 - (s.length % 4))
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const placeholderItem = (at: { x: number; y: number }, prompt: string, aspect: string): Item => ({
  id: newId(),
  kind: 'image',
  x: Math.round(at.x),
  y: Math.round(at.y),
  z: 0,
  ...boxFor(aspect),
  name: titleFrom(prompt),
  /* The whole prompt, kept on the card, so that a board full of generated
   * pictures still says what each one was asked for six months later — and so
   * the search box can find one by a word from its prompt. */
  text: prompt.trim(),
  fx: { ...FX_0 },
  tag: null,
})

export interface DrawResult {
  id: string
  ok: boolean
  error?: string
}

/* Put a card down, ask for the picture, and fill the card in.
 *
 * Never throws: a failure is a message and a card that removes itself, because
 * the caller is a button and the answer belongs on screen. */
export async function draw(
  at: { x: number; y: number },
  prompt: string,
  opts: Omit<GenOpts, 'prompt'> = {},
  select = true
): Promise<DrawResult> {
  const aspect = opts.aspect || ''
  const it = placeholderItem(at, prompt, aspect)
  store.add(it)
  if (select) store.select([it.id])
  mark(it.id, true)

  try {
    const img = await generate({ ...opts, prompt })
    /* Deleted, or undone, while we were asking. */
    if (!store.getItem(it.id)) return { id: it.id, ok: false }

    const blob = new Blob([bytesFrom(img.data)], { type: img.mime })
    const key = newKey('img')
    await putBlob(key, blob)
    if (!store.getItem(it.id)) return { id: it.id, ok: false }

    const bmp = await decodeCapped(blob)
    const nw = bmp?.width || 1024
    const nh = bmp?.height || 1024
    if (bmp) {
      getEngine().putSource(key, bmp)
      markReady(key)
    } else {
      void ensureSource(key, blob)
    }
    if (!store.getItem(it.id)) return { id: it.id, ok: false }

    const cur = store.getItem(it.id)!
    const patch: Partial<Item> = { media: key, mime: img.mime, nw, nh, readable: true }
    /* Leave the card alone if it has been resized while it was drawing. */
    if (cur.w === it.w && cur.h === it.h) Object.assign(patch, fitBox(nw, nh))
    store.update(it.id, patch, false)
    return { id: it.id, ok: true }
  } catch (e) {
    /* The empty card is not worth keeping. Nothing came, and a placeholder
     * left behind is one more thing to tidy up by hand.
     *
     * Taken away without recording it, so that undo does not hand back a card
     * nobody asked for. The snapshot the placeholder's own arrival left is
     * still there and is now identical to the board, so one press of undo
     * after a failed draw does nothing rather than something wrong. */
    if (store.getItem(it.id)) store.remove([it.id], false)
    const msg = e instanceof AiError ? e.message : (e as Error)?.name === 'AbortError' ? 'Stopped.' : 'Something went wrong asking for that picture.'
    return { id: it.id, ok: false, error: msg }
  } finally {
    mark(it.id, false)
  }
}

/* Ask for more than one at a time.
 *
 * Laid out in a row from the same point, so that four answers to one prompt
 * arrive side by side and can be held up against each other — which is the
 * reason to ask for four rather than one, and what the compare view is for.
 *
 * Separate requests rather than one request for several pictures: the two
 * families count samples differently, and one of them returns them all buried
 * in the same reply. Four requests cost what four pictures cost either way,
 * and each card fills in the moment its own answer lands. */
export async function drawMany(
  at: { x: number; y: number },
  prompt: string,
  count: number,
  opts: Omit<GenOpts, 'prompt'> = {}
): Promise<DrawResult[]> {
  const n = Math.max(1, Math.min(4, Math.round(count) || 1))
  const box = boxFor(opts.aspect || '')
  const gap = 24
  /* Centred on the point asked for, rather than running off to the right of
   * it, so that asking for four from the middle of the view puts four in the
   * middle of the view. */
  const x0 = at.x - ((n - 1) * (box.w + gap)) / 2
  const made = await Promise.all(
    Array.from({ length: n }, (_, i) => draw({ x: x0 + i * (box.w + gap), y: at.y }, prompt, opts, false))
  )
  /* Selected together at the end: four separate calls to select would each
   * have replaced the last, leaving one of the four picked out for no reason.
   * All four, and comparing them is one key away. */
  const kept = made.filter((r) => r.ok || !r.error).map((r) => r.id).filter((id) => store.getItem(id))
  if (kept.length) store.select(kept)
  return made
}
