/* Photoshop, Sketch and Illustrator files on the board.
 *
 *   npm run build && npm run test:browser -- design
 *   node test/design.mjs http://localhost:4173
 *
 * All three used to arrive as a grey card with three letters on it, which on a
 * board full of brand work is the wrong answer for exactly the files somebody
 * was sent by the studio. All three carry a picture of themselves and none of
 * them needs a library to get at it.
 *
 * Each fixture is written by hand with a shape worth asserting on, and the
 * shapes are chosen to catch the two ways this goes wrong quietly: a red and
 * blue channel swap, which looks nearly right until you notice the orange is
 * blue, and a picture read upside down, which looks entirely right on anything
 * symmetrical. So the Photoshop document is orange on the left and blue on the
 * right with a dark band along the bottom, and the Sketch one is green against
 * magenta.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { makePsd } from './fixtures/psd.mjs'
import { makeSketch } from './fixtures/sketch.mjs'
import { makePdf } from './fixtures/pdf.mjs'

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

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1400)

/* Drops one file and waits for whatever card it becomes. */
async function drop(bytes, name, type, wantKind) {
  await page.evaluate(
    async ({ data, name, type }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(data)], name, { type }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { data: [...bytes], name, type }
  )
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('.card')].some((c) => c.querySelector(`[alt="${n}"], [title="${n}"]`)) ||
      document.querySelectorAll('.card').length > 0,
    name,
    { timeout: 30000 }
  ).catch(() => {})
  await page.waitForTimeout(2600)
  return page.evaluate((k) => {
    const cards = [...document.querySelectorAll(`.card[data-kind="${k}"]`)]
    return cards.length
  }, wantKind)
}

/* The average colour of a patch of whatever the newest card is showing. */
const patch = (x0, x1, y0, y1) =>
  page.evaluate(
    ({ x0, x1, y0, y1 }) => {
      const cards = [...document.querySelectorAll('.card img.media, .card canvas.media')]
      const el = cards[cards.length - 1]
      if (!el) return null
      const w = el.naturalWidth || el.width
      const h = el.naturalHeight || el.height
      if (!w) return null
      const c = document.createElement('canvas')
      c.width = 60
      c.height = 40
      const cx = c.getContext('2d')
      cx.drawImage(el, 0, 0, 60, 40)
      const d = cx.getImageData(Math.floor(60 * x0), Math.floor(40 * y0),
        Math.max(1, Math.floor(60 * (x1 - x0))), Math.max(1, Math.floor(40 * (y1 - y0)))).data
      let r = 0, g = 0, b = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
      const n = d.length / 4
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), w, h }
    },
    { x0, x1, y0, y1 }
  )

/* ---------- Photoshop, packed, which is what real documents are ---------- */

const n1 = await drop(makePsd({ compression: 1 }), 'brand-lockup.psd', '', 'design')
check('a Photoshop document becomes a card with the artwork on it', n1 === 1, `${n1} design cards`)
check('and not a grey rectangle with three letters on it', (await page.locator('.card[data-kind="file"]').count()) === 0)

let left = await patch(0.05, 0.35, 0.1, 0.5)
let right = await patch(0.65, 0.95, 0.1, 0.5)
let bottom = await patch(0.3, 0.7, 0.88, 0.98)

check('the picture is the real size of the document, not a thumbnail',
  !!left && left.w >= 200, left ? `${left.w}x${left.h}` : 'no picture')
/* Orange on the left. If the red and blue channels were swapped this would be
   blue, which is the classic way to read a PSD nearly right. */
check('the left half is orange, so the channels are the right way round',
  !!left && left.r > left.b + 80, left ? `rgb(${left.r}, ${left.g}, ${left.b})` : '')
check('the right half is blue', !!right && right.b > right.r + 80,
  right ? `rgb(${right.r}, ${right.g}, ${right.b})` : '')
/* And the band is along the bottom rather than the top, which is the other
   thing that looks entirely right on anything symmetrical. */
check('the dark band is along the bottom, so the rows are in order',
  !!bottom && bottom.r < 90 && bottom.g < 90 && bottom.b < 90,
  bottom ? `rgb(${bottom.r}, ${bottom.g}, ${bottom.b})` : '')

fs.writeFileSync(path.join(OUT, 'design-psd.png'), await page.screenshot())

/* ---------- Photoshop, raw ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(500)

const n2 = await drop(makePsd({ compression: 0 }), 'uncompressed.psd', '', 'design')
check('an unpacked document reads too', n2 === 1)
left = await patch(0.05, 0.35, 0.1, 0.5)
check('with the same picture in it', !!left && left.r > left.b + 80,
  left ? `rgb(${left.r}, ${left.g}, ${left.b})` : '')

/* ---------- Sketch ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(500)

const n3 = await drop(makeSketch(), 'wordmark.sketch', '', 'design')
check('a Sketch file becomes a card with its preview on it', n3 === 1)
left = await patch(0.05, 0.35, 0.2, 0.8)
right = await patch(0.65, 0.95, 0.2, 0.8)
check('green on the left', !!left && left.g > left.r + 60, left ? `rgb(${left.r}, ${left.g}, ${left.b})` : '')
check('and magenta on the right', !!right && right.r > right.g + 60 && right.b > right.g + 60,
  right ? `rgb(${right.r}, ${right.g}, ${right.b})` : '')

/* ---------- Illustrator, which is really a PDF ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(500)

const n4 = await drop(makePdf(3), 'logo-artboards.ai', '', 'pdf')
check('an Illustrator file is read as the PDF it really is', n4 === 1, `${n4} document cards`)
check('so its artboards come out as pages, for nothing',
  (await page.locator('.pager span').count()) > 0 ||
  (await page.evaluate(() => document.querySelector('.card[data-kind="pdf"]') !== null)))

await page.locator('.card[data-kind="pdf"]').first().click()
await page.waitForTimeout(500)
check('and it counts them', (await page.locator('.pager span').innerText()).replace(/\s/g, '') === '1/3',
  await page.locator('.pager span').innerText())

fs.writeFileSync(path.join(OUT, 'design-ai.png'), await page.screenshot())

/* ---------- a file only named like one ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(500)

const junk = new Uint8Array(400)
for (let i = 0; i < junk.length; i++) junk[i] = (i * 37) % 251
const n5 = await drop(junk, 'not-really.psd', '', 'file')
check('something only named like a design file becomes a file card, not an empty one',
  n5 === 1, `${n5} file cards`)
check('and nothing pretends to be artwork', (await page.locator('.card[data-kind="design"]').count()) === 0)

/* ---------- and the artwork is a picture like any other ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(500)
await drop(makePsd({ compression: 1 }), 'brand-lockup.psd', '', 'design')
await page.locator('.card[data-kind="design"]').first().click()
await page.waitForTimeout(400)
if (!(await page.locator('.panel').count())) {
  await page.locator('.tool-mode').click()
  await page.waitForTimeout(600)
}
await page.waitForTimeout(1200)
check('the effects panel offers its effects on artwork',
  (await page.locator('.fx-thumb').count()) > 10, `${await page.locator('.fx-thumb').count()} effects`)
await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(2500)
check('and one of them really runs on it', await page.evaluate(() => {
  const c = document.querySelector('.card[data-kind="design"] canvas.media')
  return !!c && c.width > 0
}))

/* ---------- the file itself is kept ---------- */

const kept = await page.evaluate(async () => {
  const read = (store, key) => new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const s = r.result.transaction(store, 'readonly').objectStore(store)
      const t = key === undefined ? s.getAll() : s.get(key)
      t.onsuccess = () => res(t.result)
      t.onerror = () => res(null)
    }
    r.onerror = () => res(null)
  })
  const boards = await read('boards')
  const item = (boards || []).flatMap((b) => b.items || []).find((i) => i.kind === 'design')
  if (!item) return null
  const blob = await read('blobs', item.media)
  const head = blob ? new TextDecoder().decode(await blob.slice(0, 4).arrayBuffer()) : ''
  return { head, size: blob?.size, hasPoster: !!item.poster }
})
check('the document itself is kept, not thrown away once the picture was read',
  kept?.head === '8BPS', kept ? `${kept.size} bytes, ${kept.head}` : 'no file')
check('with the picture stored beside it', kept?.hasPoster === true)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="design"]', { timeout: 20000 })
await page.waitForTimeout(2000)
check('and it all comes back after a reload', (await page.locator('.card[data-kind="design"]').count()) === 1)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
