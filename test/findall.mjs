/* Finding something when you cannot remember which project it is in.
 *
 *   npm run build && node scripts/browser-tests.mjs findall
 *
 * Search used to walk down from the board you were standing on and stop there.
 * That was the whole world when there was one project and everything lived
 * inside it; with a row of tabs it is half of one. "Which project did I put
 * that in" was a question you answered by opening each tab and searching it
 * again — which is exactly the work the search box exists to save.
 *
 * So: a note in another project has to turn up, the row has to say which
 * project it is in before you commit to it, and picking it has to land you on
 * the card with the tabs and the address following. The things that must not
 * regress are underneath: a hit in this project is still not labelled with a
 * project name, and this project's hits still come first, because there is a
 * cap on the list and the answer is nearly always close to hand.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const ready = async () => {
  await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
  await page.waitForTimeout(400)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await ready()

/* ---------- somewhere to lose things ---------- */
const rename = async (to) => {
  await page.locator('.board-name').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(to)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(1400)
}
const writeNote = async (text) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.keyboard.press('n')
  await page.waitForTimeout(500)
  await page.locator('.card[data-kind="note"]').last().dblclick()
  await page.waitForTimeout(500)
  await page.locator('.sheet textarea').fill(text)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(1400)
}
const newProject = async () => {
  const before = await page.locator('.tab').count()
  await page.locator('.tab-new').click()
  await page.waitForFunction((n) => document.querySelectorAll('.tab').length === n + 1, before, { timeout: 15000 })
  await page.waitForTimeout(900)
}
const search = async (q) => {
  await page.locator('.search input').fill(q)
  /* The walk is debounced, and then it reads every board of every project. */
  await page.waitForTimeout(2200)
}
const rows = async () => {
  if (!(await page.locator('.search-deep').count())) return []
  if (!(await page.locator('.deep-pop').count())) await page.locator('.search-deep').click()
  await page.waitForTimeout(400)
  return page.locator('.deep-pop button').allInnerTexts()
}
const shut = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}
const onTab = () => page.locator('.tab[data-on] .tab-name').innerText()

await rename('Brand refresh')
await writeNote('zellige tiles, the blue ones')

await newProject()
await rename('Packaging')
await writeNote('corrugated sleeve, uncoated')
/* And one more, a board down, so a result can have somewhere to be inside a
   project that is not the one you are standing in. */
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('b')
await page.waitForTimeout(1200)
await page.locator('.card[data-kind="board"]').last().dblclick()
await page.waitForTimeout(1800)
await writeNote('foil stamp, buried')
await page.locator('.crumbs button').first().click()
await page.waitForTimeout(1600)

ok('two projects, one of them with a board inside it',
   (await page.locator('.tab').count()) === 2, `${await page.locator('.tab').count()} tabs`)

/* ---------- a word from the project you are not in ---------- */
await page.locator('.tab:not([data-on])').first().click()
await page.waitForTimeout(1400)
ok('standing in the first project', (await onTab()) === 'Brand refresh', await onTab())

await search('corrugated')
ok('nothing on this board matches, and it says so',
   (await page.locator('.search-count').innerText()).toLowerCase().includes('none'),
   await page.locator('.search-count').innerText())
ok('but the other project is searched too', (await page.locator('.search-deep').count()) === 1)
const away = await rows()
ok('and the card in it is offered', away.length === 1 && away[0].includes('corrugated'),
   away.join(' | ').replace(/\n/g, ' '))
ok('with the project it is in, so the jump is not a surprise',
   away[0].includes('Packaging'), away[0].replace(/\n/g, ' — '))
ok('and it is marked as being somewhere further away than a board',
   (await page.locator('.deep-pop em[data-away]').count()) === 1)
fs.writeFileSync(path.join(OUT, 'findall.png'), await page.screenshot())

/* ---------- and going there ---------- */
await page.locator('.deep-pop button').first().click()
await page.waitForTimeout(2600)
ok('picking one switches to the project it is in', (await onTab()) === 'Packaging', await onTab())
ok('and the address follows, so the link still names what is on screen',
   (await page.evaluate(() => new URLSearchParams(location.search).get('board'))) !== 'board_local',
   page.url())
ok('and it lands on the card it found', (await page.locator('.card[data-sel]').count()) === 1)
const landed = await page.evaluate(() => document.querySelector('.card[data-sel]')?.textContent || '')
ok('which is the one that matched', landed.includes('corrugated'), landed.slice(0, 60))

/* ---------- a board inside another project ---------- */
await shut()
await page.locator('.tab:not([data-on])').first().click()
await page.waitForTimeout(1600)
await search('foil')
const deep = await rows()
ok('a board inside another project is reached too',
   deep.length === 1 && deep[0].includes('foil'), deep.join(' | ').replace(/\n/g, ' '))
ok('and the row says the project and the board, in that order',
   /Packaging\s*\/\s*\S/.test(deep[0].replace(/\n/g, ' ')), deep[0].replace(/\n/g, ' — '))

await page.locator('.deep-pop button').first().click()
await page.waitForTimeout(2800)
ok('and picking it opens the project and walks down into the board',
   (await onTab()) === 'Packaging' && (await page.locator('.crumbs button').count()) >= 1,
   `${await onTab()}, ${await page.locator('.crumbs button').count()} crumbs`)
ok('landing on the card', (await page.locator('.card[data-sel]').count()) === 1)

/* ---------- what must not have changed ---------- */
/* A hit inside this project is not a jump to another one, and saying it is
   would be worse than saying nothing. */
await shut()
await page.locator('.crumbs button').first().click()
await page.waitForTimeout(1600)
await search('foil')
const near = await rows()
ok('a board below the one you are on is still found',
   near.length === 1 && near[0].includes('foil'), near.join(' | ').replace(/\n/g, ' '))
ok('and is not dressed up as another project',
   !near[0].includes('Packaging') && (await page.locator('.deep-pop em[data-away]').count()) === 0,
   near[0].replace(/\n/g, ' — '))

/* This project first: the list is capped, and the answer is nearly always
   close to hand. */
await shut()
await search('tiles')
const far = await rows()
ok('a word from the other project still reaches across',
   far.length === 1 && far[0].includes('zellige'), far.join(' | ').replace(/\n/g, ' '))

await shut()
await search('note')
const mixed = await rows()
const firstAway = mixed.findIndex((r) => r.includes('Brand refresh'))
ok('when both match, this project comes first',
   firstAway === -1 || mixed.slice(0, firstAway).every((r) => !r.includes('Brand refresh')),
   mixed.join(' | ').replace(/\n/g, ' ').slice(0, 160))

/* ---------- a word that is nowhere ---------- */
await shut()
await search('quinquagenarian')
ok('a word nobody wrote finds nothing anywhere',
   (await page.locator('.search-deep').count()) === 0 &&
   (await page.locator('.search-count').innerText()).toLowerCase().includes('none'))

/* ---------- and a deleted project stops being searched ---------- */
await page.locator('.search input').fill('')
await page.waitForTimeout(500)
page.on('dialog', (d) => d.accept())
await page.locator('.tab:not([data-on])').first().locator('.tab-close').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 1, { timeout: 15000 })
await page.waitForTimeout(1200)
await search('zellige')
ok('a project you deleted stops turning up in the answers',
   (await page.locator('.search-deep').count()) === 0,
   await page.locator('.search-deep').innerText().catch(() => 'no button'))

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
