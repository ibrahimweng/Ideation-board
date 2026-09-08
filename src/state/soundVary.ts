import { store } from './store'
import { VARIANTS, gridUnder } from './variations'
import { SOUNDS, SOUND_BY_ID } from '../store/sound'
import type { SoundLayer } from '../store/sound'
import { chainOf, isSound, treatSound } from './sounds'
import { isColor, isEnum } from '../engine/types'
import type { Params } from '../engine/types'
import { KEYS } from '../ui/shortcuts'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * Twelve of a sound.
 *
 * The grid was the best thing on the picture side and sound had none of it.
 * Choosing a treatment by moving sliders is fine when you know what you are
 * after, and on a board whose job is working out what you are after it is
 * mostly useless — which is as true of a delay as it is of a halftone.
 *
 * So: the same key, the same grid, the same loop. Twelve versions appear under
 * the card, you mark the ones worth keeping, and pressing it again replaces
 * the rest with twelve bred from those.
 *
 * ## What is different, and why
 *
 * A picture variation costs a hundred bytes of settings: twelve cards point at
 * the one picture and the graphics card does the rest, live. A sound has to be
 * rendered to be heard, so twelve versions are twelve renders and twelve files.
 *
 * That is the whole design constraint. A four-minute track varied twelve ways
 * is about half a gigabyte in a browser that keeps everything you own inside
 * one quota — so it is refused, and the message says what to do instead. Trim
 * is the first effect in the list precisely because a moment is what you want
 * twelve of. Nobody wants twelve four-minute tracks; they want twelve versions
 * of the eight seconds that matter.
 *
 * ## Rendered one at a time
 *
 * Twelve offline renders at once is twelve audio contexts, and browsers hold
 * their noses at about six. They go in order, sharing one decode of the source
 * — which is the slow part — so a batch of a short clip is a couple of
 * seconds rather than a wait.
 * ------------------------------------------------------------------------- */

/* Past this, twelve copies is more storage than anybody meant to spend. Thirty
 * seconds of mono at CD rate is about 2.6MB, so a batch is around 32MB: a lot,
 * and survivable. A minute would not be. */
export const VARY_MAX_SECS = 30

/* Roughly one variant in three runs two effects rather than one. Two is where
 * the surprises are — a gate into a reverb is a different instrument from
 * either — and more than two on a sound is mud rather than an idea. */
const PAIR_CHANCE = 0.35

/* How far a bred variant moves from its parent, as a share of each control's
 * range, and how often a child abandons the parent's effect entirely. Both are
 * the picture side's numbers, because the argument for them is about searching
 * rather than about pixels. */
const JITTER = 0.18
const STRAY_CHANCE = 0.2

const rnd = () => Math.random()
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const snap = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n)

function shuffled<T>(list: readonly T[]): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* `n` effects, spread across the groups rather than drawn from the hat. Four
 * groups and thirteen effects means a straight draw comes up three kinds of
 * reverb about as often as not, and twelve versions that are all space is a
 * worse answer than one. */
export function spreadOfSounds(n: number): string[] {
  if (!n || !SOUNDS.length) return []
  const byGroup = new Map<string, string[]>()
  for (const s of SOUNDS) {
    const g = byGroup.get(s.group)
    if (g) g.push(s.id)
    else byGroup.set(s.group, [s.id])
  }
  const fresh = () => shuffled([...byGroup.values()].map((ids) => shuffled(ids)))
  let queues = fresh()
  const out: string[] = []
  while (out.length < n) {
    let took = 0
    for (const q of queues) {
      if (out.length >= n) break
      const id = q.shift()
      if (id) { out.push(id); took++ }
    }
    if (!took) queues = fresh()
  }
  return out
}

/* The shortest slice a trim is allowed to roll, as a share of the sound.
 *
 * Trim is the one effect whose two ends are rolled apart from each other, and
 * two free ends land close together often enough to matter: a first batch came
 * back with a card reading 0:00, which is a square of the grid spent on
 * nothing. A variation you cannot hear is not a variation. */
const MIN_SLICE = 0.3

/* Settings inside every control, rolled. */
export function rollSoundParams(fxid: string): Params {
  const spec = SOUND_BY_ID[fxid]
  if (!spec) return {}
  const out: Params = {}
  for (const c of spec.controls) {
    if (isColor(c)) out[c.k] = c.def
    else if (isEnum(c)) out[c.k] = Math.floor(rnd() * c.options.length)
    else out[c.k] = clamp(snap(c.min + rnd() * (c.max - c.min), c.step), c.min, c.max)
  }
  /* Rolled as a place and a length rather than as two ends, which is the only
   * way to say "somewhere in it, long enough to hear". */
  if (fxid === 'trim') {
    const len = MIN_SLICE + rnd() * (1 - MIN_SLICE)
    const from = rnd() * (1 - len)
    out.p0 = Math.round(from * 200) / 200
    out.p1 = Math.round((from + len) * 200) / 200
  }
  return out
}

/* The same settings, nudged, so what a child inherits is the decision rather
 * than the number. */
export function breedSoundParams(fxid: string, from: Params | null): Params {
  const spec = SOUND_BY_ID[fxid]
  if (!spec) return {}
  if (!from) return rollSoundParams(fxid)
  const out: Params = {}
  for (const c of spec.controls) {
    const was = from[c.k]
    if (isColor(c)) out[c.k] = typeof was === 'string' ? was : c.def
    else if (isEnum(c)) {
      /* A menu is a decision rather than a dial, so it is kept unless the
         child is going somewhere else anyway. */
      out[c.k] = typeof was === 'number' ? was : c.def
    } else {
      const base = typeof was === 'number' ? was : c.def
      const move = (rnd() * 2 - 1) * (c.max - c.min) * JITTER
      out[c.k] = clamp(snap(base + move, c.step), c.min, c.max)
    }
  }
  return out
}

/* One fresh chain: an effect, and one time in three a second one on top. */
export function rollChain(firstId?: string): SoundLayer[] {
  const first = firstId || spreadOfSounds(1)[0]
  const chain: SoundLayer[] = [{ fxid: first, ep: rollSoundParams(first) }]
  if (rnd() < PAIR_CHANCE) {
    const second = pick(SOUNDS.filter((s) => s.id !== first)).id
    chain.push({ fxid: second, ep: rollSoundParams(second) })
  }
  return chain
}

/* One bred from a parent: the same effects, nudged — unless it strays. */
export function breedChain(parent: SoundLayer[]): SoundLayer[] {
  if (!parent.length || rnd() < STRAY_CHANCE) return rollChain()
  return parent.map((l) => ({ fxid: l.fxid, ep: breedSoundParams(l.fxid, l.ep) }))
}

/* A whole batch. With parents, bred from them; without, rolled fresh and
 * spread across the groups. */
export function batchOfChains(count: number, parents: SoundLayer[][] = []): SoundLayer[][] {
  if (!count) return []
  if (parents.length) return Array.from({ length: count }, (_, i) => breedChain(parents[i % parents.length]))
  return spreadOfSounds(count).map((id) => rollChain(id))
}

/* ---------------------------------------------------------------------------
 * The batch on the board.
 * ------------------------------------------------------------------------- */

interface Batch {
  source: string
  ids: (string | null)[]
  places: { x: number; y: number }[]
}

let batch: Batch | null = null

export function forgetSoundBatch() {
  batch = null
}

function working(sel: string[]): boolean {
  if (!batch || sel.length < 2) return false
  const mine = new Set(batch.ids.filter((id): id is string => !!id))
  return sel.every((id) => mine.has(id))
}

export interface VaryResult {
  made: number
  say: string
}

/* Renders a batch in order. One decode is shared by all of them, so what this
 * costs is the graph work rather than the file. */
/* Whether there is anything on the card to hear. The peaks are normalised to
 * the loudest thing in the sound, so a quiet render still draws a full
 * waveform and only true silence reads as silence — which is exactly the case
 * worth catching. */
const audible = (id: string): boolean =>
  (store.getItem(id)?.peaks || []).filter((v) => v > 2).length > 4

async function renderAll(ids: string[]): Promise<void> {
  for (const id of ids) {
    /* Not recorded: `variantsOf` already opened the step this belongs to, and a
       round that took thirteen presses of undo to take back would be a grid
       nobody would risk making. */
    await treatSound(id, undefined, false)
    /* A square of the grid spent on nothing is worse than one spent on a bad
     * idea. There are several ways to roll silence — a low pass under the
     * whole of the sound, a drive with its level at nought, a gate that never
     * opens — and enumerating them would be a list that goes stale the day
     * another effect is added. So the render is measured instead, and a dud is
     * thrown again. Once: a source that is itself silent must not spin. */
    if (!audible(id)) await treatSound(id, rollChain(), false)
  }
}

/* What a variant card starts as: the chain, and no memory of the render it was
 * copied from. Without the second half every card in the grid plays the sound
 * the source was playing until its own render lands, which is twelve cards
 * lying about themselves for a second and a half. */
const asVariant = (chain: SoundLayer[]): Partial<Item> => ({ chain, heard: undefined })

export async function varySound(): Promise<VaryResult> {
  const sel = store.getSelection()

  /* ---- another round on the batch already on the board ---- */
  if (working(sel) && batch) {
    const live = batch.ids.map((id) => (id && store.getItem(id) ? id : null))
    const keepers = live.filter((id) => id && store.getItem(id)?.pick === 'in') as string[]
    const drop = live.filter((id): id is string => !!id && !keepers.includes(id))
    if (!drop.length) {
      return { made: 0, say: 'Every one of them is marked kept. Unmark some to make room.' }
    }
    const parents = keepers.map((id) => chainOf(store.getItem(id)))
    const chains = batchOfChains(drop.length, parents)
    const free: number[] = []
    live.forEach((id, i) => { if (!id || !keepers.includes(id)) free.push(i) })
    const place = chains.map((chain, n) => ({ patch: asVariant(chain), ...batch!.places[free[n]] }))
    const made = store.variantsOf(batch.source, drop, place)
    if (!made.length) return { made: 0, say: 'Nothing to vary.' }
    const next = live.slice()
    made.forEach((id, n) => { next[free[n]] = id })
    batch = { ...batch, ids: next }
    store.select(next.filter((id): id is string => !!id))
    await renderAll(made)
    return {
      made: made.length,
      say: keepers.length
        ? `${made.length} more, bred from the ${keepers.length} you kept.`
        : `${made.length} more.`,
    }
  }

  /* ---- a fresh batch under one card ---- */
  if (sel.length !== 1) {
    return { made: 0, say: sel.length ? 'Pick one sound to make versions of.' : 'Pick a sound first.' }
  }
  const it = store.getItem(sel[0])
  if (!isSound(it)) return { made: 0, say: 'Only a sound has versions of this kind.' }

  /* The one refusal. Twelve renders of a long track is more storage than
   * anybody pressing a key meant to spend, and the answer is in the panel. */
  if ((it.secs || 0) > VARY_MAX_SECS) {
    return {
      made: 0,
      say: `That is ${Math.round(it.secs || 0)} seconds long. Trim it under ${VARY_MAX_SECS} first — twelve copies of a long one would fill the browser.`,
    }
  }

  const previous = batch && batch.ids.includes(it.id)
    ? batch.ids.filter((id): id is string => !!id && id !== it.id && !!store.getItem(id))
    : []

  const places = gridUnder(it)
  const chains = batchOfChains(VARIANTS)
  const made = store.variantsOf(it.id, previous, chains.map((chain, n) => ({ patch: asVariant(chain), ...places[n] })))
  if (!made.length) return { made: 0, say: 'Nothing to vary.' }
  batch = { source: it.id, ids: made, places }
  store.select(made)
  await renderAll(made)
  return {
    made: made.length,
    say: `${made.length} versions. Mark the ones worth keeping with ${KEYS.keep.hint}, then press ${KEYS.vary.hint} again.`,
  }
}

/* The same dice, thrown in place: a new treatment on the sounds that are
 * selected, without a grid. */
export async function shuffleSound(): Promise<VaryResult> {
  const sel = store.getSelection().filter((id) => isSound(store.getItem(id)))
  if (!sel.length) return { made: 0, say: 'Pick a sound to shuffle.' }
  const ids = spreadOfSounds(sel.length)
  store.beginGesture(0)
  for (let i = 0; i < sel.length; i++) await treatSound(sel[i], rollChain(ids[i]), false)
  return {
    made: sel.length,
    say: sel.length === 1 ? 'Shuffled. Press again for another.' : `Shuffled ${sel.length}.`,
  }
}

/* Whether the selection is sounds, which is how the one key knows which dice
 * to throw. A mixed selection is a picture question: the grid works on one
 * card at a time and the sound half would only refuse. */
export const soundsSelected = (sel: string[]): boolean =>
  sel.length > 0 && sel.every((id) => isSound(store.getItem(id)))
