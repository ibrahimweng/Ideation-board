import { store } from './store'
import { VARIANTS, gridUnder } from './variations'
import { KEYS } from '../ui/shortcuts'
import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * The grid, once, for every medium that has one.
 *
 * Four kinds of card can now be varied twelve ways and the dice are different
 * for each: a picture varies by what is drawn on it, a sound by what it is run
 * through, a sketch by the throw its code was drawn on, a model by where the
 * camera stands. What is identical is everything around the dice — the twelve
 * places under the card, which of them a kept variant holds, filling the holes
 * the unkept ones leave, selecting the batch so the next press is another
 * round, and the whole exchange being one press of undo.
 *
 * That machinery was written once for pictures and once for sounds, and the
 * third and fourth copies are where it would start to disagree with itself.
 * So it is here, and a medium supplies only what makes its twelve different
 * from each other.
 *
 * ## Rendered kinds and live ones
 *
 * A picture variation is a hundred bytes of settings and the graphics card
 * does the rest. The other three have to be made: a sound rendered, a sketch
 * drawn, a model photographed. `render` is where that happens and it is called
 * after the cards are already on the board, so twelve appear at once and fill
 * in — rather than appearing one at a time over several seconds, which reads
 * as the board struggling rather than working.
 * ------------------------------------------------------------------------- */

export interface VaryResult {
  made: number
  say: string
}

/* What one medium has to say about itself. */
export interface Dice<Roll> {
  /* For the messages: "Pick one sound to make versions of." */
  noun: string
  /* Whether this card can be varied at all, and why not. */
  refuse?: (it: Item) => string | null
  /* `parents` are the rolls worth breeding from; with none, roll fresh. */
  batch: (source: Item, count: number, parents: Roll[]) => Roll[]
  /* What is kept on a variant card, which is also what a parent is read back
   * from when the next round breeds. */
  patch: (roll: Roll) => Partial<Item>
  read: (it: Item) => Roll
  /* Making the variant real, where it has to be made. Called once, in order,
   * with recording off — the exchange is already one step of undo. */
  render?: (ids: string[]) => Promise<void>
}

interface Batch {
  source: string
  ids: (string | null)[]
  places: { x: number; y: number }[]
}

/* One batch across all the media. Two grids open at once is not a thing that
 * happens — the second press is always about the twelve in front of you. */
let batch: Batch | null = null

export function forgetGrid() {
  batch = null
}

/* Whether the selection is this batch being worked on rather than a card being
 * pointed at. One card selected always means "twelve of that one", even when
 * the one is itself a variant, which is how you go deeper into a direction. */
function working(sel: string[]): boolean {
  if (!batch || sel.length < 2) return false
  const mine = new Set(batch.ids.filter((id): id is string => !!id))
  return sel.every((id) => mine.has(id))
}

export async function runGrid<Roll>(dice: Dice<Roll>, only: (it: Item | undefined) => boolean): Promise<VaryResult> {
  const sel = store.getSelection()

  /* ---- another round on the batch already on the board ---- */
  if (working(sel) && batch) {
    const live = batch.ids.map((id) => (id && store.getItem(id) ? id : null))
    const keepers = live.filter((id) => id && store.getItem(id)?.pick === 'in') as string[]
    const drop = live.filter((id): id is string => !!id && !keepers.includes(id))
    if (!drop.length) {
      return { made: 0, say: 'Every one of them is marked kept. Unmark some to make room.' }
    }
    const source = store.getItem(batch.source)
    if (!source) return { made: 0, say: 'Nothing to vary.' }
    const parents = keepers.map((id) => dice.read(store.getItem(id)!))
    const rolls = dice.batch(source, drop.length, parents)
    /* The places the dropped ones leave behind, in grid order, so what arrives
     * fills the holes rather than starting a new row. */
    const free: number[] = []
    live.forEach((id, i) => { if (!id || !keepers.includes(id)) free.push(i) })
    const place = rolls.map((roll, n) => ({ patch: dice.patch(roll), ...batch!.places[free[n]] }))
    const made = store.variantsOf(batch.source, drop, place)
    if (!made.length) return { made: 0, say: 'Nothing to vary.' }
    const next = live.slice()
    made.forEach((id, n) => { next[free[n]] = id })
    batch = { ...batch, ids: next }
    store.select(next.filter((id): id is string => !!id))
    await dice.render?.(made)
    return {
      made: made.length,
      say: keepers.length
        ? `${made.length} more, bred from the ${keepers.length} you kept.`
        : `${made.length} more.`,
    }
  }

  /* ---- a fresh batch under one card ---- */
  if (sel.length !== 1) {
    return { made: 0, say: sel.length ? `Pick one ${dice.noun} to make versions of.` : `Pick a ${dice.noun} first.` }
  }
  const it = store.getItem(sel[0])
  if (!it || !only(it)) return { made: 0, say: `Only a ${dice.noun} has versions of this kind.` }
  const no = dice.refuse?.(it)
  if (no) return { made: 0, say: no }

  /* Choosing one out of a batch and pressing again means that one won: the
   * rest were the alternatives it was chosen over, and they go. */
  const previous = batch && batch.ids.includes(it.id)
    ? batch.ids.filter((id): id is string => !!id && id !== it.id && !!store.getItem(id))
    : []

  const places = gridUnder(it)
  const rolls = dice.batch(it, VARIANTS, [])
  const made = store.variantsOf(it.id, previous, rolls.map((roll, n) => ({ patch: dice.patch(roll), ...places[n] })))
  if (!made.length) return { made: 0, say: 'Nothing to vary.' }
  batch = { source: it.id, ids: made, places }
  store.select(made)
  await dice.render?.(made)
  return {
    made: made.length,
    say: `${made.length} versions. Mark the ones worth keeping with ${KEYS.keep.hint}, then press ${KEYS.vary.hint} again.`,
  }
}
