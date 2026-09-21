/* Alt and drag makes a copy.
 *
 *   npm run build && node scripts/browser-tests.mjs copies
 *
 * The gesture every drawing program made in the last thirty years means by
 * "one more of these", and until now the one this board spent on pushing a
 * picture around inside its card. That moved to shift and alt; this is what
 * alt does now, on every kind of card and on a whole selection at once.
 *
 * The thing worth checking hardest is the negative: alt and a click must
 * still be a click. A copy made on the press rather than on the first
 * movement lands exactly on top of the card you meant to click, and you find
 * out about it much later.
 *
 * Clears the board's stored data first.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:4173'
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

const cards = (kind) => page.evaluate((k) => {
  const sel = k ? `.card[data-kind="${k}"]` : '.card'
  return [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect()
    return { id: el.dataset.id, x: Math.round(r.x), y: Math.round(r.y), sel: el.hasAttribute('data-sel') }
  })
}, kind)
const rail = () => page.locator('.rail')

/* Somewhere on a card that is not a port and not a handle. */
const grip = (c) => ({ x: c.x + 40, y: c.y + 40 })

const altDrag = async (from, dx, dy, keys = ['Alt']) => {
  for (const k of keys) await page.keyboard.down(k)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 })
  await page.mouse.up()
  for (const k of [...keys].reverse()) await page.keyboard.up(k)
  await page.waitForTimeout(450)
}

/* --- a note --- */
await rail().getByRole('button', { name: 'Note', exact: true }).click()
await page.waitForTimeout(500)
const [note] = await cards('note')
ok('a note to work on', !!note)

await altDrag(grip(note), 320, 0)
const two = await cards('note')
ok('alt and drag makes a second one', two.length === 2, `${two.length} notes`)
const still = two.find((c) => c.id === note.id)
ok('and leaves the original exactly where it was', !!still && still.x === note.x && still.y === note.y,
   `${note.x} -> ${still?.x}`)
const copy = two.find((c) => c.id !== note.id)
ok('and the copy is where the drag ended', !!copy && Math.abs(copy.x - (note.x + 320)) <= 8, `x ${copy?.x}`)
ok('and the copy is what is selected, not the original', !!copy?.sel && !still?.sel)

/* --- alt and a click is still a click --- */
const before = (await cards('note')).length
await page.keyboard.down('Alt')
await page.mouse.click(note.x + 40, note.y + 40)
await page.keyboard.up('Alt')
await page.waitForTimeout(450)
ok('alt and a click makes nothing at all', (await cards('note')).length === before,
   `${before} -> ${(await cards('note')).length}`)

/* --- one undo takes it back --- */
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
ok('one undo takes the copy away', (await cards('note')).length === 1, `${(await cards('note')).length} notes`)
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(600)
ok('and one redo brings it back', (await cards('note')).length === 2)

/* --- a drawing copies as a drawing --- */
await page.mouse.click(180, 760)
await page.waitForTimeout(250)
await rail().getByRole('button', { name: 'Rectangle', exact: true }).click()
await page.waitForTimeout(250)
await page.mouse.move(200, 480)
await page.mouse.down()
await page.mouse.move(360, 600, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(450)
const drawn = await cards('shape')
ok('a drawing to copy', drawn.length === 1)
await altDrag({ x: 280, y: 540 }, 0, 220)
const drawings = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="shape"] svg path:not(.shape-hit)')].map((p) => p.getAttribute('d'))
)
ok('a drawing copies as a drawing', drawings.length === 2, `${drawings.length} drawings`)
ok('and the copy is the same drawing', drawings[0] === drawings[1], drawings.join(' | '))

/* --- a whole selection at once --- */
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
const all = (await cards()).length
const anyNote = (await cards('note'))[0]
await altDrag({ x: anyNote.x + 40, y: anyNote.y + 40 }, 0, -260)
const after = (await cards()).length
ok('alt and drag on a selection copies all of it', after === all * 2, `${all} -> ${after}`)

/* --- and a picture is copied rather than framed --- */
/* The one that would break quietly. Alt and drag on a photograph used to
 * push the picture around inside its card, and a change of modifier that
 * left that in place would mean alt copies everything except the one kind of
 * card most boards are made of. */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 600
  c.height = 400
  const x = c.getContext('2d')
  x.fillStyle = '#2F6FEB'
  x.fillRect(0, 0, 600, 400)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'p.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 700, clientY: 620 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)
const shot = (await cards('image'))[0]
ok('a picture to copy', !!shot)

/* Per card, because there are two of them and the one being pushed about is
   the copy. */
const framing = (id) => page.evaluate((cid) =>
  document.querySelector(`.card[data-id="${cid}"] .card-frame`)?.style.transform || '', id)
const wasFramed = await framing(shot.id)
await altDrag(grip(shot), 260, 0)
const pics = await cards('image')
ok('alt and drag on a picture copies it rather than framing it', pics.length === 2, `${pics.length} pictures`)
ok('and the picture in it has not been pushed about', (await framing(shot.id)) === wasFramed, await framing(shot.id))

/* And shift and alt still frames it, which is where that gesture went. A
   picture that exactly fills its card has nowhere to be pushed to, so it is
   scaled up first — with alt and the wheel, which nothing else wanted and
   which did not have to move. */
const framed = pics.find((c) => c.sel) || pics[0]
const spot = grip(framed)
await page.keyboard.down('Alt')
await page.mouse.move(spot.x, spot.y)
await page.mouse.wheel(0, -300)
await page.waitForTimeout(500)
await page.keyboard.up('Alt')
ok('alt and the wheel still scales a picture in its card',
   (await framing(framed.id)) !== wasFramed, await framing(framed.id))
const zoomed = await framing(framed.id)
await altDrag(spot, 60, 40, ['Shift', 'Alt'])
ok('shift and alt still pushes the picture around inside its card',
   (await cards('image')).length === 2 && (await framing(framed.id)) !== zoomed, await framing(framed.id))

console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none')
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
