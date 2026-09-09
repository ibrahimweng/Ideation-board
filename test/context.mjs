/* When the browser takes the context away.
 *
 *   npm run build && node scripts/browser-tests.mjs context
 *   node test/context.mjs http://localhost:4173
 *
 * One WebGL2 context serves the whole board, and it can be taken away after it
 * is given: a GPU process that crashes, a driver that updates under a running
 * tab, a machine switching graphics chips. What makes that worth a suite is
 * how it fails rather than how often it happens. Every call on a lost context
 * is a silent no-op — it does not throw and it does not return an error — and
 * every card keeps showing whatever it painted last. So the board goes on
 * looking exactly like a board that works, while nothing it is asked for
 * happens, until somebody reloads the page.
 *
 * The context lives in the worker and is not on any global, so it is caught on
 * the way out of getContext, hooked the moment the worker appears. That is a
 * race — the renderer is built on the worker's first message — so the setup
 * retries rather than hoping. Losing it afterwards is done with the extension
 * the platform provides for exactly this, WEBGL_lose_context, which is a real
 * loss and not a simulated one: the context is gone, and the app is not told
 * which of the several ways it went.
 *
 * The whole claim is the last check: after the loss, asking for a different
 * effect has to paint a different picture. Nothing else in the app is allowed
 * to know why.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

/* Installed on every worker this page ever makes, so a reload gets another
   chance at the race. */
page.on('worker', (w) => {
  void w.evaluate(() => {
    if (self.__caught) return
    const proto = OffscreenCanvas.prototype
    const was = proto.getContext
    self.__caught = []
    proto.getContext = function (kind, opts) {
      const g = was.call(this, kind, opts)
      if (g && /webgl/.test(String(kind))) self.__caught.push(g)
      return g
    }
  }).catch(() => { /* the worker went before the hook landed; the retry covers it */ })
})

const drop = () =>
  page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 400
    const x = c.getContext('2d')
    x.fillStyle = '#c33'
    x.fillRect(0, 0, 400, 400)
    x.fillStyle = '#3c3'
    x.fillRect(100, 100, 200, 200)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'p.png', { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  })

const held = async () => {
  const w = page.workers()[0]
  if (!w) return 0
  return await w.evaluate(() => (self.__caught || []).length).catch(() => 0)
}

/* The renderer is built on the worker's first message, which can beat the hook
   in. Reloading gets another worker and another go. */
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
let caught = 0
for (let tries = 0; tries < 6 && !caught; tries++) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)
  caught = await held()
}
ok('setup: the renderer’s own context is in reach', caught > 0, `${caught} caught`)

await drop()
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(2000)

const setFx = async (name) => {
  await page.locator('.card[data-kind="image"]').click({ position: { x: 20, y: 20 } })
  await page.waitForTimeout(300)
  const tile = page.locator(`.fx-thumb[title="${name}"]`)
  if (!(await tile.count())) return false
  await tile.click()
  await page.waitForTimeout(2500)
  return true
}
const shot = async () => {
  const el = page.locator('.card[data-kind="image"] canvas.media, .card[data-kind="image"] img.media').first()
  return (await el.count()) ? (await el.screenshot()).length : 0
}

/* The control. Without it the last check proves nothing: a picture that never
   changes because the effect was never applied looks the same as one that
   never changes because the context is gone. */
ok('setup: an effect can be put on the card', await setFx('Halftone'))
const first = await shot()
ok('setup: a second effect paints something else', await setFx('Thermal'))
const second = await shot()
ok('with the context alive, changing the effect changes the picture', first !== second && second > 0,
   `${first} then ${second} bytes`)

/* Gone. Not simulated: the extension is the platform's own way of taking a
   context away, and what the app sees is what it would see on a GPU reset. */
const wentAway = await page.workers()[0].evaluate(() => {
  const g = (self.__caught || [])[0]
  if (!g) return 'nothing caught'
  const ext = g.getExtension('WEBGL_lose_context')
  if (!ext) return 'no extension'
  ext.loseContext()
  return g.isContextLost() ? 'lost' : 'still there'
})
ok('the context really is taken away', wentAway === 'lost', wentAway)
await page.waitForTimeout(1200)

/* The claim. A renderer that never noticed would go on accepting jobs and
   drawing into nothing, and this card would still be showing Thermal. */
ok('setup: a third effect is asked for', await setFx('Dither'))
const third = await shot()
ok('the board carries on after losing its context', third !== second && third > 0,
   `${second} before, ${third} after`)

/* And what it painted is the picture, not a blank square where one used to be. */
const paint = await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="image"] canvas.media')
  if (!el) return null
  const c = document.createElement('canvas')
  c.width = 40
  c.height = 40
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(el, 0, 0, 40, 40)
  const d = x.getImageData(0, 0, 40, 40).data
  let lit = 0
  let spread = 0
  let lo = 255
  let hi = 0
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    if (d[i + 3] > 8) lit++
    if (l < lo) lo = l
    if (l > hi) hi = l
  }
  spread = hi - lo
  return { lit: lit / (d.length / 4), spread: Math.round(spread) }
})
ok('and what it painted is a picture rather than an empty square',
   !!paint && paint.lit > 0.9 && paint.spread > 30,
   paint ? `${Math.round(paint.lit * 100)}% opaque, ${paint.spread} of range` : 'no canvas')

/* A second loss is not a special case: the renderer that came back can go the
   same way, and the one after it has to come back too. */
const twice = await page.workers()[0].evaluate(() => {
  const g = (self.__caught || []).slice(-1)[0]
  const ext = g && g.getExtension('WEBGL_lose_context')
  if (!ext) return 'no extension'
  ext.loseContext()
  return 'lost'
})
await page.waitForTimeout(1200)
ok('setup: and a fourth effect after a second loss', await setFx('Solarize'), twice)
const fourth = await shot()
ok('and it survives losing it twice', fourth !== third && fourth > 0, `${third} then ${fourth}`)

fs.writeFileSync(path.join(OUT, 'context.png'), await page.screenshot())
console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
