/* When the browser will not write.
 *
 *   npm run build && node scripts/browser-tests.mjs nospace
 *
 * Everything made here lives in this browser and nowhere else, and every write
 * used to swallow its own errors: a board that would not save looked exactly
 * like one that had, because the pictures were still on screen — still in
 * memory. You found out on the next reload, when they were gone.
 *
 * There is an alarm for that now, and this is the check nobody had written for
 * it. It is the highest-consequence path in the app and the one where a
 * regression is invisible in ordinary use: with a disk that is not full,
 * nothing here ever runs. So the writes are made to fail on purpose, from
 * before the app has started, and what has to hold is the whole chain — the
 * refusal is noticed, it is said plainly and it stays said, the board carries
 * on working, and the way out the alarm offers actually works while the
 * writing is still broken.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const png = (w, h) => {
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
      const on = ((x >> 4) + (y >> 4)) % 2
      raw[row + 1 + x * 3] = on ? 235 : 25
      raw[row + 2 + x * 3] = 110
      raw[row + 3 + x * 3] = on ? 45 : 195
    }
  }
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const ready = async () => {
  await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
  await page.waitForTimeout(500)
}
const drop = async (buf, name) => {
  await page.evaluate(({ b64, name }) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j)
    const dt = new DataTransfer()
    dt.items.add(new File([u8], name, { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 520, clientY: 420 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, { b64: buf.toString('base64'), name })
  await page.waitForTimeout(2600)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await ready()

/* One picture written properly, so there is something worth not losing. */
await drop(png(300, 220), 'before.png')
ok('a picture on the board, saved the ordinary way',
   (await page.locator('.card[data-kind="image"]').count()) === 1)
ok('and nothing is complaining', (await page.locator('.alarm').count()) === 0)

/* ---------- and now the disk says no ---------- */
/* Every write refused, the way a full one refuses: the name is what tells
   "there is no room" apart from "this browser will not store anything". */
await page.evaluate(() => {
  IDBObjectStore.prototype.put = function () {
    const e = new Error('no room'); e.name = 'QuotaExceededError'
    throw e
  }
})
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('n')
await page.waitForTimeout(3000)

ok('the refusal is noticed', (await page.locator('.alarm').count()) === 1)
const said = await page.locator('.alarm').innerText()
ok('and said as what it is, rather than as a code',
   /no room/i.test(said) && /not being written down/i.test(said), said.split('\n')[0])
ok('with the plain fact that what is on screen is not safe',
   /before reloading/i.test(said))
ok('and it is an alarm, so anything reading the page aloud says it',
   (await page.locator('.alarm[role="alert"]').count()) === 1)
fs.writeFileSync(path.join(OUT, 'nospace.png'), await page.screenshot())

/* The board is still a board. Refusing to work as well would turn a problem
   you can still get your work out of into one you cannot. */
ok('the board goes on working', (await page.locator('.card').count()) === 2,
   `${await page.locator('.card').count()} cards`)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('l')
await page.waitForTimeout(900)
ok('and still takes what you give it', (await page.locator('.card').count()) === 3,
   `${await page.locator('.card').count()} cards`)

/* ---------- the way out it offers ---------- */
/* The alarm's whole purpose is this button. If the export cannot run while the
   writing is broken then the advice is worthless, and the one moment it
   matters is exactly the moment it would fail. */
const wait = page.waitForEvent('download', { timeout: 90000 })
await page.locator('.alarm-do button').first().click()
const dl = await wait
const file = path.join(OUT, 'nospace-rescue.board.zip')
await dl.saveAs(file)
const size = fs.statSync(file).size
ok('the export it offers really runs while the writing is broken', size > 400,
   `${dl.suggestedFilename()}, ${size} bytes`)
/* And it has the picture in it, not just the board's outline: the file was
   written before the trouble started, and a rescue that leaves the pictures
   behind is not a rescue. */
const zipText = fs.readFileSync(file).toString('latin1')
ok('with the pictures in it, not just the words',
   /media\//.test(zipText) && /board\.json/.test(zipText))

/* ---------- it does not nag, and it does not forget ---------- */
await page.locator('.alarm-do button:last-child').click()
await page.waitForTimeout(600)
ok('it can be put away', (await page.locator('.alarm').count()) === 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('s')
await page.waitForTimeout(3000)
ok('and comes back on the next thing that will not save',
   (await page.locator('.alarm').count()) === 1)

/* ---------- a browser that stores nothing at all is a different sentence ---------- */
const other = await context.newPage()
other.on('pageerror', (e) => errors.push('other: ' + e.message))
await other.addInitScript(() => {
  IDBObjectStore.prototype.put = function () {
    throw new Error('storage is not available here')
  }
})
await other.goto(BASE, { waitUntil: 'domcontentloaded' })
await other.waitForSelector('.app[data-ready]', { timeout: 20000 })
await other.waitForTimeout(600)
await other.keyboard.press('Escape')
await other.waitForTimeout(200)
await other.keyboard.press('n')
await other.waitForTimeout(3000)
const blocked = await other.locator('.alarm').innerText().catch(() => '')
ok('a browser that refuses for another reason is told apart from a full one',
   /refusing to save/i.test(blocked) && !/no room/i.test(blocked), blocked.split('\n')[0] || '(no alarm)')
ok('and it says what that means, which is the same thing either way',
   /will not survive a reload/i.test(blocked))
await other.close()

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
