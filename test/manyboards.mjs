/* Projects, and the row of tabs that holds them.
 *
 *   npm run build && node scripts/browser-tests.mjs manyboards
 *
 * There was one board and everything else nested inside it, so last month's
 * work was reached by walking down into it from the same root and two projects
 * could never be told apart.
 *
 * A project is now a tab along the top, and the three things you do to that
 * row are add, switch and close. Two of those are ordinary and one destroys
 * work outright — closing a tab deletes the project, because there is nothing
 * else a project could be closed *to*. So this leans hardest on the delete:
 * that it asks first, that saying no really means no, that closing the tab you
 * are standing on puts you somewhere real, and that closing the last one does
 * not leave you looking at nothing.
 *
 * Switching does not reload, and the address follows anyway. Both halves are
 * checked, because each without the other is a bug: a reload on every switch
 * makes the row useless, and an address that lags behind means the link you
 * copy opens somebody else's project.
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
/* One context throughout: opening a link in a second tab is one of the things
   being tested, and separate contexts would be two different browsers. */
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
const watch = (p) => p.on('pageerror', (e) => errors.push(e.message))
watch(page)

/* Closing a project asks before it destroys anything, and Playwright's default
   is to dismiss every dialog — which would make "cancel keeps it" pass without
   ever having asked. So the answer is set explicitly before each close, and
   what was asked is kept to be read back. */
let answer = true
let asked = ''
const onDialog = async (d) => {
  asked = d.message()
  await (answer ? d.accept() : d.dismiss())
}
page.on('dialog', onDialog)

const cards = (p) => p.locator('.card').count()
const tabs = (p) => p.locator('.tab').count()
const boardOf = (p) => new URL(p.url()).searchParams.get('board')

/* Waited for rather than timed.
 *
 * A fixed pause is a guess about how long a boot takes on whatever machine is
 * running this. Worse than flaky: "the new project is empty" passes for the
 * wrong reason against a page that has not read its board in yet, and the
 * keystroke that follows goes nowhere. */
const ready = async (p) => {
  /* The app says when the board on disk has actually been read in. Waiting for
     the viewport is not enough: the shell draws first, and the read ends by
     replacing everything in the store, so anything done before it lands is
     thrown away. That is a real race and this is the app's own answer to it,
     not a hook put here for the test. */
  await p.waitForSelector('.app[data-ready]', { timeout: 20000 })
  await p.waitForTimeout(400)
}

/* Put one card down, and wait for it to have been written.
 *
 * The save is debounced, so a project switched away from a moment too early
 * has nothing on it when you come back — which would look exactly like the
 * switch having lost the work. */
const put = async (p, key) => {
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  await p.keyboard.press(key)
  await p.waitForTimeout(700)
  await p.waitForTimeout(1200)
}

/* What a project holds, with everything brought on screen first.
 *
 * The board draws only the cards near the view and drops the rest, so reading
 * the document without fitting first asks a question about where the view
 * happens to be rather than about what is on the board. */
const holds = async (p) => {
  await p.keyboard.press('Escape')
  await p.waitForTimeout(150)
  await p.keyboard.press('1')
  await p.waitForTimeout(700)
  /* `?? 'nokind'` on purpose: [undefined].join() is an empty string, which
     reads exactly like an empty board and sent this on a long detour. */
  return p.evaluate(() =>
    [...document.querySelectorAll('.card')].map((c) => c.dataset.kind ?? 'nokind').sort().join(',')
  )
}

/* The tab that is not the one we are on. */
const otherTab = (p) => p.locator('.tab:not([data-on])').first()

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await ready(page)

/* ---------- the row itself ---------- */
ok('the row of projects is on screen', (await page.locator('.tabs').count()) === 1)
ok('with one tab, for the project you are in, marked as the one you are in',
   (await tabs(page)) === 1 && (await page.locator('.tab[data-on]').count()) === 1,
   `${await tabs(page)} tabs`)
ok('and the tab is a real link, so the browser can still open it in its own tab',
   (await page.locator('.tab[href*="board="]').count()) === 1)
ok('the row is there before there is anything to switch between',
   await page.locator('.tabs').isVisible())

await put(page, 'n')
ok('the first project has something on it', (await cards(page)) === 1)

/* ---------- adding one ---------- */
/* Marked first, and the mark read back after.
 *
 * The whole point of an in-app tab is that it does not reload, and a reload is
 * invisible from the outside — the page that replaces this one is itself
 * perfectly ready. Leaving something behind on the window is the only way to
 * tell "switched" from "reloaded and happened to land in the right place". */
await page.evaluate(() => { window.__same = true })
await page.locator('.tab-new').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2, { timeout: 15000 })
await page.waitForTimeout(900)
const second = boardOf(page)
ok('the + makes a project and moves you into it', (await tabs(page)) === 2, `${await tabs(page)} tabs`)
ok('without reloading the app', await page.evaluate(() => window.__same === true))
ok('the address names the project you are now looking at', !!second && second !== 'board_local', page.url())
ok('and it is empty, which is the point of it being a different project',
   (await cards(page)) === 0, `${await cards(page)} cards`)
ok('exactly one tab is marked as the one you are in',
   (await page.locator('.tab[data-on]').count()) === 1)

await put(page, 'l')
ok('and it can be worked on', (await cards(page)) === 1)
fs.writeFileSync(path.join(OUT, 'manyboards-strip.png'), await page.screenshot())

/* ---------- switching between them ---------- */
await otherTab(page).click()
await page.waitForFunction(() => new URLSearchParams(location.search).get('board') === 'board_local',
                           { timeout: 15000 })
await page.waitForTimeout(900)
ok('clicking a tab switches to it without reloading', await page.evaluate(() => window.__same === true))
ok('and the address follows the project on screen', boardOf(page) === 'board_local', page.url())
const onFirst = await holds(page)
ok('the first project still holds its own work', onFirst === 'note', `holds [${onFirst}]`)

await otherTab(page).click()
await page.waitForFunction((id) => new URLSearchParams(location.search).get('board') === id,
                           second, { timeout: 15000 })
await page.waitForTimeout(900)
const onSecond = await holds(page)
ok('and switching back finds the other one exactly as it was',
   onSecond === 'label' && boardOf(page) === second, `holds [${onSecond}] at ${page.url()}`)

/* ---------- the address is worth sharing ---------- */
/* The point of the address following the visible project: the link you copy
   out of the bar opens what you were looking at, and only that. */
const shared = await context.newPage()
watch(shared)
await shared.goto(`${BASE}/${new URL(page.url()).search}`, { waitUntil: 'domcontentloaded' })
await ready(shared)
const sharedHolds = await holds(shared)
ok('the address opens the project that was on screen, and only that one',
   boardOf(shared) === second && sharedHolds === 'label', `${shared.url()} holds [${sharedHolds}]`)
ok('and both projects can be on screen at once, in two browser tabs',
   (await cards(shared)) === 1 && (await tabs(shared)) === 2)
await shared.close()

/* ---------- reloading ---------- */
await page.reload({ waitUntil: 'domcontentloaded' })
await ready(page)
ok('a reload comes back on the project you were in',
   boardOf(page) === second && (await cards(page)) === 1, page.url())
ok('and the row is still whole', (await tabs(page)) === 2, `${await tabs(page)} tabs`)

/* ---------- saying no ---------- */
answer = false
asked = ''
await otherTab(page).locator('.tab-close').click()
await page.waitForTimeout(900)
ok('closing a project asks before it destroys anything, and says what it will take',
   /delete/i.test(asked) && /card/i.test(asked), JSON.stringify(asked))
ok('and saying no keeps it', (await tabs(page)) === 2, `${await tabs(page)} tabs`)

/* ---------- closing one you are not in ---------- */
answer = true
await otherTab(page).locator('.tab-close').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 1, { timeout: 15000 })
await page.waitForTimeout(900)
ok('closing another project deletes it', (await tabs(page)) === 1, `${await tabs(page)} tabs`)
ok('and leaves you standing where you were, with your work',
   boardOf(page) === second && (await cards(page)) === 1, page.url())

/* ---------- closing the one you are in ---------- */
await page.locator('.tab-new').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2, { timeout: 15000 })
await page.waitForTimeout(900)
const third = boardOf(page)
await put(page, 's')
ok('a third project, to close from the inside', (await tabs(page)) === 2 && third !== second)

await page.locator('.tab[data-on] .tab-close').click()
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 1, { timeout: 15000 })
await page.waitForTimeout(1200)
const landed = await holds(page)
ok('closing the project you are in lands you on a real one rather than nothing',
   (await tabs(page)) === 1 && landed === 'label', `holds [${landed}]`)
ok('and the address follows you there', boardOf(page) === second, page.url())

/* ---------- closing the last one ---------- */
/* There is no such thing as no project. Closing the only one leaves a fresh
   empty one, because the alternative is an app with nothing to draw. */
await page.locator('.tab[data-on] .tab-close').click()
await page.waitForFunction((id) => new URLSearchParams(location.search).get('board') !== id,
                           second, { timeout: 15000 })
await page.waitForTimeout(1200)
ok('closing the last project leaves a fresh one rather than an empty app',
   (await tabs(page)) === 1 && (await cards(page)) === 0 && (await page.locator('.viewport').count()) === 1,
   `${await tabs(page)} tabs, ${await cards(page)} cards`)
const fresh = boardOf(page)
ok('and you are on it', !!fresh && fresh !== second, page.url())
fs.writeFileSync(path.join(OUT, 'manyboards-closed.png'), await page.screenshot())

/* ---------- an address for a project that is gone ---------- */
const stray = await context.newPage()
watch(stray)
await stray.goto(`${BASE}/?board=${second}`, { waitUntil: 'domcontentloaded' })
/* This one bounces to a different address on the way, so the wait is for the
   board it lands on rather than the one it was asked for. */
await ready(stray)
ok('a link to a project that has been deleted falls back rather than opening a phantom',
   boardOf(stray) !== second && (await stray.locator('.viewport').count()) === 1, stray.url())
ok('and lands in the row, on a project that is really there',
   (await tabs(stray)) === 1 && (await stray.locator('.tab[data-on]').count()) === 1)
await stray.close()

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
