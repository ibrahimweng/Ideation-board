/* The copy kept in a folder on disk.
 *
 *   npm run build && node scripts/browser-tests.mjs mirror
 *   node test/mirror.mjs http://localhost:4173
 *
 * This is the app's whole answer to "the only copy of my work is in one
 * browser", and it was the one feature with no test of any kind. That is the
 * wrong thing to leave unchecked, because of how it fails: a folder copy that
 * quietly writes nothing, or writes a board.json nothing can read back, looks
 * exactly like one that is working right up until the day somebody needs it.
 *
 * The picker cannot be driven headlessly — a browser opens one only from a
 * real gesture — so `showDirectoryPicker` is replaced with a folder that lives
 * in memory and counts what is written to it. That is the only substitution:
 * everything on this side of it is the real thing, the same trick test/draw.mjs
 * plays on Gemini. What the fake cannot cover is the handle being remembered
 * across a reload, since a handle full of functions is not something IndexedDB
 * will store; that path stays a browser's own business.
 *
 * The checks are about the promises the code makes in its own comments: that
 * the folder ends up holding a board.json, the media beside it and a note
 * saying what it is; that a picture already written is never written twice;
 * and that a permission which lapses mid-copy stops the copying and says so —
 * the case where reading the wrong sentence is worst.
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

/* A solid PNG, written by hand so the bytes in the folder can be compared
   against the bytes that went in. */
const png = (w, h, rgb) => {
  const crc32 = (buf) => {
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

/* ---------- the folder ----------
 *
 * Enough of FileSystemDirectoryHandle for the app to write to: sub-folders,
 * files, and a writable that collects what it is given. It counts writes per
 * path, which is what makes "a picture already there is left alone" a thing
 * that can be asserted rather than assumed, and it can be told to refuse the
 * next write the way a lapsed permission does. */
await page.addInitScript(() => {
  const files = new Map()   // 'media/img_x' -> { bytes, writes }
  const state = { refuse: null, name: 'Boards' }
  window.__folder = {
    files,
    state,
    read: (p) => {
      const f = files.get(p)
      return f ? { text: f.text, size: f.size, writes: f.writes } : null
    },
    list: () => [...files.keys()].sort(),
    refuseNextWrite: (name) => { state.refuse = name },
  }

  const fileHandle = (full) => ({
    kind: 'file',
    name: full.split('/').pop(),
    async createWritable() {
      if (state.refuse) {
        const err = new Error('nope')
        err.name = state.refuse
        state.refuse = null
        throw err
      }
      const parts = []
      return {
        async write(data) { parts.push(data) },
        async close() {
          const blob = new Blob(parts)
          const was = files.get(full)
          files.set(full, {
            size: blob.size,
            text: blob.size < 200000 ? await blob.text() : '',
            writes: (was?.writes || 0) + 1,
          })
        },
      }
    },
    async getFile() {
      const f = files.get(full)
      return new File([f?.text || ''], full.split('/').pop())
    },
  })

  const dirHandle = (prefix, name) => ({
    kind: 'directory',
    name,
    async queryPermission() { return 'granted' },
    async requestPermission() { return 'granted' },
    async getDirectoryHandle(n) { return dirHandle(prefix + n + '/', n) },
    async getFileHandle(n, opts) {
      const full = prefix + n
      if (!opts?.create && !files.has(full)) {
        const err = new Error('not found')
        err.name = 'NotFoundError'
        throw err
      }
      return fileHandle(full)
    },
  })

  window.showDirectoryPicker = async () => dirHandle('', state.name)
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

const toastNow = async () =>
  (await page.locator('.toast').count()) ? await page.locator('.toast').innerText() : ''

const run = async (typed) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const before = await toastNow()
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.keyboard.type(typed)
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
  for (let i = 0; i < 40; i++) {
    const said = await toastNow()
    if (said && said !== before && !/copying to the folder/i.test(said)) return said
    await page.waitForTimeout(250)
  }
  return await toastNow()
}

const folder = () => page.evaluate(() => ({ list: window.__folder.list() }))
const fileAt = (p) => page.evaluate((k) => window.__folder.read(k), p)

/* ---------- two pictures on a board ---------- */
const shots = [[210, 60, 60], [60, 90, 210]].map((rgb) => png(240, 240, rgb).toString('base64'))
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
ok('two pictures are on the board', (await page.locator('.card[data-kind="image"]').count()) === 2)

/* ---------- pointing it at a folder ---------- */
const chose = await run('keep a copy')
ok('choosing a folder copies the board straight away', /copied \d+ files? to Boards/i.test(chose), chose)

const wrote = await folder()
ok('the folder holds a board.json, the media beside it, and a note',
   wrote.list.includes('board.json') && wrote.list.includes('README.json') &&
   wrote.list.filter((p) => p.startsWith('media/')).length === 2,
   wrote.list.join(', '))

/* The board.json is the half that has to be readable by something that is not
   this app — it is what the folder is for. */
const bundle = await fileAt('board.json')
let parsed = null
try { parsed = JSON.parse(bundle.text) } catch { /* left null, checked below */ }
ok('the board.json really parses', !!parsed, parsed ? `${bundle.size} bytes` : bundle.text.slice(0, 80))
ok('and holds the board with both cards on it',
   !!parsed && JSON.stringify(parsed).split('"kind":"image"').length - 1 === 2)

const note = await fileAt('README.json')
ok('the note says it is a copy rather than a sync, and how to open it',
   /not a sync/i.test(note?.text || '') && /ever read back/i.test(note?.text || '') &&
   /import/i.test(note?.text || ''),
   (note?.text || '').replace(/\s+/g, ' ').slice(0, 90))

const media = (await folder()).list.filter((p) => p.startsWith('media/'))
const first = await fileAt(media[0])
ok('a picture in the folder is the picture, not an empty file', first.size > 200, `${first.size} bytes`)

/* ---------- a second copy leaves the pictures alone ---------- */
await page.keyboard.press('Escape')
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(200)
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
await page.waitForTimeout(600)

const again = await run('copy to the folder now')
ok('a later copy writes the board again', /copied 1 file to Boards/i.test(again), again)

const media2 = await fileAt(media[0])
ok('and never rewrites a picture already there', media2.writes === 1, `${media2.writes} write(s)`)
const board2 = await fileAt('board.json')
ok('while the board itself is written every time', board2.writes === 2, `${board2.writes} writes`)

/* ---------- a permission that lapses mid-copy ---------- */
await page.evaluate(() => window.__folder.refuseNextWrite('NotAllowedError'))
const lapsed = await run('copy to the folder now')
ok('a lapsed permission is reported as one, with what to do about it',
   /lapsed/i.test(lapsed) && /choose it again/i.test(lapsed), lapsed)

/* The folder is dropped when that happens, and the command list is where that
   shows: it offers to keep a copy again rather than to stop keeping one. */
await page.keyboard.press('Control+k')
await page.waitForTimeout(400)
await page.keyboard.type('folder')
await page.waitForTimeout(500)
const offers = await page.locator('.cmd-row').allInnerTexts()
await page.keyboard.press('Escape')
ok('and the folder is let go of rather than silently kept',
   offers.some((t) => /keep a copy in a folder/i.test(t)) && !offers.some((t) => /stop keeping a copy/i.test(t)),
   offers.join(' | ').slice(0, 90))

/* Nothing more is written to a folder that has been let go of. */
const beforeIdle = (await fileAt('board.json')).writes
await page.keyboard.press('Escape')
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(200)
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(6500)
ok('and nothing is written to it afterwards', (await fileAt('board.json')).writes === beforeIdle,
   `${beforeIdle} then ${(await fileAt('board.json')).writes}`)

/* ---------- back on, and the wait between copies ---------- */
const back = await run('keep a copy')
ok('the folder can be taken up again', /copied \d+ files? to Boards/i.test(back), back)

/* Copying follows the board settling rather than every keystroke.
 *
 * Checked on the wait itself rather than only on the count, because the count
 * alone does not prove it: `copyNow` refuses to start while one is running, so
 * a burst collapses into one copy whether or not anything is waiting. What
 * only the wait explains is a change that has not been written yet a moment
 * after it was made. */
const settled = (await fileAt('board.json')).writes
await page.keyboard.press('Escape')
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(200)
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(1500)
ok('a change is not written the moment it is made', (await fileAt('board.json')).writes === settled,
   `${settled} then ${(await fileAt('board.json')).writes} after 1.5s`)
await page.waitForTimeout(5000)
ok('and is written once the board has been left alone', (await fileAt('board.json')).writes === settled + 1,
   `${(await fileAt('board.json')).writes} writes`)

/* And a run of them still costs one copy rather than one each. */
const burst = (await fileAt('board.json')).writes
for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120) }
await page.waitForTimeout(9000)
const after = (await fileAt('board.json')).writes
ok('a run of changes costs one copy rather than one each', after - burst === 1,
   `${after - burst} copies for eight changes`)

/* ---------- stopping ---------- */
const stopped = await run('stop keeping a copy')
await page.waitForTimeout(400)
const idle = (await fileAt('board.json')).writes
await page.keyboard.press('Escape')
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(200)
await page.keyboard.press('ArrowUp')
await page.waitForTimeout(6500)
ok('stopping really stops it', (await fileAt('board.json')).writes === idle,
   `${idle} then ${(await fileAt('board.json')).writes}${stopped ? ' — said: ' + stopped.slice(0, 40) : ''}`)

fs.writeFileSync(path.join(OUT, 'mirror.png'), await page.screenshot())

console.log('\nfolder held:', (await folder()).list.join(', '))
console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
