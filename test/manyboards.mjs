/* More than one board, and a browser tab for each.
 *
 *   npm run build && node scripts/browser-tests.mjs manyboards
 *
 * There was one board and everything else nested inside it, so last month's
 * work was reached by walking down into it from the same root and two projects
 * could never be on screen together.
 *
 * A board's address is now in the page's address, which is what makes a board
 * something a browser tab can be pointed at. So the test that matters is the
 * one an in-app switcher could never pass: two tabs, two boards, at the same
 * time, neither treading on the other. The rest is the housekeeping that has to
 * hold for that to be worth having — a board that is really separate, a list
 * built of real links, and an address for a board that is gone failing softly.
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
/* One context throughout: two tabs of the same browser is the thing being
   tested, and separate contexts would be two different browsers. */
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
const watch = (p) => p.on('pageerror', (e) => errors.push(e.message))
watch(page)

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

const cards = (p) => p.locator('.card').count()
const openMenu = async (p) => {
  await p.locator('.boards-open').click()
  await p.waitForSelector('.boards-list a', { timeout: 5000 })
  await p.waitForTimeout(200)
}

/* ---------- the list ---------- */
ok('a board offers the others', (await page.locator('.boards-open').count()) === 1)
await openMenu(page)
const first = await page.locator('.boards-list a').count()
ok('and the board you are on is in it, marked as the one you are on',
   first === 1 && (await page.locator('.boards-list a[data-on]').count()) === 1, `${first} listed`)
ok('every entry is a real link, so the browser can open one in its own tab',
   (await page.locator('.boards-list a[href*="board="]').count()) === first)
fs.writeFileSync(path.join(OUT, 'manyboards-list.png'), await page.screenshot())

/* ---------- something to tell them apart by ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('n')
await page.waitForTimeout(700)
ok('the first board has something on it', (await cards(page)) === 1)
await page.waitForTimeout(1200)

/* ---------- a second board ---------- */
await openMenu(page)
await page.locator('.boards-new').click()
await page.waitForTimeout(2600)
const second = new URL(page.url()).searchParams.get('board')
ok('a new board puts its own address in the bar', !!second && second !== 'board_local', page.url())
ok('and it is empty, which is the point of it being a different board', (await cards(page)) === 0,
   `${await cards(page)} cards`)

await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('l')
await page.waitForTimeout(700)
ok('and it can be worked on', (await cards(page)) === 1)
await page.waitForTimeout(1200)

await openMenu(page)
ok('both boards are listed now', (await page.locator('.boards-list a').count()) === 2,
   `${await page.locator('.boards-list a').count()} listed`)

/* ---------- the thing an in-app switcher could not do ---------- */
const other = await context.newPage()
watch(other)
await other.goto(`${BASE}/?board=board_local`, { waitUntil: 'domcontentloaded' })
await other.waitForTimeout(2400)
ok('a second tab opens the other board at the same time', (await cards(other)) === 1)
ok('and each tab is on its own board',
   (await cards(page)) === 1 && (await cards(other)) === 1 &&
   (await page.locator('.card[data-kind="label"]').count()) === 1 &&
   (await other.locator('.card[data-kind="note"]').count()) === 1,
   `new board: ${await page.locator('.card[data-kind="label"]').count()} label, first board: ${await other.locator('.card[data-kind="note"]').count()} note`)

/* Work in one must not disturb the other. Two tabs on the *same* board argue
   about who saved last, on purpose; two tabs on two boards have nothing to
   argue about and must simply leave each other alone. */
await other.keyboard.press('Escape')
await other.waitForTimeout(200)
await other.keyboard.press('n')
await other.waitForTimeout(1600)
ok('working in one tab does not reach into the other',
   (await cards(other)) === 2 && (await cards(page)) === 1,
   `first board ${await cards(other)}, new board ${await cards(page)}`)
ok('and neither tab is asked to resolve a clash it does not have',
   (await page.locator('.clash, .tabclash').count()) === 0 && (await other.locator('.clash, .tabclash').count()) === 0)
fs.writeFileSync(path.join(OUT, 'manyboards-two.png'), await other.screenshot())

/* ---------- and it all survives being reloaded ---------- */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2400)
ok('a tab reloads onto the board it was pointed at',
   new URL(page.url()).searchParams.get('board') === second && (await cards(page)) === 1,
   page.url())
await other.close()

/* ---------- an address for a board that is not there ---------- */
const stray = await context.newPage()
watch(stray)
await stray.goto(`${BASE}/?board=b_nosuchboard`, { waitUntil: 'domcontentloaded' })
await stray.waitForTimeout(2800)
ok('an address naming a board that does not exist falls back rather than opening a phantom',
   !new URL(stray.url()).searchParams.get('board') && (await stray.locator('.viewport').count()) === 1,
   stray.url())
ok('and lands on a real board with real work on it', (await cards(stray)) === 2, `${await cards(stray)} cards`)
await stray.close()

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
