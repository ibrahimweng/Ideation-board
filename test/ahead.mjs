/* A record from further along than this build.
 *
 *   npm run build && node scripts/browser-tests.mjs ahead
 *   node test/ahead.mjs http://localhost:4173
 *
 * Boards are written by whichever build has the tab, and read by whichever one
 * opens it next. Those are not always the same: a second tab can be running a
 * newer deploy while this one sits open, and a `.board.zip` is exported by the
 * version that made it and imported by the version you have. Both put a card
 * on the board that this build has never heard of, and the app already treats
 * the first as a real scenario — test/tabs.mjs exists for tabs writing over
 * each other.
 *
 * It did not survive it. Every question about a card went through a table
 * indexed by its kind, and a row that is not there is undefined: the whole app
 * came down, not the card. Measured before the fix — no cards, no toolbar, an
 * empty page and one line in a console nobody has open:
 *
 *     Cannot read properties of undefined (reading 'pixels')
 *
 * Which is the worst screen this app has, because the work is in this browser
 * and nowhere else, and a person looking at a blank page cannot tell a drawing
 * failure from having lost all of it.
 *
 * So there are two claims here and they are different. One: a card this build
 * does not understand is drawn as one, and can still be moved out of the way
 * or deleted, and its file is not swept out from under the build that does
 * understand it. Two: whatever else goes wrong in a render — this one is a
 * record no build ever wrote — the page says what happened and says the work
 * is still there, rather than going white.
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
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]))

const fresh = async () => {
  await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
}

/* Written straight into the record, which is how a card from another build
   arrives: not through anything this build would run. */
const putCard = (card) =>
  page.evaluate(async (card) => {
    const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
    const all = await new Promise((res) => {
      const t = db.transaction('boards', 'readonly')
      const q = t.objectStore('boards').getAll()
      q.onsuccess = () => res(q.result || [])
      q.onerror = () => res([])
    })
    const b = all[0]
    b.items.push(card)
    await new Promise((res) => {
      const t = db.transaction('boards', 'readwrite')
      t.objectStore('boards').put(b)
      t.oncomplete = res
    })
  }, card)

const alive = () =>
  page.evaluate(() => ({
    cards: document.querySelectorAll('.card').length,
    buttons: document.querySelectorAll('button').length,
    words: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
  }))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await fresh()

/* ---------- a kind from a later build ---------- */

await page.keyboard.press('n')
await page.waitForTimeout(1200)
ok('setup: a board with a card of this build’s own on it', (await page.locator('.card').count()) === 1)

await putCard({
  id: 'i_ahead', kind: 'hologram', x: 260, y: 240, w: 300, h: 200, z: 9,
  fx: { fxid: 'none', ep: null, preset: 'none', n: 1, more: [] }, tag: null,
  name: 'From a later build', media: 'img_a_newer_build_keeps_this',
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2600)

const after = await alive()
ok('the board still opens with a card it does not understand on it',
   after.cards === 2 && after.buttons > 5, `${after.cards} cards, ${after.buttons} buttons`)
ok('and the card says why it cannot be drawn rather than being an empty box',
   /newer version/i.test(after.words), after.words.slice(0, 70))

const unknown = page.locator('.card[data-id="i_ahead"]')
await unknown.click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
ok('it can be selected like any other card', (await page.locator('.card[data-sel]').count()) === 1)

/* Being able to get it out of the way matters more than being able to read it:
   a card you can neither draw nor remove is a card that owns the board. */
await page.keyboard.press('Delete')
await page.waitForTimeout(800)
ok('and deleted', (await page.locator('.card').count()) === 1)
await page.keyboard.press('Control+z')
await page.waitForTimeout(800)
ok('and put back', (await page.locator('.card').count()) === 2)

/* The file belongs to the build that understands the card. Sweeping it away
   because this build cannot read the card is the same mistake as deleting a
   picture because its board is not open. */
const swept = await page.evaluate(async () => {
  const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
  await new Promise((res) => {
    const t = db.transaction('blobs', 'readwrite')
    t.objectStore('blobs').put(new Blob([new Uint8Array(4096)]), 'img_a_newer_build_keeps_this')
    t.oncomplete = res
  })
  return true
})
await page.keyboard.press('Escape')
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('clear up')
await page.waitForTimeout(500)
await page.keyboard.press('Enter')
await page.waitForTimeout(6000)
const kept = await page.evaluate(async () => {
  const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
  const blob = await new Promise((res) => {
    const t = db.transaction('blobs', 'readonly')
    const q = t.objectStore('blobs').get('img_a_newer_build_keeps_this')
    q.onsuccess = () => res(q.result)
    q.onerror = () => res(null)
  })
  return blob ? blob.size : 0
})
ok('and the file it points at survives a sweep', swept && kept === 4096, `${kept} bytes`)

fs.writeFileSync(path.join(OUT, 'ahead.png'), await page.screenshot())

/* ---------- and a record no build ever wrote ---------- */

/* The card above is handled now, so this is the other half: something that
   still throws. A note whose words are a number is not a shape anything here
   writes — the store only ever puts a string there and the relay refuses
   anything else — so it stands in for the corrupt record and the unforeseen
   bug alike, and drawing it is a real throw rather than a simulated one.
 
   Six other malformed cards were tried and drawn without complaint: a chain
   that is a string, a stack that is a string, materials that are a string, a
   whole `fx` that is a string, a card with no id, a section inside itself.
   That is worth knowing — the boundary is not standing in for a fragile app —
   but one throw is all it takes, and this is what happens when there is one. */
await fresh()
await page.keyboard.press('n')
await page.waitForTimeout(1200)
await putCard({ id: 'i_broken', kind: 'note', x: 300, y: 260, w: 300, h: 200, z: 9, tag: null, name: 'Half a record', text: 42, fx: { fxid: 'none', ep: null, preset: 'none', n: 1, more: [] } })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2600)

const said = await alive()
ok('a render that throws does not leave a blank page',
   said.words.length > 0, `${said.words.length} characters on it`)
ok('it says the board could not be drawn',
   /could not be drawn/i.test(said.words), said.words.slice(0, 60))
/* The sentence that matters. Somebody watching their work vanish needs the
   first thing they read to be that it has not. */
ok('and says the work is still there, which is the thing worth saying',
   /still here/i.test(said.words) && /storage/i.test(said.words), said.words.slice(0, 140))
ok('and offers the thing that usually fixes it',
   (await page.locator('button', { hasText: /reload the board/i }).count()) === 1)

fs.writeFileSync(path.join(OUT, 'ahead-boom.png'), await page.screenshot())

/* Pressing it has to actually reload, and the board is still broken after —
   the point is that the app says so every time rather than once. */
await page.locator('button', { hasText: /reload the board/i }).click()
await page.waitForTimeout(2600)
ok('and pressing it reloads rather than doing nothing',
   /could not be drawn/i.test((await alive()).words))

console.log('\npage errors (the throw itself is expected here):', errors.length)
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length ? 1 : 0)
