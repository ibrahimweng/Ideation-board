import { store } from './store'
import { DIST, PITCH, isStaged, stageOf, turnTo } from './staging'
import type { Stage } from '../store/model'
import { runGrid } from './varyGrid'
import type { Dice, VaryResult } from './varyGrid'

/* ---------------------------------------------------------------------------
 * Twelve of a model.
 *
 * Pressing V on a model gave twelve treatments of one camera angle, because a
 * model card is a picture and the picture dice are what pictures get. The
 * thing you actually want twelve of is the model — seen from twelve places.
 *
 * ## Round it, not at random
 *
 * Twelve random angles is not twelve useful angles. Half of them look at the
 * underside, several land within a few degrees of each other, and the set as a
 * whole tells you less about the object than four would.
 *
 * So they go round it: the turn is divided into twelve and each variant takes
 * its own share, nudged rather than placed exactly. That is the same argument
 * as spreading effects across their groups — the point of twelve is coverage,
 * and coverage is not what randomness gives you.
 *
 * The tilt stays in the band a thing is photographed from: a little above the
 * equator, sometimes level, occasionally low. Not the top, which is a plan and
 * a different drawing, and not the bottom, which is nothing anybody wants. And
 * a few come in closer than the rest, because one of the twelve being a detail
 * is worth more than twelve of the same size.
 * ------------------------------------------------------------------------- */

const rnd = () => Math.random()
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/* How far a variant may stray from its share of the turn, as a share of that
 * slice. Enough that the set does not look mechanical, small enough that it
 * stays a circuit. */
const WOBBLE = 0.35

/* Where a thing gets photographed from: mostly a little above, sometimes
 * level, rarely low. */
const tilt = () => {
  const r = rnd()
  if (r < 0.62) return 8 + rnd() * 34
  if (r < 0.85) return -6 + rnd() * 16
  return -34 + rnd() * 22
}

/* One in four comes in close. A detail among the whole views is worth more
 * than a twelfth view of the whole. */
const near = (from: number) => (rnd() < 0.25 ? clamp(from * (0.45 + rnd() * 0.3), DIST.min, DIST.max)
  : clamp(from * (0.85 + rnd() * 0.4), DIST.min, DIST.max))

export function anglesAround(count: number, from: Stage): Stage[] {
  const slice = 360 / Math.max(1, count)
  return Array.from({ length: count }, (_, i) => ({
    yaw: from.yaw + i * slice + (rnd() * 2 - 1) * slice * WOBBLE,
    pitch: clamp(tilt(), -PITCH, PITCH),
    dist: near(from.dist),
  }))
}

/* Bred from an angle worth keeping: near it, rather than round the whole
 * object again. A few degrees either way and a little in or out is what
 * "more like that one" means for a camera. */
export function anglesNear(count: number, parents: Stage[]): Stage[] {
  return Array.from({ length: count }, (_, i) => {
    const p = parents[i % parents.length]
    return {
      yaw: p.yaw + (rnd() * 2 - 1) * 26,
      pitch: clamp(p.pitch + (rnd() * 2 - 1) * 14, -PITCH, PITCH),
      dist: clamp(p.dist * (0.85 + rnd() * 0.35), DIST.min, DIST.max),
    }
  })
}

/* Rendered in order. Each is a real three.js render and a picture written to
 * storage, and the parsed model is shared by all twelve — which is what makes
 * a batch a second or two rather than twelve loads. */
async function shootAll(ids: string[]): Promise<void> {
  for (const id of ids) {
    const it = store.getItem(id)
    if (isStaged(it)) await turnTo(id, stageOf(it))
  }
}

const dice: Dice<Stage> = {
  noun: 'model',
  batch: (source, count, parents) =>
    parents.length ? anglesNear(count, parents) : anglesAround(count, stageOf(source)),
  /* The view it was copied from has to go, or every card shows the angle the
   * source was showing until its own render lands. */
  patch: (stage) => ({ stage, poster: undefined }),
  read: (it) => stageOf(it),
  render: shootAll,
}

export const varyModel = (): Promise<VaryResult> => runGrid(dice, (it) => isStaged(it))

/* The same dice thrown in place: another angle on every model selected. */
export async function shuffleModel(): Promise<VaryResult> {
  const sel = store.getSelection().filter((id) => isStaged(store.getItem(id)))
  if (!sel.length) return { made: 0, say: 'Pick a model to shuffle.' }
  store.beginGesture(0)
  for (const id of sel) {
    const it = store.getItem(id)
    if (isStaged(it)) await turnTo(id, anglesAround(1, stageOf(it))[0])
  }
  return {
    made: sel.length,
    say: sel.length === 1 ? 'Turned somewhere else. Press again for another.' : `Turned ${sel.length}.`,
  }
}
