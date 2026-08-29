/* Undo, one board at a time.
 *
 *   npm run build && node scripts/browser-tests.mjs undoboards
 *
 * The history was two arrays cleared whenever a board was loaded. Clearing
 * them is right — an undo that reached across a board switch would put one
 * board's cards onto another — and it also meant that stepping into a nested
 * board and coming back cost you your undo, silently, with the keystroke doing
 * nothing at all.
 *
 * Kept per board, both are true at once, and that is what is checked here:
 * that walking away and back leaves the history where it was, that redo
 * survives the same trip, that a board's undo only ever undoes that board, and
 * that a board written by another tab while you were away does not hand you an
 * undo that would quietly overwrite what they did.
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

const ready = async (p) => {
  await p.waitForSelector('.app[data-ready]', { timeout: 20000 })
  await p.waitForTimeout(400)
}
const cards = (p = page) => p.locator('.card').count()
const add = async (key, n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    await page.keyboard.press(key)
    await page.waitForTimeout(450)
  }
  /* The save is debounced, and a board switched away from a moment too early
     comes back without what was just put on it. */
  await page.waitForTimeout(1400)
}
const undo = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(120)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(900)
}
const redo = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(120)
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(900)
}
const goIn = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.locator('.card[data-kind="board"]').last().dblclick()
  await page.waitForTimeout(1900)
}
const goUp = async () => {
  await page.locator('.crumbs button').first().click()
  await page.waitForTimeout(1900)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await ready(page)

/* ---------- three things, and a board to walk into ---------- */
await add('n', 3)
ok('three cards on the board', (await cards()) === 3, `${await cards()} cards`)
await add('b')
ok('and a board card to walk into', (await cards()) === 4, `${await cards()} cards`)

/* ---------- what used to be lost ---------- */
await goIn()
ok('inside, and it is a board of its own', (await cards()) === 0, `${await cards()} cards`)
await add('l', 2)
ok('with two things put on it', (await cards()) === 2, `${await cards()} cards`)
await goUp()
ok('back out, with everything still here', (await cards()) === 4, `${await cards()} cards`)

await undo()
ok('undo still has something to undo after the trip', (await cards()) === 3, `${await cards()} cards`)
await undo(2)
ok('and keeps going, all the way back through what was done here',
   (await cards()) === 1, `${await cards()} cards`)
fs.writeFileSync(path.join(OUT, 'undoboards.png'), await page.screenshot())

/* ---------- and it undid this board, not the other one ---------- */
/* The board card was the fourth thing made, so undoing three times took it
   away with the rest — which is the point: this board's history is this
   board's. What is inside it is untouched, and comes back when the card
   does. */
await redo(3)
ok('redo survives the trip too', (await cards()) === 4, `${await cards()} cards`)
await goIn()
ok('and the board inside is exactly as it was left', (await cards()) === 2, `${await cards()} cards`)

/* ---------- each board undoes its own ---------- */
await undo()
ok('its own undo works on its own cards', (await cards()) === 1, `${await cards()} cards`)
await goUp()
ok('and the board above is untouched by that', (await cards()) === 4, `${await cards()} cards`)
await goIn()
ok('as is the one below, on the way back in', (await cards()) === 1, `${await cards()} cards`)
await goUp()

/* ---------- across projects, too ---------- */
await page.locator('.tab-new').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2, { timeout: 15000 })
await page.waitForTimeout(1200)
ok('a second project, empty', (await cards()) === 0, `${await cards()} cards`)
await add('s', 2)
await undo()
ok('undo works there', (await cards()) === 1, `${await cards()} cards`)
await page.locator('.tab:not([data-on])').first().click()
await page.waitForTimeout(1800)
ok('and the first project is as it was', (await cards()) === 4, `${await cards()} cards`)
await page.locator('.tab:not([data-on])').first().click()
await page.waitForTimeout(1800)
ok('and so is the second, with its own step still to redo', (await cards()) === 1, `${await cards()} cards`)
await redo()
ok('which it can', (await cards()) === 2, `${await cards()} cards`)

/* ---------- a reload is a fresh start ---------- */
/* Nothing here is written to disk, and it should not be: undo is what you did
   in this sitting. What must not happen is a stale history surviving into a
   session that cannot honour it. */
await page.reload({ waitUntil: 'domcontentloaded' })
await ready(page)
const wasThere = await cards()
await undo()
ok('a reload starts the history again rather than undoing last time',
   (await cards()) === wasThere, `${wasThere} before, ${await cards()} after`)

/* ---------- and another tab's work is not undone for it ---------- */
/* The snapshots describe the board as it was before somebody else wrote it.
   Handing them back would not be undo, it would be a quiet overwrite. */
await add('n')
const mine = await cards()
const which = await page.evaluate(() => new URLSearchParams(location.search).get('board') || 'board_local')

const other = await context.newPage()
other.on('pageerror', (e) => errors.push('other: ' + e.message))
await other.goto(`${BASE}/?board=${which}`, { waitUntil: 'domcontentloaded' })
await ready(other)
await other.keyboard.press('Escape')
await other.waitForTimeout(200)
await other.keyboard.press('l')
await other.waitForTimeout(2200)
const theirs = await cards(other)
ok('another tab on the same board adds one of its own', theirs === mine + 1, `${theirs} there, ${mine} here`)
await other.close()

/* Round the houses so this tab loads the board again and sees their version. */
await page.locator('.tab-new').click()
await page.waitForTimeout(2000)
await page.locator('.tab:not([data-on])').first().click()
await page.waitForTimeout(2200)
const seen = await cards()
ok('coming back finds what they did', seen === theirs, `${seen} cards`)
await undo()
ok('and undo does not reach back past it and take their work away',
   (await cards()) === seen, `${seen} before, ${await cards()} after`)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
