/* An effect must not change the shape of what it is applied to.
 *
 *   npm run dev &
 *   node test/aspect.mjs http://localhost:5173
 *
 * An uneffected card crops its picture to fill, through object-fit. The
 * renderer used to map the whole picture onto a card-shaped quad instead, so
 * turning an effect on squashed anything whose card was not the shape of its
 * picture. The check is geometric: a circle in the source has to still be a
 * circle on the card, and the effected card has to frame it exactly as the
 * plain one did.
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

/* A wide picture with a true circle in the middle, small enough to survive
 * being cropped either way. */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 600
  c.height = 300
  const x = c.getContext('2d')
  x.fillStyle = '#ffffff'
  x.fillRect(0, 0, 600, 300)
  x.fillStyle = '#e5251f'
  x.beginPath()
  x.arc(300, 150, 55, 0, Math.PI * 2)
  x.fill()
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'circle.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)

/* The red circle's bounding box, measured on a picture of the card. Reading
 * the canvas instead would measure the bitmap the renderer produced, not what
 * the browser then does with it, and both have been wrong here. */
const measure = async (sel) => {
  const el = page.locator(sel).first()
  if (!(await el.count())) return null
  const shot = await el.screenshot()
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const s = document.createElement('canvas')
    s.width = img.width
    s.height = img.height
    const x = s.getContext('2d')
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, s.width, s.height).data
    let x0 = s.width
    let x1 = -1
    let y0 = s.height
    let y1 = -1
    for (let py = 0; py < s.height; py++) {
      for (let px = 0; px < s.width; px++) {
        const i = (py * s.width + px) * 4
        if (d[i] > 140 && d[i + 1] < 120 && d[i + 2] < 120) {
          if (px < x0) x0 = px
          if (px > x1) x1 = px
          if (py < y0) y0 = py
          if (py > y1) y1 = py
        }
      }
    }
    if (x1 < 0) return null
    return { w: x1 - x0 + 1, h: y1 - y0 + 1, box: { w: s.width, h: s.height } }
  }, shot.toString('base64'))
}

const round = (n) => Math.round(n * 100) / 100

/* ---------- a card taller than its picture ---------- */
const card = page.locator('.card[data-kind="image"]').first()
await card.click({ position: { x: 60, y: 10 } })
await page.waitForTimeout(300)
const box = await card.boundingBox()
await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3)
await page.mouse.down()
await page.mouse.move(box.x + 240, box.y + 470, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(600)
const tall = await card.boundingBox()
check(
  'the card is taller than the picture is shaped',
  tall.height > tall.width * 1.4,
  `${Math.round(tall.width)}x${Math.round(tall.height)}`
)

const plainTall = await measure('.card[data-kind="image"] .card-body')
check('the plain card draws a circle', plainTall && Math.abs(plainTall.w / plainTall.h - 1) < 0.08, JSON.stringify(plainTall))

/* Posterize keeps edges sharp and colours where they were, so what is measured
 * is the geometry and not the effect's own softening. */
await page.locator('.fx-thumb[title="Posterize"]').click()
await page.waitForTimeout(1800)
const fxTall = await measure('.card[data-kind="image"] .card-body')
check('an effect keeps it a circle', fxTall && Math.abs(fxTall.w / fxTall.h - 1) < 0.1, JSON.stringify(fxTall))
check(
  'and frames it exactly as the plain card did',
  fxTall && plainTall && Math.abs(fxTall.h / plainTall.h - 1) < 0.06,
  fxTall && plainTall ? `${fxTall.h} vs ${plainTall.h}` : 'missing'
)
fs.writeFileSync(path.join(OUT, 'aspect-tall.png'), await card.screenshot())

/* ---------- and one wider than its picture ---------- */
const before = await card.boundingBox()
await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3)
await page.mouse.down()
await page.mouse.move(before.x + 640, before.y + 200, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(1800)
const wide = await card.boundingBox()
check(
  'the card is now wider than the picture is shaped',
  wide.width > wide.height * 1.8,
  `${Math.round(wide.width)}x${Math.round(wide.height)}`
)
const fxWide = await measure('.card[data-kind="image"] .card-body')
check('still a circle on a wide card', fxWide && Math.abs(fxWide.w / fxWide.h - 1) < 0.1, JSON.stringify(fxWide))
fs.writeFileSync(path.join(OUT, 'aspect-wide.png'), await card.screenshot())

/* ---------- a second effect, and one that blurs first ---------- */
await page.locator('.fx-thumb[title="Pixelate"]').click()
await page.waitForTimeout(1800)
const pixel = await measure('.card[data-kind="image"] .card-body')
check('an effect with a blur behind it too', pixel && Math.abs(pixel.w / pixel.h - 1) < 0.18, JSON.stringify(pixel))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
console.log('ratios:', JSON.stringify({ plainTall: plainTall && round(plainTall.w / plainTall.h), fxTall: fxTall && round(fxTall.w / fxTall.h), fxWide: fxWide && round(fxWide.w / fxWide.h) }))
await browser.close()
process.exit(fail ? 1 : 0)
