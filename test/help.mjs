/* How this works, and the ways in to it.
 *
 *   npm run build && node scripts/browser-tests.mjs help
 *
 * Every button here says what it is on a tooltip and the command list will
 * find anything by name, so what was missing was never a list of the controls.
 * It was the handful of things you cannot deduce from a button: that the work
 * is in this browser and nowhere else, that closing a tab destroys a project,
 * that the picture-drawing spends your own money. This is the page that says
 * so, and the checks below are about it being reachable, readable and
 * escapable rather than about its prose.
 *
 * The one that matters most is the quietest: while it is open, the board's own
 * keys must do nothing. A help page that adds a note to the board behind it
 * every time you read the word "note" would be worse than no help page.
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
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const open = () => page.locator('.help').count()
const shut = async () => { if (await open()) { await page.keyboard.press('Escape'); await page.waitForTimeout(300) } }

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
await page.waitForTimeout(500)

/* ---------- the ways in ---------- */
ok('an empty board offers it to somebody who would rather read first',
   (await page.locator('.first-help').count()) === 1)
await page.locator('.first-help').click()
await page.waitForSelector('.help', { timeout: 5000 })
ok('and that opens it', (await open()) === 1)
await shut()
ok('escape puts you back on the board', (await open()) === 0)

await page.keyboard.press('?')
await page.waitForTimeout(400)
ok('one key opens it — the one you would guess', (await open()) === 1)
await shut()

const helpButton = page.locator('.topbar .tool[aria-label="Help"]')
ok('there is a button for it in the top row, next to the command list',
   (await helpButton.count()) === 1)
/* It is the one button that must not fall off a narrow window: the smaller
   the window, the likelier this is somebody's first look at the app. */
ok('and it does not stand down when the row runs short',
   (await page.locator('.topbar .tool[aria-label="Help"][data-narrow]').count()) === 0)
await helpButton.click()
await page.waitForSelector('.help', { timeout: 5000 })
ok('the button opens it', (await open()) === 1)

/* The keyboard comes with it. It covers the board and takes the board's keys,
   so leaving focus behind means tabbing through a page nobody can see. */
ok('the keyboard comes with it, on the way out',
   (await page.evaluate(() => document.activeElement?.className)) === 'ghost')

/* ---------- what is in it ---------- */
const heads = await page.locator('.help-body section h3').allInnerTexts()
ok('it is a page of sections rather than a wall', heads.length >= 8, `${heads.length}: ${heads.join(' / ')}`)
ok('every section says what it is about', heads.every((h) => h.trim().length > 3))
const words = (await page.locator('.help-body').innerText()).split(/\s+/).length
ok('and there is something in them to read', words > 500, `${words} words`)

const navs = await page.locator('.help-nav button').allInnerTexts()
ok('the sections are listed down the side, so you can see what there is',
   navs.length === heads.length, `${navs.length} listed, ${heads.length} sections`)
ok('and the list matches the page', navs.join('|') === heads.join('|'), navs.join(' / '))
ok('one of them is marked as the one you are reading',
   (await page.locator('.help-nav button[data-on]').count()) === 1)

/* The questions somebody actually arrives with. Not a check on the wording —
   on the subjects being covered at all. */
const text = (await page.locator('.help-body').innerText()).toLowerCase()
for (const [what, needles] of [
  ['where the work is kept', ['this browser', 'nothing']],
  ['what closing a tab does', ['deletes that project']],
  ['what the drawing costs', ['your own', 'key']],
  ['that effects stack', ['stack']],
  ['how to get work out', ['export']],
]) {
  ok(`it answers ${what}`, needles.every((n) => text.includes(n)), needles.join(' + '))
}

/* ---------- the keys ---------- */
const rows = await page.locator('.help-keys tr').count()
ok('every key is written down in one place', rows >= 20, `${rows} keys`)
/* Generated from the same table the toolbar reads, so this is really a check
   that nobody has written a second list by hand. */
const hint = await page.locator('.topbar .tool[aria-label="Note"]').getAttribute('title')
const noteKey = hint.match(/\(([^)]+)\)$/)[1]
ok('and they are the keys the buttons claim, not a list that has drifted',
   (await page.locator('.help-keys kbd').allInnerTexts()).includes(noteKey), `note is ${noteKey}`)

/* ---------- moving around it ---------- */
const top = () => page.locator('.help-body').evaluate((e) => e.scrollTop)
ok('it starts at the beginning', (await top()) < 20, `${await top()}px`)
await page.locator('.help-nav button').last().click()
await page.waitForTimeout(900)
ok('clicking a section in the list goes to it', (await top()) > 300, `${await top()}px`)
ok('and the list keeps up with where you are',
   (await page.locator('.help-nav button[data-on]').last().innerText()) === navs[navs.length - 1])

fs.writeFileSync(path.join(OUT, 'help.png'), await page.screenshot())

/* ---------- it does not sit on the board's keyboard ---------- */
/* The quiet one. Everything that covers the board takes the keys with it, or
   reading the word "note" adds notes to the board underneath. */
await page.keyboard.press('n')
await page.waitForTimeout(500)
await page.keyboard.press('s')
await page.waitForTimeout(500)
ok('the board behind it does not answer its own keys',
   (await open()) === 1 && (await page.locator('.card').count()) === 0,
   `${await page.locator('.card').count()} cards appeared`)

/* ---------- and it goes away ---------- */
await page.mouse.click(30, 450)
await page.waitForTimeout(400)
ok('clicking the board behind it closes it', (await open()) === 0)

await page.keyboard.press('?')
await page.waitForTimeout(400)
await page.locator('.help-top .ghost').click()
await page.waitForTimeout(400)
ok('so does the close button', (await open()) === 0)

/* And back to whatever opened it, rather than to the top of the page. */
await helpButton.click()
await page.waitForSelector('.help', { timeout: 5000 })
await page.locator('.help-top .ghost').click()
await page.waitForTimeout(400)
ok('and the keyboard goes back to the button that opened it',
   (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Help')

/* ---------- and the board has its keys back ---------- */
await page.keyboard.press('n')
await page.waitForTimeout(700)
ok('the board answers again once it is shut', (await page.locator('.card').count()) === 1)

/* ---------- the command list knows about it ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('help')
await page.waitForTimeout(500)
const found = (await page.locator('.cmd-row').allInnerTexts()).join(' | ').replace(/\n/g, ' ')
ok('and the command list finds it under the word somebody would type',
   /how this works/i.test(found), found.slice(0, 120))
await page.keyboard.press('Enter')
await page.waitForTimeout(600)
ok('and running it opens it', (await open()) === 1)

/* ---------- it fits ---------- */
const fits = await page.locator('.help').evaluate((e) => {
  const r = e.getBoundingClientRect()
  return r.width <= innerWidth && r.height <= innerHeight && r.left >= 0 && r.top >= 0
})
ok('it fits in the window', fits)
const wide = await page.locator('.help-body').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)
ok('and nothing in it runs off the side', wide)

await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(500)
const fitsSmall = await page.locator('.help').evaluate((e) => {
  const r = e.getBoundingClientRect()
  return r.width <= innerWidth && r.height <= innerHeight
})
ok('and it still fits on a phone', fitsSmall)
ok('with the sections still listed', (await page.locator('.help-nav button').count()) === navs.length)
fs.writeFileSync(path.join(OUT, 'help-narrow.png'), await page.screenshot())

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
