import { BY_ID, EFFECTS, PRESETS, defaults } from '../engine/effects'
import { store } from './store'
import { hasPixels } from './kinds'
import { KEYS } from '../ui/shortcuts'
import type { Item } from './types'
import { ADJUST_0, isColor, isEnum } from '../engine/types'
import type { FxState, Layer, Params } from '../engine/types'

/* ---------------------------------------------------------------------------
 * Twelve of these.
 *
 * The effects panel is a thing you operate. You pick an effect, you push six
 * sliders, you look, you push them again. That is fine when you already know
 * what you are after and useless when you do not — which, on a board whose
 * whole job is working out what you are after, is most of the time.
 *
 * So: one key, and twelve versions of the picture appear under it. Mark the
 * ones worth keeping, press it again, and the ones you did not mark are
 * replaced by twelve bred from the ones you did.
 *
 * The idea is old and good. Marks and colleagues described it in 1997 as a
 * design gallery: rather than hunt for parameters by hand, generate the
 * broadest set of *perceptually different* outputs the parameters can produce,
 * lay them out, and let the person steer by pointing. Midjourney's grid and
 * its variation buttons are the same shape, twenty-five years later.
 *
 * ## What a roll changes, and what it leaves alone
 *
 * It replaces the treatment: the effect, its settings, and the tone. It leaves
 * the framing — zoom, offset, rotation, flip — and the layering — opacity and
 * blend mode — exactly as they were.
 *
 * That split is not new here. It is the same line a saved look draws, and for
 * the same reason: a crop belongs to the particular photograph it was set on,
 * and how a card sits with the cards under it belongs to where it is on the
 * board. Neither is what "another version of this" means.
 *
 * Nothing is lost to a roll in any case. The card it came from is untouched
 * and sitting directly above, and the whole batch is one press of undo.
 *
 * ## Breadth first
 *
 * Twelve effects picked at random from thirty-one would quite often be five
 * blurs. So the picks go round the groups in turn — one from Print, one from
 * Grid, one from Type, one from Distort — which is the cheapest possible
 * stand-in for the "perceptually different" the 1997 paper had to compute.
 * ------------------------------------------------------------------------- */

/* Four across, three down: enough to see a direction, few enough to look at
 * all of them without scrolling. */
export const VARIANTS = 12
export const COLS = 4

/* Roughly one variant in four stacks a second effect on top of the first.
 * Those are the ones nobody would have thought to try, and they are the reason
 * to look at the grid rather than at a list of effect names. */
const STACK_CHANCE = 0.25
/* And one in three gets grain it did not ask for, which is this board's own
 * accent more than it is an effect. */
const GRAIN_CHANCE = 0.34

/* How far a bred variant moves from its parent, as a share of each control's
 * range. Small enough that the family resemblance survives, big enough that
 * the children are not twelve copies. */
const JITTER = 0.18
/* Breeding that only ever narrows finds a local best and stops. Now and then a
 * child takes a completely different effect, which is the cheapest way to keep
 * looking while still mostly refining. */
const STRAY_CHANCE = 0.2

const rnd = () => Math.random()
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const snap = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n)

/* ---------------------------------------------------------------------------
 * Colour.
 *
 * A control's colour has a job — an ink, a paper, a tint — and rolling pure
 * random RGB into it loses the job and produces mud. What it does not lose is
 * the default the effect was written with, so the roll reads that: a slot
 * whose default is nearly white keeps getting papers, one whose default is
 * nearly black keeps getting inks, and everything else gets a colour with some
 * strength in it. The hue is free; only the register is kept.
 * ------------------------------------------------------------------------- */

function lumaOf(hex: string): number {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const v = parseInt(n.slice(0, 6) || '000000', 16)
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const at = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${at(0)}${at(8)}${at(4)}`
}

/* `near` is the hue to stay close to when a child is being bred; without it
 * the hue is free. */
export function rollColour(def: string, near?: string): string {
  const light = lumaOf(def)
  const hue = near === undefined ? rnd() * 360 : (hueOf(near) + (rnd() * 60 - 30) + 360) % 360
  if (light > 0.72) return hsl(hue, 4 + rnd() * 16, 88 + rnd() * 8)
  if (light < 0.28) return hsl(hue, 8 + rnd() * 34, 7 + rnd() * 15)
  return hsl(hue, 45 + rnd() * 40, 40 + rnd() * 22)
}

function hueOf(hex: string): number {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const v = parseInt(n.slice(0, 6) || '000000', 16)
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const deg = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (deg * 60 + 360) % 360
}

/* ---------------------------------------------------------------------------
 * One effect's settings, rolled or bred.
 * ------------------------------------------------------------------------- */

/* Every control given a value across its whole range. The full range rather
 * than a cautious middle: the point of a gallery is the ones you would not
 * have typed in yourself, and the ends are where those live. */
export function rollParams(fxid: string): Params {
  const spec = BY_ID[fxid]
  if (!spec) return {}
  const out: Params = {}
  for (const c of spec.controls) {
    if (isColor(c)) out[c.k] = rollColour(c.def)
    else if (isEnum(c)) out[c.k] = Math.floor(rnd() * c.options.length)
    else out[c.k] = clamp(snap(c.min + rnd() * (c.max - c.min), c.step), c.min, c.max)
  }
  return out
}

/* The same settings, nudged. A control the parent set to one end stays near
 * that end, so what the child inherits is the decision rather than the number. */
export function breedParams(fxid: string, from: Params | null): Params {
  const spec = BY_ID[fxid]
  if (!spec) return {}
  if (!from) return rollParams(fxid)
  const out: Params = {}
  for (const c of spec.controls) {
    const was = from[c.k]
    if (isColor(c)) {
      out[c.k] = typeof was === 'string' ? rollColour(c.def, was) : rollColour(c.def)
    } else if (isEnum(c)) {
      /* An enum has no near: it is a different mark, not a smaller one. Kept
       * most of the time so the family holds together. */
      out[c.k] = rnd() < 0.25 ? Math.floor(rnd() * c.options.length) : typeof was === 'number' ? was : c.def
    } else {
      const base = typeof was === 'number' ? was : c.def
      out[c.k] = clamp(snap(base + (rnd() * 2 - 1) * (c.max - c.min) * JITTER, c.step), c.min, c.max)
    }
  }
  return out
}

/* ---------------------------------------------------------------------------
 * Which effects a batch gets.
 * ------------------------------------------------------------------------- */

/* Everything except Original, which is what the card already is. */
const CHOOSABLE = EFFECTS.filter((e) => e.id !== 'none')

function shuffled<T>(list: readonly T[]): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* `n` effects, spread across the groups rather than drawn from the hat. With
 * five of the ten groups being kinds of blur and kinds of print, a straight
 * draw comes up with a very samey twelve about as often as not. */
export function spreadOfEffects(n: number): string[] {
  if (!n || !CHOOSABLE.length) return []
  const byGroup = new Map<string, string[]>()
  for (const e of CHOOSABLE) {
    const g = byGroup.get(e.group)
    if (g) g.push(e.id)
    else byGroup.set(e.group, [e.id])
  }
  const fresh = () => shuffled([...byGroup.values()].map((ids) => shuffled(ids)))
  let queues = fresh()
  const out: string[] = []
  /* Round the groups in turn, taking one from each, until there are enough.
   * Asked for more than there are, the whole set starts again rather than the
   * batch coming up short. */
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

/* ---------------------------------------------------------------------------
 * A whole treatment.
 * ------------------------------------------------------------------------- */

/* The tone fields back to nothing, so a rolled preset lands on a clean card
 * rather than on top of whatever the last one happened to leave. */
const FLAT = { exp: ADJUST_0.exp, con: ADJUST_0.con, sat: ADJUST_0.sat, warm: ADJUST_0.warm, blur: ADJUST_0.blur, grain: ADJUST_0.grain }

function maybeStack(firstId: string): Layer[] | undefined {
  if (rnd() > STACK_CHANCE) return undefined
  const second = pick(CHOOSABLE.filter((e) => e.id !== firstId))
  return [{ fxid: second.id, ep: rollParams(second.id) }]
}

/* Everything a roll writes, over the card it came from. */
function treat(source: FxState, fxid: string, ep: Params, more: Layer[] | undefined): FxState {
  const tone = { ...FLAT, ...pick(PRESETS).vals }
  return {
    ...source,
    ...tone,
    grain: rnd() < GRAIN_CHANCE ? Math.round(15 + rnd() * 40) : tone.grain,
    fxid,
    ep,
    more,
    /* Not the name of the preset it came from: the moment an effect and a
       stack are on top of it, "Noir" is a lie the panel would keep telling. */
    preset: 'custom',
  }
}

/* One fresh version of a card. */
export function rollLook(source: FxState, fxid: string): FxState {
  return treat(source, fxid, rollParams(fxid), maybeStack(fxid))
}

/* One version bred from a parent: the same effect, nudged — unless it strays. */
export function breedLook(parent: FxState): FxState {
  if (rnd() < STRAY_CHANCE || parent.fxid === 'none') {
    return rollLook(parent, pick(CHOOSABLE).id)
  }
  const ep = breedParams(parent.fxid, parent.ep ?? (defaults(parent.fxid) as Params))
  /* A parent's stack is kept as it is. Breeding two layers at once moves too
   * far in one step, and the second layer is what made the parent worth
   * keeping about a quarter of the time. */
  const more = parent.more?.length ? parent.more.map((l) => ({ ...l, ep: l.ep ? { ...l.ep } : null })) : undefined
  return {
    ...parent,
    ep,
    more,
    /* The tone travels with the parent, jittered only in the one place a
       photograph really notices. */
    con: clamp(parent.con + (rnd() * 2 - 1) * 18, -100, 100),
    sat: clamp(parent.sat + (rnd() * 2 - 1) * 22, 0, 200),
    preset: 'custom',
  }
}

/* A whole batch. `parents` are the looks worth breeding from; with none, the
 * batch is rolled fresh off the card it came from. */
export function batchOfLooks(source: FxState, count: number, parents: FxState[] = []): FxState[] {
  if (!count) return []
  if (parents.length) return Array.from({ length: count }, (_, i) => breedLook(parents[i % parents.length]))
  const ids = spreadOfEffects(count)
  return ids.map((id) => rollLook(source, id))
}

/* ---------------------------------------------------------------------------
 * The batch on the board.
 *
 * Twelve real cards rather than twelve previews in a sheet. They are cards, so
 * everything already works on them: keep and cut, the effects panel, compare,
 * the show, export, undo. A preview grid would have been a second place for a
 * picture to live, and this board only has one.
 *
 * Twelve copies cost twelve item records and no storage at all — a card names
 * a picture in a store shared by the whole browser, and the copies name the
 * same one. What differs between them is a hundred bytes of settings.
 *
 * ## The grid
 *
 * Twelve places under the card it came from, held in this module for as long
 * as the batch lasts. A kept variant holds its place and the ones around it
 * are replaced, so the grid stays a grid however many rounds it goes.
 *
 * Held here rather than on the board because it is where you are, not
 * something about the board: a reload should find twelve ordinary cards, not a
 * half-finished conversation.
 * ------------------------------------------------------------------------- */

/* The same gap the tidy command uses, so a batch looks like something the
 * board laid out rather than something dropped on it. */
const GAP = 24

interface Batch {
  source: string
  /* One per place in the grid; null where a card has been removed. */
  ids: (string | null)[]
  places: { x: number; y: number }[]
}

let batch: Batch | null = null

/* For the tests, and for anything that needs to start over. */
export function forgetBatch() {
  batch = null
}

function gridUnder(it: Item): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < VARIANTS; i++) {
    out.push({
      x: it.x + (i % COLS) * (it.w + GAP),
      y: it.y + it.h + GAP + Math.floor(i / COLS) * (it.h + GAP),
    })
  }
  return out
}

/* Whether the selection is this batch being worked on rather than a card being
 * pointed at. One card selected always means "twelve of that one", even when
 * the one is itself a variant — which is how you go deeper into a direction. */
function working(sel: string[]): boolean {
  if (!batch || sel.length < 2) return false
  const mine = new Set(batch.ids.filter((id): id is string => !!id))
  return sel.every((id) => mine.has(id))
}

export interface VaryResult {
  made: number
  say: string
}

/* One press of the key. */
export function vary(): VaryResult {
  const sel = store.getSelection()

  /* ---- a round on the batch already on the board ---- */
  if (working(sel) && batch) {
    const live = batch.ids.map((id) => (id && store.getItem(id) ? id : null))
    const keepers = live.filter((id) => id && store.getItem(id)?.pick === 'in') as string[]
    const drop = live.filter((id): id is string => !!id && !keepers.includes(id))
    if (!drop.length) {
      return { made: 0, say: 'Every one of them is marked kept. Unmark some to make room.' }
    }
    const parents = keepers.map((id) => store.getItem(id)!.fx)
    const source = store.getItem(batch.source)
    const from = source ? source.fx : parents[0]
    const looks = batchOfLooks(from, drop.length, parents)
    /* The places the dropped ones leave behind, in grid order, so what arrives
     * fills the holes rather than starting a new row. */
    const free: number[] = []
    live.forEach((id, i) => { if (!id || !keepers.includes(id)) free.push(i) })
    const place = looks.map((fx, n) => ({ fx, ...batch!.places[free[n]] }))
    const made = store.variantsOf(batch.source, drop, place)
    if (!made.length) return { made: 0, say: 'Nothing to vary.' }
    const next = live.slice()
    made.forEach((id, n) => { next[free[n]] = id })
    batch = { ...batch, ids: next }
    store.select(next.filter((id): id is string => !!id))
    return {
      made: made.length,
      say: keepers.length
        ? `${made.length} more, bred from the ${keepers.length} you kept.`
        : `${made.length} more.`,
    }
  }

  /* ---- a fresh batch under one card ---- */
  if (sel.length !== 1) {
    return { made: 0, say: sel.length ? 'Pick one picture to make versions of.' : 'Pick a picture first.' }
  }
  const it = store.getItem(sel[0])
  if (!hasPixels(it)) return { made: 0, say: 'Only a picture has versions.' }

  /* Choosing one out of a batch and pressing again means that one won: the
   * rest were the alternatives it was chosen over, and they go. */
  const previous = batch && batch.ids.includes(it.id)
    ? batch.ids.filter((id): id is string => !!id && id !== it.id && !!store.getItem(id))
    : []

  const places = gridUnder(it)
  const looks = batchOfLooks(it.fx, VARIANTS)
  const made = store.variantsOf(it.id, previous, looks.map((fx, n) => ({ fx, ...places[n] })))
  if (!made.length) return { made: 0, say: 'Nothing to vary.' }
  batch = { source: it.id, ids: made, places }
  store.select(made)
  return {
    made: made.length,
    say: `${made.length} versions. Mark the ones worth keeping with ${KEYS.keep.hint}, then press ${KEYS.vary.hint} again.`,
  }
}

/* ---------------------------------------------------------------------------
 * And the same dice, thrown in place.
 *
 * The grid is for deciding between twelve. This is for when you do not want to
 * decide anything — you want the picture to be something else, now, and to
 * keep pressing until it is interesting. Mosh has one button that does this
 * and it is the cheapest ideation mechanic anybody has ever built.
 *
 * It is also the fastest way anyone finds out what the other thirty effects
 * do, which is worth more than the effect list ever was.
 * ------------------------------------------------------------------------- */

export function shuffle(): VaryResult {
  const sel = store.getSelection().filter((id) => hasPixels(store.getItem(id)))
  if (!sel.length) return { made: 0, say: 'Pick a picture to shuffle.' }
  /* A different effect each, rather than the same one on all of them: several
   * cards shuffled together is a row of alternatives, not a set. */
  const ids = spreadOfEffects(sel.length)
  store.beginGesture(0)
  sel.forEach((id, i) => {
    const cur = store.getItem(id)
    if (cur) store.update(id, { fx: rollLook(cur.fx, ids[i]) }, false)
  })
  return {
    made: sel.length,
    say: sel.length === 1 ? 'Shuffled. Press again for another.' : `Shuffled ${sel.length}.`,
  }
}
