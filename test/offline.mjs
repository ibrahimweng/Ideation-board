/* The app, on a machine with no network.
 *
 *   npm run build && node scripts/browser-tests.mjs offline
 *
 * Everything this board knows was always local — the boards in IndexedDB, the
 * pictures beside them as blobs, nothing uploaded and no account. The app was
 * not: the manifest says it installs, so people install it, and opening it on
 * a plane showed the browser's offline page over a machine that had all of it.
 *
 * So the test is the honest one. Make a board, cut the network at the browser,
 * and open the app again: it has to start, and the work has to be there. Then
 * check the two things that would make that a bad bargain — that a picture
 * being drawn is never mistaken for something to cache, and that the version
 * on screen is never swapped out from under somebody without being asked.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
/* One context throughout: a service worker belongs to an origin in a profile,
   and a fresh context would throw away the very thing being tested. */
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1500)

/* The worker registers after load, on purpose, so it does not compete with the
   app's own first paint. */
const registered = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  return !!reg && !!navigator.serviceWorker.controller === false ? 'installed' : reg ? 'controlling' : 'none'
})
ok('a service worker takes charge of the app', registered !== 'none', registered)

const cached = await page.evaluate(async () => {
  const names = await caches.keys()
  const app = names.find((n) => n.startsWith('ideation-app-'))
  if (!app) return { names, files: 0 }
  const keys = await (await caches.open(app)).keys()
  return { app, files: keys.length, has: keys.map((r) => new URL(r.url).pathname) }
})
ok('and the whole shell is put by, not whatever happened to be asked for',
   cached.files >= 10 && cached.has?.some((p) => p.endsWith('.css')) &&
   cached.has?.some((p) => /worker-.*\.js$/.test(p)),
   `${cached.files} files`)
ok('including the worker that runs the effects, which nothing would have fetched on a cold start',
   !!cached.has?.some((p) => /worker-.*\.js$/.test(p)))

/* Something to come back to. */
await page.keyboard.press('n')
await page.waitForTimeout(600)
/* A note arrives empty; its words are typed in the editor the card opens. */
await page.locator('.card[data-kind="note"]').first().dblclick({ position: { x: 60, y: 90 } })
await page.waitForSelector('.sheet textarea', { timeout: 5000 })
await page.locator('.sheet textarea').fill('a note made before the network went')
await page.locator('.sheet-actions button', { hasText: 'Save' }).click()
await page.waitForTimeout(1200)
ok('a board can be made while there is still a network', (await page.locator('.card').count()) === 1)

/* ---------- and now there is not one ---------- */
await context.setOffline(true)
await page.waitForTimeout(300)

/* Proof the network really is gone, so that what follows means something.
 *
 * Asked of an address nothing has ever cached — a cached file would answer
 * happily with no network at all, which is the whole feature and therefore
 * useless as a control. */
const reached = await page.evaluate(async () => {
  try {
    const res = await fetch('/nothing-has-ever-asked-for-this-' + Math.random(), { cache: 'no-store' })
    return `the network answered (${res.status})`
  } catch {
    return 'refused'
  }
})
ok('the network is really gone', reached === 'refused', reached)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2600)
ok('the app still opens', (await page.locator('.viewport').count()) === 1)
ok('and the board is still there', (await page.locator('.card').count()) === 1,
   `${await page.locator('.card').count()} cards`)
ok('with what was written on it', /before the network went/.test(await page.locator('.card').innerText()))
ok('and it is really running, not a shell of itself',
   (await page.locator('.topbar').count()) === 1 && (await page.locator('.stats').count()) === 1)
fs.writeFileSync(path.join(OUT, 'offline.png'), await page.screenshot())

/* A cold start with no network at all: not a reload of a page that was already
   running, but the app opened from nothing, the way an installed one is. */
const cold = await context.newPage()
await cold.goto(BASE, { waitUntil: 'domcontentloaded' })
await cold.waitForTimeout(2600)
ok('a fresh tab opens offline too, which is what an installed app does',
   (await cold.locator('.viewport').count()) === 1 && (await cold.locator('.card').count()) === 1)
await cold.close()

await context.setOffline(false)
await page.waitForTimeout(300)

/* ---------- what must not be cached ---------- */
/* Asking Google for a picture goes through the same fetch handler as
   everything else. A cached answer would mean paying for a picture once and
   being handed it for ever, and an event stream held open by the relay would
   be buffered into uselessness. Neither is this file's business. */
const outside = await page.evaluate(async () => {
  const names = await caches.keys()
  let n = 0
  for (const name of names) {
    for (const req of await (await caches.open(name)).keys()) {
      const u = new URL(req.url)
      if (u.origin !== location.origin && !u.host.includes('fonts.g')) n++
    }
  }
  return n
})
ok('nothing from anywhere but this app and its fonts is ever put by', outside === 0, `${outside} strangers cached`)

/* ---------- and it does not change under you ---------- */
ok('no new version is announced when there is not one',
   (await page.locator('.update-bar').count()) === 0)

/* The part where getting it wrong costs somebody their afternoon.
 *
 * A worker that takes over the moment it installs swaps the scripts under
 * whoever is using the page, and this is an app people leave open for days.
 * So a second version is really put on the server and the page really told to
 * look, and what has to happen is: it says so, and nothing else, until it is
 * answered. The file is put back afterwards — the suites that follow are
 * served out of the same directory. */
const swPath = path.join(process.cwd(), 'dist', 'sw.js')
const original = fs.existsSync(swPath) ? fs.readFileSync(swPath, 'utf8') : null
if (!original) {
  ok('a second version can be put up to test the handover', false, 'no dist/sw.js to replace')
} else {
  try {
    fs.writeFileSync(swPath, original.replace(/const VERSION = "[^"]+"/, 'const VERSION = "second-version"'))
    const before = await page.evaluate(() => document.querySelector('.card')?.textContent || '')

    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
    })
    await page.waitForSelector('.update-bar', { timeout: 10000 }).catch(() => {})
    ok('a new version says so', (await page.locator('.update-bar').count()) === 1)
    ok('and does not take over until it is asked to',
       (await page.evaluate(() => document.querySelector('.card')?.textContent || '')) === before &&
       (await page.locator('.card').count()) === 1)
    fs.writeFileSync(path.join(OUT, 'offline-update.png'), await page.screenshot())

    await page.locator('.update-bar button', { hasText: 'Reload' }).click()
    /* Waited for rather than timed: the press hands over to the new worker,
       which activates, claims the page, and only then is the reload fired. */
    await page.waitForSelector('.viewport', { timeout: 20000 }).catch(() => {})
    await page.waitForSelector('.card', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(600)
    ok('and comes back on the new one when it is',
       (await page.locator('.viewport').count()) === 1 && (await page.locator('.update-bar').count()) === 0,
       `viewport ${await page.locator('.viewport').count()}, bar ${await page.locator('.update-bar').count()}`)
    ok('with the work still there afterwards', (await page.locator('.card').count()) === 1,
       `${await page.locator('.card').count()} cards`)
    ok('and running the version that was waiting',
       (await page.evaluate(async () => {
         const names = await caches.keys()
         return names.some((n) => n === 'ideation-app-second-version')
       })), (await page.evaluate(() => caches.keys())).join(', '))
  } finally {
    fs.writeFileSync(swPath, original)
  }
}

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
