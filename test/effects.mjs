/* Every effect, on the same picture.
 *
 *   npm run dev &
 *   node test/effects.mjs http://localhost:5173
 *
 * A shader that fails to compile does not throw: the renderer quietly falls
 * back to Original, and the card looks like the picture with nothing done to
 * it. So the check is that every effect paints something, that no two of them
 * paint the same thing, and that none of them paints a flat colour. It leaves
 * a contact sheet of all of them in .smoke for looking at.
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

/* Something with tone, edges, colour and texture, so no effect has an excuse
 * for producing nothing. */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 480
  const x = c.getContext('2d')
  const sky = x.createLinearGradient(0, 0, 0, 480)
  sky.addColorStop(0, '#123a63')
  sky.addColorStop(0.55, '#c8752f')
  sky.addColorStop(1, '#f2e2c4')
  x.fillStyle = sky
  x.fillRect(0, 0, 640, 480)
  x.fillStyle = '#101418'
  x.beginPath()
  x.moveTo(0, 380)
  x.lineTo(180, 210)
  x.lineTo(300, 330)
  x.lineTo(430, 160)
  x.lineTo(640, 400)
  x.lineTo(640, 480)
  x.lineTo(0, 480)
  x.fill()
  x.fillStyle = '#fdf6df'
  x.beginPath()
  x.arc(470, 110, 46, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = 'rgba(255,255,255,0.85)'
  for (let i = 0; i < 900; i++) {
    x.fillRect(Math.random() * 640, Math.random() * 300, 1.5, 1.5)
  }
  x.strokeStyle = '#e5251f'
  x.lineWidth = 6
  x.strokeRect(60, 300, 140, 110)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'scene.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 420, clientY: 320 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)

const card = page.locator('.card[data-kind="image"]').first()
await card.click({ position: { x: 60, y: 10 } })
await page.waitForTimeout(400)

const names = await page.evaluate(() =>
  [...document.querySelectorAll('.fx-thumb')].map((b) => b.getAttribute('title'))
)
check('the panel offers every effect', names.length >= 30, `${names.length} effects`)

/* Eight by eight of grey, which is enough to tell two pictures apart and
 * cheap enough to do for all of them. */
const fingerprint = (b64) =>
  page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const s = document.createElement('canvas')
    s.width = 8
    s.height = 8
    const x = s.getContext('2d')
    x.drawImage(img, 0, 0, 8, 8)
    const d = x.getImageData(0, 0, 8, 8).data
    const v = []
    for (let i = 0; i < 64; i++) v.push(Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]))
    const mean = v.reduce((a, b) => a + b, 0) / 64
    const spread = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / 64)
    return { v, spread: Math.round(spread) }
  }, b64)

const dist = (a, b) => {
  let n = 0
  for (let i = 0; i < 64; i++) n += Math.abs(a.v[i] - b.v[i])
  return Math.round(n / 64)
}

const shots = []
const plainShot = (await card.screenshot()).toString('base64')
const plain = await fingerprint(plainShot)

const flat = []
const same = []
const unchanged = []
const seen = []

for (const name of names) {
  await page.locator(`.fx-thumb[title="${name}"]`).click()
  await page.waitForTimeout(name === 'Oil paint' ? 2600 : 1400)
  const b64 = (await card.screenshot()).toString('base64')
  const fp = await fingerprint(b64)
  shots.push({ name, b64 })

  if (fp.spread < 4) flat.push(name)
  if (name !== 'Original' && dist(fp, plain) < 3) unchanged.push(name)
  for (const prev of seen) {
    if (prev.name === 'Original' || name === 'Original') continue
    if (dist(fp, prev.fp) < 2) same.push(`${name}=${prev.name}`)
  }
  seen.push({ name, fp })
}

check('every effect paints something of its own', unchanged.length === 0, unchanged.join(', ') || 'none unchanged')
check('no two effects paint the same picture', same.length === 0, same.join(', ') || 'all distinct')
check('none of them paints a flat colour', flat.length === 0, flat.join(', ') || 'all have detail')

/* The contact sheet, for looking at rather than for asserting on. */
const sheet = await page.evaluate(async (list) => {
  const cols = 6
  const cw = 260
  const ch = 200
  const pad = 22
  const rows = Math.ceil(list.length / cols)
  const c = document.createElement('canvas')
  c.width = cols * cw
  c.height = rows * (ch + pad)
  const x = c.getContext('2d')
  x.fillStyle = '#e9e8e4'
  x.fillRect(0, 0, c.width, c.height)
  for (let i = 0; i < list.length; i++) {
    const img = new Image()
    img.src = 'data:image/png;base64,' + list[i].b64
    await img.decode()
    const col = i % cols
    const row = Math.floor(i / cols)
    const dx = col * cw
    const dy = row * (ch + pad)
    const scale = Math.min((cw - 12) / img.width, ch / img.height)
    x.drawImage(img, dx + 6, dy + pad - 4, img.width * scale, img.height * scale)
    x.fillStyle = '#17171a'
    x.font = '600 13px sans-serif'
    x.fillText(list[i].name, dx + 8, dy + 14)
  }
  return c.toDataURL('image/png').split(',')[1]
}, shots)
fs.writeFileSync(path.join(OUT, 'effects-sheet.png'), Buffer.from(sheet, 'base64'))
console.log(`     contact sheet: ${path.join(OUT, 'effects-sheet.png')}`)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
