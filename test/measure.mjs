/* Holding a key and pointing at something to be told how far away it is.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/measure.mjs http://localhost:4173
 *
 * The board knows where everything is and until now kept it to itself. Alt and
 * a hover is how it says so: the gap between two cards, the space left round
 * one sitting inside another, both at once for something away up and to the
 * right. Every figure here is one the board already had, so what this suite
 * checks is that the figure on screen is the distance on the board.
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

const tool = (t) => page.locator(`.rail button[aria-label="${t}"]`).first()
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

const items = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card')]
      .map((c) => {
        const r = c.getBoundingClientRect()
        return { id: c.dataset.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      })
      .sort((a, b) => a.x - b.x || a.y - b.y)
  )

/* Every figure the overlay is showing, and how many lines it drew. */
const shown = () =>
  page.evaluate(() => ({
    says: [...document.querySelectorAll('.measure-say')].map((b) => Number(b.textContent)).sort((a, b) => a - b),
    lines: document.querySelectorAll('.measure-line').length,
    guides: document.querySelectorAll('.measure-line[data-guide]').length,
    box: document.querySelectorAll('.measure-box').length,
  }))

const grip = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    if (!card) return null
    const r = card.getBoundingClientRect()
    for (let dx = 12; dx < r.width - 12; dx += 6) {
      const x = r.x + dx
      const y = r.y + 10
      if (document.elementFromPoint(x, y)?.closest('.card') === card) return { x, y }
    }
    return null
  }, id)

const moveTo = async (from, to) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

/* Point at a card without pressing anything.
 *
 * A quarter of the way in, not the middle: the middle of a selected card is
 * where the smart selection puts its ring, the edges carry the wire ports and
 * the corners carry the resize handles, and a hover that lands on any of
 * those is pointing at the overlay rather than at the card. */
const hover = async (c) => {
  await page.mouse.move(c.x + c.w * 0.25, c.y + c.h * 0.25)
  await page.waitForTimeout(160)
}

/* ---------- two cards, a known distance apart ---------- */
for (let i = 0; i < 2; i++) {
  await tool('Label').click()
  await page.waitForTimeout(250)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
}
let list = await items()
check('two cards to work with', list.length === 2, `${list.length}`)

/* Put them side by side, lined up, with a gap nobody has to guess at. */
let a = await grip(list[0].id)
await moveTo(a, { x: 400, y: 300 })
list = await items()
let b = await grip(list[1].id)
await moveTo(b, { x: 900, y: 300 })
await blur()
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
list = await items()
const [left, right] = list
const gap = right.x - (left.x + left.w)
check('they sit apart with a real gap between them', gap > 40, `${gap}`)

/* ---------- nothing until it is asked for ---------- */
await page.mouse.click(left.x + left.w / 2, left.y + 12)
await page.waitForTimeout(200)
check('one of them is selected', (await page.locator('.card[data-sel]').count()) === 1)
await hover(right)
let s = await shown()
check('pointing at the other says nothing on its own', s.lines === 0 && s.says.length === 0, JSON.stringify(s))

/* ---------- and the figure is the distance ---------- */
await page.keyboard.down('Alt')
await hover(right)
s = await shown()
check('Alt and a hover draws one measurement', s.says.length === 1 && s.box === 1, JSON.stringify(s))
check('and the figure it prints is the gap on the board', s.says[0] === gap, `${s.says[0]} vs ${gap}`)
check('with no guide, since the two of them are lined up', s.guides === 0, `${s.guides}`)
fs.writeFileSync(path.join(OUT, 'measure-gap.png'), await page.screenshot())

/* ---------- letting go puts it away ---------- */
await page.keyboard.up('Alt')
await page.waitForTimeout(160)
s = await shown()
check('letting the key go puts it away', s.lines === 0, JSON.stringify(s))

/* ---------- pointing at what is already selected asks nothing ---------- */
await page.keyboard.down('Alt')
await hover(left)
s = await shown()
check('pointing at the selection itself measures nothing', s.lines === 0 && s.box === 0, JSON.stringify(s))
await page.keyboard.up('Alt')

/* Nor one card of several, where there would have been a figure to print:
   how far a card sits in from the edges of the box round its own selection
   is not something anybody is asking. */
await blur()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
check('both are selected', (await page.locator('.card[data-sel]').count()) === 2)
await page.keyboard.down('Alt')
await hover(right)
s = await shown()
check('nor one card out of several that are selected', s.lines === 0 && s.box === 0, JSON.stringify(s))
await page.keyboard.up('Alt')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

/* ---------- away up and to the right: both at once ---------- */
await page.keyboard.press('Escape')
b = await grip(list[1].id)
await moveTo(b, { x: 950, y: 600 })
await blur()
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
list = await items()
const [one, two] = list
await page.mouse.click(one.x + one.w / 2, one.y + 12)
await page.waitForTimeout(200)
await page.keyboard.down('Alt')
await hover(two)
s = await shown()
const dx = two.x - (one.x + one.w)
const dy = two.y - (one.y + one.h)
check('something set apart both ways is measured both ways', s.says.length === 2, JSON.stringify(s))
check('across, by the gap between the facing edges', s.says.includes(dx) || s.says.includes(dx - 1) || s.says.includes(dx + 1), `${JSON.stringify(s.says)} vs ${dx}`)
check('and down, by the other one', s.says.includes(dy) || s.says.includes(dy - 1) || s.says.includes(dy + 1), `${JSON.stringify(s.says)} vs ${dy}`)
check('with a guide back to the selection for each', s.guides === 2, `${s.guides}`)
fs.writeFileSync(path.join(OUT, 'measure-both.png'), await page.screenshot())
await page.keyboard.up('Alt')

/* ---------- a press is not a measurement ---------- */
/* Pressing a card puts it in the selection, and a thing measured against
   itself measures nothing, so the overlay gets out of the way by itself. */
await page.keyboard.down('Alt')
await hover(two)
check('it is showing before the press', (await shown()).lines > 0)
await page.mouse.down()
await page.waitForTimeout(200)
s = await shown()
check('pressing what it was measuring puts it away', s.lines === 0 && s.says.length === 0, JSON.stringify(s))
await page.mouse.up()
await page.waitForTimeout(150)

/* ---------- and Alt goes on meaning a copy ---------- */
/* The two gestures share the key and must not share anything else: one is a
   hover and the other is a press. */
const was = (await items()).length
const held = await grip(two.id)
await page.mouse.move(held.x, held.y)
await page.mouse.down()
await page.mouse.move(held.x + 160, held.y + 120, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(350)
check('Alt and a drag still makes a copy', (await items()).length === was + 1, `${was} -> ${(await items()).length}`)
await page.keyboard.up('Alt')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
