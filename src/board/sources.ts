import { useEffect, useState } from 'react'
import { getEngine } from '../engine/client'
import { getBlob } from '../store/idb'
import { decodeCapped } from '../store/media'

/* ---------------------------------------------------------------------------
 * Keeps track of which media sources are resident on the GPU.
 *
 * A source is decoded and uploaded exactly once, no matter how many cards use
 * it or how often its effect changes. Decode happens through createImageBitmap
 * off the main thread, and the resulting bitmap is transferred to the worker
 * rather than copied.
 * ------------------------------------------------------------------------- */

const ready = new Set<string>()
const inflight = new Map<string, Promise<boolean>>()
const waiters = new Map<string, Set<() => void>>()

function notify(key: string) {
  const s = waiters.get(key)
  if (!s) return
  for (const fn of [...s]) fn()
}

export function isReady(key: string) {
  return ready.has(key)
}

/* Used by the ingest path, which uploads its own decode and would otherwise
 * cause the source to be decoded a second time on first mount. */
export function markReady(key: string) {
  ready.add(key)
  notify(key)
}

export function ensureSource(key: string, blob?: Blob): Promise<boolean> {
  if (ready.has(key)) return Promise.resolve(true)
  const cur = inflight.get(key)
  if (cur) return cur

  const p = (async () => {
    const b = blob || (await getBlob(key))
    if (!b) return false
    const bmp = await decodeCapped(b)
    if (!bmp) return false
    getEngine().putSource(key, bmp)
    ready.add(key)
    notify(key)
    return true
  })()
    .catch(() => false)
    .finally(() => inflight.delete(key))

  inflight.set(key, p)
  return p
}

export function dropSource(key: string) {
  ready.delete(key)
  getEngine().dropSource(key)
}

/* True once the source behind `key` is on the GPU. Cards use this to hold
 * their render request until there is something to render. */
export function useSourceReady(key: string | undefined): boolean {
  const [ok, setOk] = useState(() => (key ? ready.has(key) : false))

  useEffect(() => {
    if (!key) {
      setOk(false)
      return
    }
    if (ready.has(key)) {
      setOk(true)
      return
    }
    setOk(false)
    let live = true
    const fn = () => {
      if (live) setOk(true)
    }
    let s = waiters.get(key)
    if (!s) waiters.set(key, (s = new Set()))
    s.add(fn)
    void ensureSource(key)
    return () => {
      live = false
      s!.delete(fn)
      if (!s!.size) waiters.delete(key)
    }
  }, [key])

  return ok
}
