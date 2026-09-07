/* Framing a picture by hand.
 *
 *   npm run build && npm run test:browser -- framing
 *   node test/framing.mjs http://localhost:4173
 *
 * A card crops what is on it, and the only way to say where the crop sat was
 * two sliders called Offset X and Offset Y. Nobody frames a photograph by
 * typing coordinates into two boxes.
 *
 * Alt and drag pushes the picture around inside its card; Alt and the wheel
 * scales it. They write the same two numbers the sliders write, which is the
 * point: a framing found by dragging can still be nudged from the keyboard,
 * and one typed into the panel can be dragged on from.
 *
 * What has to stay true while that is added is everything a plain drag did.
 * The gesture sits on top of the one thing people do most — moving a card —
 * and the ways it could break that are the ways worth checking: a plain drag
 * still moving the card, a modifier drag not moving it, a card that has no
 * picture behaving as it always did, and a whole selection not being reframed
 * because one of them was.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

/* Two pictures side by side. */
const drop = (hue, at) =>
  page.evaluate(
    async ({ hue, at }) => {
      const c = document.createElement('canvas')
      c.width = 900
      c.height = 600
      const x = c.getContext('2d')
      const g = x.createLinearGradient(0, 0, 900, 600)
      g.addColorStop(0, `hsl(${hue}, 70%, 30%)`)
      g.addColorStop(1, `hsl(${hue + 50}, 80%, 70%)`)
      x.fillStyle = g
      x.fillRect(0, 0, 900, 600)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], `p${hue}.png`, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at, clientY: 250 })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { hue, at }
  )

await drop(200, 200)
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(700)
await drop(20, 720)
await page.waitForTimeout(1300)

const ids = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="image"]')].map((c) => c.dataset.id)
)
check('two pictures on the board', ids.length === 2, `${ids.length}`)
const [A, B] = ids

/* Where a card is, and where the picture inside it sits. The framing is read
 * off the card rather than out of the store, so what is checked is what ended
 * up on the glass. */
const shape = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    if (!card) return null
    const t = card.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/)
    return {
      x: t ? Math.round(+t[1]) : null,
      y: t ? Math.round(+t[2]) : null,
      frame: card.querySelector('.card-frame')?.style.transform || '',
    }
  }, id)

/* The numbers behind it, which are the ones the panel writes. */
const off = (id) =>
  page.evaluate((cid) => {
    const m = document
      .querySelector(`.card[data-id="${cid}"] .card-frame`)
      ?.style.transform.match(/translate\(([-\d.]+)%,\s*([-\d.]+)%\)/)
    return m ? { ox: +m[1], oy: +m[2] } : { ox: 0, oy: 0 }
  }, id)

const zoomOf = (id) =>
  page.evaluate((cid) => {
    const m = document
      .querySelector(`.card[data-id="${cid}"] .card-frame`)
      ?.style.transform.match(/scale\(([\d.]+)\)/)
    return m ? +m[1] : 1
  }, id)

/* A point on a card that really is that card. */
const grip = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    if (!card) return null
    const r = card.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, id)

async function dragOn(id, dx, dy, { alt = false } = {}) {
  const at = await grip(id)
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + dx / 2, at.y + dy / 2, { steps: 4 })
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 4 })
  await page.mouse.up()
  if (alt) await page.keyboard.up('Alt')
  await page.waitForTimeout(400)
}

/* ---------- a plain drag still moves the card ---------- */

const beforeMove = await shape(A)
await dragOn(A, 60, 40)
const afterMove = await shape(A)
check('a plain drag still moves the card, as it always did',
  afterMove.x === beforeMove.x + 60 && afterMove.y === beforeMove.y + 40,
  `${beforeMove.x},${beforeMove.y} -> ${afterMove.x},${afterMove.y}`)
check('and leaves the picture where it was in its card', afterMove.frame === beforeMove.frame,
  `"${afterMove.frame}"`)

/* ---------- and Alt and a drag moves the picture instead ---------- */

/* Zoomed in first, so there is something behind the edges to bring into view
 * rather than an edge to pull off the card — which is what framing is for. */
await page.locator(`.card[data-id="${A}"]`).click()
await page.waitForTimeout(400)
await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
await page.waitForTimeout(400)
await page.locator('.ctl', { hasText: 'Zoom' }).first().locator("input[type='range']").fill('1.8')
await page.waitForTimeout(500)
check('a picture can be scaled up inside its card', (await zoomOf(A)) === 1.8, `${await zoomOf(A)}`)

const held = await shape(A)
await dragOn(A, -70, -50, { alt: true })
const framed = await shape(A)
check('Alt and a drag leaves the card exactly where it is',
  framed.x === held.x && framed.y === held.y, `${held.x},${held.y} -> ${framed.x},${framed.y}`)
check('and moves the picture inside it instead', framed.frame !== held.frame,
  `"${held.frame}" -> "${framed.frame}"`)

const moved = await off(A)
/* Dragged up and to the left, so both numbers go down. */
check('in the direction it was dragged', moved.ox < 0 && moved.oy < 0, JSON.stringify(moved))

fs.writeFileSync(path.join(OUT, 'framing.png'), await page.screenshot())

/* ---------- the panel is showing the same numbers ---------- */

const shownX = await page.locator('.ctl', { hasText: 'Offset X' }).first().locator('input.ctl-num').inputValue()
check('and the panel says what the hand did', Math.abs(Number(shownX) - moved.ox) <= 1,
  `panel ${shownX}, card ${moved.ox}`)

/* Which means the two ways of saying it are the same two numbers: nudge it
   from the panel and the picture moves on. */
await page.locator('.ctl', { hasText: 'Offset X' }).first().locator('input.ctl-num').fill('-30')
await page.locator('.ctl', { hasText: 'Offset X' }).first().locator('input.ctl-num').press('Enter')
await page.waitForTimeout(500)
check('and a figure typed in carries on from where the drag left off', (await off(A)).ox === -30,
  `${(await off(A)).ox}`)

/* ---------- one drag is one step of undo ---------- */

const beforeUndo = await off(A)
await dragOn(A, 40, 0, { alt: true })
const dragged = await off(A)
check('another drag moves it again', dragged.ox !== beforeUndo.ox, `${beforeUndo.ox} -> ${dragged.ox}`)
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
check('and one undo takes the whole drag off, not a frame of it',
  (await off(A)).ox === beforeUndo.ox, `${(await off(A)).ox}, wanted ${beforeUndo.ox}`)
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(600)
check('and redo puts it back', (await off(A)).ox === dragged.ox)

/* ---------- it frames one picture, not the selection ---------- */

await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
const bBefore = await off(B)
await dragOn(A, -40, -30, { alt: true })
check('with everything selected it still frames only the one under the pointer',
  JSON.stringify(await off(B)) === JSON.stringify(bBefore),
  `the other went ${JSON.stringify(await off(B))}`)
check('and does not throw the selection away to do it',
  (await page.locator('.card[data-sel]').count()) > 1,
  `${await page.locator('.card[data-sel]').count()} still selected`)

/* ---------- Alt and the wheel scales it ---------- */

const z0 = await zoomOf(A)
const at = await grip(A)
await page.keyboard.down('Alt')
await page.mouse.move(at.x, at.y)
await page.mouse.wheel(0, -240)
await page.waitForTimeout(500)
const z1 = await zoomOf(A)
await page.keyboard.up('Alt')
check('Alt and the wheel scales the picture in its card', z1 > z0, `${z0} -> ${z1}`)
check('and the card did not move under it', (await shape(A)).x === framed.x)

/* Far past the end, to see it stop rather than run away. */
await page.keyboard.down('Alt')
await page.mouse.move(at.x, at.y)
for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -240)
await page.waitForTimeout(600)
check('and stops at the far end rather than running past it', (await zoomOf(A)) === 3, `${await zoomOf(A)}`)
for (let i = 0; i < 24; i++) await page.mouse.wheel(0, 240)
await page.waitForTimeout(600)
check('and at the near end too', (await zoomOf(A)) === 1, `${await zoomOf(A)}`)
await page.keyboard.up('Alt')

/* And the offsets have ends of their own. */
await dragOn(A, 4000, 4000, { alt: true })
const far = await off(A)
check('a picture cannot be dragged out past the ends of the numbers',
  far.ox === 50 && far.oy === 50, JSON.stringify(far))

/* ---------- a card with no picture is untouched by any of it ---------- */

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('n')
await page.waitForSelector('.card[data-kind="note"]', { timeout: 8000 })
await page.waitForTimeout(600)
const note = await page.evaluate(() => document.querySelector('.card[data-kind="note"]').dataset.id)
const noteBefore = await shape(note)
await dragOn(note, 50, 30, { alt: true })
const noteAfter = await shape(note)
check('Alt and a drag on a note moves the note, because there is nothing in it to frame',
  noteAfter.x === noteBefore.x + 50 && noteAfter.y === noteBefore.y + 30,
  `${noteBefore.x},${noteBefore.y} -> ${noteAfter.x},${noteAfter.y}`)

/* ---------- and it says it is there ---------- */

await page.locator(`.card[data-id="${A}"]`).click()
await page.waitForTimeout(400)
await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
await page.waitForTimeout(400)
check('the panel says the gesture exists, since nothing else would',
  /alt/i.test(await page.locator('.fx-hint').first().innerText()),
  await page.locator('.fx-hint').first().innerText())

await page.keyboard.down('Alt')
await page.waitForTimeout(300)
const cursor = await page.evaluate(
  (cid) => getComputedStyle(document.querySelector(`.card[data-id="${cid}"]`)).cursor,
  A
)
await page.keyboard.up('Alt')
await page.waitForTimeout(300)
check('and a picture says so under the pointer while Alt is down', cursor === 'grab', cursor)
check('and stops saying it when Alt is let go', await page.evaluate(
  (cid) => getComputedStyle(document.querySelector(`.card[data-id="${cid}"]`)).cursor !== 'grab', A
))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
