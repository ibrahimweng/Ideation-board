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

/* Cards added from the toolbar cascade and overlap, so a click aimed at one
 * can land on another. This finds a spot that really belongs to the card. */
const pointOn = async (index) => page.evaluate((i) => {
  const card = document.querySelectorAll('.card[data-kind="note"]')[i]
  if (!card) return null
  const r = card.getBoundingClientRect()
  const cy = Math.round(r.top + r.height / 2), cx = Math.round(r.left + r.width / 2)
  for (let dy = 0; dy < r.height / 2 - 6; dy += 8) {
    for (let dx = 0; dx < r.width / 2 - 6; dx += 8) {
      const y = cy + (dy % 16 === 0 ? dy : -dy), x = cx + (dx % 16 === 0 ? dx : -dx)
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('.card-handles') && el.closest('.card') === card) return { x, y }
    }
  }
  return null
}, index)

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

/* ---------- tag filter ---------- */
await page.locator('.search input').fill('')
await page.waitForTimeout(400)

/* A selected card shows resize handles in a layer above the board, and those
 * can sit over a neighbouring card. Clearing the selection first keeps the
 * clicks below aimed at cards. */
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* tag two of the notes differently through the right click menu */
const tagNote = async (index, swatch) => {
  const p = await pointOn(index)
  if (!p) return false
  await page.mouse.click(p.x, p.y, { button: 'right' })
  await page.waitForTimeout(500)
  await page.locator('.menu-tags button').nth(swatch).click()
  await page.waitForTimeout(700)
  return true
}
ok('setup: tagged one note', await tagNote(0, 1))
ok('setup: tagged another note differently', await tagNote(1, 2))

ok('tag filter: control is present', await page.locator('.tagfilter').count() === 1)
ok('tag filter: starts on all tags', (await page.locator('.tagfilter').innerText()).toLowerCase().includes('all'),
   await page.locator('.tagfilter').innerText())

await page.locator('.tagfilter').click()
await page.waitForTimeout(400)
ok('tag filter: opens a list', await page.locator('.tf-pop').count() === 1)
const rows = await page.locator('.tf-pop button').allInnerTexts()
ok('tag filter: lists all tags, each colour and untagged',
   rows.length === 7 && /all tags/i.test(rows[0]) && /untagged/i.test(rows[rows.length - 1]),
   rows.map(r => r.replace(/\n/g, ' ')).join(' | '))
fs.writeFileSync(path.join(OUT, 'tagfilter-open.png'), await page.screenshot())

/* the dropdown must not be cut off by the top bar */
const notClipped = await page.evaluate(() => {
  const p = document.querySelector('.tf-pop').getBoundingClientRect()
  const bar = document.querySelector('.topbar').getBoundingClientRect()
  return p.bottom > bar.bottom && p.height > 100
})
ok('tag filter: list is not clipped by the top bar', notClipped)

/* pick the first colour */
await page.locator('.tf-pop button').nth(1).click()
await page.waitForTimeout(600)
ok('tag filter: closes after choosing', await page.locator('.tf-pop').count() === 0)
const litNow = await page.locator('.card:not([data-dim])').count()
ok('tag filter: dims cards without that tag', litNow === 1, `${litNow} lit`)
ok('tag filter: button shows the chosen tag',
   !/all tags/i.test(await page.locator('.tagfilter').innerText()),
   await page.locator('.tagfilter').innerText())

/* combining with text: both have to match */
await page.locator('.search input').fill('zzzznothing')
await page.waitForTimeout(500)
ok('tag filter: text and tag narrow together',
   (await page.locator('.card:not([data-dim])').count()) === 0,
   `${await page.locator('.card:not([data-dim])').count()} lit`)
await page.locator('.search input').fill('')
await page.waitForTimeout(500)

/* untagged */
await page.locator('.tagfilter').click()
await page.waitForTimeout(400)
await page.locator('.tf-pop button').last().click()
await page.waitForTimeout(600)
const untaggedLit = await page.locator('.card:not([data-dim])').count()
ok('tag filter: untagged picks the cards with no tag', untaggedLit >= 2, `${untaggedLit} lit`)

/* back to all */
await page.locator('.tagfilter').click()
await page.waitForTimeout(400)
await page.locator('.tf-pop button').first().click()
await page.waitForTimeout(600)
ok('tag filter: all tags brings every card back',
   (await page.locator('.card[data-dim]').count()) === 0,
   `${await page.locator('.card[data-dim]').count()} still dimmed`)

/* ---------- narrowing is only half of it ---------- */
/* Until now the search box could show you four cards out of thirty and there
   was no way to do anything with those four: Select all took thirty, and so
   did presenting and exporting. */
await page.locator('.search input').fill('launch')
await page.waitForTimeout(500)
const litResults = await lit()
ok('act on results: the count is something you can press', (await page.locator('button.search-count').count()) === 1)

await page.locator('.search input').press('Control+Enter')
await page.waitForTimeout(500)
ok('act on results: Cmd and Enter takes all of them',
   (await page.locator('.card[data-sel]').count()) === litResults,
   `${await page.locator('.card[data-sel]').count()} selected, ${litResults} lit`)
ok('act on results: and nothing that was faded out',
   (await page.locator('.card[data-dim][data-sel]').count()) === 0)

await page.keyboard.press('Escape')
await page.waitForTimeout(250)
await page.locator('.search input').fill('launch')
await page.waitForTimeout(400)
await page.locator('button.search-count').click()
await page.waitForTimeout(400)
ok('act on results: pressing the count does the same',
   (await page.locator('.card[data-sel]').count()) === litResults,
   `${await page.locator('.card[data-sel]').count()} selected`)

await page.keyboard.press('Escape')
await page.waitForTimeout(250)
await page.locator('.search input').fill('launch')
await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement.blur())
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
ok('act on results: with a search running, Select all means what you can see',
   (await page.locator('.card[data-sel]').count()) === litResults && (await page.locator('.card[data-dim][data-sel]').count()) === 0,
   `${await page.locator('.card[data-sel]').count()} of ${litResults}`)

await page.keyboard.press('Escape')
await page.locator('.search input').fill('')
await page.waitForTimeout(400)
await page.evaluate(() => document.activeElement.blur())
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
const everything = await page.locator('.card[data-sel]').count()
ok('act on results: and with no search running it means everything', everything > litResults,
   `${everything} with no filter, ${litResults} with one`)
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter(r => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
