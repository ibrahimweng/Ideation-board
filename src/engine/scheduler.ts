/* ---------------------------------------------------------------------------
 * Job scheduling.
 *
 * The previous version re-scanned every item on the board on every animation
 * frame, rebuilding a JSON signature string per item to decide whether to
 * repaint. That is O(items) of allocation per frame whether or not anything
 * changed, and it dispatched work with no ordering and no ceiling.
 *
 * Here, work is pushed, not polled. A card enqueues only when something about
 * it actually changed, jobs are ordered by distance from the centre of the
 * viewport, and at most a few are in flight at once so a slider drag can
 * supersede stale work instead of queueing behind it.
 * ------------------------------------------------------------------------- */

import { Tier } from './types'
import type { Params } from './types'

export interface Job {
  id: string
  key: string
  effectId: string
  stack?: { effectId: string; params: Params | null }[]
  params: Params | null
  width: number
  height: number
  seed: number
  tier: Tier
  /* Lower runs sooner. Set from distance to viewport centre. */
  priority: number
  jobId: number
}

export class JobQueue {
  /* One pending job per card: a newer request for the same card replaces the
   * older one rather than piling up behind it. */
  private pending = new Map<string, Job>()
  private seq = 0

  push(job: Omit<Job, 'jobId'>): number {
    const jobId = ++this.seq
    this.pending.set(job.id, { ...job, jobId })
    return jobId
  }

  drop(id: string) {
    this.pending.delete(id)
  }

  clear() {
    this.pending.clear()
  }

  get size() {
    return this.pending.size
  }

  /* Cheapest correct choice at this size: a linear scan for the best job.
   * Boards hold tens of visible cards, not thousands, so a heap would cost
   * more in bookkeeping than it saves. */
  take(allowFull: boolean): Job | null {
    let best: Job | null = null
    for (const j of this.pending.values()) {
      if (!allowFull && j.tier === Tier.Full) continue
      if (!best) { best = j; continue }
      /* Proxy work always outranks full-resolution work: getting something
       * correct on every visible card beats perfecting one of them. */
      if (j.tier !== best.tier) { if (j.tier < best.tier) best = j; continue }
      if (j.priority < best.priority) best = j
    }
    if (best) this.pending.delete(best.id)
    return best
  }

  has(id: string) {
    return this.pending.has(id)
  }
}

/* Tracks whether the user is actively interacting. While hot, only proxy-tier
 * work is dispatched, which is what keeps pan and zoom at full frame rate. */
export class Heat {
  private at = 0
  private ms: number
  constructor(ms = 180) {
    this.ms = ms
  }
  touch() {
    this.at = performance.now()
  }
  get hot() {
    return performance.now() - this.at < this.ms
  }
}
