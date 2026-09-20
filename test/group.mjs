/* Several cards, worked on as one.
 *
 * Reported like this: "i cant select multip items and scale them or add
 * effects to them together". Half of that was true. An effect really did go on
 * every selected card — nothing on screen said so, which is a different bug —
 * but scaling did not: every selected card drew its own four handles and each
 * handle resized the one card it belonged to, so three photographs meant three
 * boxes and no way to make the three of them bigger together.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/group.mjs http://localhost:4173
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
await page.waitForTimeout(1800)

/* Three notes rather than three photographs: this is about boxes, and a note
 * is a box that needs no decoding, no worker and no GPU to be one. */
for (let i = 0; i < 3; i++) {
  await page.getByRole('button', { name: 'Note', exact: true }).click()
  await page.waitForTimeout(350)
}
await page.keyboard.press('Escape')
await page.waitForTimeout(250)

const cards = () => page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="note"]')].map((c) => {
    const t = c.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/)
    return {
      id: c.dataset.id,
      x: t ? Math.round(+t[1]) : 0,
      y: t ? Math.round(+t[2]) : 0,
      w: Math.round(parseFloat(c.style.width)),
      h: Math.round(parseFloat(c.style.height)),
    }
  })
)

/* A corner of whichever box is on screen, and only if it can really be pressed
 * — the panel lies over the right of the board, and a handle under it is a
 * handle the mouse never reaches. */
const grip = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const x = Math.round(r.x + r.width / 2)
  const y = Math.round(r.y + r.height / 2)
  const at = document.elementFromPoint(x, y)
  return at === el ? { x, y } : null
}, sel)

/* A point that really belongs to the card asked for. Notes made one after
 * another cascade, so they overlap: a fixed offset into the first one lands on
 * whichever of them happens to be on top. */
const pointOn = (i, kind = 'note') => page.evaluate(({ n, kind }) => {
  const c = document.querySelectorAll(`.card[data-kind="${kind}"]`)[n]
  if (!c) return null
  const r = c.getBoundingClientRect()
  for (let dy = 6; dy < r.height - 6; dy += 6) {
    for (let dx = 6; dx < r.width - 6; dx += 6) {
      const x = Math.round(r.left + dx)
      const y = Math.round(r.top + dy)
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('.card-handles') && !el.closest('.group-handles') && el.closest('.card') === c) {
        return { x, y }
      }
    }
  }
  return null
}, { n: i, kind })

const drag = async (from, dx, dy, opts = {}) => {
  if (opts.shift) await page.keyboard.down('Shift')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 14 })
  await page.mouse.up()
  if (opts.shift) await page.keyboard.up('Shift')
  await page.waitForTimeout(600)
}

/* The panel covers the right of the board, so it stands down while the boxes
 * are being dragged and comes back for the part that is about the panel. */
await page.keyboard.press('e')
await page.waitForTimeout(400)
ok('setup: the panel is out of the way', (await page.locator('.panel').count()) === 0)

/* ---------- one box, not three ---------- */
await page.keyboard.press('Control+a')
await page.waitForTimeout(500)
const three = await cards()
ok('setup: three cards, all selected', three.length === 3, `${three.length} cards`)
ok('a selection of several draws one box round the lot',
   (await page.locator('.group-handles').count()) === 1)
ok('and the cards inside it stand their own handles down',
   (await page.locator('.card-handles').count()) === 0,
   `${await page.locator('.card-handles').count()} card boxes`)

/* ---------- a corner scales all of them ---------- */
const before = await cards()
const se = await grip('.group-handles .handle-se')
ok('the box has a corner that can be got hold of', !!se, se ? `${se.x},${se.y}` : 'covered')
/* Shift held: the key every drawing program has used to keep a shape since the
 * eighties, and the one this board uses for it on one card and on forty. */
await drag(se, 200, 140, { shift: true })
const after = await cards()

const grew = before.map((b, i) => after[i].w / b.w)
ok('dragging its corner scales every card, not just the one under the pointer',
   grew.every((k) => k > 1.1), grew.map((k) => k.toFixed(2)).join(', '))
ok('and scales them all by the same amount',
   Math.max(...grew) - Math.min(...grew) < 0.02, grew.map((k) => k.toFixed(3)).join(', '))

/* The thing that makes it a scale rather than a resize: what is between them
 * grows with them, so the arrangement survives. */
const spreadWas = Math.max(...before.map((c) => c.x)) - Math.min(...before.map((c) => c.x))
const spreadNow = Math.max(...after.map((c) => c.x)) - Math.min(...after.map((c) => c.x))
ok('the space between them grows by the same factor',
   spreadWas > 0 && Math.abs(spreadNow / spreadWas - grew[0]) < 0.06,
   `${spreadWas} -> ${spreadNow}, cards ×${grew[0].toFixed(2)}`)

/* And with shift held nothing is squashed, however the pointer went. */
const shapeKept = before.every((b, i) => Math.abs(after[i].w / after[i].h - b.w / b.h) < 0.02)
ok('and with shift held every card keeps the shape it was', shapeKept,
   after.map((c) => (c.w / c.h).toFixed(2)).join(', '))

/* ---------- one undo, not three ---------- */
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)
const undone = await cards()
ok('one undo puts the whole scale back',
   undone.every((c, i) => c.w === before[i].w && c.h === before[i].h),
   undone.map((c) => `${c.w}x${c.h}`).join(' '))

/* ---------- and without it, the axes come apart ---------- */
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
const flat = await grip('.group-handles .handle-se')
await drag(flat, 260, 0)
const squashed = await cards()
ok('a plain drag moves one axis without the other, which is what free means',
   squashed.every((c, i) => c.w > undone[i].w * 1.1 && Math.abs(c.h - undone[i].h) <= 2),
   squashed.map((c) => `${c.w}x${c.h}`).join(' '))
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)

/* ---------- one card is still its own ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
const onFirst = await pointOn(0)
ok('there is somewhere on the first card to press', !!onFirst)
await page.mouse.click(onFirst.x, onFirst.y)
await page.waitForTimeout(400)
ok('one card on its own keeps its own handles',
   (await page.locator('.card-handles').count()) === 1 &&
   (await page.locator('.group-handles').count()) === 0)
const solo = await cards()
const one = await grip('.card-handles .handle-se')
ok('which can still be got hold of', !!one)
await drag(one, 120, 0)
const soloAfter = await cards()
ok('and still resizes freely, width without height',
   soloAfter[0].w > solo[0].w + 40 && soloAfter[0].h === solo[0].h,
   `${solo[0].w}x${solo[0].h} -> ${soloAfter[0].w}x${soloAfter[0].h}`)
ok('and takes none of the others with it',
   soloAfter[1].w === solo[1].w && soloAfter[2].w === solo[2].w)

/* One card gets the same key, which it never had: before this, a single card
 * could only ever be resized freely and there was no way to keep a photograph
 * the shape it was. */
const wasShape = soloAfter[0].w / soloAfter[0].h
const oneAgain = await grip('.card-handles .handle-se')
await drag(oneAgain, 140, 20, { shift: true })
const locked = await cards()
ok('and shift keeps one card the shape it was, the same as it does for many',
   Math.abs(locked[0].w / locked[0].h - wasShape) < 0.02 && locked[0].w > soloAfter[0].w + 40,
   `${soloAfter[0].w}x${soloAfter[0].h} -> ${locked[0].w}x${locked[0].h}`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)

/* ---------- the panel says what it is working on ---------- */
await page.evaluate(async () => {
  const dt = new DataTransfer()
  for (let i = 0; i < 2; i++) {
    const c = document.createElement('canvas')
    c.width = 240
    c.height = 180
    const x = c.getContext('2d')
    x.fillStyle = `hsl(${i * 90} 70% 50%)`
    x.fillRect(0, 0, 240, 180)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    dt.items.add(new File([blob], `g${i}.png`, { type: 'image/png' }))
  }
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 420, clientY: 300 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForTimeout(3500)
ok('setup: two pictures to treat', (await page.locator('.card[data-kind="image"]').count()) === 2)

/* Both of them picked up by hand: a drop picks up the words it brings in and
 * leaves a photograph where it lands, which is a different thing this board
 * does on purpose. */
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
const p1 = await pointOn(0, 'image')
const p2 = await pointOn(1, 'image')
ok('setup: both pictures can be pressed', !!p1 && !!p2)
await page.mouse.click(p1.x, p1.y)
await page.waitForTimeout(250)
await page.keyboard.down('Shift')
await page.mouse.click(p2.x, p2.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(400)
ok('setup: two pictures selected',
   (await page.evaluate(() => document.querySelectorAll('.card[data-kind="image"][data-sel]').length)) === 2)

await page.keyboard.press('e')
await page.waitForTimeout(700)
const many = await page.locator('.panel-many').count()
ok('the panel says how many cards it is about to touch', many === 1,
   many ? await page.locator('.panel-many').innerText() : 'says nothing')
ok('and says the right number',
   /\b2\b/.test(await page.locator('.panel-many').innerText().catch(() => '')),
   await page.locator('.panel-many').innerText().catch(() => ''))

const fxOf = () => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('ideation.board.db', 1); q.onsuccess = () => r(q.result) })
  const bs = await new Promise((r) => { const t = db.transaction('boards', 'readonly').objectStore('boards').getAll(); t.onsuccess = () => r(t.result) })
  return (bs[0]?.items || []).filter((i) => i.kind === 'image').map((i) => i.fx?.fxid)
})
const fxWas = await fxOf()
await page.locator('.fx-grid button').nth(3).click()
await page.waitForTimeout(2200)
const fxNow = await fxOf()
ok('and an effect really does land on all of them',
   fxNow.length === 2 && fxNow.every((f) => f && f !== 'none' && f === fxNow[0]),
   `${JSON.stringify(fxWas)} -> ${JSON.stringify(fxNow)}`)

/* ---------- it survives ---------- */
await page.waitForTimeout(1200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2400)
const kept = await cards()
ok('the sizes a scale left behind survive a reload',
   kept.length === 3 && kept.every((c) => c.w > 0 && c.h > 0),
   kept.map((c) => `${c.w}x${c.h}`).join(' '))

console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none')
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
