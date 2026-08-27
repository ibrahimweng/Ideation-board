import { useEffect, useState } from 'react'

/* ---------------------------------------------------------------------------
 * Keeping the app on the machine the work is already on.
 *
 * The boards were always local. The app was not: installed from the manifest
 * and opened without a network, it showed the browser's offline page while
 * every board sat in IndexedDB, two inches away and unreachable.
 *
 * Updating is the part worth being careful about. A service worker that takes
 * over the moment it installs swaps the scripts under whoever is using the
 * page, and this is an app people leave open for days with unsaved thinking on
 * the screen. So a new version installs, waits, and says so; nothing changes
 * until somebody presses Reload. The same bargain the app makes everywhere
 * else it could decide something on your behalf and does not.
 * ------------------------------------------------------------------------- */

let waiting: ServiceWorker | null = null
const watchers = new Set<() => void>()

function tell() {
  for (const fn of [...watchers]) fn()
}

function note(reg: ServiceWorkerRegistration) {
  /* Only ever a *replacement*. On a first visit the worker installs with no
   * controller to replace, and telling somebody their brand new page is out of
   * date would be nonsense. */
  if (reg.waiting && navigator.serviceWorker.controller) {
    waiting = reg.waiting
    tell()
  }
}

export function goOffline() {
  if (!('serviceWorker' in navigator)) return
  /* After load: registering earlier competes with the app's own first paint
   * for the same connection, and there is nothing to cache until the page has
   * fetched it anyway. */
  const start = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        note(reg)
        reg.addEventListener('updatefound', () => {
          const fresh = reg.installing
          if (!fresh) return
          fresh.addEventListener('statechange', () => {
            if (fresh.state === 'installed') note(reg)
          })
        })
      })
      .catch(() => {
        /* No sw.js, or a browser that will not have one, or a page served
         * without a secure origin. The app is exactly what it was before. */
      })
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/* Take the new one, and come back on the version it brought. */
export function takeUpdate() {
  const w = waiting
  if (!w) return
  /* The reload is hung on the handover rather than fired straight away, so the
   * page that comes back is the new one rather than a race with it. */
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  w.postMessage('take-over')
}

export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(() => !!waiting)
  useEffect(() => {
    const fn = () => setReady(!!waiting)
    watchers.add(fn)
    fn()
    return () => {
      watchers.delete(fn)
    }
  }, [])
  return ready
}
