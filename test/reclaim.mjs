/* Getting the room back.
 *
 *   npm run build && node scripts/browser-tests.mjs reclaim
 *
 * Deleting a card never deleted its picture, and nothing ever deleted a board
 * at all, so the store only ever grew — while the corner of the screen warned
 * that the disk was filling up and offered three buttons, none of which freed
 * a byte.
 *
 * The risk in fixing that runs entirely one way. A file wrongly kept costs
 * some room; a file wrongly deleted is a photograph gone from a board that may
 * not even be open, with no undo and no second copy. So this drives the real
 * store in a real browser and checks both halves: that the room really comes
 * back, and that every way a file can still be spoken for survives it.
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

const png = (w, h, rgb) => {
  function crc32(buf) {
    let c = ~0
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
    return ~c >>> 0
  }
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
    for (let x = 0; x < w; x++) { raw[row + 1 + x * 3] = rgb[0]; raw[row + 2 + x * 3] = rgb[1]; raw[row + 3 + x * 3] = rgb[2] }
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

/* Pictures big enough that freeing them is a number worth reading. */
const shots = [1, 2, 3, 4].map((i) => png(200, 200, [40 * i, 90, 200 - 30 * i]).toString('base64'))
await page.evaluate((list) => {
  const dt = new DataTransfer()
  list.forEach((b64, i) => {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j)
    dt.items.add(new File([u8], `shot${i}.png`, { type: 'image/png' }))
  })
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, shots)
await page.waitForTimeout(3000)
ok('four pictures are on the board', (await page.locator('.card[data-kind="image"]').count()) === 4)

const files = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('ideation.board.db')
  r.onsuccess = () => {
    const all = r.result.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys()
    all.onsuccess = () => res(all.result.map(String))
    all.onerror = () => res([])
  }
  r.onerror = () => res([])
}))
const held = await files()
ok('and their files are really in the store', held.length >= 4, `${held.length} files`)

/* ---------- the leak itself ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('1')
await page.waitForTimeout(500)
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
await page.keyboard.press('Delete')
await page.waitForTimeout(1800)
ok('the cards can all be deleted', (await page.locator('.card').count()) === 0)
const afterDelete = await files()
ok('and deleting them frees nothing at all, which is the bug',
   afterDelete.length === held.length, `${afterDelete.length} files still held, was ${held.length}`)

/* ---------- what the sweep does about it ---------- */
/* Run the way a person runs it, out of the command list, rather than through a
   hook put in the product for the test's benefit. What is checked is therefore
   the real path, message and all. */
const clearUp = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.keyboard.type('clear up')
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
  /* The toast says what happened; wait for one that is not "looking…". */
  for (let i = 0; i < 40; i++) {
    const said = await page.locator('.toast').innerText().catch(() => '')
    if (said && !/looking/i.test(said)) return said
    await page.waitForTimeout(250)
  }
  return await page.locator('.toast').innerText().catch(() => '')
}

/* A file written moments ago is left alone on purpose, so that a drop still
   arriving cannot have its picture taken out from under it. Waited out rather
   than worked around, because the waiting is the behaviour. */
const tooNew = await clearUp()
ok('a file written moments ago is held back rather than swept',
   /nothing to clear up yet/i.test(tooNew), tooNew)
ok('and nothing was actually removed', (await files()).length === held.length, `${(await files()).length} files`)

await page.waitForTimeout(11_000)
const said = await clearUp()
ok('once they are old enough, the files nothing points at are cleared',
   /cleared 4 files/i.test(said), said)
const afterSweep = await files()
ok('and the store really is smaller', afterSweep.length === 0, `${afterSweep.length} files left`)

/* ---------- and what it must never do ---------- */
await page.evaluate((b64) => {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j)
  const dt = new DataTransfer()
  dt.items.add(new File([u8], 'keeper.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, shots[0])
await page.waitForTimeout(2500)
ok('a picture is back on the board', (await page.locator('.card[data-kind="image"]').count()) === 1)

await page.waitForTimeout(11_000)
const guarded = await clearUp()
ok('a picture still on the board is never swept', /nothing to clear up/i.test(guarded), guarded)
ok('and it is still on the board afterwards', (await page.locator('.card[data-kind="image"]').count()) === 1)
ok('and its file is still in the store', (await files()).length >= 1, `${(await files()).length} files`)

/* Taken away with Cut: on no board at all, and about to be put on another. */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
await page.keyboard.press('Control+x')
await page.waitForTimeout(900)
ok('a card can be taken away', (await page.locator('.card').count()) === 0)
const cutGuard = await clearUp()
ok('a picture taken away with Cut is never swept — it is on no board by design',
   /nothing to clear up/i.test(cutGuard), cutGuard)
await page.keyboard.press('Control+v')
await page.waitForTimeout(1500)
ok('and it comes back with its picture intact',
   (await page.locator('.card[data-kind="image"] img.media, .card[data-kind="image"] canvas.media').count()) === 1)
fs.writeFileSync(path.join(OUT, 'reclaim.png'), await page.screenshot())

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
