/* A moment to change your mind about deleting a project.
 *
 *   npm run build && node scripts/browser-tests.mjs undelete
 *
 * Closing a tab deletes the project, which is the one thing this app does that
 * destroys work outright: no file behind a board, no undo that reaches across
 * boards, and this browser holding the only copy. It asked first and said what
 * it was about to take, and that was the whole safety net — and since a
 * focused tab answers the Delete key, the whole thing is two keystrokes.
 *
 * So the records are held for a few seconds after the boards leave the disk.
 * What has to be true: the project is properly gone in the meantime, from the
 * row and from search both, because a half-deleted project that still turns up
 * in answers would be worse than either state; putting it back restores it
 * under its own id, in its own place in the row, with its pictures; and asking
 * for the room back during those seconds does not quietly turn the offer into
 * a project of empty frames.
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

const png = (w, h, hue) => {
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
      raw[row + 1 + x * 3] = on ? hue : 255 - hue
      raw[row + 2 + x * 3] = on ? 90 : 190
      raw[row + 3 + x * 3] = on ? 200 : 50
    }
  }
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('dialog', (d) => d.accept())

const ready = async () => {
  await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
  await page.waitForTimeout(400)
}
const tabs = () => page.locator('.tab').count()
const cards = () => page.locator('.card').count()
const rename = async (to) => {
  await page.locator('.tab[data-on]').dblclick()
  await page.waitForTimeout(400)
  await page.locator('.tab-edit').fill(to)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1400)
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
const blobs = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('ideation.board.db')
  r.onsuccess = () => {
    const t = r.result.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys()
    t.onsuccess = () => res(t.result.length)
    t.onerror = () => res(-1)
  }
  r.onerror = () => res(-1)
}))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await ready()

/* ---------- two projects, one of them worth keeping ---------- */
await rename('Kept')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('n')
await page.waitForTimeout(1600)

await page.locator('.tab-new').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2, { timeout: 15000 })
await page.waitForTimeout(1000)
await rename('Doomed')
await drop(png(300, 220, 40), 'inside-doomed.png')
ok('a project with a picture in it', (await cards()) === 1, `${await cards()} cards`)
const doomedId = await page.evaluate(() => new URLSearchParams(location.search).get('board'))
const filesBefore = await blobs()
ok('and the picture is really on disk', filesBefore >= 1, `${filesBefore} files`)

/* ---------- delete it, and it is gone ---------- */
await page.locator('.tab[data-on] .tab-close').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 1, { timeout: 15000 })
await page.waitForTimeout(900)
ok('closing the tab takes the project out of the row', (await tabs()) === 1, `${await tabs()} tabs`)
ok('and lands you on the other one', (await page.locator('.tab-name').first().innerText()) === 'Kept',
   await page.locator('.tab-name').first().innerText())

/* Properly gone while the offer stands. A project half deleted — out of the
   row but still answering searches — would be worse than either state. */
await page.locator('.search input').fill('inside-doomed')
await page.waitForTimeout(2400)
/* Counted, not read: asking a missing element for its text waits out the whole
   locator timeout, which is longer than the offer this check is standing in
   front of — the first version of this spent thirty seconds here and then
   failed the two checks below for having taken too long. */
ok('and it is gone from the answers too, not merely hidden',
   (await page.locator('.search-deep').count()) === 0)
await page.locator('.search input').fill('')
await page.waitForTimeout(500)

/* ---------- but the offer is there ---------- */
const toast = await page.locator('.toast').innerText().catch(() => '')
ok('the line along the bottom offers it back', /Doomed/.test(toast) && (await page.locator('.toast-undo').count()) === 1,
   toast.replace(/\n/g, ' '))
ok('and the pictures are still on disk while it does', (await blobs()) === filesBefore,
   `${await blobs()} files, was ${filesBefore}`)
fs.writeFileSync(path.join(OUT, 'undelete.png'), await page.screenshot())

/* ---------- taken ---------- */
await page.locator('.toast-undo').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2, { timeout: 15000 })
await page.waitForTimeout(2000)
ok('taking the offer puts the project back', (await tabs()) === 2, `${await tabs()} tabs`)
ok('under its own address, not as a copy of itself',
   (await page.evaluate(() => new URLSearchParams(location.search).get('board'))) === doomedId,
   page.url())
ok('with its picture', (await cards()) === 1, `${await cards()} cards`)
ok('and the picture is a picture, not an empty frame', await page.evaluate(() => {
  const c = document.querySelector('.card[data-kind="image"] canvas, .card[data-kind="image"] img')
  return !!c && (c.width || c.naturalWidth) > 0
}))
/* And the row remembers where it went, rather than putting it on the end. */
const order = await page.locator('.tab-name').allInnerTexts()
ok('in its own place in the row', order.join('|') === 'Kept|Doomed', order.join(' | '))
ok('and it answers searches again', await (async () => {
  await page.locator('.search input').fill('inside-doomed')
  await page.waitForTimeout(2400)
  const n = await page.locator('.search-count').innerText()
  await page.locator('.search input').fill('')
  await page.waitForTimeout(400)
  return !/none/i.test(n)
})())

/* ---------- and when it is not taken, the room really does come back ---------- */
await page.locator('.tab[data-on] .tab-close').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 1, { timeout: 15000 })
await page.waitForTimeout(700)
ok('deleted again, and offered again', (await page.locator('.toast-undo').count()) === 1)
/* The grace is ten seconds; the sweep follows it. */
await page.waitForTimeout(13000)
ok('the offer lapses', (await page.locator('.toast-undo').count()) === 0)
const after = await blobs()
ok('and the pictures nothing points at any more are collected',
   after < filesBefore, `${after} files, was ${filesBefore}`)
ok('the project stays gone', (await tabs()) === 1, `${await tabs()} tabs`)

/* ---------- asking for the room back does not take the offer away ---------- */
/* The sweep is the one thing that could turn an undo into empty frames, so
   while the offer stands the held pictures are spoken for. */
await drop(png(300, 220, 210), 'second-life.png')
await page.waitForTimeout(1200)
await page.locator('.tab-new').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2, { timeout: 15000 })
await page.waitForTimeout(1000)
await rename('Second')
await drop(png(300, 220, 130), 'in-second.png')
const held = await blobs()
await page.locator('.tab[data-on] .tab-close').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 1, { timeout: 15000 })
await page.waitForTimeout(700)

/* Clear up, right now, while the offer stands. */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('clear up files')
await page.waitForTimeout(600)
await page.keyboard.press('Enter')
await page.waitForTimeout(3000)
ok('clearing up during the offer keeps what the offer needs', (await blobs()) === held,
   `${await blobs()} files, was ${held}`)
await page.locator('.toast-undo').click().catch(() => {})
await page.waitForTimeout(2500)
ok('so the project still comes back whole', (await tabs()) === 2 && (await cards()) === 1,
   `${await tabs()} tabs, ${await cards()} cards`)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
