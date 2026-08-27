/* ---------------------------------------------------------------------------
 * The app itself, kept on the machine the work is already on.
 *
 * Everything this board knows lives in one browser: the boards in IndexedDB,
 * the pictures beside them as blobs, nothing uploaded and no account. And
 * until this file existed, none of it could be reached without a network —
 * the manifest says the app installs, so people install it, and then it opens
 * on a plane to the browser's offline page with every board sitting two inches
 * away and unreachable. The data was local. The app was not.
 *
 * What is cached is the shell and only the shell: the document, the built
 * scripts and styles, the worker that runs the effects, the icons. Not your
 * pictures — those were never fetched, they are already in IndexedDB.
 *
 * The list is written in at build time, so it names exactly what this build
 * produced and nothing else. `scripts/build-sw.mjs` does that; if it does not
 * run, no sw.js is emitted at all and the app behaves as it did before, which
 * is the right way for this to fail.
 * ------------------------------------------------------------------------- */

/* Replaced at build. The version is the build's own fingerprint, so a deploy
 * that changed nothing does not throw the cache away. */
const VERSION = '__VERSION__'
const SHELL = __SHELL__

const APP = `ideation-app-${VERSION}`
/* Fonts come from Google and are versioned by URL. Kept apart from the shell
 * so a new build does not throw them away and send everyone back for them. */
const FONTS = 'ideation-fonts'
const FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(APP)
      /* One at a time rather than addAll, which throws the whole install away
       * if a single file 404s. A shell missing one icon is still a shell. */
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            /* Logged nowhere on purpose: there is nobody to tell, and the
             * fetch handler falls back to the network for anything absent. */
          })
        )
      )
    })()
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.startsWith('ideation-app-') && n !== APP).map((n) => caches.delete(n))
      )
      await self.clients.claim()
    })()
  )
})

/* The page asks for this when somebody presses Reload on the update notice.
 * Never on its own: taking over mid-session would swap the scripts under a
 * board somebody is in the middle of editing. */
self.addEventListener('message', (e) => {
  if (e.data === 'take-over') void self.skipWaiting()
})

const isFont = (url) => FONT_HOSTS.some((h) => url.startsWith(h))

async function fromCacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res && res.ok) cache.put(req, res.clone()).catch(() => {})
  return res
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  /* Anything that is not this app is none of this file's business: Google
   * being asked for a picture, the relay on the loopback address, a photograph
   * dragged in from another site. Left alone entirely — an event stream that
   * went through here would be buffered into uselessness. */
  const ours = url.origin === self.location.origin
  if (!ours && !isFont(req.url)) return

  if (isFont(req.url)) {
    e.respondWith(fromCacheFirst(req, FONTS).catch(() => caches.match(req)))
    return
  }

  /* The document, however it was asked for. Network first, so a deploy is
   * picked up the moment there is a network to pick it up from, and the cached
   * copy is what makes the app open with none. */
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(APP)
          cache.put('/index.html', fresh.clone()).catch(() => {})
          return fresh
        } catch {
          const cache = await caches.open(APP)
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
        }
      })()
    )
    return
  }

  /* Built files carry a hash in the name, so a given URL's contents never
   * change and the cache can be trusted without asking. */
  e.respondWith(fromCacheFirst(req, APP).catch(() => caches.match(req).then((r) => r || Response.error())))
})
