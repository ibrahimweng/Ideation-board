/* Dragging a number's name to change it.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/scrub.mjs http://localhost:4173
 *
 * Every figure in every panel has a name written beside it and until now that
 * name was decoration. The arithmetic — what a pixel is worth, what shift and
 * alt do to it — is checked in test/unit/scrub.test.ts. This is about the two
 * things only a real panel can answer: that dragging a name actually changes
 * the card, and that the whole drag is one step of undo rather than one step
 * per pixel.
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
const opacity = () =>
  page.evaluate(() => {
    const el = document.querySelector('.card[data-kind="shape"]')
    return el ? Number(getComputedStyle(el).opacity) : null
  })

const card = () =>
  page.evaluate(() => {
    const el = document.querySelector('.card[data-kind="shape"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })

/* Drag a word sideways, the way a person would.
 *
 * Brought into view first: the panel is taller than the window and a press at
 * a point below the fold is a press the page never hears about. */
const scrub = async (word, by, keys = {}) => {
  await word.scrollIntoViewIfNeeded()
  const box = await word.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (keys.shift) await page.keyboard.down('Shift')
  await page.mouse.move(x, y)
  await page.mouse.down()
  /* In steps, because a scrub is a stream of pointer moves and one jump would
     not tell us whether the thing follows the pointer or only its end. */
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (by * i) / 10, y)
  await page.mouse.up()
  if (keys.shift) await page.keyboard.up('Shift')
  await page.waitForTimeout(250)
}

/* ---------- a rectangle, and its width ---------- */
await rail().getByRole('button', { name: 'Rectangle', exact: true }).click()
await page.waitForTimeout(250)
await page.mouse.move(500, 300)
await page.mouse.down()
await page.mouse.move(740, 460, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(500)
let shape = await card()
check('a rectangle to work on', shape !== null && shape.w > 100, JSON.stringify(shape))

/* The panel opens on the shape it drew. */
const wLabel = page.locator('.shape-num', { hasText: /^W$/ }).locator('span.scrub')
check('its width has a name that can be taken hold of', (await wLabel.count()) === 1, `${await wLabel.count()}`)

const before = shape.w
await scrub(wLabel, 60)
shape = await card()
check('dragging the name widens the card', shape?.w === before + 60, `${before} -> ${shape?.w}`)

/* ---------- one drag, one undo ---------- */
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)
shape = await card()
check('and one undo puts the whole drag back', shape?.w === before, `${shape?.w} vs ${before}`)

/* ---------- a press that never moved is a click ---------- */
await wLabel.scrollIntoViewIfNeeded()
const box = await wLabel.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(250)
shape = await card()
check('clicking the name changes nothing', shape?.w === before, `${shape?.w} vs ${before}`)

/* And a click that wobbled by a pixel on the way, which is what a real one
   does: without a threshold the wobble would be a change nobody asked for. */
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2)
await page.mouse.up()
await page.waitForTimeout(250)
shape = await card()
check('nor does a click that wobbled a pixel', shape?.w === before, `${shape?.w} vs ${before}`)

/* ---------- shift moves ten times as far ---------- */
await scrub(wLabel, 12, { shift: true })
shape = await card()
check('shift moves it ten times as far', shape?.w === before + 120, `${before} -> ${shape?.w}`)
fs.writeFileSync(path.join(OUT, 'scrub-shape.png'), await page.screenshot())
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Control+z')
await page.waitForTimeout(400)

/* ---------- and the same on a slider ---------- */
/* Every slider in the app is the one component, so proving it on one proves
   it on the eighty in the effects panel too. Opacity starts at its maximum,
   so this one goes the other way. */
const op = page.locator('.ctl', { hasText: /^Opacity/ }).locator('label.scrub')
check('a slider has one too', (await op.count()) === 1, `${await op.count()}`)
if (await op.count()) {
  const read = () => page.locator('.ctl', { hasText: /^Opacity/ }).locator('input.ctl-num').inputValue()
  const was = parseFloat(await read())
  await scrub(op, -25)
  const now = parseFloat(await read())
  check('dragging its name moves the figure', now === was - 25, `${was} -> ${now}`)
  fs.writeFileSync(path.join(OUT, 'scrub-slider.png'), await page.screenshot())
  check('and it moved the card with it', (await opacity()) < 1, `${await opacity()}`)
}

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
