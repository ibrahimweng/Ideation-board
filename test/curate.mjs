/* Gathering the best of something into one place.
 *
 *   npm run dev &
 *   node test/curate.mjs http://localhost:5173
 *
 * The job the whole app is for, end to end: gather a pile of references, mark
 * the few that survive, put those few somewhere of their own, move them to the
 * board where they belong, and hand the result over.
 *
 * Two steps of that had no verb at all. You could mark six of forty as kept
 * and then find them exactly where they were, scattered among the thirty-four
 * you did not keep. And a board card held a whole board, but nothing could
 * travel between boards: the only way to move a photograph one level was to
 * find the original file and drop it again.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)

/* ---------- gather a pile ---------- */
const NAMES = ['zellige', 'plaster', 'oak-batten', 'brass-tap', 'terracotta', 'linen', 'stone-sink', 'rattan', 'olive-glaze', 'cork', 'clay-tile', 'iron-handle']
await page.evaluate(async (names) => {
  const paint = async (i) => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 400
    const x = c.getContext('2d')
    x.fillStyle = `hsl(${i * 29} 55% 50%)`
    x.fillRect(0, 0, 600, 400)
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
  }
  const dt = new DataTransfer()
  for (let i = 0; i < names.length; i++) dt.items.add(new File([await paint(i)], `${names[i]}.jpg`, { type: 'image/jpeg' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 400, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, NAMES)
await page.waitForTimeout(12000)
const held = () => page.evaluate(() => Number((document.querySelector('.stats')?.textContent || '').match(/\d+/)?.[0] || 0))
ok('setup: twelve references gathered', (await held()) === 12, `${await held()} items`)

/* ---------- decide ---------- */
const pointOn = (i) => page.evaluate((i) => {
  const c = document.querySelectorAll('.card')[i]
  if (!c) return null
  const r = c.getBoundingClientRect()
  for (let dy = 4; dy < r.height - 4; dy += 4) {
    for (let dx = 4; dx < r.width - 4; dx += 4) {
      const x = Math.round(r.left + dx)
      const y = Math.round(r.top + dy)
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('.card-handles') && el.closest('.card') === c) return { x, y }
    }
  }
  return null
}, i)
for (const i of [0, 3, 6, 9, 11]) {
  const at = await pointOn(i)
  if (!at) continue
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(140)
  await page.keyboard.press('i')
  await page.waitForTimeout(170)
}
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
ok('setup: five of them kept', (await page.locator('.card[data-pick="in"]').count()) === 5)

/* ---------- put the keepers in one place ---------- */
await page.locator('.search input').fill('kept')
await page.waitForTimeout(800)
await page.locator('.search input').press('Control+Enter')
await page.waitForTimeout(600)
ok('the keepers can be picked out in one step', (await page.locator('.card[data-sel]').count()) === 5,
   `${await page.locator('.card[data-sel]').count()} selected`)

await page.evaluate(() => document.activeElement.blur())
await page.keyboard.press('g')
await page.waitForTimeout(1800)
ok('G makes somewhere for them', (await page.locator('.card-section').count()) === 1)
ok('with a name on it, so it is a group and not a heap',
   /shortlist/i.test(await page.locator('.section-bar span').first().innerText().catch(() => '')),
   await page.locator('.section-bar span').first().innerText().catch(() => 'no name'))

await page.locator('.search input').fill('')
await page.waitForTimeout(500)
await page.evaluate(() => document.activeElement.blur())
await page.keyboard.press('1')
await page.waitForTimeout(900)
const inside = await page.evaluate(() => {
  const sec = document.querySelector('.card-section')
  if (!sec) return -1
  const r = sec.getBoundingClientRect()
  return [...document.querySelectorAll('.card:not(.card-section)')].filter((c) => {
    const q = c.getBoundingClientRect()
    return q.left >= r.left - 2 && q.right <= r.right + 2 && q.top >= r.top - 2 && q.bottom <= r.bottom + 2
  }).length
})
ok('and all five are inside it', inside === 5, `${inside} of 5`)
/* Clear ground: gathering never lands on the cards it came from. */
const overlap = await page.evaluate(() => {
  const sec = document.querySelector('.card-section').getBoundingClientRect()
  return [...document.querySelectorAll('.card:not(.card-section)')].filter((c) => {
    const q = c.getBoundingClientRect()
    const over = !(q.right < sec.left || q.left > sec.right || q.bottom < sec.top || q.top > sec.bottom)
    return over && !(q.left >= sec.left - 2 && q.right <= sec.right + 2)
  }).length
})
ok('on ground of its own, clear of what it came from', overlap === 0, `${overlap} cards straddling it`)
fs.writeFileSync(path.join(OUT, 'curate-gathered.png'), await page.screenshot())

await page.keyboard.press('Control+z')
await page.waitForTimeout(900)
ok('and it is one step of undo', (await page.locator('.card-section').count()) === 0)
await page.keyboard.press('Control+y').catch(() => {})
await page.keyboard.press('Shift+Control+z')
await page.waitForTimeout(900)
ok('which can be taken back', (await page.locator('.card-section').count()) === 1)

/* ---------- move them to a board of their own ---------- */
await page.keyboard.press('Escape')
await page.getByRole('button', { name: 'Board', exact: true }).click()
await page.waitForTimeout(1200)
ok('setup: a board to move them into', (await page.locator('.card[data-kind="board"]').count()) === 1)

await page.locator('.search input').fill('kept')
await page.waitForTimeout(800)
await page.locator('.search input').press('Control+Enter')
await page.waitForTimeout(600)
await page.evaluate(() => document.activeElement.blur())
const beforeCut = await held()
await page.keyboard.press('Control+x')
/* The readout is derived from the board, so this waits for it rather than
   guessing how long the derivation takes. */
await page.waitForFunction(
  (n) => Number((document.querySelector('.stats')?.textContent || '').match(/\d+/)?.[0] || 0) !== n,
  beforeCut,
  { timeout: 8000 }
).catch(() => {})
ok('taking them away takes them off this board', (await held()) === beforeCut - 5,
   `${await held()} items, was ${beforeCut}`)
ok('and says where they have gone', /open another/i.test(await page.locator('.toast').innerText().catch(() => '')),
   await page.locator('.toast').innerText().catch(() => 'nothing'))

await page.locator('.search input').fill('')
await page.waitForTimeout(500)
await page.evaluate(() => document.activeElement.blur())
await page.keyboard.press('1')
await page.waitForTimeout(800)
await page.locator('.card[data-kind="board"]').first().dblclick()
await page.waitForTimeout(2000)
ok('setup: inside the new board, which is empty', (await held()) === 0, `${await held()} items`)

await page.keyboard.press('Control+v')
await page.waitForTimeout(1600)
ok('putting them here puts them here', (await held()) === 5, `${await held()} items`)
await page.keyboard.press('1')
await page.waitForTimeout(900)
const arrived = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="image"]')].map((c) => c.querySelector('img')?.getAttribute('alt') || '').filter(Boolean))
ok('with their pictures, which never had to move', arrived.length === 5, arrived.join(', '))
const drawn = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="image"] img')].filter((i) => i.naturalWidth > 0).length)
ok('and the pictures really are drawn, not broken links', drawn === 5, `${drawn} of 5`)
ok('and they are still marked as kept', (await page.locator('.card[data-pick="in"]').count()) === 5)
fs.writeFileSync(path.join(OUT, 'curate-moved.png'), await page.screenshot())

/* Putting them down happens once: a move, not a copy. */
await page.keyboard.press('Control+v')
await page.waitForTimeout(1200)
ok('and putting them down again does not make copies', (await held()) === 5, `${await held()} items`)

/* ---------- a board cannot be put inside itself ---------- */
await page.keyboard.press('Escape')
while ((await page.locator('.crumbs button').count()) > 0) {
  await page.locator('.crumbs button').first().click()
  await page.waitForTimeout(1400)
}
const boardCard = await pointOn(await page.evaluate(() =>
  [...document.querySelectorAll('.card')].findIndex((c) => c.dataset.kind === 'board')))
await page.mouse.click(boardCard.x, boardCard.y)
await page.waitForTimeout(400)
await page.keyboard.press('Control+x')
await page.waitForTimeout(1200)
ok('setup: the board card itself can be taken away', (await page.locator('.card[data-kind="board"]').count()) === 0)
/* And now try to put it inside itself. */
await page.keyboard.press('Control+z')
await page.waitForTimeout(1000)
const back = await pointOn(await page.evaluate(() =>
  [...document.querySelectorAll('.card')].findIndex((c) => c.dataset.kind === 'board')))
await page.mouse.click(back.x, back.y)
await page.waitForTimeout(300)
await page.keyboard.press('Control+x')
await page.waitForTimeout(1000)
await page.keyboard.press('Control+z')
await page.waitForTimeout(1000)
await page.locator('.card[data-kind="board"]').first().dblclick()
await page.waitForTimeout(2000)
const wasIn = await held()
await page.keyboard.press('Control+v')
await page.waitForTimeout(1400)
ok('a board refuses to be put inside itself', (await held()) === wasIn, `${await held()} items, was ${wasIn}`)
ok('and says why', /itself/i.test(await page.locator('.toast').innerText().catch(() => '')),
   await page.locator('.toast').innerText().catch(() => 'nothing'))

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
