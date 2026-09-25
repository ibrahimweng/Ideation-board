/* Showing the board, and reading the colours out of a picture.
 *
 *   npm run dev &
 *   node test/present.mjs http://localhost:5173
 *
 * Two things a board could not do. It could be worked on but not shown, so
 * showing it meant sharing a screen with a toolbar, a panel and eleven other
 * cards around the one being talked about. And half of what a moodboard is
 * about is colour, which was locked inside the photographs: you could look at
 * it but not write it down or put it beside the colour from another picture.
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
await page.waitForTimeout(1200)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

/* A picture with five colours in it that can be named in advance: a blue end,
 * a beige middle, a rust end, a green rectangle and a yellow disc. */
const drop = (at) =>
  page.evaluate(async (at) => {
    const c = document.createElement('canvas')
    c.width = 900
    c.height = 600
    const x = c.getContext('2d')
    const g = x.createLinearGradient(0, 0, 900, 0)
    g.addColorStop(0, '#1c3f5e')
    g.addColorStop(0.5, '#e8ddc4')
    g.addColorStop(1, '#8a3b2a')
    x.fillStyle = g
    x.fillRect(0, 0, 900, 600)
    x.fillStyle = '#1c8f5e'
    x.fillRect(60, 60, 180, 140)
    x.fillStyle = '#f2c14e'
    x.beginPath()
    x.arc(700, 180, 80, 0, Math.PI * 2)
    x.fill()
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], `scene-${at.x}.png`, { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, at)

const cardAt = (kind) =>
  page.evaluate((k) => {
    const c = document.querySelector(`.card[data-kind="${k}"]`)
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.x + 60), y: Math.round(r.y + 20), id: c.dataset.id }
  }, kind)

await drop({ x: 260, y: 150 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1400)

/* ---------- the colours out of a picture ---------- */
const at = await cardAt('image')
await page.mouse.click(at.x, at.y)
await page.waitForTimeout(400)
await page.mouse.click(at.x, at.y, { button: 'right' })
await page.waitForTimeout(400)
const pull = page.locator('.menu button', { hasText: 'Pull the colours out' })
check('a picture offers its colours', (await pull.count()) === 1)
await pull.click()
await page.waitForTimeout(1800)

const swatches = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="note"]')].map((c) => {
    const n = c.querySelector('.note')
    const r = c.getBoundingClientRect()
    return { paper: n.style.background, ink: n.style.color, text: n.textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }
  })
)
check('five swatches come out', swatches.length === 5, `${swatches.length}`)
check('each one says its own hex', swatches.every((s) => /^#[0-9A-F]{6}$/.test(s.text)), swatches.map((s) => s.text).join(' '))

/* The colours themselves: the five put into the picture should be among them,
 * within the slack of averaging a bucket of near neighbours. */
const rgb = (css) => (css.match(/\d+/g) || []).slice(0, 3).map(Number)
const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol
const got = swatches.map((s) => rgb(s.paper))
for (const [name, want] of [['the green rectangle', [28, 143, 94]], ['the yellow disc', [242, 193, 78]], ['the blue end', [28, 63, 94]], ['the rust end', [138, 59, 42]]]) {
  check(`it found ${name}`, got.some((g) => near(g, want, 60)), got.map((g) => g.join(',')).join(' | '))
}
check('no two of them are the same colour', new Set(swatches.map((s) => s.paper)).size === 5)

/* Dark paper takes light ink and pale paper takes dark: a swatch you cannot
 * read the hex off is not a swatch. */
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
check(
  'the writing is legible on every one of them',
  swatches.every((s) => {
    const l = lum(rgb(s.paper))
    const i = lum(rgb(s.ink))
    return Math.abs(l - i) > 0.4
  }),
  swatches.map((s) => `${lum(rgb(s.paper)).toFixed(2)}/${lum(rgb(s.ink)).toFixed(2)}`).join(' ')
)

const row = swatches.map((s) => s.y)
check('they arrive in a row under the picture', new Set(row).size === 1, `${new Set(row).size} rows`)

await page.keyboard.press('Control+z')
await page.waitForTimeout(700)
check('and the lot is one step of undo', (await page.locator('.card[data-kind="note"]').count()) === 0)

/* ---------- showing the board ---------- */
await drop({ x: 760, y: 150 })
await page.waitForTimeout(1400)
await page.keyboard.press('Escape')
await page.evaluate(() => document.activeElement?.blur?.())
await page.waitForTimeout(300)
const cards = await page.locator('.card').count()

await page.keyboard.press('p')
await page.waitForTimeout(1200)
check('P shows the board', (await page.locator('.present').count()) === 1)
check('one thing at a time, and it says which', (await page.locator('.present-count').innerText()) === `1 / ${cards}`, `${await page.locator('.present-count').innerText()} of ${cards} cards`)
check('with nothing else on screen', (await page.locator('.topbar').isVisible()) === true && (await page.evaluate(() => {
  const p = document.querySelector('.present').getBoundingClientRect()
  return Math.round(p.width) === window.innerWidth && Math.round(p.height) === window.innerHeight
})))
fs.writeFileSync(path.join(OUT, 'present.png'), await page.screenshot())

const shown = () => page.locator('.present-count').innerText()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(500)
check('the arrows move through it', (await shown()) === `2 / ${cards}`, await shown())
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(400)
check('and back', (await shown()) === `1 / ${cards}`, await shown())
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(400)
check('the first one is where it stops going back', (await shown()) === `1 / ${cards}`, await shown())

/* Reading order, not the order they were made in: the left picture is first
 * because the two sit side by side. */
const first = await page.locator('.present-name').innerText()
check('the order is the one on the board', first.includes('260'), first)

await page.keyboard.press('Escape')
await page.waitForTimeout(600)
check('Escape leaves it', (await page.locator('.present').count()) === 0)

/* ---------- a developed card presents as itself ----------
 *
 * Presenting gates on whether the card is wearing anything, and a developed
 * photograph counts: developing is the treatment on every card that has no
 * effect on it at all. The gate learned that and the canvas it puts up did
 * not — it was handed the first effect and nothing else — so a card developed
 * two stops came up on the wall as the file, which is the one place anybody
 * would notice and the last place they could do anything about it.
 */
await page.keyboard.press('Escape')
await page.evaluate(() => document.activeElement?.blur?.())
await page.waitForTimeout(300)
const devCard = await cardAt('image')
await page.mouse.click(devCard.x, devCard.y)
await page.waitForTimeout(500)
await page.locator('.panel-tabs button', { hasText: 'Develop' }).first().click()
await page.waitForTimeout(400)
const expBox = page.locator('.develop .ctl', { hasText: /^Exposure/ }).locator('input.ctl-num').first()
await expBox.scrollIntoViewIfNeeded()
await expBox.fill('-2.5')
await expBox.press('Enter')
await page.waitForTimeout(1000)

/* Off the board first, so what is compared is the same picture drawn twice
   rather than a card against a slide. */
const onBoard = await page.evaluate((id) => {
  const card = document.querySelector(`.card[data-id="${id}"]`)
  const el = card?.querySelector('canvas.media') || card?.querySelector('img.media')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(r.width))
  c.height = Math.max(1, Math.round(r.height))
  const g = c.getContext('2d', { willReadFrequently: true })
  try { g.drawImage(el, 0, 0, c.width, c.height) } catch { return null }
  const d = g.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.5), 1, 1).data
  return [d[0], d[1], d[2]]
}, devCard.id)
/* Down rather than up, so the figure lands in the middle of the range instead
   of clipping at white, where an undeveloped picture and a developed one would
   read the same. */
check('setup: two and a half stops down shows on the card', onBoard && onBoard[0] < 150, JSON.stringify(onBoard))

await page.keyboard.press('Escape')
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('p')
await page.waitForTimeout(1400)
check('the board presents', (await page.locator('.present').count()) === 1)
const onWall = await page.evaluate(() => {
  const el = document.querySelector('.present-media')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(r.width))
  c.height = Math.max(1, Math.round(r.height))
  const g = c.getContext('2d', { willReadFrequently: true })
  try { g.drawImage(el, 0, 0, c.width, c.height) } catch { return null }
  const d = g.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.5), 1, 1).data
  return { px: [d[0], d[1], d[2]], tag: el.tagName }
})
check('and the developed card is developed on the wall too',
      onWall && Math.abs(onWall.px[0] - onBoard[0]) <= 8,
      onWall ? `${JSON.stringify(onWall.px)} on a ${onWall.tag} against ${JSON.stringify(onBoard)}` : 'nothing shown')
fs.writeFileSync(path.join(OUT, 'present-developed.png'), await page.screenshot())
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
/* And off again, so the checks below read the board they were written for. */
await page.mouse.click(devCard.x, devCard.y)
await page.waitForTimeout(400)
await page.locator('.panel-tabs button', { hasText: 'Develop' }).first().click()
await page.waitForTimeout(300)
await page.locator('.develop button', { hasText: 'Undevelop' }).first().click()
await page.waitForTimeout(700)
await page.keyboard.press('Escape')
await page.evaluate(() => document.activeElement?.blur?.())
await page.waitForTimeout(300)

/* A selection of more than one shows only those. */
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Escape')
const one = await cardAt('image')
await page.mouse.click(one.x, one.y)
await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('p')
await page.waitForTimeout(1000)
check('one card selected still shows the whole board', (await page.locator('.present-count').innerText()) === `1 / ${cards}`, await page.locator('.present-count').innerText())
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

/* A third card, so "just the selection" is a smaller number than "the whole
 * board" and the check can tell them apart. */
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Escape')
await page.keyboard.press('n')
await page.waitForTimeout(600)
await page.keyboard.press('Escape')
await page.evaluate(() => document.activeElement?.blur?.())
const now = await page.locator('.card').count()
check('three things on the board', now === cards + 1, `${now}`)

const spots = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="image"]')].map((c) => {
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.x + 60), y: Math.round(r.y + 20) }
  })
)
await page.mouse.click(spots[0].x, spots[0].y)
await page.waitForTimeout(250)
await page.keyboard.down('Shift')
await page.mouse.click(spots[1].x, spots[1].y)
await page.keyboard.up('Shift')
await page.waitForTimeout(400)
check('two of the three are selected', (await page.locator('.card[data-sel]').count()) === 2)
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('p')
await page.waitForTimeout(1000)
const selCount = await page.locator('.present-count').innerText()
check('a selection of several shows just those', selCount === '1 / 2', `${selCount}, board has ${now}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

check('no page errors', errors.length === 0, errors.join(' | '))
/* ---------- a narrowed board presents what it narrowed to ---------- */
/* The other half of the search box. Showing all thirty cards after being
   asked to show four was the reason marking a board up went nowhere. */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const everything = await page.locator('.card').count()
await page.locator('.search input').fill('note')
await page.waitForTimeout(600)
const litHere = await page.locator('.card:not([data-dim])').count()
await page.evaluate(() => document.activeElement.blur())
await page.keyboard.press('p')
await page.waitForTimeout(800)
const narrowedCount = await page.locator('.present-count').innerText().catch(() => 'not open')
check('a narrowed board presents only what it narrowed to',
  narrowedCount === `1 / ${litHere}` && litHere < everything,
  `${narrowedCount} with ${litHere} of ${everything} lit`)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.locator('.search input').fill('')
await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement.blur())
await page.keyboard.press('p')
await page.waitForTimeout(800)
check('and clearing the search brings the whole board back',
  (await page.locator('.present-count').innerText().catch(() => '')) === `1 / ${everything}`,
  await page.locator('.present-count').innerText().catch(() => 'not open'))
await page.keyboard.press('Escape')
await page.waitForTimeout(400)


console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
