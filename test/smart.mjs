/* The gaps between cards, as something to take hold of.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/smart.mjs http://localhost:4173
 *
 * Figma's smart selection, which is the best gesture on any canvas: line a
 * handful of cards up and the space between them stops being empty and becomes
 * the control. Drag it and they all open out together, with the figure under
 * the cursor.
 *
 * The half of it worth testing hardest is the refusal. Handles offered over a
 * pile would have to invent an order the cards do not have, so this suite
 * checks that a pile gets none, that one press of Tidy earns them, and that
 * pulling a single card back out of line takes them away again.
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

/* Where the cards are on screen, in reading order. */
const items = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card')]
      .map((c) => {
        const r = c.getBoundingClientRect()
        return { id: c.dataset.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
  )

/* What the overlay is offering. */
const handles = () =>
  page.evaluate(() => ({
    gaps: document.querySelectorAll('.smart-gap').length,
    rings: document.querySelectorAll('.smart-ring').length,
    across: document.querySelectorAll('.smart-gap[data-across]').length,
  }))

/* A point on a card that is the card and not a port, a ring or a handle. */
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

const drag = async (from, to, steps = 14) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.waitForTimeout(120)
  await page.mouse.up()
  await page.waitForTimeout(250)
}

/* ---------- four cards, dropped anywhere ---------- */
for (let i = 0; i < 4; i++) {
  await tool('Label').click()
  await page.waitForTimeout(250)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
}
let list = await items()
check('four cards to work with', list.length === 4, `${list.length}`)

/* Scattered, so nothing is lined up with anything by accident. */
const spread = [
  { x: 320, y: 220 },
  { x: 620, y: 360 },
  { x: 880, y: 250 },
  { x: 460, y: 540 },
]
for (let i = 0; i < 4; i++) {
  const at = await grip(list[i].id)
  await drag(at, spread[i], 8)
  list = await items()
}
await blur()
await page.keyboard.press('Escape')

/* ---------- the refusal ---------- */
await blur()
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
check('all four are selected', (await page.locator('.card[data-sel]').count()) === 4)
let h = await handles()
check('a scattered selection is offered no handles', h.gaps === 0 && h.rings === 0, JSON.stringify(h))
fs.writeFileSync(path.join(OUT, 'smart-none.png'), await page.screenshot())

/* ---------- one press earns them ---------- */
await blur()
await page.keyboard.press('Control+Alt+t')
await page.waitForTimeout(450)
list = await items()
h = await handles()
check('tidying the selection offers a handle per gap', h.gaps >= 1 && h.rings === 4, JSON.stringify(h))
/* Four cards laid out by `tidyOnto` from a scatter this wide come out as a
   row or a two by two, and either is a shape with gaps in it. */
check('and a ring on every card', h.rings === list.length, `${h.rings} vs ${list.length}`)
fs.writeFileSync(path.join(OUT, 'smart-handles.png'), await page.screenshot())

/* The gaps really are even now, which is the claim the handles rest on. */
const evenly = (l) => {
  const rows = new Map()
  for (const c of l) {
    const key = [...rows.keys()].find((k) => Math.abs(k - c.y) <= 2)
    if (key === undefined) rows.set(c.y, [c])
    else rows.get(key).push(c)
  }
  const gaps = []
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x)
    for (let i = 1; i < row.length; i++) gaps.push(row[i].x - (row[i - 1].x + row[i - 1].w))
  }
  return gaps
}
const before = evenly(list)
check('the gaps along a row are all the same', before.length > 0 && before.every((g) => Math.abs(g - before[0]) <= 2), JSON.stringify(before))

/* ---------- and they travel with the cards ---------- */
/* Nothing else redraws this overlay: the board does not re-render when a card
   moves, so without its own subscription per card the handles would be left
   behind at the old positions the moment the selection was dragged. */
const markAt = () =>
  page.evaluate(() => {
    const g = document.querySelector('.smart-gap:not([data-across])')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y) }
  })
const markWas = await markAt()
const carry = await grip(list[0].id)
await drag(carry, { x: carry.x + 90, y: carry.y + 40 }, 10)
const markNow = await markAt()
check(
  'the handles travel with the cards',
  !!markNow && !!markWas && Math.abs(markNow.x - (markWas.x + 90)) <= 3 && Math.abs(markNow.y - (markWas.y + 40)) <= 3,
  `${JSON.stringify(markWas)} -> ${JSON.stringify(markNow)}`
)
list = await items()

/* ---------- dragging a gap opens them all out ---------- */
const gapBox = await page.evaluate(() => {
  const g = [...document.querySelectorAll('.smart-gap:not([data-across])')][0]
  if (!g) return null
  const r = g.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width) }
})
check('a gap handle sits in the gap', gapBox !== null && gapBox.w > 0, JSON.stringify(gapBox))
if (gapBox) {
  await page.mouse.move(gapBox.x, gapBox.y)
  await page.mouse.down()
  await page.mouse.move(gapBox.x + 60, gapBox.y, { steps: 12 })
  await page.waitForTimeout(150)
  const said = await page.evaluate(() => document.querySelector('.smart-say')?.textContent ?? null)
  check('it says what the gap is while you drag it', said !== null && Number(said) > 20, String(said))
  fs.writeFileSync(path.join(OUT, 'smart-drag.png'), await page.screenshot())
  await page.mouse.up()
  await page.waitForTimeout(300)
}
let after = evenly(await items())
check('the gap is wider and still even', after.length === before.length && after[0] > before[0] + 30 && after.every((g) => Math.abs(g - after[0]) <= 2), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)

/* ---------- a ring swaps a card along the run ---------- */
/* What dragging a card along a row has always looked like it would do and
   never did: it used to land on top of whatever was there and leave a hole
   where it came from. */
list = await items()
const order = list.map((c) => c.id)
const ringAt = (i) =>
  page.evaluate((n) => {
    const r = [...document.querySelectorAll('.smart-ring')][n]
    if (!r) return null
    const b = r.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }, i)
/* The rings are drawn in the same order the cards are read in. */
const mine = await ringAt(0)
const theirs = { x: list[1].x + list[1].w / 2, y: list[1].y + list[1].h / 2 }
check('there is a ring to take hold of', mine !== null, JSON.stringify(mine))
if (mine) {
  await drag(mine, theirs, 12)
  const now = (await items()).map((c) => c.id)
  check(
    'dragging a ring swaps that card with the one it lands on',
    now[0] === order[1] && now[1] === order[0] && now.length === order.length,
    `${order.join(',')} -> ${now.join(',')}`
  )
  check('and nothing else in the run moved', now.slice(2).join(',') === order.slice(2).join(','))
  await blur()
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  const back = (await items()).map((c) => c.id)
  check('one undo puts the run back in its old order', back.join(',') === order.join(','), back.join(','))
}

/* ---------- and the whole drag is one step of undo ---------- */
await blur()
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
const undone = evenly(await items())
check('one undo puts the spacing back', undone.length === before.length && Math.abs(undone[0] - before[0]) <= 2, `${JSON.stringify(undone)} vs ${JSON.stringify(before)}`)

/* ---------- pulling one out of line takes them away ---------- */
await blur()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
check('the handles are back on a tidy selection', (await handles()).gaps >= 1)
list = await items()
/* On its own, because dragging one card of a selection takes the whole
   selection with it and the arrangement survives. */
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
const odd = await grip(list[list.length - 1].id)
await drag(odd, { x: odd.x + 37, y: odd.y + 83 }, 10)
await blur()
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
check('all four are selected again', (await page.locator('.card[data-sel]').count()) === 4)
h = await handles()
check('one card out of line and the handles go', h.gaps === 0 && h.rings === 0, JSON.stringify(h))
fs.writeFileSync(path.join(OUT, 'smart-gone.png'), await page.screenshot())

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
