/* Connections between cards.
 *
 *   npm run dev &
 *   node test/wires.mjs http://localhost:5173
 *
 * A wire is stored as two card ids and drawn from wherever those cards are, so
 * the things worth checking are that it appears where it should, follows the
 * cards when they move, can be selected and removed on its own, goes when the
 * card it is attached to goes, comes back with undo, and survives a reload.
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

const tool = (t) => page.locator('.tools button', { hasText: t }).first()
const wires = () => page.locator('.wire-line')
const boxes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card')].map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height }
    })
  )
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

/* A point on that card's title bar that really belongs to it. Cards cascade
 * over one another as they are added, so a point worked out from a card's own
 * rectangle can easily land on a card sitting over it. */
const grip = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    if (!card) return null
    const r = card.getBoundingClientRect()
    for (let dx = 12; dx < r.width - 12; dx += 10) {
      const x = r.x + dx
      const y = r.y + 10
      const el = document.elementFromPoint(x, y)
      if (el && el.closest('.card') === card) return { x, y }
    }
    return null
  }, id)

/* Two notes, well apart. */
await tool('Note').click()
await page.waitForTimeout(300)
await tool('Note').click()
await page.waitForTimeout(300)
let cards = await boxes()
await page.mouse.move(cards[1].x + 60, cards[1].y + 10)
await page.mouse.down()
await page.mouse.move(cards[1].x + 470, cards[1].y + 200, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(400)
cards = await boxes()

/* ---------- the ports ---------- */
await page.mouse.move(cards[0].x + 60, cards[0].y + 80)
await page.waitForTimeout(250)
const port = await page.evaluate(() => {
  const layer = document.querySelector('.card-ports')
  const dot = document.querySelector('.port-e')
  return {
    shown: layer ? getComputedStyle(layer).opacity === '1' : false,
    count: document.querySelectorAll('.card-ports').length && document.querySelectorAll('.card-ports i').length,
    rect: dot ? dot.getBoundingClientRect().toJSON() : null,
  }
})
check('hovering a card shows its ports', port.shown && !!port.rect)
check('four of them, one a side', port.count % 4 === 0)

/* ---------- dragging one to another card ---------- */
await page.mouse.move(port.rect.x + port.rect.width / 2, port.rect.y + port.rect.height / 2)
await page.mouse.down()
await page.mouse.move(cards[1].x + 100, cards[1].y + 90, { steps: 14 })
await page.waitForTimeout(120)
const during = await page.evaluate(() => ({
  preview: document.querySelector('.wire-preview')?.getAttribute('d') || null,
  over: !!document.querySelector('.card[data-wire-over]'),
}))
check('the wire follows the pointer', !!during.preview && during.preview.startsWith('M '))
check('the card it would land on is marked', during.over)
await page.mouse.up()
await page.waitForTimeout(400)

check('letting go on a card connects them', (await wires().count()) === 1)
const first = await wires().first().getAttribute('d')
check('the preview is put away', !(await page.evaluate(() => document.querySelector('.wire-preview')?.hasAttribute('data-on'))))
fs.writeFileSync(path.join(OUT, 'wire-made.png'), await page.screenshot())

/* ---------- the same pair twice ---------- */
await page.mouse.move(cards[0].x + 60, cards[0].y + 80)
await page.waitForTimeout(200)
const port2 = await page.evaluate(() => document.querySelector('.port-e')?.getBoundingClientRect().toJSON() || null)
await page.mouse.move(port2.x + 5, port2.y + 5)
await page.mouse.down()
await page.mouse.move(cards[1].x + 100, cards[1].y + 90, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
check('connecting the same pair again changes nothing', (await wires().count()) === 1)

/* ---------- it follows the cards ---------- */
await page.mouse.move(cards[1].x + 60, cards[1].y + 10)
await page.mouse.down()
await page.mouse.move(cards[1].x + 60, cards[1].y + 260, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(400)
const moved = await wires().first().getAttribute('d')
check('moving a card redraws its wire', moved !== first, `${first?.slice(0, 24)} -> ${moved?.slice(0, 24)}`)

/* ---------- selecting and removing the wire ---------- */
/* Escape rather than a press on empty board: a synthetic pointerdown on the
 * viewport starts a marquee that never ends, and the next real press finishes
 * it as a selection drag over whatever lies between. */
await blur()
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const mid = await page.evaluate(() => {
  const p = document.querySelector('.wire-line')
  const len = p.getTotalLength()
  const pt = p.getPointAtLength(len / 2)
  const svg = document.querySelector('.wires').getBoundingClientRect()
  return { x: svg.x + pt.x, y: svg.y + pt.y }
})
await page.mouse.click(mid.x, mid.y)
await page.waitForTimeout(300)
check('a wire can be picked out on its own', await page.evaluate(() => !!document.querySelector('.wire[data-sel]')))
await blur()
await page.keyboard.press('Delete')
await page.waitForTimeout(300)
check('and removed on its own', (await wires().count()) === 0)
check('without taking the cards with it', (await page.locator('.card').count()) === 2)

await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
check('undo brings the wire back', (await wires().count()) === 1)

/* ---------- deleting a card takes its wires ---------- */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
check('a wire survives a reload', (await wires().count()) === 1)

cards = await boxes()
await page.mouse.click(cards[1].x + 60, cards[1].y + 10)
await blur()
await page.keyboard.press('Delete')
await page.waitForTimeout(400)
check('deleting a card takes its wires with it', (await wires().count()) === 0)
check('and leaves the other card', (await page.locator('.card').count()) === 1)
await page.keyboard.press('Control+z')
await page.waitForTimeout(500)
check('undo brings back the card and the wire together', (await wires().count()) === 1 && (await page.locator('.card').count()) === 2)

/* ---------- connecting from the menu ---------- */
await tool('Note').click()
await page.waitForTimeout(400)
cards = await boxes()
/* New cards cascade over the ones already there, so the third has to be put
 * somewhere of its own before it can be aimed at. */
const third = cards[cards.length - 1]
const pick = await grip(third.id)
await page.mouse.move(pick.x, pick.y)
await page.mouse.down()
await page.mouse.move(pick.x, pick.y + 430, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)

const one = await grip(cards[0].id)
const two = await grip(third.id)
await page.mouse.click(one.x, one.y)
await page.waitForTimeout(150)
await page.keyboard.down('Shift')
await page.mouse.click(two.x, two.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(300)
check('shift adds a card to the selection', (await page.locator('.card[data-sel]').count()) === 2)
await page.mouse.click(two.x, two.y, { button: 'right' })
await page.waitForTimeout(300)
const connect = page.locator('.menu button', { hasText: 'Connect' })
check('two selected cards can be connected from the menu', (await connect.count()) === 1)
if (await connect.count()) {
  await connect.click()
  await page.waitForTimeout(400)
}
check('which makes a second wire', (await wires().count()) === 2)
fs.writeFileSync(path.join(OUT, 'wire-two.png'), await page.screenshot())

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
