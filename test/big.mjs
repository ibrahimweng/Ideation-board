/* A board with a great deal on it.
 *
 *   npm run build && npm run test:browser -- big
 *   node test/big.mjs http://localhost:4173 [count]
 *
 * Every other suite works on a handful of cards, which is the wrong size for
 * the things that only go wrong at scale. Undo used to keep the whole board
 * per step, so a big board had six steps of history instead of sixty and paid
 * for every card it was not moving on the first frame of every drag. Both are
 * fixed in the store and both are covered by `test/unit/history.test.ts`; what
 * a real browser adds is whether any of it is felt — whether picking a card up
 * on a full board still blocks the main thread.
 *
 * The board is written straight into IndexedDB rather than built by dropping
 * two thousand files, because that is how a big board really arrives: off the
 * disk, in one read, at the moment the app starts. Labels rather than pictures,
 * so nothing here is waiting on a decode or a texture upload and what is being
 * measured is the board rather than the graphics card.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const N = Number(process.argv[3] || process.env.N || 2000)
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
/* Deliberately not deleteDatabase(). The page has already opened the database
   by the time this runs, a delete waits for every connection to close, and the
   write below would then be queued behind a delete that is itself waiting on
   this page — which is a hang rather than a failure. A new browser context
   starts with nothing in it anyway, so there is nothing to clear. */
await page.evaluate(() => localStorage.clear())
/* Let the app finish opening before writing under it. It reads its board on
   boot and can write one back, and a record put down in the middle of that is
   racing the autosave for the same key. */
await page.waitForTimeout(1500)

/* ---------- write the board, then open it ---------- */

/* `board_local` is the id the app opens on when the address names no other, so
   a record written under it is the board that is there when the tab starts. */
await page.evaluate(async (n) => {
  const FX = {
    exp: 0, con: 0, sat: 100, warm: 0, blur: 0, grain: 0,
    zoom: 1, ox: 0, oy: 0, rot: 0, fh: false, fv: false,
    preset: 'none', fxid: 'none', ep: null,
  }
  const across = Math.ceil(Math.sqrt(n))
  const items = []
  for (let i = 0; i < n; i++) {
    items.push({
      id: `big_${i}`,
      kind: 'label',
      text: `card ${i}`,
      x: (i % across) * 220,
      y: Math.floor(i / across) * 120,
      w: 180, h: 44, z: 20 + i,
      fx: { ...FX }, tag: null,
    })
  }
  await new Promise((res, rej) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs')
    }
    r.onerror = () => rej(r.error)
    r.onsuccess = () => {
      const db = r.result
      const t = db.transaction('boards', 'readwrite')
      t.objectStore('boards').put({
        id: 'board_local',
        name: 'A big board',
        updated: Date.now(),
        created: Date.now(),
        items,
        view: { x: 40, y: 40, z: 1 },
      })
      t.oncomplete = () => res()
      t.onerror = () => rej(t.error)
    }
  })
}, N)

const opened = Date.now()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card', { timeout: 60000 })
await page.waitForFunction(
  (n) => document.querySelector('.stats')?.textContent?.includes(`${n} items`),
  N,
  { timeout: 60000 }
)
const openMs = Date.now() - opened

check(`a board of ${N} opens`, true, `${openMs}ms to first paint of the whole board`)

const mounted = await page.locator('.card').count()
check(
  'and only what is on screen is put in the page',
  mounted > 0 && mounted < N / 4,
  `${mounted} of ${N} mounted`
)

/* Long tasks: anything over 50ms is a stall somebody can feel. */
await page.evaluate(() => {
  window.__long = []
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push(Math.round(e.duration))
  }).observe({ entryTypes: ['longtask'] })
})

/* ---------- the first frame of a drag ---------- */

/* This is the one the old history made expensive: opening a step used to
   serialise every card on the board before the first pointer move was
   answered. */
const box = await page.locator('.card').first().boundingBox()
const from = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
const movedId = await page.locator('.card').first().getAttribute('data-id')
/* A card is placed with a transform rather than with left and top, so that
   moving one is a compositor change and never a layout. */
const placeOf = (id) =>
  page.evaluate((cardId) => {
    const el = document.querySelector(`.card[data-id="${cardId}"]`)
    return el ? el.style.transform : null
  }, id)
const startedAt = await placeOf(movedId)

await page.evaluate(() => { window.__long.length = 0 })
await page.mouse.move(from.x, from.y)
await page.mouse.down()
const t0 = Date.now()
/* The press to the first movement, which is where the cost used to sit. */
await page.mouse.move(from.x + 4, from.y + 2)
const firstFrameMs = Date.now() - t0
for (let i = 1; i <= 30; i++) await page.mouse.move(from.x + 4 + i * 9, from.y + 2 + i * 5)
await page.mouse.up()
await page.waitForTimeout(400)

const longDuringDrag = await page.evaluate(() => window.__long.slice())
check('dragging a card blocks the main thread for nothing', longDuringDrag.length === 0,
  longDuringDrag.length ? `${longDuringDrag.join('ms, ')}ms` : `0 long tasks, first move answered in ${firstFrameMs}ms`)

const afterDrag = await placeOf(movedId)
check('and the card really moved', !!afterDrag && afterDrag !== startedAt,
  `${startedAt} -> ${afterDrag}`)

/* ---------- one press puts the whole drag back ---------- */

await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
const afterUndo = await placeOf(movedId)
check('one undo puts it back where it was', !!afterUndo && afterUndo === startedAt,
  afterUndo || 'the card is gone')
check('and takes nothing else with it', await page.evaluate((n) =>
  !!document.querySelector('.stats')?.textContent?.includes(`${n} items`), N), `${N} items`)

/* ---------- panning across all of it ---------- */

await page.evaluate(() => { window.__long.length = 0 })
await page.evaluate(() => new Promise((res) => {
  const vp = document.querySelector('.viewport')
  let n = 0
  const step = () => {
    vp.dispatchEvent(new WheelEvent('wheel', { deltaX: 34, deltaY: 22, bubbles: true, cancelable: true }))
    if (++n < 90) requestAnimationFrame(step)
    else res()
  }
  requestAnimationFrame(step)
}))
await page.waitForTimeout(500)
const longDuringPan = await page.evaluate(() => window.__long.slice())
check('panning across the whole board blocks it for nothing', longDuringPan.length === 0,
  longDuringPan.length ? `${longDuringPan.join('ms, ')}ms` : '0 long tasks')

/* ---------- the board does not work while nobody is touching it ---------- */

/* The frame loop used to walk every item and build two strings sixty times a
   second whether or not anything had changed. It settles now, so an untouched
   board should be able to sit for a second having done almost nothing. */
const idle = await page.evaluate(() => new Promise((res) => {
  let frames = 0
  const t0 = performance.now()
  const tick = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(frames) }
  requestAnimationFrame(tick)
}))
check('an untouched board still animates smoothly', idle > 30, `${idle} frames in a second`)

fs.writeFileSync(path.join(OUT, 'big.png'), await page.screenshot())
check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
