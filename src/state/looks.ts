import type { FxState, Layer, Params } from '../engine/types'

/* ---------------------------------------------------------------------------
 * Looks: an effect and a grade, saved under a name and put on other cards.
 *
 * A board full of pictures is rarely twelve separate decisions. It is one
 * decision made twelve times, and until now the only way to make it twelve
 * times was to select everything before choosing, or to set every slider again
 * by hand for each card added later.
 *
 * A look is the treatment and not the composition: the effect, its parameters,
 * and the tone. Zoom, offset, rotation and flip stay with the card they belong
 * to, because those are how a particular picture is cropped and carrying them
 * across would wreck eleven framings to copy one.
 *
 * They live in localStorage rather than in the board. A look is how you work
 * rather than what is on this board, and you want the one you saved last week
 * when you open a new board today.
 * ------------------------------------------------------------------------- */

export interface LookFx {
  fxid: string
  ep: Params | null
  /* Effects after the first. A look that dropped these would silently flatten
   * a stacked card to its bottom layer, which is the sort of loss nobody
   * notices until the picture is wrong. */
  more?: Layer[]
  exp: number
  con: number
  sat: number
  warm: number
  blur: number
  grain: number
  preset: string
}

export interface Look {
  id: string
  name: string
  fx: LookFx
  saved: number
}

const KEY = 'ideation.looks'
const CLIP = 'ideation.look.clipboard'
const LIMIT = 60

/* The part of a card's settings a look carries. */
export function lookFrom(fx: FxState): LookFx {
  return {
    fxid: fx.fxid,
    ep: fx.ep ? { ...fx.ep } : null,
    more: fx.more?.length ? fx.more.map((l) => ({ fxid: l.fxid, ep: l.ep ? { ...l.ep } : null })) : undefined,
    exp: fx.exp,
    con: fx.con,
    sat: fx.sat,
    warm: fx.warm,
    blur: fx.blur,
    grain: fx.grain,
    preset: fx.preset,
  }
}

/* True when there is anything worth saving or copying. */
export const isPlain = (fx: LookFx) =>
  fx.fxid === 'none' && !fx.exp && !fx.con && fx.sat === 100 && !fx.warm && !fx.blur && !fx.grain

/* ---------- the saved list ---------- */

let cache: Look[] | null = null
const listeners = new Set<() => void>()

function read(): Look[] {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    cache = Array.isArray(raw) ? raw.filter((l) => l && l.id && l.fx) : []
  } catch {
    cache = []
  }
  return cache
}

function write(next: Look[]) {
  cache = next.slice(0, LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* A session with no storage keeps them for as long as it lasts. */
  }
  for (const fn of listeners) fn()
}

export function subscribeLooks(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function listLooks(): Look[] {
  return read()
}

/* Newest first: the one you just saved is the one you are about to use. */
export function saveLook(name: string, fx: LookFx): Look {
  const look: Look = {
    id: 'lk_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name: (name || 'Look').trim().slice(0, 40) || 'Look',
    fx,
    saved: Date.now(),
  }
  write([look, ...read()])
  return look
}

export function removeLook(id: string) {
  write(read().filter((l) => l.id !== id))
}

export function renameLook(id: string, name: string) {
  const clean = (name || '').trim().slice(0, 40)
  if (!clean) return
  write(read().map((l) => (l.id === id ? { ...l, name: clean } : l)))
}

/* ---------- the clipboard ---------- */

/* Kept in storage as well as in memory, so a look copied before a reload is
 * still on the clipboard after it. */
export function copyLook(fx: LookFx) {
  try {
    localStorage.setItem(CLIP, JSON.stringify(fx))
  } catch {
    /* memory only */
  }
  clip = fx
  for (const fn of listeners) fn()
}

let clip: LookFx | null | undefined

export function copiedLook(): LookFx | null {
  if (clip !== undefined) return clip
  try {
    const raw = JSON.parse(localStorage.getItem(CLIP) || 'null')
    clip = raw && typeof raw.fxid === 'string' ? (raw as LookFx) : null
  } catch {
    clip = null
  }
  return clip
}

/* A name for a look nobody has named, taken from what it actually is. */
export function describe(fx: LookFx, effectName: string): string {
  const bits: string[] = []
  if (fx.fxid !== 'none') bits.push(effectName)
  if (fx.sat === 0) bits.push('mono')
  else if (fx.warm > 20) bits.push('warm')
  else if (fx.warm < -20) bits.push('cool')
  if (fx.grain > 30) bits.push('grain')
  if (!bits.length) bits.push('Look')
  return bits.join(' ')
}
