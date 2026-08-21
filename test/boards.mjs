/* Boards inside boards.
 *
 *   npm run dev &
 *   node test/boards.mjs http://localhost:5173
 *
 * Checks that a board card opens a board of its own, that what is put inside
 * one stays there, that the trail back out works at depth, that a name follows
 * the board it belongs to, that the board you were on is the one you come back
 * to after a reload, and that duplicating a board card copies what is inside
 * rather than pointing a second card at the same board.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.removeItem('ideation.path')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

const tool = (label) => page.locator('.tools button', { hasText: label }).first()
const cards = () => page.locator('.card')
const boardCards = () => page.locator('.card[data-kind="board"]')
const crumbs = () => page.locator('.crumbs button')
const boardName = () => page.locator('.board-name')
const blur = () => page.evaluate(() => document.activeElement?.blur?.())

/* ---------- a board card ---------- */
await tool('Board').click()
await page.waitForSelector('.card[data-kind="board"]', { timeout: 5000 })
check('toolbar adds a board card', (await boardCards().count()) === 1)
check('a new board reports itself empty', (await page.locator('.board-meta').first().innerText()).includes('0 items'))

/* ---------- opening it ---------- */
await boardCards().first().dblclick({ position: { x: 90, y: 90 } })
await page.waitForTimeout(900)
check('opening a board shows the trail back', (await crumbs().count()) === 1)
check('the trail names the board above', (await crumbs().first().innerText()).trim() === 'Untitled board')
check('the board you opened is empty', (await cards().count()) === 0)
check('the name field is the board you are on', (await boardName().inputValue()) === 'Board')

/* ---------- putting something in it, and naming it ---------- */
await tool('Note').click()
await page.waitForTimeout(400)
check('a card added inside stays inside', (await cards().count()) === 1)

await boardName().fill('Research')
await blur()
await page.waitForTimeout(400)

/* ---------- back out ---------- */
await crumbs().first().click()
await page.waitForTimeout(900)
check('the trail goes back up', (await crumbs().count()) === 0)
check('the board above is unchanged', (await cards().count()) === 1 && (await boardCards().count()) === 1)
check('the card took the new name', (await page.locator('.card-name').first().innerText()).trim() === 'Research')
check('the card counts what is inside', (await page.locator('.board-meta').first().innerText()).includes('1 item'))
fs.writeFileSync(path.join(OUT, 'boards-card.png'), await boardCards().first().screenshot())

/* ---------- nesting ---------- */
await boardCards().first().dblclick({ position: { x: 90, y: 90 } })
await page.waitForTimeout(800)
await tool('Board').click()
await page.waitForTimeout(500)
await boardCards().first().dblclick({ position: { x: 90, y: 90 } })
await page.waitForTimeout(900)
const trail = await crumbs().allInnerTexts()
check('two levels down, both steps are listed', trail.length === 2, JSON.stringify(trail))
check('the trail reads root then parent', trail.map((t) => t.trim()).join(' / ') === 'Untitled board / Research')
await tool('Note').click()
/* Longer than the autosave's own wait, or the reload below would land before
 * the note had been written and the check would be measuring the debounce. */
await page.waitForTimeout(1200)
check('the deepest board holds its own card', (await cards().count()) === 1)
fs.writeFileSync(path.join(OUT, 'boards-nested.png'), await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 200 } }))

/* The trail is one more thing competing for a top bar that is already full,
 * and the first version of it overlapped the search box at every width. */
for (const w of [900, 1120, 1280, 1440, 1600]) {
  await page.setViewportSize({ width: w, height: 900 })
  await page.waitForTimeout(300)
  const bar = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      return el ? el.getBoundingClientRect() : null
    }
    const brand = box('.brand')
    const search = box('.search')
    const tools = box('.tools')
    const top = box('.topbar')
    const name = box('.board-name')
    /* The trail drops its older steps on a narrow window, so the one to
     * measure is the last one still drawn. */
    const shown = [...document.querySelectorAll('.crumbs button')]
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 0)
    const crumb = shown.length ? shown[shown.length - 1] : null
    return {
      clear: !!(brand && search && tools && top) && brand.right <= search.left + 1 && search.right <= tools.left + 1,
      inside: !!(tools && top) && tools.right <= top.right + 1,
      oneRow: !!top && top.height <= 53,
      /* Not just laid out, but inside the part of the bar you can see: the
       * brand clips, so a crumb can have a width and still be invisible. */
      wayBack: !!(crumb && brand) && crumb.width >= 24 && crumb.right <= brand.right + 1,
      nameShown: !!(name && brand) && name.width >= 44 && name.right <= brand.right + 1,
      nameW: Math.round(name?.width || 0),
      spare: Math.round((brand?.right || 0) - (name?.right || 0)),
    }
  })
  check(
    `the trail fits the bar at ${w}px`,
    bar.clear && bar.inside && bar.oneRow && bar.wayBack && bar.nameShown,
    JSON.stringify(bar)
  )
}
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(400)

/* ---------- coming back to where you were ---------- */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
check('a reload lands on the board you were on', (await crumbs().count()) === 2)
check('and its contents came back', (await cards().count()) === 1)

/* ---------- climbing out by the trail ---------- */
await crumbs().first().click()
await page.waitForTimeout(900)
check('a crumb jumps straight to that level', (await crumbs().count()) === 0)
check('which is the root board', (await boardCards().count()) === 1 && (await boardName().inputValue()) === 'Untitled board')

/* ---------- duplicating copies what is inside ---------- */
await boardCards().first().click({ position: { x: 60, y: 10 } })
await page.keyboard.press('Control+d')
await page.waitForTimeout(1500)
check('duplicate makes a second board card', (await boardCards().count()) === 2)

/* Empty the copy, then check the original still has its contents. */
await boardCards().nth(1).dblclick({ position: { x: 90, y: 90 } })
await page.waitForTimeout(900)
const inCopy = await cards().count()
check('the copy holds a copy of the contents', inCopy === 2, `${inCopy} cards`)
await blur()
await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(400)
check('the copy can be emptied', (await cards().count()) === 0)
await crumbs().first().click()
await page.waitForTimeout(900)
/* Down the left edge: the copy sits 28px right of the original and above it,
 * so the middle of the original is behind the copy. */
await boardCards().first().dblclick({ position: { x: 12, y: 120 } })
await page.waitForTimeout(900)
check('emptying the copy left the original alone', (await cards().count()) === 2)
await crumbs().first().click()
await page.waitForTimeout(900)

/* ---------- deleting a board card ---------- */
/* Past the original's right edge: opening the original raised it above the
 * copy, so their overlap now belongs to the original. */
await boardCards().nth(1).click({ position: { x: 246, y: 12 } })
await page.keyboard.press('Delete')
await page.waitForTimeout(400)
check('a board card can be removed', (await boardCards().count()) === 1)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
