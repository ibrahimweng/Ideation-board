/* Two shapes into one.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/boolean.mjs http://localhost:4173
 *
 * Union, subtract, intersect and exclude. The arithmetic is checked in
 * test/unit/boolean.test.ts, where the areas can be written down. This is
 * about what only a real board can answer: that the menu and the keys reach
 * it, that the card that comes out is one card where two were, that a hole is
 * really a hole rather than a ring painted over, and that the whole thing is
 * one step of undo.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:4173'
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
await page.waitForTimeout(1400)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

const rail = () => page.locator('.rail')
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

/* Every drawing on the board, as the record has it. */
const shapes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card[data-kind="shape"]')].map((el) => {
      const p = el.querySelector('svg path:not(.shape-hit)')
      const r = el.getBoundingClientRect()
      return {
        id: el.dataset.id,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        d: p?.getAttribute('d') || '',
        rule: p?.getAttribute('fill-rule') || null,
        rings: (p?.getAttribute('d') || '').split('M').length - 1,
      }
    })
  )

/* Pick a tool. The rail holds one of each group and the rest are behind the
   corner mark, so a tool that is not showing is walked to. Scoped to the rail,
   because the panel names itself after the shape it is working on and a tab
   called Rectangle is not the rectangle tool. */
const tool = async (name, group = 'Shapes') => {
  if (await rail().getByRole('button', { name, exact: true }).count()) {
    await rail().getByRole('button', { name, exact: true }).click()
  } else {
    await rail().getByRole('button', { name: group, exact: true }).click()
    await page.waitForTimeout(220)
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  await page.waitForTimeout(250)
}

/* Draw one, from a to b. */
const draw = async (name, x0, y0, x1, y1) => {
  await tool(name)
  await page.waitForTimeout(220)
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x1, y1, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}

const both = async () => {
  await blur()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(250)
}

/* ---------- two overlapping rectangles ---------- */
await draw('Rectangle', 400, 260, 640, 460)
await draw('Rectangle', 520, 340, 760, 540)
let list = await shapes()
check('two drawings to work on', list.length === 2, `${list.length}`)
const spread = {
  x: Math.min(...list.map((s) => s.x)),
  y: Math.min(...list.map((s) => s.y)),
  r: Math.max(...list.map((s) => s.x + s.w)),
  b: Math.max(...list.map((s) => s.y + s.h)),
}

/* ---------- unite ---------- */
await both()
await page.keyboard.press('Control+Alt+u')
await page.waitForTimeout(500)
list = await shapes()
check('two united into one card', list.length === 1, `${list.length}`)
check(
  'the box round it is the box round both of them',
  Math.abs(list[0].x - spread.x) <= 2 && Math.abs(list[0].x + list[0].w - spread.r) <= 2 &&
    Math.abs(list[0].y - spread.y) <= 2 && Math.abs(list[0].y + list[0].h - spread.b) <= 2,
  `${JSON.stringify(list[0])} vs ${JSON.stringify(spread)}`
)
check('it is one ring, since they overlapped', list[0].rings === 1, `${list[0].rings} rings`)
/* Two rectangles overlapping corner to corner make a staircase: eight
   corners, and the run of lines closes back onto the first of them. */
check('and the outline is the staircase the two of them make',
      (list[0].d.match(/L/g) || []).length === 8 && list[0].d.endsWith('Z'), list[0].d)
fs.writeFileSync(path.join(OUT, 'boolean-union.png'), await page.screenshot())

/* ---------- one step of undo ---------- */
await blur()
await page.keyboard.press('Control+z')
await page.waitForTimeout(450)
list = await shapes()
check('one undo brings both of them back', list.length === 2, `${list.length}`)

/* ---------- subtract, which is about an order ---------- */
await both()
await page.keyboard.press('Control+Alt+s')
await page.waitForTimeout(500)
list = await shapes()
check('subtract leaves one card', list.length === 1, `${list.length}`)
check(
  'and it is the first one with the second taken out of it',
  Math.abs(list[0].x - spread.x) <= 2 && list[0].x + list[0].w < spread.r - 10,
  `${JSON.stringify(list[0])} vs ${JSON.stringify(spread)}`
)
fs.writeFileSync(path.join(OUT, 'boolean-subtract.png'), await page.screenshot())
await blur()
await page.keyboard.press('Control+z')
await page.waitForTimeout(450)

/* ---------- a hole is really a hole ---------- */
/* A circle wholly inside a square: what comes out has two rings, and the one
   inside has to be a hole rather than a ring painted over the top. */
await both()
await page.keyboard.press('Delete')
await page.waitForTimeout(350)
await draw('Rectangle', 400, 250, 700, 550)
await draw('Ellipse', 480, 330, 620, 470)
await both()
await page.keyboard.press('Control+Alt+s')
await page.waitForTimeout(600)
list = await shapes()
check('a circle taken out of a square leaves one card', list.length === 1, `${list.length}`)
check('made of two rings', list[0]?.rings === 2, `${list[0]?.rings} rings`)
check('painted even odd, which is what makes the inner one a hole', list[0]?.rule === 'evenodd', `${list[0]?.rule}`)
/* And the proof: the middle of the card is see-through. A press there goes to
   the board and takes the selection away rather than landing on the shape. */
await page.mouse.click(list[0].x + list[0].w / 2, list[0].y + list[0].h / 2)
await page.waitForTimeout(300)
check('and you can press straight through the hole', (await page.locator('.card[data-sel]').count()) === 0)
fs.writeFileSync(path.join(OUT, 'boolean-hole.png'), await page.screenshot())

/* ---------- the menu reaches all four ---------- */
/* Something to combine it with: what the hole test left is one card, and one
   card is exactly the case the row is supposed to stand down for. */
await draw('Rectangle', 780, 300, 900, 420)
await both()
list = await shapes()
/* Well inside it: the corner of a selected card carries a scale handle, and
   a right click that lands on one of those is a right click on the overlay. */
await page.mouse.click(list[0].x + list[0].w * 0.2, list[0].y + list[0].h * 0.2, { button: 'right' })
await page.waitForTimeout(350)
const named = await page.evaluate(() => ({
  menus: document.querySelectorAll('.menu').length,
  wide: document.querySelectorAll('.menu-wide').length,
  words: [...document.querySelectorAll('.menu-wide button')].map((b) => b.textContent.trim()),
}))
check('the menu offers all four of them',
      JSON.stringify(named.words) === JSON.stringify(['Unite', 'Subtract', 'Intersect', 'Exclude']),
      JSON.stringify(named))
fs.writeFileSync(path.join(OUT, 'boolean-menu.png'), await page.screenshot())
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

/* ---------- and it only offers them when there is something to combine ---- */
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
list = await shapes()
await page.mouse.click(list[0].x + list[0].w * 0.2, list[0].y + list[0].h * 0.2)
await page.waitForTimeout(200)
/* Well inside it: the corner of a selected card carries a scale handle, and
   a right click that lands on one of those is a right click on the overlay. */
await page.mouse.click(list[0].x + list[0].w * 0.2, list[0].y + list[0].h * 0.2, { button: 'right' })
await page.waitForTimeout(350)
check('one drawing on its own gets no Combine row', (await page.locator('.menu-wide').count()) === 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
