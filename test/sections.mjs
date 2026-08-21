/* Section behaviour. Sections work like Figma sections: an item joins one when
 * you drop it inside, moving a section moves everything in it, deleting a
 * section deletes its contents, and resizing never changes what is inside.
 *
 *   npm run dev &
 *   node test/sections.mjs http://localhost:5173
 *
 * Clears the board's stored data first.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173'
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

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

/* Reads what the board actually stored, which is where membership lives. */
const stored = () => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('ideation.board.db', 1); q.onsuccess = () => r(q.result) })
  const boards = await new Promise((r) => { const t = db.transaction('boards', 'readonly').objectStore('boards').getAll(); t.onsuccess = () => r(t.result) })
  return (boards[0]?.items || []).map((i) => ({ id: i.id, kind: i.kind, parent: i.parent ?? null, x: i.x, y: i.y }))
})

const dragInto = async (cardSel, section) => {
  const card = page.locator(cardSel).last()
  const cb = await card.boundingBox()
  const sb = await section.boundingBox()
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 8)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 - cb.height / 2 + 8, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}

await page.getByRole('button', { name: 'Section', exact: true }).click()
await page.waitForTimeout(500)
const section = page.locator('.card-section').last()
const bar = section.locator('.section-bar')

/* two notes dropped inside */
for (let i = 0; i < 2; i++) {
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.waitForTimeout(400)
  await dragInto('.card[data-kind="note"]', section)
}
await page.waitForTimeout(1200)

let items = await stored()
const sectionId = items.find((i) => i.kind === 'section').id
let members = items.filter((i) => i.parent === sectionId)
ok('membership: dropping an item inside makes it a member', members.length === 2, `${members.length} members`)

/* --- resize must not change membership --- */
await bar.click()
await page.waitForTimeout(400)
const se = page.locator('.handle-se').first()
const hb = await se.boundingBox()
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
await page.mouse.down()
await page.mouse.move(hb.x - 260, hb.y - 200, { steps: 12 })   // shrink a lot
await page.mouse.up()
await page.waitForTimeout(700)
items = await stored()
members = items.filter((i) => i.parent === sectionId)
ok('resize: shrinking keeps the same members', members.length === 2, `${members.length} members after shrink`)

/* they still follow the section even while overhanging it */
const noteBefore = (await stored()).filter((i) => i.parent === sectionId).map((i) => ({ id: i.id, x: i.x, y: i.y }))
const bb = await bar.boundingBox()
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
await page.mouse.down()
await page.mouse.move(bb.x + bb.width / 2 + 90, bb.y + bb.height / 2 + 60, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(700)
const noteAfter = (await stored()).filter((i) => i.parent === sectionId).map((i) => ({ id: i.id, x: i.x, y: i.y }))
const movedTogether = noteBefore.every((n) => {
  const a = noteAfter.find((m) => m.id === n.id)
  return a && Math.abs(a.x - n.x - 90) < 12 && Math.abs(a.y - n.y - 60) < 12
})
ok('resize: overhanging members still move with the section', movedTogether)

/* --- duplicate takes the contents --- */
await bar.click()
await page.waitForTimeout(300)
const beforeDup = (await stored()).length
await page.keyboard.press('Control+d')
await page.waitForTimeout(900)
items = await stored()
const sections = items.filter((i) => i.kind === 'section')
const copyId = sections.map((s) => s.id).find((sid) => sid !== sectionId)
const copyMembers = items.filter((i) => i.parent === copyId)
ok('duplicate: a copied section brings its contents', items.length === beforeDup + 3, `${beforeDup} -> ${items.length} items`)
ok('duplicate: copies point at the copied section', copyMembers.length === 2, `${copyMembers.length} members on the copy`)

/* --- delete takes the contents, undo brings them back --- */
const beforeDel = (await stored()).length
await page.keyboard.press('Delete')
await page.waitForTimeout(700)
const afterDel = (await stored()).length
ok('delete: removing a section removes its contents', afterDel === beforeDel - 3, `${beforeDel} -> ${afterDel} items`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(900)
const afterUndo = (await stored()).length
ok('delete: one undo restores the section and its contents', afterUndo === beforeDel, `${afterDel} -> ${afterUndo} items`)

/* --- dragging an item out removes it --- */
const loose = page.locator('.card[data-kind="note"]').first()
const lb = await loose.boundingBox()
await page.mouse.move(lb.x + lb.width / 2, lb.y + 8)
await page.mouse.down()
await page.mouse.move(lb.x + lb.width / 2, 120, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(700)
const anyOrphan = (await stored()).some((i) => i.kind === 'note' && i.parent === null)
ok('membership: dragging an item out clears its section', anyOrphan)

/* --- survives a reload --- */
const beforeReload = (await stored()).filter((i) => i.parent).length
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const afterReload = (await stored()).filter((i) => i.parent).length
ok('persist: membership survives a reload', afterReload === beforeReload && beforeReload > 0,
   `${beforeReload} -> ${afterReload} items with a section`)

console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none')
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
