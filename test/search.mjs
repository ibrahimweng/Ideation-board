/* Search filtering.
 *   npm run dev &
 *   node test/search.mjs http://localhost:5173
 * Clears the board's stored data first. */
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => indexedDB.deleteDatabase('ideation.board.db'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* Three notes with distinct words, plus a link and an image. */
const texts = ['launch plan for spring', 'colour studies', 'launch checklist']
for (const t of texts) {
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.waitForTimeout(350)
  await page.locator('.card[data-kind="note"]').last().dblclick()
  await page.waitForTimeout(400)
  await page.locator('.sheet textarea').fill(t)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(400)
}
page.once('dialog', (d) => d.accept('https://example.com/launch-notes'))
await page.getByRole('button', { name: 'Link', exact: true }).click()
await page.waitForTimeout(500)
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300
  const x = c.getContext('2d'); x.fillStyle = '#3a7'; x.fillRect(0, 0, 400, 300)
  const dt = new DataTransfer()
  dt.items.add(new File([await new Promise(r => c.toBlob(r, 'image/jpeg', .9))], 'moodboard.jpg', { type: 'image/jpeg' }))
  const vp = document.querySelector('.viewport')
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 200, clientY: 640 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt }); vp.dispatchEvent(ev)
})
await page.waitForTimeout(2000)

const total = await page.locator('.card').count()
ok('setup: cards on the board', total >= 5, `${total} cards`)

ok('search: bar is present', await page.locator('.search input').count() === 1)

const dimmed = async () => page.locator('.card[data-dim]').count()
const lit = async () => page.locator('.card:not([data-dim])').count()

/* text in a note */
await page.locator('.search input').fill('launch')
await page.waitForTimeout(500)
ok('search: dims cards that do not match', (await dimmed()) > 0, `${await dimmed()} dimmed, ${await lit()} lit`)
ok('search: keeps matching cards visible', (await lit()) >= 2, `${await lit()} lit`)
ok('search: shows a result count', /\d+\/\d+/.test(await page.locator('.search-count').innerText()),
   await page.locator('.search-count').innerText())
fs.writeFileSync(path.join(OUT, 'search-active.png'), await page.screenshot())

/* a card name */
await page.locator('.search input').fill('moodboard')
await page.waitForTimeout(500)
const litNames = await page.evaluate(() =>
  [...document.querySelectorAll('.card:not([data-dim])')].map(c => c.querySelector('.card-name')?.textContent || c.dataset.kind))
ok('search: matches on a file name', litNames.some(n => (n || '').includes('moodboard')), litNames.join(','))

/* a url */
await page.locator('.search input').fill('example.com')
await page.waitForTimeout(500)
ok('search: matches on a link url', (await lit()) >= 1, `${await lit()} lit`)

/* kind */
await page.locator('.search input').fill('note')
await page.waitForTimeout(500)
ok('search: matches on the kind of card', (await lit()) >= 3, `${await lit()} lit`)

/* two words, any order */
await page.locator('.search input').fill('spring launch')
await page.waitForTimeout(500)
ok('search: every word has to match, in any order', (await lit()) === 1, `${await lit()} lit`)

/* no results */
await page.locator('.search input').fill('zzzznothing')
await page.waitForTimeout(500)
ok('search: says when nothing matches', (await page.locator('.search-count').innerText()).toLowerCase().includes('none'),
   await page.locator('.search-count').innerText())
ok('search: dims everything when nothing matches', (await lit()) === 0, `${await lit()} lit`)

/* dimmed cards must not take the pointer */
await page.locator('.search input').fill('launch')
await page.waitForTimeout(500)
const dimHit = await page.evaluate(() => {
  const d = document.querySelector('.card[data-dim]')
  if (!d) return 'no dimmed card'
  const r = d.getBoundingClientRect()
  const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + 8))
  return el?.closest('.card[data-dim]') ? 'dimmed card took it' : 'passed through'
})
ok('search: a dimmed card does not take the pointer', dimHit === 'passed through', dimHit)

/* Enter steps through results and moves the board */
const viewBefore = await page.evaluate(() => document.querySelector('.surface').style.transform)
await page.locator('.search input').press('Enter')
await page.waitForTimeout(600)
const viewAfter = await page.evaluate(() => document.querySelector('.surface').style.transform)
ok('search: Enter moves the board to a result', viewBefore !== viewAfter, `${viewBefore} -> ${viewAfter}`)
ok('search: Enter selects the result', await page.locator('.card[data-sel]').count() === 1)
const countText = await page.locator('.search-count').innerText()
await page.locator('.search input').press('Enter')
await page.waitForTimeout(500)
ok('search: Enter again moves to the next one', (await page.locator('.search-count').innerText()) !== countText,
   `${countText} -> ${await page.locator('.search-count').innerText()}`)

/* clearing restores everything */
await page.locator('.search input').press('Escape')
await page.waitForTimeout(500)
ok('search: Escape clears it', (await page.locator('.search input').inputValue()) === '')
ok('search: clearing brings every card back', (await dimmed()) === 0, `${await dimmed()} still dimmed`)

/* the shortcut focuses it */
await page.locator('.viewport').click({ position: { x: 40, y: 700 } })
await page.waitForTimeout(300)
await page.keyboard.press('/')
await page.waitForTimeout(400)
ok('search: slash focuses the box',
   await page.evaluate(() => document.activeElement?.closest('.search') !== null))

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter(r => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
