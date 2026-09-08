/* An effect run again on what it drew.
 *
 *   npm run build && npm run test:browser -- repeat
 *   node test/repeat.mjs http://localhost:4173
 *
 * One pass is an effect. More than one is feedback, and feedback is the whole
 * reason a live-coded video synth is worth using: a kaleidoscope that recurses,
 * a warp that spirals, a blur that blooms. None of it can be reached by moving
 * a slider, because what it needs is not a different setting — it is the same
 * setting applied to its own output.
 *
 * A count rather than a running loop. These are still pictures: a card has to
 * look the same next time it is opened, and an effect that drifts while nobody
 * is watching cannot be exported, reloaded or compared against anything.
 *
 * So the checks are that a repeat changes the picture, that each further pass
 * changes it again, that the card it is on does not cost anything until it is
 * asked for, and that the number survives everything a card survives.
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
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

/* A picture with a clear off-centre shape, so a warp run twice is visibly not
 * a warp run once. */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 700
  c.height = 500
  const x = c.getContext('2d')
  x.fillStyle = '#12233a'
  x.fillRect(0, 0, 700, 500)
  x.fillStyle = '#f4e3c1'
  x.fillRect(90, 70, 240, 170)
  x.fillStyle = '#d8532c'
  x.beginPath()
  x.arc(470, 330, 120, 0, Math.PI * 2)
  x.fill()
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'shape.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 380, clientY: 330 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1400)

const id = await page.evaluate(() => document.querySelector('.card[data-kind="image"]').dataset.id)

/* A coarse fingerprint of what the card is showing, so two renders can be told
 * apart without caring about single pixels. */
const seen = () =>
  page.evaluate((cid) => {
    const el = document.querySelector(`.card[data-id="${cid}"] canvas.media, .card[data-id="${cid}"] img.media`)
    if (!el) return null
    const c = document.createElement('canvas')
    c.width = 12
    c.height = 8
    const x = c.getContext('2d')
    x.drawImage(el, 0, 0, 12, 8)
    const d = x.getImageData(0, 0, 12, 8).data
    const out = []
    for (let i = 0; i < d.length; i += 4) {
      out.push(Math.round((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 16))
    }
    return out.join('')
  }, id)

const apart = (a, b) => {
  if (!a || !b || a.length !== b.length) return 99
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

await page.locator(`.card[data-id="${id}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.waitForTimeout(300)
await page.locator('.fx-thumb[title="Warp"]').click()
await page.waitForTimeout(2600)

const once = await seen()
check('the effect draws something', !!once && once.length > 40)

const counter = page.locator('.fx-layer-n').first()
check('the layer says how many times it runs', (await counter.innerText()).trim() === '×1',
  await counter.innerText())
check('and says it to a reader too',
  /runs 1 time/i.test(await counter.getAttribute('aria-label')), await counter.getAttribute('aria-label'))

/* ---------- running it again ---------- */

await counter.click()
await page.waitForTimeout(2600)
const twice = await seen()
check('running it twice says so', (await counter.innerText()).trim() === '×2', await counter.innerText())
check('and draws something else', apart(once, twice) > 6, `${apart(once, twice)} of 96 cells differ`)

await counter.click()
await page.waitForTimeout(2600)
const thrice = await seen()
check('a third pass changes it again', apart(twice, thrice) > 4, `${apart(twice, thrice)} differ`)
/* Deliberately not checking that three passes differ from one. Warp's default
   is a twirl, and a rotation applied three times can land back somewhere that
   looks like once — which is a true thing about rotations rather than a fault
   in the repeat. What has to hold is that each pass reads the last one, and
   the two checks above are that. */

fs.writeFileSync(path.join(OUT, 'repeat-warp.png'), await page.screenshot())

/* ---------- and back down ---------- */

/* The count wraps rather than needing a second control to go the other way:
   twelve presses is the whole range and there is nowhere else to put a
   downward one. */
for (let i = 0; i < 10; i++) {
  await counter.click()
  await page.waitForTimeout(120)
}
check('pressing past the end comes back to once', (await counter.innerText()).trim() === '×1',
  await counter.innerText())
await page.waitForTimeout(2600)
const around = await seen()
check('and the picture with it', apart(once, around) < 4, `${apart(once, around)} differ`)

/* ---------- it is part of the card ---------- */

await counter.click()
await counter.click()
await page.waitForTimeout(2800)
const kept = await seen()

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await page.waitForTimeout(2200)
check('undo takes a pass off', (await page.locator('.fx-layer-n').first().innerText()).trim() !== '×3',
  await page.locator('.fx-layer-n').first().innerText())
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(2400)
check('and redo puts it back', (await page.locator('.fx-layer-n').first().innerText()).trim() === '×3',
  await page.locator('.fx-layer-n').first().innerText())

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(2600)
await page.locator(`.card[data-id="${id}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(600)
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.waitForTimeout(2600)
check('the count is still there after a reload',
  (await page.locator('.fx-layer-n').first().innerText()).trim() === '×3',
  await page.locator('.fx-layer-n').first().innerText())
check('and the picture is the one it was', apart(kept, await seen()) < 4, `${apart(kept, await seen())} differ`)

/* ---------- a card that never asked pays nothing ---------- */

/* One pass is the path every card on the board takes, and it has to stay the
   one draw it always was rather than becoming a loop that happens to run once. */
const saved = await page.evaluate(async (cid) => {
  const read = () => new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const s = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
      s.onsuccess = () => res(s.result)
      s.onerror = () => res([])
    }
    r.onerror = () => res([])
  })
  const items = ((await read()) || []).flatMap((b) => b.items || [])
  const it = items.find((i) => i.id === cid)
  return { n: it?.fx?.n, fxid: it?.fx?.fxid }
}, id)
check('the count is written on the card', saved.n === 3, JSON.stringify(saved))

await page.keyboard.press('n')
await page.waitForSelector('.card[data-kind="note"]', { timeout: 8000 })
await page.waitForTimeout(700)
const plain = await page.evaluate(async () => {
  const read = () => new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const s = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
      s.onsuccess = () => res(s.result)
      s.onerror = () => res([])
    }
    r.onerror = () => res([])
  })
  const items = ((await read()) || []).flatMap((b) => b.items || [])
  return items.filter((i) => i.fx && i.fx.n !== undefined).length
})
check('and nothing else on the board carries one', plain === 1, `${plain} cards with a count`)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
