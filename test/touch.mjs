/* Fingers.
 *
 *   npm run dev &
 *   node test/touch.mjs http://localhost:5173
 *
 * The board was pointer and wheel only, which left it unusable on a tablet: no
 * way to pan except a scroll wheel, and no way to zoom at all. One finger on
 * empty board now pans, two pinch, a finger on a card still drags it, and a
 * tap still clears the selection.
 *
 * The presses are synthesised rather than made by a real touchscreen, so what
 * this checks is the board's own handling of them.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.removeItem('ideation.path')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

/* Presses, as the board sees them. */
const finger = (steps) =>
  page.evaluate((moves) => {
    for (const m of moves) {
      const ev = new PointerEvent(m.t, {
        pointerId: m.id,
        pointerType: 'touch',
        isPrimary: m.id === 1,
        clientX: m.x,
        clientY: m.y,
        bubbles: true,
        cancelable: true,
        buttons: m.t === 'pointerup' ? 0 : 1,
      })
      const target =
        m.t === 'pointerdown' ? document.querySelector(m.on || '.viewport') : window
      target.dispatchEvent(ev)
    }
  }, steps)

const view = () =>
  page.evaluate(() => {
    const t = document.querySelector('.surface').style.transform
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0(?:px)?\) scale\(([\d.]+)\)/.exec(t)
    return m ? { x: +m[1], y: +m[2], z: +m[3] } : null
  })

const cards = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card')].map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset.id, x: Math.round(r.x), y: Math.round(r.y) }
    })
  )

const start = await view()
check('the board starts unpanned', !!start, JSON.stringify(start))

/* ---------- one finger pans ---------- */
const swipe = [{ t: 'pointerdown', id: 1, x: 300, y: 600 }]
for (let i = 1; i <= 8; i++) swipe.push({ t: 'pointermove', id: 1, x: 300 + i * 20, y: 600 - i * 10 })
swipe.push({ t: 'pointerup', id: 1, x: 460, y: 520 })
await finger(swipe)
await page.waitForTimeout(400)
const panned = await view()
check(
  'one finger on empty board pans it',
  panned.x - start.x === 160 && panned.y - start.y === -80,
  JSON.stringify(panned)
)
check('and does not draw a selection rectangle', (await page.locator('.marquee').count()) === 0)

/* ---------- two fingers pinch ---------- */
const before = await view()
const out = [
  { t: 'pointerdown', id: 1, x: 600, y: 400 },
  { t: 'pointerdown', id: 2, x: 800, y: 400 },
]
for (let i = 1; i <= 8; i++) {
  out.push({ t: 'pointermove', id: 1, x: 600 - i * 10, y: 400 })
  out.push({ t: 'pointermove', id: 2, x: 800 + i * 10, y: 400 })
}
out.push({ t: 'pointerup', id: 1, x: 520, y: 400 })
out.push({ t: 'pointerup', id: 2, x: 880, y: 400 })
await finger(out)
await page.waitForTimeout(400)
const zoomed = await view()
check('two fingers spreading zoom in', zoomed.z > before.z * 1.4, `${before.z} -> ${zoomed.z}`)

const inward = [
  { t: 'pointerdown', id: 3, x: 500, y: 400 },
  { t: 'pointerdown', id: 4, x: 900, y: 400 },
]
for (let i = 1; i <= 8; i++) {
  inward.push({ t: 'pointermove', id: 3, x: 500 + i * 20, y: 400 })
  inward.push({ t: 'pointermove', id: 4, x: 900 - i * 20, y: 400 })
}
inward.push({ t: 'pointerup', id: 3, x: 660, y: 400 })
inward.push({ t: 'pointerup', id: 4, x: 740, y: 400 })
await finger(inward)
await page.waitForTimeout(400)
const back = await view()
check('and closing them zooms out again', back.z < zoomed.z * 0.8, `${zoomed.z} -> ${back.z}`)
check('the zoom readout keeps up', /\d+%/.test(await page.locator('.zoombar').innerText()))

/* ---------- a card still moves under one finger ---------- */
await page.locator('.tools button', { hasText: 'Note' }).first().click()
await page.waitForTimeout(500)
const made = (await cards())[0]
const at = await page.evaluate((cid) => {
  const r = document.querySelector(`.card[data-id="${cid}"]`).getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 10) }
}, made.id)
const drag = [{ t: 'pointerdown', id: 9, x: at.x, y: at.y, on: `.card[data-id="${made.id}"] .card-bar` }]
for (let i = 1; i <= 8; i++) drag.push({ t: 'pointermove', id: 9, x: at.x + i * 12, y: at.y + i * 6 })
drag.push({ t: 'pointerup', id: 9, x: at.x + 96, y: at.y + 48 })
const viewBefore = await view()
await finger(drag)
await page.waitForTimeout(400)
const moved = (await cards()).find((c) => c.id === made.id)
const viewAfter = await view()
check('a finger on a card moves the card', moved.x > made.x + 20, `${made.x} -> ${moved.x}`)
check('and leaves the board where it was', viewAfter.x === viewBefore.x && viewAfter.y === viewBefore.y)
check('the card is selected by the touch', (await page.locator('.card[data-sel]').count()) === 1)

/* ---------- a tap on empty board clears the selection ---------- */
await finger([
  { t: 'pointerdown', id: 11, x: 200, y: 780 },
  { t: 'pointermove', id: 11, x: 201, y: 781 },
  { t: 'pointerup', id: 11, x: 201, y: 781 },
])
await page.waitForTimeout(400)
check('a tap on empty board clears the selection', (await page.locator('.card[data-sel]').count()) === 0)
fs.writeFileSync(path.join(OUT, 'touch.png'), await page.screenshot())

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
