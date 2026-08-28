/* The ASCII effect, and the font it no longer has.
 *
 *   npm run build && node scripts/browser-tests.mjs ascii
 *
 * The glyphs used to be fillText of ` .:-=+*#%@` in a stack beginning
 * `ui-monospace, "JetBrains Mono", …`, and the atlas is built once when the
 * engine starts and kept. So the look of the effect depended on which of those
 * faces the machine had, on whether the webfont among them had arrived by that
 * moment, and on how far into the boot that moment fell. The same board came
 * back looking different after a reload. Two machines never agreed. Offline,
 * the whole stack fell through to whatever the browser calls monospace. People
 * bake this into exported pictures.
 *
 * They are shapes now. The three things that has to buy are checked here: the
 * same board renders the same after a reload, no text is drawn at any point,
 * and the ramp still runs the right way round — the darker the patch, the
 * heavier the mark. The last one is the reason the ramp exists, and it is the
 * thing hand-drawn glyphs could plausibly have got wrong.
 */
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

/* A left-to-right ramp from black to white, so every step of the glyph ramp
 * has somewhere on the picture that asks for it. */
const gradient = (w, h) => {
  const crc32 = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const head = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(head))
    return Buffer.concat([len, head, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255)
      raw[row + 1 + x * 3] = v; raw[row + 2 + x * 3] = v; raw[row + 3 + x * 3] = v
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const errors = []

/* Everything below happens twice, in two pages that differ in one way: the
 * second cannot draw text at all. Same steps, same picture expected. */
const run = async (page, muteText) => {
  if (muteText) {
    /* Before anything of the app has run, so the engine cannot have built its
     * atlas yet. If a single glyph still came from a typeface, this page would
     * render flat paper and the comparison below would say so. */
    await page.addInitScript(() => {
      const off = function () {}
      CanvasRenderingContext2D.prototype.fillText = off
      CanvasRenderingContext2D.prototype.strokeText = off
      if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
        OffscreenCanvasRenderingContext2D.prototype.fillText = off
        OffscreenCanvasRenderingContext2D.prototype.strokeText = off
      }
      window.__noText = true
    })
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
  await page.waitForTimeout(700)

  await page.evaluate((b64) => {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j)
    const dt = new DataTransfer()
    dt.items.add(new File([u8], 'ramp.png', { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 520, clientY: 400 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, gradient(480, 300).toString('base64'))
  await page.waitForTimeout(2600)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.keyboard.press('1')
  await page.waitForTimeout(700)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
  if (!(await page.locator('.fx-thumb').count())) {
    await page.keyboard.press('e')
    await page.waitForTimeout(600)
  }
  await page.locator('.fx-thumb[title="ASCII"]').click()
  await page.waitForTimeout(2000)
}

/* Framed the same way every time, or this compares two pictures of the same
 * card at two different sizes and calls the difference a bug. */
const frame = async (page) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.keyboard.press('1')
  await page.waitForTimeout(700)
}

/* The card once it has stopped changing. A render is asked for and arrives
 * when it arrives, so a single shot after a fixed pause can catch a canvas
 * half drawn. Two matching shots in a row is the picture. */
const shot = async (page) => {
  let last = null
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300)
    const buf = await page.locator('.card .media').first().screenshot()
    const now = createHash('sha1').update(buf).digest('hex')
    if (last && now === last.hash) return last
    last = { hash: now, buf }
  }
  return last
}

const page = await context.newPage()
page.on('pageerror', (e) => errors.push(e.message))
await run(page, false)
await frame(page)
const first = await shot(page)
fs.writeFileSync(path.join(OUT, 'ascii.png'), first.buf)

/* ---------- the ramp runs the right way round ---------- */
/* The source is black on the left and white on the right. The effect spends a
 * heavier character on a brighter patch and lays light ink on dark paper, so
 * read in bands the result has to climb steadily from left to right.
 *
 * This is the one thing hand-drawn glyphs could get wrong without anything
 * else noticing. The shader picks a character by brightness and nothing else,
 * so a ramp whose ink dips somewhere in the middle puts a lighter mark on a
 * brighter patch, and the picture stops reading as a picture. */
const bands = await page.locator('.card canvas.media').first().evaluate((cv, n) => {
  const c = document.createElement('canvas')
  c.width = cv.width
  c.height = cv.height
  c.getContext('2d').drawImage(cv, 0, 0)
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  const out = []
  for (let b = 0; b < n; b++) {
    const x0 = Math.floor((b * c.width) / n)
    const x1 = Math.floor(((b + 1) * c.width) / n)
    let sum = 0
    let count = 0
    for (let y = 0; y < c.height; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * c.width + x) * 4
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
        count++
      }
    }
    out.push(Math.round((sum / count) * 100) / 100)
  }
  return out
}, 8)
ok('the effect paints something rather than falling back to the picture',
   bands.some((v) => v > 4) && Math.max(...bands) - Math.min(...bands) > 12, JSON.stringify(bands))
/* Steadily, not strictly: two neighbouring bands can land on the same
   character, and the auto-tone step moves the whole ramp about. What must
   never happen is a band that goes back down. */
const dips = bands.filter((v, i) => i && v < bands[i - 1] - 0.75)
ok('the brighter the patch the heavier the mark, all the way along the ramp',
   dips.length === 0, JSON.stringify(bands))
ok('and the two ends really are different marks',
   bands[bands.length - 1] - bands[0] > 12,
   `${bands[0]} at the dark end, ${bands[bands.length - 1]} at the light end`)

/* ---------- the same board, after a reload ---------- */
/* What the bug was. Pixel identity across a reload is a promise this effect
   could not make while its atlas came from whichever font had turned up. */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
await page.waitForTimeout(900)
await frame(page)
const again = await shot(page)
ok('the same board renders the same picture after a reload',
   again.hash === first.hash, `${first.hash.slice(0, 10)} then ${again.hash.slice(0, 10)}`)

/* Twice more, because a race that only shows one time in three would pass a
   single reload and still be there. */
let steady = true
for (let i = 0; i < 2; i++) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
  await page.waitForTimeout(900)
  await frame(page)
  if ((await shot(page)).hash !== first.hash) steady = false
}
ok('and again, and again', steady)

/* ---------- with no way to draw text at all ---------- */
/* Its own browser, not just its own page: the two would otherwise share a
   store, and clearing it under a tab that still has it open is a way to make
   this test flaky about something it is not testing. */
const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const mute = await fresh.newPage()
mute.on('pageerror', (e) => errors.push(e.message))
await run(mute, true)
await frame(mute)
const muted = await shot(mute)
fs.writeFileSync(path.join(OUT, 'ascii-notext.png'), muted.buf)
ok('a page that cannot draw text renders exactly the same picture',
   muted.hash === first.hash, `${first.hash.slice(0, 10)} vs ${muted.hash.slice(0, 10)}`)
ok('and the stub really was in place', await mute.evaluate(() => window.__noText === true))
await fresh.close()

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
