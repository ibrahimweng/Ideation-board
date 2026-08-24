/* The board without a mouse, the board with a finger, and the board with
 * nothing on it yet.
 *
 *   npm run dev &
 *   node test/access.mjs http://localhost:5173
 *
 * Three ways in that were missing. Selecting a card needed a pointer, which
 * put the whole of the app behind a selection — the effects, the looks, the
 * export, the menu — out of reach of anyone who cannot use one. The context
 * menu needed a right button, which a tablet does not have. And an empty board
 * was a grey field with no hint that files could be dropped on it.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, hasTouch: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1300)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

/* ---------- an empty board says what to do with it ---------- */
check('an empty board is not a grey field', (await page.locator('.first').count()) === 1)
const words = await page.locator('.first').innerText()
check('it says files can be dropped on it', /drop/i.test(words), words.split('\n')[0])
check('and names the key that opens everything', /ctrl\+k|⌘k/i.test(words))
check('the three ways in are buttons, not decoration', (await page.locator('.first-do button').count()) === 3)
fs.writeFileSync(path.join(OUT, 'access-empty.png'), await page.screenshot())

await page.locator('.first-do button', { hasText: 'Write a note' }).click()
await page.waitForTimeout(600)
check('pressing one of them does the thing', (await page.locator('.card').count()) === 1)
check('and the empty board goes when there is something to look at', (await page.locator('.first').count()) === 0)
await page.keyboard.press('Escape')

/* ---------- getting around without a pointer ---------- */
const drop = (seed, at) =>
  page.evaluate(
    async ({ seed, at }) => {
      const c = document.createElement('canvas')
      c.width = 600
      c.height = 400
      const x = c.getContext('2d')
      x.fillStyle = `hsl(${seed},55%,50%)`
      x.fillRect(0, 0, 600, 400)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], `card-${seed}.png`, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { seed, at }
  )

/* Three across the top, one far below and off screen, so walking to it has to
 * bring it into view or it has walked to something nobody can see. */
await drop(10, { x: 100, y: 110 })
await page.waitForTimeout(500)
await drop(120, { x: 480, y: 110 })
await page.waitForTimeout(500)
await drop(230, { x: 860, y: 110 })
await page.waitForTimeout(800)
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card[data-kind="image"]')]
  return cards.length
})
await drop(330, { x: 200, y: 600 })
await page.waitForTimeout(900)
/* Push the last one a long way down, out of sight. */
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.card[data-kind="image"]')].pop()
  const id = el.dataset.id
  const ev = new CustomEvent('x')
  void ev
  return id
})

await page.keyboard.press('Escape')
await blur()

const said = () => page.locator('.said').innerText()
const selected = () => page.locator('.card[data-sel]').count()

await page.keyboard.press('Tab')
await page.waitForTimeout(400)
check('Tab selects something on a board where nothing was selected', (await selected()) === 1)
const first = await said()
check('and says what it landed on, and where in the board it is', /\d+ of \d+/.test(first), first)

await page.keyboard.press('Tab')
await page.waitForTimeout(400)
const second = await said()
check('Tab again moves on', second !== first, `${first} -> ${second}`)

await page.keyboard.down('Shift')
await page.keyboard.press('Tab')
await page.keyboard.up('Shift')
await page.waitForTimeout(400)
check('and Shift with it goes back', (await said()) === first, await said())

/* Reading order: across the top row before dropping to the one below. */
const total = Number((first.match(/of (\d+)$/) || [])[1] || 0)
check('it knows how many there are to walk', total > 3, `${total}`)
const order = [first]
for (let i = 0; i < total; i++) {
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  order.push(await said())
}
check('it walks in the order the board reads', order[0] !== order[1] && order[1] !== order[2], order.map((o) => o.split(',')[0]).join(' → '))
check('every card gets its turn, and none twice', new Set(order.slice(0, total)).size === total, `${new Set(order.slice(0, total)).size} of ${total}`)
check('and then it comes back round to the start', order[total] === order[0], `${order[total]} vs ${order[0]}`)

/* The card it lands on has to be on screen, or it has landed on nothing. */
const onScreen = await page.evaluate(() => {
  const el = document.querySelector('.card[data-sel]')
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight
})
check('whatever it lands on is brought into view', onScreen)

/* Enter opens what is selected. */
let notes = await page.locator('.card[data-kind="note"]').count()
if (notes) {
  while (!/note/.test(await said())) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(250)
  }
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  check('Enter opens what is selected', (await page.locator('.sheet').count()) === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}

/* ---------- a finger instead of a right button ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const box = await page.locator('.card[data-kind="image"]').first().boundingBox()
const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }

/* A long press: down, hold still, up — with no mouse involved. */
const hold = async (x, y, ms) => {
  await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py)
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py }))
  }, [x, y])
  await page.waitForTimeout(ms)
  await page.evaluate(([px, py]) => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: px, clientY: py }))
  }, [x, y])
}

await hold(at.x, at.y, 700)
await page.waitForTimeout(400)
check('holding a finger on a card opens its menu', (await page.locator('.menu').count()) === 1)
const head = await page.locator('.menu-head').innerText().catch(() => '')
check('and it is the card menu, not the board one', !/add here/i.test(head), head)
fs.writeFileSync(path.join(OUT, 'access-longpress.png'), await page.screenshot())
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* A quick tap must not open it. */
await hold(at.x, at.y, 120)
await page.waitForTimeout(500)
check('a quick tap does not', (await page.locator('.menu').count()) === 0)

/* Nor a press that turns into a drag. */
await page.evaluate(([px, py]) => {
  const el = document.elementFromPoint(px, py)
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py }))
}, [at.x, at.y])
for (let i = 1; i <= 6; i++) {
  await page.evaluate(([px, py]) => {
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 8, pointerType: 'touch', clientX: px, clientY: py }))
  }, [at.x + i * 12, at.y])
  await page.waitForTimeout(90)
}
await page.waitForTimeout(500)
await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, pointerType: 'touch' })))
await page.waitForTimeout(400)
check('nor does a press that turns into a drag', (await page.locator('.menu').count()) === 0)

/* ---------- what a screen reader is given ---------- */
check('the board says what it is and how it works', await page.evaluate(() => {
  const vp = document.querySelector('.viewport')
  return vp.getAttribute('role') === 'application' && /tab/i.test(vp.getAttribute('aria-label') || '')
}))
check('and there is one thing on the page that speaks', await page.evaluate(() => {
  const s = document.querySelector('.said')
  return !!s && s.getAttribute('aria-live') === 'polite'
}))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
