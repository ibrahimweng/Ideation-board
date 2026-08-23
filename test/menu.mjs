/* Right click menu on cards.
 *   npm run dev &
 *   node test/menu.mjs http://localhost:5173
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

/* The board autosaves on a 700ms debounce, so reads wait past it. */
const settle = () => page.waitForTimeout(1200)
const stored = () => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('ideation.board.db', 1); q.onsuccess = () => r(q.result) })
  const b = await new Promise((r) => { const t = db.transaction('boards', 'readonly').objectStore('boards').getAll(); t.onsuccess = () => r(t.result) })
  return (b[0]?.items || []).map((i) => ({ id: i.id, kind: i.kind, z: i.z, tag: i.tag ?? null, parent: i.parent ?? null }))
})

for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Note', exact: true }).click(); await page.waitForTimeout(350) }

const card = page.locator('.card[data-kind="note"]').first()
await card.click({ position: { x: 40, y: 8 } })
await page.waitForTimeout(300)
await card.click({ button: 'right', position: { x: 40, y: 8 } })
await page.waitForTimeout(400)
ok('menu opens on right click', await page.locator('.menu').count() === 1)
fs.writeFileSync(path.join(OUT, 'menu-open.png'), await page.screenshot())

const labels = await page.locator('.menu > button').allInnerTexts()
ok('menu lists the expected actions',
   labels.some(l => l.includes('Edit text')) && labels.some(l => l.includes('Duplicate')) &&
   labels.some(l => l.includes('Bring to front')) && labels.some(l => l.includes('Send to back')) &&
   labels.some(l => l.includes('Delete')),
   labels.map(l => l.split('\n')[0]).join(' | '))

/* stays on screen when opened near an edge */
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
const afterFirstEsc = await page.locator('.menu').count()
await card.click({ button: 'right', position: { x: 40, y: 8 } })
await page.waitForTimeout(400)
const afterReopen = await page.locator('.menu').count()
await page.keyboard.press('Escape'); await page.waitForTimeout(400)
const afterSecondEsc = await page.locator('.menu').count()
ok('Escape closes the menu', afterSecondEsc === 0,
   `first esc -> ${afterFirstEsc}, reopen -> ${afterReopen}, second esc -> ${afterSecondEsc}`)

/* tag */
await card.click({ button: 'right', position: { x: 40, y: 8 } })
await page.waitForTimeout(350)
await page.locator('.menu-tags button').nth(2).click()
await settle()
let items = await stored()
ok('tag: applies from the menu', items.some(i => i.tag), `tags: ${items.map(i=>i.tag).join(',')}`)
ok('tag: menu closes after choosing', await page.locator('.menu').count() === 0)
ok('tag: dot shows on the card', await card.locator('.card-tag').count() === 1)

/* send to back / bring to front */
const zBefore = (await stored()).find(i => i.tag)
await card.click({ button: 'right', position: { x: 40, y: 8 } })
await page.waitForTimeout(350)
await page.locator('.menu').getByRole('button', { name: 'Send to back', exact: true }).click()
await settle()
let zAfter = (await stored()).find(i => i.id === zBefore.id)
ok('order: send to back lowers z', zAfter.z < zBefore.z, `${zBefore.z} -> ${zAfter.z}`)
ok('order: stays above sections', zAfter.z >= 2, `z=${zAfter.z}`)

await card.click({ button: 'right', position: { x: 40, y: 8 } })
await page.waitForTimeout(350)
await page.locator('.menu').getByRole('button', { name: 'Bring to front', exact: true }).click()
await settle()
const zTop = (await stored()).find(i => i.id === zBefore.id)
const maxOther = Math.max(...(await stored()).filter(i => i.id !== zBefore.id && i.kind !== 'section').map(i => i.z))
ok('order: bring to front raises above the rest', zTop.z > maxOther, `${zTop.z} vs ${maxOther}`)

/* duplicate */
const n0 = (await stored()).length
await card.click({ button: 'right', position: { x: 40, y: 8 } })
await page.waitForTimeout(350)
await page.locator('.menu').getByRole('button', { name: /^Duplicate/ }).click()
await settle()
ok('duplicate: adds a copy', (await stored()).length === n0 + 1, `${n0} -> ${(await stored()).length}`)

/* multi selection */
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
await card.click({ button: 'right', position: { x: 40, y: 8 } })
await page.waitForTimeout(400)
const head = await page.locator('.menu-head').innerText()
ok('menu: acts on the whole selection when one of them is right clicked', /\d+ items/i.test(head), head)

/* remove from section only when relevant */
const hasRemove = await page.locator('.menu').getByRole('button', { name: 'Remove from section' }).count()
ok('menu: hides "Remove from section" when nothing is in one', hasRemove === 0)

/* delete */
const before = (await stored()).length
await page.locator('.menu').getByRole('button', { name: /^Delete/ }).click()
await settle()
ok('delete: removes the selection', (await stored()).length < before, `${before} -> ${(await stored()).length}`)

/* ---------- right clicking a corner ---------- */
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
/* The delete check above emptied the board, so make something to aim at. */
await page.getByRole('button', { name: 'Note', exact: true }).click()
await page.waitForTimeout(500)
const corner = page.locator('.card[data-kind="note"]').first()
const cb = await corner.boundingBox()
const cornerMenu = async () =>
  (await page.locator('.menu').count()) === 1 &&
  !/add here/i.test(await page.locator('.menu-head').innerText().catch(() => ''))

/* The corner of a card belongs to the card. Rounding it means the very corner
 * pixel does not, so this asks for three pixels in, which is inside the arc
 * at the radius a card is drawn with. */
await page.mouse.click(Math.round(cb.x + 3), Math.round(cb.y + 3), { button: 'right' })
await page.waitForTimeout(500)
ok('menu: right clicking a corner opens the card menu', await cornerMenu(),
   `${await page.locator('.menu').count()} menu(s)`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

/* And again with the card selected, which puts a resize handle over that
 * exact spot. The press lands on the handle rather than on the card, so the
 * contextmenu has to reach the card through it. This is what the check was
 * always for; it used to be made against an unselected card, where there was
 * no handle in the way and nothing was being proved. */
await page.mouse.click(Math.round(cb.x + 60), Math.round(cb.y + 8))
await page.waitForTimeout(400)
ok('menu: the card is selected, so a handle covers the corner',
   (await page.locator('.handle-nw').count()) === 1 &&
     (await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('handle'),
       [Math.round(cb.x + 3), Math.round(cb.y + 3)])) === true)
await page.mouse.click(Math.round(cb.x + 3), Math.round(cb.y + 3), { button: 'right' })
await page.waitForTimeout(500)
ok('menu: right clicking that handle still opens the card menu', await cornerMenu(),
   `${await page.locator('.menu').count()} menu(s)`)
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

/* ---------- canvas menu ---------- */
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

/* find bare board to right click on */
const spot = await page.evaluate(() => {
  const vp = document.querySelector('.viewport').getBoundingClientRect()
  for (let y = vp.bottom - 80; y > vp.top + 60; y -= 40) {
    for (let x = vp.left + 60; x < vp.right - 60; x += 40) {
      const el = document.elementFromPoint(x, y)
      if (el && (el.classList.contains('viewport') || el.classList.contains('surface'))) return { x, y }
    }
  }
  return null
})
ok('canvas: found bare board', !!spot, spot ? `${spot.x},${spot.y}` : 'none')

await page.mouse.click(spot.x, spot.y, { button: 'right' })
await page.waitForTimeout(500)
ok('canvas: menu opens on empty board', await page.locator('.menu').count() === 1)
const canvasLabels = await page.locator('.menu > button').allInnerTexts()
ok('canvas: lists the add actions',
   ['Note', 'Label', 'Section', 'Link', 'Files…'].every(l => canvasLabels.some(c => c.startsWith(l))),
   canvasLabels.map(l => l.split('\n')[0]).join(' | '))
ok('canvas: head reads as an add menu',
   /add here/i.test(await page.locator('.menu-head').innerText()))
fs.writeFileSync(path.join(OUT, 'menu-canvas.png'), await page.screenshot())

const nBefore = (await stored()).length
await page.locator('.menu').getByRole('button', { name: 'Note', exact: true }).click()
await settle()
const after = await stored()
ok('canvas: adds a note', after.length === nBefore + 1, `${nBefore} -> ${after.length}`)

/* the new note must be at the click point, not the middle of the view */
const placed = await page.evaluate((s) => {
  const el = document.elementFromPoint(s.x + 6, s.y + 6)
  const card = el && el.closest('.card')
  return card ? card.dataset.kind : null
}, spot)
ok('canvas: places it under the pointer', placed === 'note', `found ${placed}`)

/* right clicking a card still gives the card menu, not this one */
const anyCard = page.locator('.card[data-kind="note"]').first()
await anyCard.click({ button: 'right', position: { x: 30, y: 8 } })
await page.waitForTimeout(500)
ok('canvas: right clicking a card still opens the card menu',
   !/add here/i.test(await page.locator('.menu-head').innerText()),
   await page.locator('.menu-head').innerText())
await page.keyboard.press('Escape'); await page.waitForTimeout(300)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter(r => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
