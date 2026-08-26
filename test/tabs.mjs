/* Two tabs, one board.
 *
 *   npm run dev &
 *   node test/tabs.mjs http://localhost:5173
 *
 * Everything here is kept in one browser, and a browser has tabs. Open the app
 * twice — a bookmark, a restored session, "open in new tab" — and both copies
 * used to load the same record and both write it back, neither knowing the
 * other existed. Whichever saved last won and the other one's work was gone:
 * no warning, no conflict, no undo, and the tab that lost it never found out.
 *
 * Two tabs are opened in one browser context here, which is what two tabs are.
 * What has to be true: a tab that is only looking picks up what the other one
 * did; a tab that has its own unwritten work is never quietly overwritten and
 * never quietly overwrites; and when the two really do collide, the question
 * is put to the person with both versions still in existence.
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
/* One context, so the two pages share a browser the way two tabs do. */
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const errors = []
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)))

const A = await ctx.newPage()
await A.goto(BASE, { waitUntil: 'domcontentloaded' })
await A.waitForTimeout(900)
await A.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await A.reload({ waitUntil: 'domcontentloaded' })
await A.waitForTimeout(1800)

const note = async (page, text) => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.waitForTimeout(400)
  await page.locator('.card[data-kind="note"]').last().dblclick()
  await page.waitForTimeout(400)
  await page.locator('.sheet textarea').fill(text)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(800)
}
const cards = (page) => page.locator('.card').count()
const texts = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="note"]')].map((c) => (c.textContent || '').replace(/^Note/, '').trim().slice(0, 24)))

await note(A, 'written in tab one')
await A.waitForTimeout(1600)
ok('setup: the first tab has a board', (await cards(A)) === 1)

/* ---------- the second tab ---------- */
const B = await ctx.newPage()
await B.goto(BASE, { waitUntil: 'domcontentloaded' })
await B.waitForTimeout(2400)
ok('a second tab opens on the same board', (await cards(B)) === 1, `${await cards(B)} cards`)

await note(B, 'written in tab two')
await B.waitForTimeout(1800)
ok('and can add to it', (await cards(B)) === 2)

/* ---------- the first tab is told ---------- */
await A.bringToFront()
await A.waitForTimeout(2400)
ok('the first tab picks it up without being touched', (await cards(A)) === 2,
   `${await cards(A)} cards — was 1`)
/* The card arrives before its words are drawn, so this waits for them. */
await A.waitForFunction(() =>
  [...document.querySelectorAll('.card[data-kind="note"]')].every((c) => (c.textContent || '').length > 4),
  { timeout: 5000 }).catch(() => {})
const both = await texts(A)
ok('and has both notes on it', both.some((t) => t.includes('tab one')) && both.some((t) => t.includes('tab two')),
   both.join(' | '))
fs.writeFileSync(path.join(OUT, 'tabs-caught-up.png'), await A.screenshot())

/* ---------- so writing again keeps everything ---------- */
await note(A, 'written in tab one again')
await A.waitForTimeout(2000)
await A.reload({ waitUntil: 'domcontentloaded' })
await A.waitForTimeout(2400)
const kept = await texts(A)
ok('so a later write in the first tab keeps the second tab’s work', kept.length === 3, `${kept.length} notes: ${kept.join(' | ')}`)
ok('which is the whole point: nothing was silently thrown away',
   kept.some((t) => t.includes('tab two')), kept.join(' | '))

/* ---------- and the second tab catches up too ---------- */
await B.bringToFront()
await B.waitForTimeout(2000)
ok('and the second tab is brought up to date in turn', (await cards(B)) === 3, `${await cards(B)} cards`)

/* ---------- when they really do collide ----------
   Both tabs edited before either wrote. There is no answer here that is not
   somebody's loss, so nothing is decided: the tab holding unwritten work stops
   saving and asks, with both versions still in existence while it does.

   Staged rather than raced. A record written straight into storage, newer than
   anything this tab has read, is exactly what a second tab leaves behind — and
   it is also what a browser with no way to pass messages between tabs leaves
   behind, which is the case the guard on every write exists for. */
await A.bringToFront()
await A.waitForTimeout(400)
const before = await cards(A)
await A.evaluate(() => new Promise((done) => {
  const req = indexedDB.open('ideation.board.db')
  req.onsuccess = () => {
    const db = req.result
    const s = db.transaction('boards', 'readwrite').objectStore('boards')
    const get = s.get('board_local')
    get.onsuccess = () => {
      const rec = get.result
      /* Their version: everything that is there now, and one more. */
      rec.items = [...rec.items, { ...rec.items[0], id: 'i_from_the_other_tab', y: (rec.items[0]?.y || 0) + 400, text: 'written in the other tab' }]
      rec.updated = Date.now() + 60000
      s.put(rec).onsuccess = () => done()
    }
  }
}))
/* And now this tab has work of its own to write. */
await A.getByRole('button', { name: 'Label', exact: true }).click()
await A.waitForTimeout(2600)

ok('a write that would overwrite a newer record stops and asks',
   (await A.locator('.alarm').count()) === 1,
   (await A.locator('.alarm strong').innerText().catch(() => 'nothing asked')))
const mine = await cards(A)
ok('the work it was holding is still on screen', mine === before + 1, `${mine} cards, was ${before}`)
ok('and it offers both answers', (await A.locator('.alarm-do button').count()) === 2,
   (await A.locator('.alarm-do button').allInnerTexts()).join(' / '))

/* Nothing is written while the question stands. */
await A.getByRole('button', { name: 'Label', exact: true }).click()
await A.waitForTimeout(2000)
ok('and it is still asking, not quietly saving', (await A.locator('.alarm').count()) === 1)
const onDisk = await A.evaluate(() => new Promise((done) => {
  const req = indexedDB.open('ideation.board.db')
  req.onsuccess = () => {
    const s = req.result.transaction('boards', 'readonly').objectStore('boards').get('board_local')
    s.onsuccess = () => done((s.result?.items || []).length)
  }
}))
ok('their version is still the one on disk, untouched', onDisk === before + 1, `${onDisk} items`)
fs.writeFileSync(path.join(OUT, 'tabs-clash.png'), await A.screenshot())

/* ---------- taking theirs ---------- */
await A.locator('.alarm-do button.ghost').click()
await A.waitForTimeout(2200)
ok('taking the other tab’s puts the question away', (await A.locator('.alarm').count()) === 0)
const after = await texts(A)
ok('and this tab is now showing their version', after.some((t) => t.includes('other tab')), after.join(' | '))
await A.reload({ waitUntil: 'domcontentloaded' })
await A.waitForTimeout(2400)
ok('which is what a reload finds', (await cards(A)) === onDisk, `${await cards(A)} of ${onDisk}`)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
