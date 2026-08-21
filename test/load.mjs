/* Load test: fill a board with images, apply an effect to all of them, and
 * measure whether the main thread stays responsive while the GPU works.
 *
 *   node test/load.mjs http://localhost:5173 [count]
 *
 * The number that matters is `longTasksDuringEffect`: work that blocks the
 * main thread for over 50ms is what makes a board feel frozen. With the
 * renderer in a worker this should stay near zero however many images are
 * being processed. */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173'
const N = Number(process.argv[3] || process.env.N || 60)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* Long-task observer: anything over 50ms is a visible stall. */
await page.evaluate(() => {
  window.__long = []
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push(Math.round(e.duration))
  }).observe({ entryTypes: ['longtask'] })
})

await page.evaluate(async (n) => {
  const dt = new DataTransfer()
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas')
    c.width = 1200; c.height = 800
    const x = c.getContext('2d')
    const g = x.createLinearGradient(0, 0, 1200, 800)
    g.addColorStop(0, `hsl(${(i * 37) % 360} 65% 28%)`)
    g.addColorStop(1, `hsl(${(i * 37 + 120) % 360} 70% 70%)`)
    x.fillStyle = g; x.fillRect(0, 0, 1200, 800)
    for (let k = 0; k < 40; k++) {
      x.fillStyle = `hsl(${(i * 11 + k * 23) % 360} 60% ${25 + (k % 6) * 11}%)`
      x.fillRect((k * 91) % 1150, (k * 57) % 750, 90, 90)
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
    dt.items.add(new File([blob], `photo-${i}.jpg`, { type: 'image/jpeg' }))
  }
  const vp = document.querySelector('.viewport')
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  vp.dispatchEvent(ev)
}, N)

await page.waitForSelector('.card', { timeout: 120000 })
await page.waitForFunction((n) => document.querySelector('.stats')?.textContent?.includes(`${n} items`), N, { timeout: 180000 })
await page.waitForTimeout(1500)

const mounted = await page.locator('.card').count()
await page.evaluate(() => { window.__long.length = 0 })

/* Apply one effect to every item at once — the case that used to crawl. */
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
const t0 = Date.now()
await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(4000)
const applyMs = Date.now() - t0
const longDuringEffect = await page.evaluate(() => window.__long.slice())

/* Then pan while every visible card is effected. */
await page.evaluate(() => { window.__long.length = 0 })
const pan = await page.evaluate(() => new Promise((res) => {
  const vp = document.querySelector('.viewport')
  let frames = 0
  const t0 = performance.now()
  const step = () => {
    frames++
    vp.dispatchEvent(new WheelEvent('wheel', { deltaX: 7, deltaY: 3, bubbles: true, cancelable: true }))
    const dt = performance.now() - t0
    if (dt < 3000) requestAnimationFrame(step)
    else res({ frames, fps: Math.round(frames / (dt / 1000)) })
  }
  requestAnimationFrame(step)
}))
const longDuringPan = await page.evaluate(() => window.__long.slice())

const over50 = (a) => a.filter((d) => d > 50)
console.log(JSON.stringify({
  images: N,
  cardsMounted: mounted,
  virtualized: mounted < N,
  applyEffectToAllMs: applyMs,
  longTasksDuringEffect: over50(longDuringEffect).length,
  worstTaskDuringEffectMs: Math.max(0, ...longDuringEffect),
  panFps: pan.fps,
  longTasksDuringPan: over50(longDuringPan).length,
  worstTaskDuringPanMs: Math.max(0, ...longDuringPan),
  pageErrors: errors,
}, null, 2))

await browser.close()
