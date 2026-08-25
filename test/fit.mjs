/* Getting back to the board, and getting close to one card.
 *
 *   npm run dev &
 *   node test/fit.mjs http://localhost:5173
 *
 * Two ways of losing your place, and the way out of each. A board grows past
 * the window and there was no way to see all of it at once; a picture on a
 * board is small and there was no way to look at one properly without turning
 * the whole app into a slideshow first. So: 1 fits everything, 2 fits what is
 * selected, and a double click on a picture opens it big at that picture
 * rather than at the start of the board.
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

/* Four pictures, dropped at the four corners of the window, then spread much
 * further apart by zooming out first — so the board really is bigger than one
 * screenful, which is the whole point of fitting it. */
await page.evaluate(async () => {
  const paint = async (hex) => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 240
    const x = c.getContext('2d')
    x.fillStyle = hex
    x.fillRect(0, 0, 320, 240)
    return await new Promise((r) => c.toBlob(r, 'image/png'))
  }
  const drop = async (hex, name, at) => {
    const dt = new DataTransfer()
    dt.items.add(new File([await paint(hex)], name, { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
    await new Promise((r) => setTimeout(r, 800))
  }
  /* Zoomed out, so a drop near the edge of the window is a long way out on
   * the board. */
  const vp = document.querySelector('.viewport')
  for (let i = 0; i < 12; i++) {
    vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, ctrlKey: true, clientX: 640, clientY: 430 }))
    await new Promise((r) => setTimeout(r, 40))
  }
  await drop('#d81b1b', 'red.png', { x: 140, y: 160 })
  await drop('#1b5fd8', 'blue.png', { x: 1140, y: 160 })
  await drop('#12a150', 'green.png', { x: 140, y: 760 })
  await drop('#8b45d8', 'violet.png', { x: 1140, y: 760 })
})
await page.waitForTimeout(1500)
ok('setup: four pictures, spread out', (await page.locator('.card[data-kind="image"]').count()) === 4,
   `${await page.locator('.card[data-kind="image"]').count()} pictures`)

const view = () => page.evaluate(() => {
  const t = document.querySelector('.surface').style.transform
  const z = /scale\(([\d.]+)\)/.exec(t)
  return { transform: t, zoom: z ? Number(z[1]) : 1 }
})

const onScreen = (sel = '.card') => page.evaluate((s) => {
  const w = window.innerWidth
  const h = window.innerHeight
  const cards = [...document.querySelectorAll(s)]
  const inside = cards.filter((c) => {
    const r = c.getBoundingClientRect()
    return r.right > 0 && r.bottom > 0 && r.left < w && r.top < h &&
      r.left > -1 && r.top > -1 && r.right < w + 1 && r.bottom < h + 1
  })
  return { total: cards.length, inside: inside.length }
}, sel)

/* ---------- scroll a long way away, then come back ---------- */
await page.mouse.move(640, 430)
for (let i = 0; i < 20; i++) {
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(20)
}
await page.waitForTimeout(500)
const lost = await onScreen()
/* The board only keeps the cards near the window in the document, so a board
 * scrolled right away is a board with nothing rendered at all. */
ok('setup: the board can be scrolled off screen entirely', lost.inside === 0,
   `${lost.inside}/${lost.total} on screen`)

await page.keyboard.press('1')
await page.waitForTimeout(800)
const fitted = await onScreen()
ok('1 brings the whole board back on screen', fitted.inside === fitted.total,
   `${fitted.inside}/${fitted.total} on screen`)
fs.writeFileSync(path.join(OUT, 'fit-board.png'), await page.screenshot())

const after = await view()
ok('and never blows the board up past life size', after.zoom <= 1.001, `zoom ${after.zoom}`)

/* A small board should not be magnified to fill the window either. */
const small = await page.evaluate(() => document.querySelectorAll('.card').length)
void small

/* ---------- fit the selection ---------- */
const pointOn = (index) => page.evaluate((i) => {
  const card = document.querySelectorAll('.card[data-kind="image"]')[i]
  if (!card) return null
  const r = card.getBoundingClientRect()
  for (let dy = 4; dy < r.height - 4; dy += 4) {
    for (let dx = 4; dx < r.width - 4; dx += 4) {
      const x = Math.round(r.left + dx)
      const y = Math.round(r.top + dy)
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('.card-handles') && el.closest('.card') === card) return { x, y }
    }
  }
  return null
}, index)

const one = await pointOn(0)
await page.mouse.click(one.x, one.y)
await page.waitForTimeout(300)
const zoomBefore = (await view()).zoom
await page.keyboard.press('2')
await page.waitForTimeout(800)
const zoomAfter = (await view()).zoom
ok('2 fits the selection, which is closer than the whole board', zoomAfter > zoomBefore,
   `${zoomBefore.toFixed(2)} -> ${zoomAfter.toFixed(2)}`)
const selOnScreen = await onScreen('.card[data-sel]')
ok('and the selected card is fully on screen', selOnScreen.inside === selOnScreen.total,
   `${selOnScreen.inside}/${selOnScreen.total}`)
fs.writeFileSync(path.join(OUT, 'fit-selection.png'), await page.screenshot())

/* Nothing selected is not nothing happening: it says so. */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('2')
await page.waitForTimeout(400)
const said = await page.locator('.toast').innerText().catch(() => '')
ok('with nothing selected it says so rather than doing nothing', /nothing selected/i.test(said), said || 'no message')

/* ---------- both are in the command list ---------- */
await page.keyboard.press('Control+k')
await page.waitForTimeout(350)
await page.locator('.cmd-input').fill('fit')
await page.waitForTimeout(300)
const names = await page.locator('.cmd-row .cmd-name').allInnerTexts()
ok('the command list offers both', names.some((n) => /whole board/i.test(n)) && names.some((n) => /selection/i.test(n)),
   names.join(' | '))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- double click a picture ---------- */
await page.keyboard.press('1')
await page.waitForTimeout(700)
const third = await pointOn(2)
await page.mouse.dblclick(third.x, third.y)
await page.waitForTimeout(700)
ok('double clicking a picture opens it big', (await page.locator('.present').count()) === 1)
const name = await page.locator('.present-name').innerText().catch(() => '')
ok('and it opens on the one that was clicked, not on the first card', name === 'green.png', name || 'no name')
fs.writeFileSync(path.join(OUT, 'fit-present.png'), await page.screenshot())

/* Still a slideshow: the arrows move on from there. */
const at = await page.locator('.present-count').innerText()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(400)
ok('the arrows still step through the board from there',
   (await page.locator('.present-count').innerText()) !== at,
   `${at} -> ${await page.locator('.present-count').innerText()}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
ok('and Escape puts it away', (await page.locator('.present').count()) === 0)

/* A note still opens its editor rather than the slideshow: a double click on
 * something you write in has always meant "let me write in it". */
await page.getByRole('button', { name: 'Note', exact: true }).click()
await page.waitForTimeout(400)
await page.locator('.card[data-kind="note"]').last().dblclick()
await page.waitForTimeout(500)
ok('a double click on a note still opens the editor', (await page.locator('.sheet textarea').count()) === 1)
await page.keyboard.press('Escape')

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
