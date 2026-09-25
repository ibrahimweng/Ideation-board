/* A depth range, on a card that is not the shape of its map.
 *
 *   npm run build && npm run test:browser -- depthmask
 *   node test/depthmask.mjs http://localhost:4173
 *
 * A mask can say "everything this far away", and it answers by reading the
 * depth map wired into the card. The photograph is read cropped to fill the
 * card, the way an untreated card is; the map has to be read the same way and
 * with its own crop, because the map is a different card and need not be the
 * same shape. Read at the photograph's own coordinates it gave the right
 * distances for the wrong part of the frame the moment the two aspects
 * disagreed — which they do as soon as anybody wires a square map into a wide
 * photograph, and the mask then landed somewhere nobody asked for.
 *
 * So the fixture is deliberately mismatched: a two-to-one photograph and a
 * square map whose distance runs top to bottom. Cropped to fill a wide card,
 * only the middle half of that gradient is on screen — so the nearest quarter
 * of the map is off the card entirely, and a range asking for it must find
 * nothing at all. Read raw it finds the top of the card, which is the bug,
 * stated as a number.
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  const t = m.text()
  if (/shader|GL_|WebGL|program/i.test(t) && m.type() === 'error') errors.push('console: ' + t)
})

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

const drop = (w, h, draw, name, at) =>
  page.evaluate(
    async ({ w, h, draw, name, at }) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const x = c.getContext('2d')
      new Function('x', 'w', 'h', draw)(x, w, h)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], name, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { w, h, draw, name, at }
  )

/* Flat grey, so a masked edit shows up as one number rather than as a feeling.
   Twice as wide as it is tall, which is the whole point of the fixture. */
const WIDE = `x.fillStyle='rgb(128,128,128)';x.fillRect(0,0,w,h);`

/* A square map, black at the top and white at the bottom. Cropped into a
   two-to-one card it loses its top and bottom quarters, so what is on the card
   runs from a quarter to three quarters and never reaches either end. */
const RAMP = `
for(let yy=0;yy<h;yy++){
  const v=Math.round((yy/(h-1))*255);
  x.fillStyle='rgb('+v+','+v+','+v+')';x.fillRect(0,yy,w,1);
}
`

await drop(1200, 600, WIDE, 'wide.png', { x: 520, y: 430 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(1500)
await drop(600, 600, RAMP, 'ramp.png', { x: 1180, y: 430 })
await page.waitForTimeout(1800)

const placed = await page.evaluate(() =>
  [...document.querySelectorAll('.card')]
    .map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height }
    })
    .sort((a, b) => b.w / b.h - a.w / a.h)
)
check('setup: a wide photograph and a square map', placed.length === 2, placed.map((c) => c.id).join(', '))
const PIC = placed[0]
const MAP = placed[1]
check('and the two really are different shapes',
      PIC && MAP && PIC.w / PIC.h > 1.7 && Math.abs(MAP.w / MAP.h - 1) < 0.1,
      PIC && MAP ? `${(PIC.w / PIC.h).toFixed(2)} and ${(MAP.w / MAP.h).toFixed(2)}` : 'missing')

/* ---------- wire the map into the picture ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.mouse.move(MAP.x + MAP.w / 2, MAP.y + MAP.h / 2)
await page.waitForTimeout(500)
/* The ports are a layer beside the card rather than inside it, so the one that
   belongs to this card is found by where it is. */
const port = await page.evaluate((box) => {
  for (const p of document.querySelectorAll('.port-w')) {
    const r = p.getBoundingClientRect()
    if (!r.width) continue
    if (Math.abs(r.left + 10 - box.x) < 40 && r.top > box.y - 20 && r.top < box.y + box.h + 20) return r.toJSON()
  }
  return null
}, MAP)
if (port) {
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2)
  await page.mouse.down()
  await page.mouse.move(PIC.x + PIC.w / 2, PIC.y + PIC.h / 2, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(1800)
}
check('setup: the map is wired into the photograph', (await page.locator('.wire').count()) === 1,
      `${await page.locator('.wire').count()} wires, port ${port ? 'found' : 'missing'}`)

/* ---------- reading the picture ---------- */
const sample = (fx, fy) =>
  page.evaluate(async ({ fx, fy, id }) => {
    const card = document.querySelector(`.card[data-id="${id}"]`)
    const el = card?.querySelector('canvas.media') || card?.querySelector('img.media')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(r.width))
    c.height = Math.max(1, Math.round(r.height))
    const g = c.getContext('2d', { willReadFrequently: true })
    try {
      g.drawImage(el, 0, 0, c.width, c.height)
    } catch {
      return null
    }
    const d = g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data
    return [d[0], d[1], d[2]]
  }, { fx, fy, id: PIC.id })

const setMask = async (label, value) => {
  const box = page
    .locator('.mask-body .ctl', { hasText: new RegExp(`^${label}`) })
    .locator('input.ctl-num')
    .first()
  await box.scrollIntoViewIfNeeded()
  await box.fill(String(value))
  await box.press('Enter')
  await page.waitForTimeout(700)
}

const hideOverlay = async () => {
  const eye = page.locator('.mask-eye[data-on]')
  if (await eye.count()) {
    await eye.first().click()
    await page.waitForTimeout(700)
  }
}

/* Off the wire and out of whatever the drag left up, before anything is
   asked of the panel. */
await page.keyboard.press('Escape')
await page.mouse.move(760, 900)
await page.waitForTimeout(600)
await page.locator(`.card[data-id="${PIC.id}"]`).click()
await page.waitForTimeout(600)
await page.locator('.panel-tabs button', { hasText: 'Develop' }).first().click()
await page.waitForTimeout(300)
const add = page.locator('.masks > .mask-add > button', { hasText: 'New mask' })
await add.scrollIntoViewIfNeeded()
await add.click()
await page.waitForTimeout(200)
await page.locator('.masks > .mask-add .mask-kinds button', { hasText: 'Depth range' }).first().click()
await page.waitForTimeout(1200)
await hideOverlay()

/* A range over the far half of what is on the card. The map's bottom is the
   far end and the card shows its middle half, so the bottom of the card reads
   three quarters and the top reads one quarter. */
await setMask('Nearest', 55)
await setMask('Furthest', 100)
await setMask('Softness', 5)
await setMask('Exposure', -2)

const low = await sample(0.5, 0.85)
const high = await sample(0.5, 0.15)
check('a depth range darkens the far end of the map and not the near one',
      low && high && low[0] < 100 && Math.abs(high[0] - 128) <= 6,
      `far ${low && low[0]}, near ${high && high[0]}`)
fs.writeFileSync(path.join(OUT, 'depthmask-far.png'), await page.screenshot())

/* And the one the crop decides. The nearest quarter of the square map is
   above the top of a two-to-one card, so a range asking for it covers nothing
   at all. Read at the photograph's own coordinates it would find the top of
   the card instead, which is a mask somewhere nobody pointed at. */
await setMask('Nearest', 0)
await setMask('Furthest', 22)
await setMask('Softness', 2)
const top = await sample(0.5, 0.06)
const middle = await sample(0.5, 0.5)
const bottom = await sample(0.5, 0.94)
check('and a range that falls outside the crop finds nothing, rather than the top of the card',
      top && middle && bottom && Math.abs(top[0] - 128) <= 6 && Math.abs(middle[0] - 128) <= 6 &&
        Math.abs(bottom[0] - 128) <= 6,
      `${top && top[0]} / ${middle && middle[0]} / ${bottom && bottom[0]}`)
fs.writeFileSync(path.join(OUT, 'depthmask-outside.png'), await page.screenshot())

/* The other half, for the same reason in the other direction: the furthest
   quarter is off the bottom of the card. */
/* Furthest first: the two sliders hold each other apart, so a nearest set
   above the furthest that is currently there would be pulled back down to it. */
await setMask('Furthest', 100)
await setMask('Nearest', 88)
const farTop = await sample(0.5, 0.06)
const farBottom = await sample(0.5, 0.94)
check('and the same at the other end of it',
      farTop && farBottom && Math.abs(farTop[0] - 128) <= 6 && Math.abs(farBottom[0] - 128) <= 6,
      `${farTop && farTop[0]} / ${farBottom && farBottom[0]}`)

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
