/* ---------------------------------------------------------------------------
 * How much room there is, and what happens when there is none.
 *
 * Everything you make lives in this browser and nowhere else, and until now
 * every write to it swallowed its own errors. A board that would not save
 * looked exactly like a board that had saved: the pictures were still on
 * screen, because they were still in memory. You found out on the next reload,
 * when they were gone.
 *
 * So three things. Ask the browser to treat this data as worth keeping, rather
 * than as a cache it may throw away when the disk gets tight. Watch how full
 * it is, and say so before it matters. And when a write does fail, say so
 * loudly and immediately, because at that moment the only copy of the work is
 * in a tab that is one reload away from losing it.
 * ------------------------------------------------------------------------- */

export type Trouble =
  /* The browser refused a write because there is no room. */
  | 'full'
  /* It refused for some other reason — private browsing with storage off,
     a corrupt database, a policy. Different cause, same consequence. */
  | 'blocked'
  | null

export interface Space {
  /* Bytes used and allowed, as the browser reports them. Both are rounded and
     deliberately imprecise; treat them as a gauge, not a ledger. */
  usage: number
  quota: number
  /* 0 to 1, or 0 when the browser will not say. */
  ratio: number
  /* True when the browser has promised not to evict this data on its own. */
  persisted: boolean
  /* Whether any of the above is real, or just the zeroes it starts at. */
  known: boolean
  trouble: Trouble
  /* What could not be written, for the message. */
  troubleAt: number
}

const state: Space = { usage: 0, quota: 0, ratio: 0, persisted: false, known: false, trouble: null, troubleAt: 0 }
const listeners = new Set<(s: Space) => void>()

/* Past this, saying nothing is no longer a kindness. */
export const TIGHT = 0.8
/* Room kept back so the board's own record can always be written, even when
 * the pictures cannot. A board with no pictures is recoverable; a board that
 * has forgotten what was on it is not. */
const RESERVE = 8 * 1024 * 1024

const tell = () => {
  for (const fn of listeners) fn({ ...state })
}

export function subscribeSpace(fn: (s: Space) => void) {
  listeners.add(fn)
  fn({ ...state })
  return () => void listeners.delete(fn)
}

export const spaceNow = (): Space => ({ ...state })

/* Without this the browser is free to throw the whole database away when the
 * disk gets tight, without asking and without telling anyone. Chrome grants it
 * on its own judgement of whether the site is worth keeping; Firefox asks;
 * Safari grants it after a while of use. Refused is not an error — it only
 * means the data is a cache, which is worth knowing and worth saying. */
export async function askToPersist(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    state.persisted = (await navigator.storage.persisted?.()) || (await navigator.storage.persist())
    tell()
    return state.persisted
  } catch {
    return false
  }
}

export async function measure(): Promise<Space> {
  /* No way to ask at all — an old browser, or one with storage turned off.
   * The gauge goes blank rather than keeping a number that is no longer being
   * checked, because a stale figure would go on refusing drops that would in
   * fact fit. */
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    state.known = false
    state.usage = 0
    state.quota = 0
    state.ratio = 0
    tell()
    return { ...state }
  }
  try {
    const e = await navigator.storage.estimate()
    if (e && typeof e.usage === 'number' && typeof e.quota === 'number' && e.quota > 0) {
      state.usage = e.usage
      state.quota = e.quota
      state.ratio = e.usage / e.quota
      state.known = true
    }
    if (navigator.storage.persisted) state.persisted = await navigator.storage.persisted()
  } catch {
    /* It can answer, it just would not this time. The last reading stands. */
  }
  tell()
  return { ...state }
}

/* Will this much fit, with the reserve left over? Unknown quota answers yes:
 * refusing a drop because the browser is being cagey would be worse than
 * letting it fail and saying so. */
export function roomFor(bytes: number): boolean {
  if (!state.known) return true
  return state.quota - state.usage - bytes > RESERVE
}

/* Called by the storage layer rather than by anything that can see the screen,
 * so every path into the database reports the same way. */
export function reportWriteFailure(err: unknown) {
  const name = (err as { name?: string })?.name || ''
  const full = name === 'QuotaExceededError' || /quota/i.test(String(err))
  state.trouble = full ? 'full' : 'blocked'
  state.troubleAt = Date.now()
  tell()
  void measure()
}

/* One write getting through does not prove the trouble is over — it may have
 * been a small one — but it does prove the database is reachable, which is
 * what "blocked" claimed it was not. */
export function reportWriteOk(bytes = 0) {
  if (state.trouble === 'blocked' || (state.trouble === 'full' && bytes > RESERVE / 8)) {
    state.trouble = null
    tell()
  }
}

export function describeSpace(s: Space): string {
  const mb = (n: number) => `${(n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1)}MB`
  if (!s.known) return 'This browser will not say how much room is left'
  const kept = s.persisted ? 'kept' : 'treated as a cache the browser may clear'
  return `${mb(s.usage)} of ${mb(s.quota)} used, and ${kept}`
}
