/* Keeping and cutting.
 *
 *   npm run dev &
 *   node test/decide.mjs http://localhost:5173
 *
 * A board only ever accumulated. A tag says what something is; this says what
 * you decided about it, which is the thing a wall of references is for and the
 * thing it could never record. So: the mark goes on from the keyboard, from
 * the menu and from the command list, it comes off again the same way, it
 * survives a reload, and the words on it can be searched for.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.removeItem('ideation.path') })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* Three notes, spread out enough to click one at a time. */
for (const t of ['first idea', 'second idea', 'third idea']) {
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('.card[data-kind="note"]').last().dblclick()
  await page.waitForTimeout(350)
  await page.locator('.sheet textarea').fill(t)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(350)
}
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Tidy up', exact: true }).click().catch(() => {})
await page.waitForTimeout(400)

const pointOn = (index) => page.evaluate((i) => {
  const card = document.querySelectorAll('.card[data-kind="note"]')[i]
  if (!card) return null
  const r = card.getBoundingClientRect()
  for (let dy = 4; dy < r.height - 4; dy += 6) {
    for (let dx = 4; dx < r.width - 4; dx += 6) {
      const x = Math.round(r.left + dx)
      const y = Math.round(r.top + dy)
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('.card-handles') && el.closest('.card') === card) return { x, y }
    }
  }
  return null
}, index)

const pickAt = (index) => page.evaluate((i) => {
  const card = document.querySelectorAll('.card[data-kind="note"]')[i]
  return card ? card.dataset.pick || null : 'missing'
}, index)

const select = async (index) => {
  const at = await pointOn(index)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(250)
}

ok('setup: three notes', (await page.locator('.card[data-kind="note"]').count()) === 3)

/* ---------- the keyboard ---------- */
await select(0)
await page.keyboard.press('i')
await page.waitForTimeout(350)
ok('I keeps the selected card', (await pickAt(0)) === 'in', String(await pickAt(0)))
ok('and it wears a mark that does not hide',
   (await page.locator('.card[data-pick="in"] .card-pick').count()) === 1)

await page.keyboard.press('i')
await page.waitForTimeout(350)
ok('I again takes the mark off', (await pickAt(0)) === null, String(await pickAt(0)))

await page.keyboard.press('o')
await page.waitForTimeout(350)
ok('O cuts it instead', (await pickAt(0)) === 'out', String(await pickAt(0)))

await page.keyboard.press('i')
await page.waitForTimeout(350)
ok('and I turns a cut back into a keep rather than clearing it', (await pickAt(0)) === 'in', String(await pickAt(0)))

/* A cut card steps back but stays where it is. */
await select(1)
await page.keyboard.press('o')
await page.waitForTimeout(400)
/* Measured with nothing selected: a cut card that is selected or hovered
 * comes back up, since you cannot work on what you cannot see. */
await page.keyboard.press('Escape')
await page.mouse.move(4, 4)
await page.waitForTimeout(300)
const faded = await page.evaluate(() => {
  const c = document.querySelector('.card[data-pick="out"]')
  return c ? Number(getComputedStyle(c).opacity) : 1
})
ok('a cut card fades back on the board', faded < 0.6, `opacity ${faded}`)

/* ---------- neither one is a tag ---------- */
const tagStill = await page.evaluate(() => {
  const c = document.querySelector('.card[data-pick="in"]')
  return c ? !!c.querySelector('.card-tag') : 'missing'
})
ok('marking one does not give it a tag', tagStill === false, String(tagStill))

/* ---------- the menu ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
const at2 = await pointOn(2)
await page.mouse.click(at2.x, at2.y)
await page.waitForTimeout(250)
await page.mouse.click(at2.x, at2.y, { button: 'right' })
await page.waitForTimeout(350)
ok('the card menu offers both', (await page.locator('.menu-picks button').count()) === 2)
await page.locator('.menu-picks button', { hasText: 'Cut' }).click()
await page.waitForTimeout(400)
ok('choosing Cut from the menu marks it', (await pickAt(2)) === 'out', String(await pickAt(2)))

await page.mouse.click(at2.x, at2.y, { button: 'right' })
await page.waitForTimeout(350)
const shown = await page.locator('.menu-picks button[data-on]').innerText().catch(() => '')
ok('and the menu shows which one it is wearing', shown.trim().startsWith('Cut'), shown.trim().split('\n')[0])
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

/* ---------- the command list ---------- */
await select(2)
await page.keyboard.press('Control+k')
await page.waitForTimeout(350)
await page.locator('.cmd-input').fill('mark as kept')
await page.waitForTimeout(300)
const cmdRow = page.locator('.cmd-row').first()
ok('the command list offers it too', (await cmdRow.innerText()).toLowerCase().includes('kept'),
   (await cmdRow.innerText()).replace('\n', ' — '))
await cmdRow.click()
await page.waitForTimeout(450)
ok('running it marks the selection', (await pickAt(2)) === 'in', String(await pickAt(2)))

/* ---------- several at once ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
await page.keyboard.press('o')
await page.waitForTimeout(450)
ok('a whole selection is decided together', (await page.locator('.card[data-pick="out"]').count()) === 3,
   `${await page.locator('.card[data-pick="out"]').count()} cut`)
await page.keyboard.press('o')
await page.waitForTimeout(450)
ok('and the same key clears them all again', (await page.locator('.card[data-pick]').count()) === 0)

/* ---------- searchable, and remembered ---------- */
await select(0)
await page.keyboard.press('i')
await page.waitForTimeout(250)
await select(1)
await page.keyboard.press('o')
await page.waitForTimeout(400)
await page.keyboard.press('Escape')

await page.locator('.search input').fill('kept')
await page.waitForTimeout(500)
const litKept = await page.evaluate(() =>
  [...document.querySelectorAll('.card:not([data-dim])')].map((c) => c.dataset.pick || 'none'))
ok('searching for "kept" finds what was kept', litKept.length === 1 && litKept[0] === 'in', litKept.join(','))

await page.locator('.search input').fill('cut')
await page.waitForTimeout(500)
const litCut = await page.evaluate(() =>
  [...document.querySelectorAll('.card:not([data-dim])')].map((c) => c.dataset.pick || 'none'))
ok('and "cut" finds what was cut', litCut.length === 1 && litCut[0] === 'out', litCut.join(','))
await page.locator('.search input').fill('')
await page.waitForTimeout(400)

fs.writeFileSync(path.join(OUT, 'decide-board.png'), await page.screenshot())

await page.waitForTimeout(1200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
ok('the decisions survive a reload',
   (await page.locator('.card[data-pick="in"]').count()) === 1 && (await page.locator('.card[data-pick="out"]').count()) === 1,
   `${await page.locator('.card[data-pick="in"]').count()} kept, ${await page.locator('.card[data-pick="out"]').count()} cut`)

/* ---------- undo ---------- */
await select(2)
await page.keyboard.press('i')
await page.waitForTimeout(400)
ok('setup: a third decision', (await page.locator('.card[data-pick="in"]').count()) === 2)
await page.keyboard.press('Control+z')
await page.waitForTimeout(500)
ok('a decision can be undone', (await page.locator('.card[data-pick="in"]').count()) === 1,
   `${await page.locator('.card[data-pick="in"]').count()} kept`)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
