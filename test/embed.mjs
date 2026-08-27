/* A player is a separate document.
 *
 *   npm run build && node scripts/browser-tests.mjs embed
 *
 * An embedded player is an iframe, and an iframe's pointer events never reach
 * the page around it. That is fine until something on this side is in the
 * middle of a drag, because the pointerup that should end the drag lands in
 * the player and is simply lost — and the card goes on following the mouse
 * until it is clicked again.
 *
 * It was worst on the card that caused it. Pressing an unselected player
 * selects it, and selecting it takes away the shield that was covering it, so
 * the act of starting the drag exposed the very thing that would swallow the
 * end of it.
 *
 * The player is served from here rather than fetched, so the suite needs no
 * internet and the iframe is a real cross-origin document either way.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

/* A real document at the player's address, filling itself, so the thing under
   the cursor is a genuine cross-origin frame and not an empty box. */
await page.route('**/youtube.com/embed/**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<html><body style="margin:0;background:#111"><div style="width:100%;height:100%"></div></body></html>',
  })
)

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('text/plain', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'clipboardData', { value: dt })
  window.dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="embed"]', { timeout: 8000 })
await page.waitForTimeout(1600)
ok('a YouTube link becomes an embedded player', (await page.locator('.card[data-kind="embed"]').count()) === 1)
ok('and an unselected one is covered, so it can be picked up at all',
   (await page.locator('.embed-shield').count()) === 1)

const box = () => page.evaluate(() => {
  const c = document.querySelector('.card[data-kind="embed"]')
  const r = c.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})

/* Press in the middle of the player — the part that is a separate document —
   drag it, and let go there. */
const before = await box()
const from = { x: before.x + before.w / 2, y: before.y + before.h / 2 }
await page.mouse.move(from.x, from.y)
await page.mouse.down()
await page.mouse.move(from.x + 40, from.y + 30, { steps: 6 })
await page.mouse.move(from.x + 120, from.y + 90, { steps: 10 })
await page.waitForTimeout(200)
const during = await box()
ok('a player can be dragged by its picture', during.x !== before.x || during.y !== before.y,
   `${before.x},${before.y} -> ${during.x},${during.y}`)

await page.mouse.up()
await page.waitForTimeout(300)
const dropped = await box()

/* The whole point. Move the mouse a long way with no button held. */
await page.mouse.move(from.x + 400, from.y + 260, { steps: 12 })
await page.waitForTimeout(300)
await page.mouse.move(from.x + 60, from.y - 120, { steps: 12 })
await page.waitForTimeout(400)
const after = await box()
ok('and it stays where it was let go of, rather than following the mouse',
   after.x === dropped.x && after.y === dropped.y,
   `let go at ${dropped.x},${dropped.y}, now at ${after.x},${after.y}`)
fs.writeFileSync(path.join(OUT, 'embed-drag.png'), await page.screenshot())

/* The board must also be usable again afterwards: a drag that never ended
   would go on eating every press. */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.mouse.click(120, 820)
await page.waitForTimeout(300)
ok('and the board takes a press again afterwards',
   (await page.locator('.card[data-sel="true"]').count()) === 0,
   'clicking empty board cleared the selection')

/* Selecting it hands the picture to the player, which is what makes it
   playable — and the title bar is then how it is moved. */
await page.mouse.click(from.x, from.y)
await page.waitForTimeout(400)
ok('a selected player is uncovered, so it can be played',
   (await page.locator('.embed-shield').count()) === 0)
ok('and keeps a strip to be taken hold of by, where its name is',
   (await page.locator('.embed-grip').count()) === 1)
/* The middle of a selected player belongs to the player, which is the point
   of selecting it. */
ok('while the picture itself belongs to the player',
   await page.evaluate(() => {
     const c = document.querySelector('.card[data-kind="embed"]').getBoundingClientRect()
     const el = document.elementFromPoint(Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2))
     return !!el && el.classList.contains('embed-frame')
   }))

const sel = await box()
/* A video's name goes along the top, because its own controls take the
   bottom. That strip is the grip. */
const bar = { x: sel.x + sel.w / 2, y: sel.y + 18 }
await page.mouse.move(bar.x, bar.y)
await page.mouse.down()
await page.mouse.move(bar.x + 90, bar.y + 60, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
const byBar = await box()
ok('and a selected player still moves by that strip', byBar.x !== sel.x || byBar.y !== sel.y,
   `${sel.x},${sel.y} -> ${byBar.x},${byBar.y}`)

await page.mouse.move(bar.x + 400, bar.y + 300, { steps: 10 })
await page.waitForTimeout(300)
const settled = await box()
ok('and that drag ends too', settled.x === byBar.x && settled.y === byBar.y,
   `${byBar.x},${byBar.y} -> ${settled.x},${settled.y}`)

/* ---------- and the strip does not swallow a small card ---------- */
const grip = async () =>
  page.evaluate(() => {
    const c = document.querySelector('.card[data-kind="embed"]')
    const g = c.querySelector('.embed-grip')
    return { card: Math.round(c.getBoundingClientRect().height), grip: Math.round(g.getBoundingClientRect().height) }
  })
const big = await grip()
ok('the strip is the height of the name plate on a normal card', big.grip === 38, JSON.stringify(big))

/* Dragged down to the smallest a card is allowed to be. The handles live in a
   layer of their own, beside the card rather than inside it.
   
   The effects panel is open by default on a window this wide and covers the
   right of the board, which is where the card has been dragged to and where
   its corner handle therefore is. Out of the way first: a bounding box says
   where a thing is, not whether anything is on top of it. */
if (await page.locator('.panel').count()) {
  /* E alone, not Escape first: Escape would clear the selection, and the strip
     only exists on a selected player. */
  await page.keyboard.press('e')
  await page.waitForTimeout(500)
}
ok('the player is still selected with the panel out of the way',
   (await page.locator('.embed-grip').count()) === 1)
const handle = page.locator('.card-handles [data-resize="se"]')
await page.waitForTimeout(300)
const hb = await handle.first().boundingBox()
ok('the card has a resize handle to take hold of', !!hb)
const at = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }
const under = await page.evaluate(
  ([x, y]) => {
    const el = document.elementFromPoint(Math.round(x), Math.round(y))
    return el ? el.className || el.tagName : 'nothing'
  },
  [at.x, at.y]
)
await page.mouse.move(at.x, at.y)
await page.mouse.down()
await page.mouse.move(at.x - 500, at.y - 400, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(500)
const small = await grip()
ok('and gives way on a card too short to spare it',
   small.card < 120 && small.grip < small.card * 0.5,
   `${small.grip} of ${small.card}; pressed ${Math.round(at.x)},${Math.round(at.y)} which held "${under}"`)

/* ---------- and the players are not left dead afterwards ---------- */
/* While a press is down the players are untargetable, which is the fix. If
   that outlived the press, a single tap on empty board would leave every
   player on the board unclickable until the page was reloaded — and a finger
   takes a different path out of the handler from a mouse, so both are tried. */
const reachable = async () =>
  page.evaluate(() => {
    const f = document.querySelector('.card[data-kind="embed"] .embed-frame')
    return getComputedStyle(f).pointerEvents !== 'none' && !document.body.dataset.pressing
  })

await page.mouse.click(140, 800)
await page.waitForTimeout(300)
ok('a click on empty board leaves the players clickable again', await reachable())

await page.touchscreen.tap(160, 780)
await page.waitForTimeout(400)
ok('and so does a tap, which leaves the handler by a different door', await reachable())

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
