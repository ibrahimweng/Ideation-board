/* End-to-end smoke test: drop an image, apply effects, confirm the card is
 * actually painted. Run with the dev server or a preview server running:
 *
 *   npm run dev &  node test/smoke.mjs http://localhost:5173
 *
 * A blank canvas compresses to almost nothing, so screenshot byte size is a
 * reliable "did anything render" signal. */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
const EXEC = process.env.CHROME_PATH || undefined
const MIN_PAINTED_BYTES = 20000

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const webgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))
if (!webgl2) {
  console.error('FAIL: no WebGL2 in this browser')
  await browser.close()
  process.exit(1)
}

/* Build a gradient photo in-page and drop it on the board. */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 600
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 900, 600)
  g.addColorStop(0, '#1b3fa0'); g.addColorStop(0.5, '#e86f2c'); g.addColorStop(1, '#f5e8c8')
  x.fillStyle = g
  x.fillRect(0, 0, 900, 600)
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `hsl(${i * 17 % 360} 70% ${30 + (i % 5) * 10}%)`
    x.fillRect((i * 97) % 860, (i * 53) % 560, 40, 40)
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'test.jpg', { type: 'image/jpeg' }))
  const vp = document.querySelector('.viewport')
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 260, clientY: 260 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  vp.dispatchEvent(ev)
})

await page.waitForSelector('.card', { timeout: 20000 })
await page.waitForTimeout(2000)

const card = page.locator('.card').first()
const original = await card.screenshot()
fs.writeFileSync(path.join(OUT, 'card-original.png'), original)

await page.keyboard.press('Control+a')
await page.waitForTimeout(400)

const results = []
for (const name of ['ASCII', 'Halftone', 'Thermal', 'Dither', 'Glitch']) {
  await page.locator(`.fx-thumb[title="${name}"]`).click()
  await page.waitForTimeout(2200)
  const shot = await card.screenshot()
  fs.writeFileSync(path.join(OUT, `card-${name.toLowerCase()}.png`), shot)
  const painted = shot.length >= MIN_PAINTED_BYTES
  const changed = Buffer.compare(shot, original) !== 0
  results.push({ name, bytes: shot.length, painted, changed })
}

/* The preview strip must render real previews, not empty boxes. */
const thumb = await page.locator('.fx-thumb').nth(3).screenshot()
fs.writeFileSync(path.join(OUT, 'thumb.png'), thumb)
const thumbPainted = thumb.length > 1200

console.table(results)
console.log('preview strip painted:', thumbPainted, `(${thumb.length} bytes)`)
console.log('page errors:', errors.length ? errors : 'none')

const ok = results.every((r) => r.painted && r.changed) && thumbPainted && errors.length === 0
console.log(ok ? '\nPASS' : '\nFAIL')
await browser.close()
process.exit(ok ? 0 : 1)
