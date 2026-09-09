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
 * The context lives in the worker, which puts it on its own global for the
 * same reason the engine is on the window: a pipeline you cannot look at is a
 * pipeline you cannot debug. Losing it is done with the extension the platform
 * provides for exactly this, WEBGL_lose_context, which is a real loss and not
 * a simulated one: the context is gone, and the app is not told which of the
 * several ways it went.
 *
 * This first tried to catch the context on its way out of getContext, hooked
 * when the worker appeared. That is a race against the worker's first message
 * and it lost every time on a CI machine — and the shape of the failure is the
 * part worth keeping in mind: with nothing caught, nothing was ever lost, so
 * the checks below went on passing about a board that had never been hurt.
 * Two setup lines failed and eight substantive ones passed vacuously. A
 * premise that cannot be established now stops the suite instead.
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
  if (!w) return false
  return await w.evaluate(() => !!self.__gl).catch(() => false)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2200)

const reachable = await held()
ok('setup: the renderer’s own context is in reach', reachable, reachable ? 'on the worker' : 'not exposed')
if (!reachable) {
  /* Everything below is about what happens after a loss, and without a handle
     there is nothing to lose. Passing those checks would say the board
     survived something that never happened to it. */
  console.log('\nnothing to take away — the rest of this suite would be about a board that was never hurt')
  console.log(`\n${results.filter((r) => r.p).length}/${results.length} checks passed`)
  console.log('FAIL')
  await browser.close()
  process.exit(1)
}

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
  const g = self.__gl
  if (!g) return 'nothing exposed'
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
/* The one the worker put up when it rebuilt, which is a different context from
   the one taken away a moment ago — and proving that is half of what this
   check is for. */
const twice = await page.workers()[0].evaluate(() => {
  const g = self.__gl
  if (!g) return 'nothing exposed'
  if (g.isContextLost()) return 'still the dead one'
  const ext = g.getExtension('WEBGL_lose_context')
  if (!ext) return 'no extension'
  ext.loseContext()
  return 'lost'
})
await page.waitForTimeout(1200)
ok('the renderer that came back is a live context of its own', twice === 'lost', twice)
ok('setup: and a fourth effect after a second loss', await setFx('Solarize'))
const fourth = await shot()
ok('and it survives losing it twice', fourth !== third && fourth > 0, `${third} then ${fourth}`)

fs.writeFileSync(path.join(OUT, 'context.png'), await page.screenshot())
console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
