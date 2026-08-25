/* Where a drop lands.
 *
 *   npm run dev &
 *   node test/drop.mjs http://localhost:5173
 *
 * A folder of photographs is how a board actually starts, and it used to go
 * badly: everything was laid out four across, so twenty pictures built a
 * column five rows deep that marched off the bottom of the window. Eight
 * arrived on screen and twelve did not, with nothing to say they were there —
 * which is indistinguishable from a drop that half failed. I took it for a bug
 * in my own code before finding they had all arrived.
 *
 * So: the whole drop arrives, it is laid out in a block shaped like the window
 * rather than a column, the view goes to it, and a small drop into the corner
 * you are working in moves nothing at all.
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
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const drop = (n, at = { x: 300, y: 300 }, tag = 'ref') => page.evaluate(async ({ n, at, tag }) => {
  const dt = new DataTransfer()
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas')
    c.width = 480
    c.height = 320
    const x = c.getContext('2d')
    x.fillStyle = `hsl(${(i * 37) % 360} 55% 50%)`
    x.fillRect(0, 0, 480, 320)
    dt.items.add(new File([await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))], `${tag}-${i}.jpg`, { type: 'image/jpeg' }))
  }
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, { n, at, tag })

/* How many items the board holds, which is not the same as how many are in
 * the document: the board only renders what is near the window, which is what
 * made a drop that went off screen look like a drop that went missing. */
const held = () => page.evaluate(() => Number((document.querySelector('.stats')?.textContent || '').match(/\d+/)?.[0] || 0))

const onScreen = (named) => page.evaluate((named) => {
  const w = window.innerWidth
  const h = window.innerHeight
  let cards = [...document.querySelectorAll('.card')]
  if (named) cards = cards.filter((c) => (c.querySelector('.card-name')?.textContent || '').startsWith(named))
  return cards.filter((c) => {
    const r = c.getBoundingClientRect()
    return r.left > -2 && r.top > -2 && r.right < w + 2 && r.bottom < h + 2
  }).length
}, named)

const view = () => page.evaluate(() => document.querySelector('.surface').style.transform)

/* ---------- a folder of twenty ---------- */
await drop(20)
await page.waitForTimeout(12000)
const total = await held()
ok('all twenty arrive', total === 20, `${total} items`)
ok('and every one of them is on screen', (await onScreen()) === total,
   `${await onScreen()} of ${total} rendered on screen`)

/* A block rather than a column: the shape is what makes twenty legible. */
const shape = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')]
  const xs = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left / 8)))
  const ys = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top / 8)))
  return { cols: xs.size, rows: ys.size }
})
ok('laid out as a block, not a column', shape.cols > 1 && shape.rows > 1 && shape.cols >= shape.rows,
   `${shape.cols} across by ${shape.rows} down`)
fs.writeFileSync(path.join(OUT, 'drop-twenty.png'), await page.screenshot())

/* ---------- a small drop where you are already looking ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
const stayPut = await view()
await drop(1, { x: 300, y: 300 })
await page.waitForTimeout(3500)
ok('one picture dropped in front of you moves nothing', (await view()) === stayPut,
   `${stayPut} -> ${await view()}`)
ok('and it is there', (await held()) === 21, `${await held()} items`)

/* ---------- and a drop while zoomed in ---------- */
/* Coming back from a drop closer than you were is worse than not moving, so
 * the view may travel but it must not magnify. */
const zoomOf = (t) => Number((/scale\(([\d.]+)\)/.exec(t) || [0, 1])[1])
await page.keyboard.press('2')
await page.waitForTimeout(500)
await page.mouse.move(640, 430)
for (let i = 0; i < 6; i++) {
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Control')
  await page.waitForTimeout(60)
}
await page.waitForTimeout(500)
const zoomedIn = zoomOf(await view())
await drop(6, { x: 200, y: 200 }, 'late')
await page.waitForTimeout(6000)
const after = zoomOf(await view())
ok('a drop never zooms you in further than you were', after <= zoomedIn + 0.001,
   `${zoomedIn.toFixed(2)} -> ${after.toFixed(2)}`)
ok('and all six of them arrive', (await held()) === 27, `${await held()} items`)
/* The drop, not the board: the view goes to what just arrived, and whatever
   else happens to fit around it is a bonus. */
ok('with the six that just arrived on screen', (await onScreen('late')) === 6, `${await onScreen('late')} of 6`)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
