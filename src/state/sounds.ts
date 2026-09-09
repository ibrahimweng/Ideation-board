import { store } from './store'
import { getBlob, putBlob } from '../store/idb'
import { newKey } from '../store/media'
import { MAX_CHAIN, renderSound, soundDefaults, toWav } from '../store/sound'
import { peaksFrom } from '../store/audio'
import type { SoundLayer } from '../store/sound'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * Working on a sound.
 *
 * The same transaction turning a model is: render, save, point the card at it.
 * The original file is never touched — `media` is what was dropped and stays
 * what was dropped — so taking the chain off is not an undo, it is the card
 * pointing back at the thing it always had.
 *
 * The peaks are rewritten too, which is the part that makes this feel like the
 * rest of the board rather than like a plugin. A gate that chops a track to
 * pieces should look like a track in pieces on the card, from across the room,
 * without pressing play.
 * ------------------------------------------------------------------------- */

export const isSound = (i?: Item | null): i is Item => !!i && i.kind === 'audio' && !!i.media

export const chainOf = (i?: Item | null): SoundLayer[] =>
  (i?.chain || []).slice(0, MAX_CHAIN).map((l) => ({ fxid: l.fxid, ep: l.ep ?? null }))

/* Whether anything is on it. A chain of one effect set to nothing is the same
 * as no chain, and both have to read as "the original". */
export const isTreated = (i?: Item | null): boolean =>
  chainOf(i).some((l) => l.fxid && l.fxid !== 'none')

const busy = new Set<string>()
export const treating = (id: string) => busy.has(id)

/* One context, made on demand and kept. Browsers limit how many you may have,
 * and a board of sounds would reach that limit by the third card. */
let shared: AudioContext | null = null
const decoder = (): AudioContext => {
  if (!shared) shared = new AudioContext()
  return shared
}

/* Decoding is the slow part and the file does not change, so a card decoded
 * once stays decoded for as long as anyone is working on it. */
const decoded = new Map<string, AudioBuffer>()

export function forgetSound(key: string) {
  decoded.delete(key)
}

async function sourceOf(key: string): Promise<AudioBuffer | null> {
  const hit = decoded.get(key)
  if (hit) return hit
  const blob = await getBlob(key)
  if (!blob) return null
  try {
    const buf = await decoder().decodeAudioData(await blob.arrayBuffer())
    decoded.set(key, buf)
    return buf
  } catch {
    return null
  }
}

/* Renders a card's chain and points the card at what came out. Returns the
 * reason it could not, or null if it did.
 *
 * `record` is for the callers that have already opened a step of undo before
 * asking. Twelve variations are one press of undo, not thirteen: the exchange
 * that put them on the board is the step, and the renders that follow are it
 * finishing rather than twelve more things that happened. */
export async function treatSound(id: string, chain?: SoundLayer[], record = true): Promise<string | null> {
  const it = store.getItem(id)
  if (!isSound(it)) return 'that card is not a sound'
  if (busy.has(id)) return null
  busy.add(id)
  try {
    /* Kept apart on purpose. `given` is what the panel is showing, empty slots
     * and all; `want` is the subset there is anything to render. Writing the
     * filtered list back to the card was quietly deleting the empty slot the
     * moment it was added, so pressing Add appeared to do nothing at all. */
    const given = (chain ?? chainOf(it)).slice(0, MAX_CHAIN)
    const want = given.filter((l) => l.fxid && l.fxid !== 'none')
    const src = await sourceOf(it.media!)
    if (!src) return 'this browser could not decode that sound'

    /* Nothing to render is not a render. The card goes back to the file it
     * came with, and the treated copy is left for the sweep. */
    if (!want.length) {
      const still = store.getItem(id)
      if (!isSound(still)) return null
      store.update(id, {
        heard: undefined,
        chain: given.length ? given : undefined,
        peaks: peaksFrom(src),
        secs: src.duration,
      }, record)
      return null
    }

    const out = await renderSound(src, want)
    const key = newKey('snd')
    await putBlob(key, toWav(out))

    const still = store.getItem(id)
    if (!isSound(still)) return null
    /* Written once and then left alone. This is the shape of the file the card
     * was given, which is what the compare key draws — and computing it again
     * on every render would be reading the whole track to arrive at the answer
     * already on the card. A sound treated before this existed picks it up on
     * its next render; one that was never treated has it in `peaks` already. */
    const dry = still.dry ?? peaksFrom(src)
    store.update(id, { heard: key, chain: given, peaks: peaksFrom(out), secs: out.duration, dry }, record)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'that could not be rendered'
  } finally {
    busy.delete(id)
  }
}

/* Edits the chain on every selected sound and renders each. Each card keeps
 * its own chain rather than being handed this one's, for the same reason the
 * picture panel edits each card's own layers: two cards selected together may
 * be treated differently, and writing one onto the other would flatten it. */
export async function editChain(ids: string[], fn: (chain: SoundLayer[]) => SoundLayer[]): Promise<void> {
  store.beginGesture(0)
  const jobs: Promise<string | null>[] = []
  for (const id of ids) {
    const it = store.getItem(id)
    if (!isSound(it)) continue
    jobs.push(treatSound(id, fn(chainOf(it)).slice(0, MAX_CHAIN)))
  }
  await Promise.all(jobs)
}

export const setSoundEffect = (ids: string[], at: number, fxid: string) =>
  editChain(ids, (chain) => {
    const next = chain.slice()
    const layer: SoundLayer = { fxid, ep: fxid === 'none' ? null : soundDefaults(fxid) }
    if (at >= next.length) next.push(layer)
    else next[at] = layer
    /* Setting a later one to nothing is asking for it to go; setting the only
     * one to nothing is taking the treatment off. */
    return at > 0 && fxid === 'none' ? next.filter((_, i) => i !== at) : next
  })

export const setSoundParam = (ids: string[], at: number, k: string, v: number | string) =>
  editChain(ids, (chain) =>
    chain.map((l, i) => (i === at ? { ...l, ep: { ...(l.ep || soundDefaults(l.fxid)), [k]: v } } : l))
  )

export const addSoundLayer = (ids: string[]) =>
  editChain(ids, (chain) => (chain.length >= MAX_CHAIN ? chain : [...chain, { fxid: 'none', ep: null }]))

export const dropSoundLayer = (ids: string[], at: number) =>
  editChain(ids, (chain) => (chain.length <= 1 ? [] : chain.filter((_, i) => i !== at)))

export const clearSound = (ids: string[]) => editChain(ids, () => [])
