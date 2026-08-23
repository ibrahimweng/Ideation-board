/* Lining cards up.
 *
 *   npm run dev &
 *   node test/arrange.mjs http://localhost:5173
 *
 * Three ways to tidy a board: dragging a card pulls it onto the edges and
 * middles of the ones around it and says so with a guide; the right click menu
 * lines up and evenly spaces a selection; and "Tidy up" lays it out on a grid.
 * All of them are one step of undo.
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

/* The toolbar is icons, so a button is found by the name it carries for
 * anything reading the page rather than by the words printed on it. */
const tool = (t) => page.locator(`.tools button[aria-label="${t}"]`).first()
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

/* Positions as the board holds them, not as the screen shows them. */
const items = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card')].map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
  )
/* Any card in the selection that can actually be right clicked. Once cards
 * have been lined up they overlap, and a card can end up with no point of its
 * own left to aim at. */
const anyGrip = async () => {
  for (const c of await items()) {
    const at = await grip(c.id)
    if (at) return at
  }
  return null
}

const grip = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    if (!card) return null
    const r = card.getBoundingClientRect()
    for (let dx = 12; dx < r.width - 12; dx += 10) {
      const x = r.x + dx
      const y = r.y + 10
      if (document.elementFromPoint(x, y)?.closest('.card') === card) return { x, y }
    }
    return null
  }, id)

/* Four labels: small, cheap to place, and their boxes are their content. */
for (let i = 0; i < 4; i++) {
  await tool('Label').click()
  await page.waitForTimeout(250)
}
let list = await items()
check('four cards to work with', list.length === 4, `${list.length}`)

/* Spread them out so nothing starts lined up with anything. */
const spread = [
  { x: 300, y: 200 },
  { x: 560, y: 330 },
  { x: 830, y: 260 },
  { x: 420, y: 520 },
]
for (let i = 0; i < 4; i++) {
  const at = await grip(list[i].id)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(spread[i].x, spread[i].y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  list = await items()
}
await blur()
await page.keyboard.press('Escape')

/* ---------- snapping to a neighbour ---------- */
list = await items()
const target = list[0]
const mover = list[1]
const from = await grip(mover.id)
/* Aim four pixels off the target's left edge: near enough to be pulled on. */
await page.mouse.move(from.x, from.y)
await page.mouse.down()
const grabDx = from.x - mover.x
await page.mouse.move(target.x + grabDx + 4, from.y + 120, { steps: 12 })
await page.waitForTimeout(150)
const guide = await page.evaluate(() => {
  const v = document.querySelector('.guide-v')
  return v ? { shown: getComputedStyle(v).display !== 'none', left: v.style.left, height: v.style.height } : null
})
check('a guide appears when an edge lines up', guide?.shown === true, JSON.stringify(guide))
fs.writeFileSync(path.join(OUT, 'arrange-guide.png'), await page.screenshot())
await page.mouse.up()
await page.waitForTimeout(300)
list = await items()
const snapped = list.find((c) => c.id === mover.id)
const anchor = list.find((c) => c.id === target.id)
check('and the card is pulled exactly onto it', snapped.x === anchor.x, `${snapped.x} vs ${anchor.x}`)
check('the guide goes when the drag ends', await page.evaluate(() => getComputedStyle(document.querySelector('.guide-v')).display === 'none'))

/* ---------- align from the menu ---------- */
await blur()
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
const menuAt = await anyGrip()
await page.mouse.click(menuAt.x, menuAt.y, { button: 'right' })
await page.waitForTimeout(300)
check('the menu offers alignment for a selection', (await page.locator('.menu-arrange').count()) === 2)

await page.locator('.menu-arrange button[title="Tops"]').click()
await page.waitForTimeout(400)
list = await items()
const tops = new Set(list.map((c) => c.y))
check('aligning tops puts them on one line', tops.size === 1, [...tops].join(','))

await blur()
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
check('and one undo puts them all back', new Set((await items()).map((c) => c.y)).size > 1)

/* ---------- spacing evenly ---------- */
await page.keyboard.press('Control+Shift+Z')
await page.waitForTimeout(400)
/* Widen what they sit in first, or spacing four cards evenly inside a span
 * narrower than they are makes the gaps negative and the check meaningless. */
await page.keyboard.press('Escape')
list = (await items()).sort((a, b) => a.x - b.x)
const far = await grip(list[list.length - 1].id)
await page.mouse.move(far.x, far.y)
await page.mouse.down()
await page.mouse.move(far.x + 420, far.y, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
const beforeSpace = (await items()).sort((a, b) => a.x - b.x)
await blur()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
const g2 = await anyGrip()
await page.mouse.click(g2.x, g2.y, { button: 'right' })
await page.waitForTimeout(300)
await page.locator('.menu-arrange button[title="Across"]').click()
await page.waitForTimeout(400)
list = (await items()).sort((a, b) => a.x - b.x)
const gaps = list.slice(1).map((c, i) => c.x - (list[i].x + list[i].w))
const even = gaps.every((g) => Math.abs(g - gaps[0]) <= 1)
check('spacing evenly leaves equal gaps', even && gaps[0] > 0, gaps.join(', '))
check(
  'and leaves the outermost two where they were',
  list[0].x === beforeSpace[0].x && list[list.length - 1].x === beforeSpace[beforeSpace.length - 1].x,
  `${list[0].x}/${beforeSpace[0].x} and ${list[list.length - 1].x}/${beforeSpace[beforeSpace.length - 1].x}`
)

/* ---------- tidy up ---------- */
await blur()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
const g3 = await anyGrip()
await page.mouse.click(g3.x, g3.y, { button: 'right' })
await page.waitForTimeout(300)
await page.locator('.menu button', { hasText: 'Tidy up' }).click()
await page.waitForTimeout(400)
list = await items()
const xs = [...new Set(list.map((c) => c.x))].sort((a, b) => a - b)
const ys = [...new Set(list.map((c) => c.y))].sort((a, b) => a - b)
check('tidying puts them on a grid', xs.length * ys.length >= list.length, `${xs.length} columns, ${ys.length} rows`)
const colGap = xs.length > 1 ? xs[1] - xs[0] : 0
const evenCols = xs.slice(1).every((x, i) => Math.abs(x - xs[i] - colGap) <= 1)
check('with the columns evenly spaced', evenCols, xs.join(', '))
fs.writeFileSync(path.join(OUT, 'arrange-tidy.png'), await page.screenshot())

await blur()
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
check('tidying is one step of undo', JSON.stringify((await items()).map((c) => c.x)) !== JSON.stringify(list.map((c) => c.x)))

/* ---------- shift still means the grid ---------- */
await page.keyboard.press('Escape')
list = await items()
const gridder = list[0]
const at = await grip(gridder.id)
await page.mouse.move(at.x, at.y)
await page.mouse.down()
await page.keyboard.down('Shift')
await page.mouse.move(at.x + 137, at.y + 91, { steps: 10 })
const noGuide = await page.evaluate(() => getComputedStyle(document.querySelector('.guide-v')).display === 'none')
await page.mouse.up()
await page.keyboard.up('Shift')
await page.waitForTimeout(300)
check('holding shift asks for the grid instead', noGuide)
const moved = (await items()).find((c) => c.id === gridder.id)
check('which lands on a multiple of eight', moved.x % 8 === gridder.x % 8, `${gridder.x} -> ${moved.x}`)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
