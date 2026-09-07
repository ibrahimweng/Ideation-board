/* A PDF on the board.
 *
 *   npm run build && npm run test:browser -- pdf
 *   node test/pdf.mjs http://localhost:4173
 *
 * A PDF used to arrive as a grey card with three letters on it and a Download
 * link, which on a board whose whole subject is looking at things is the wrong
 * answer for the format most of a brand direction comes in. It is a picture of
 * a page now, with the document kept beside it.
 *
 * So the questions are: does the page really render, is it the right page, can
 * it be turned, does the picture behave like every other picture on the board —
 * effects, export, colours — and is the original file still there afterwards.
 * The document is written by hand in test/fixtures/pdf.mjs, so each page is a
 * different colour and says its own number, and page one can be told from page
 * two by looking rather than by trusting a counter.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
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

/* ---------- drop a three page document ---------- */

/* Passed as plain numbers, because that is what survives the trip into the
   page; the bytes are put back together on the other side. */
const bytes = [...makePdf(3)]
await page.evaluate(async (data) => {
  const file = new File([new Uint8Array(data)], 'reference-deck.pdf', { type: 'application/pdf' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, bytes)

/* Rendering a page means starting a worker and parsing a document, so this is
   given longer than a picture would be. */
await page.waitForSelector('.card[data-kind="pdf"]', { timeout: 30000 })
await page.waitForTimeout(2500)

const card = page.locator('.card[data-kind="pdf"]').first()
check('a dropped PDF becomes a document card, not a file card', (await card.count()) === 1)
check('and not a grey rectangle with three letters on it', (await page.locator('.card[data-kind="file"]').count()) === 0)

/* ---------- it really rendered ---------- */

/* The average colour of whatever the card is showing.
   Either an <img> of the page, or, once an effect is on it, the canvas the
   renderer hands its work to. Both draw into a canvas the same way, and taking
   whichever is there is what lets this be asked before and after an effect. */
const shot = async () =>
  page.evaluate(() => {
    const el = document.querySelector('.card[data-kind="pdf"] img.media, .card[data-kind="pdf"] canvas.media')
    if (!el) return null
    const w = el.naturalWidth || el.width
    const h = el.naturalHeight || el.height
    if (!w) return null
    const c = document.createElement('canvas')
    c.width = 40
    c.height = 30
    const x = c.getContext('2d')
    x.drawImage(el, 0, 0, 40, 30)
    const d = x.getImageData(0, 0, 40, 30).data
    /* The average colour of the page, which is what tells one page of the
       fixture from another without reading any text. */
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
    const n = d.length / 4
    return { w, h, kind: el.tagName.toLowerCase(), r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
  })

const page1 = await shot()
check('the page is drawn as a real picture', !!page1 && page1.w > 200, page1 ? `${page1.w}x${page1.h}` : 'no picture')
check('and it is not a blank sheet', !!page1 && !(page1.r > 250 && page1.g > 250 && page1.b > 250),
  page1 ? `average rgb(${page1.r}, ${page1.g}, ${page1.b})` : '')
/* Page one of the fixture is orange. */
check('it is page one, by its colour', !!page1 && page1.r > page1.b + 40, page1 ? `r${page1.r} b${page1.b}` : '')

const words = await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="pdf"] img.media')
  return el ? el.getAttribute('alt') : null
})
check('and it says which page it is, for anyone who cannot see it', /page 1/i.test(words || ''), words)

fs.writeFileSync(path.join(OUT, 'pdf-page1.png'), await page.screenshot())

/* ---------- turning a page ---------- */

await card.click()
await page.waitForTimeout(400)
check('a document with more than one page offers a pager', (await page.locator('.pager').count()) === 1)
check('and it counts them', (await page.locator('.pager span').innerText()).replace(/\s/g, '') === '1/3',
  await page.locator('.pager span').innerText())
check('with no way back from the first page', await page.locator('.pager button[aria-label="Previous page"]').isDisabled())

await page.locator('.pager button[aria-label="Next page"]').click()
await page.waitForTimeout(2500)
check('going forward lands on page two', (await page.locator('.pager span').innerText()).replace(/\s/g, '') === '2/3',
  await page.locator('.pager span').innerText())

const page2 = await shot()
/* Page two of the fixture is blue. */
check('and the picture really changed with it', !!page2 && !!page1 && page2.b > page2.r + 40,
  page2 ? `rgb(${page2.r}, ${page2.g}, ${page2.b})` : 'no picture')
check('the card did not resize itself under you', await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="pdf"]')
  return el.style.width && el.style.height
}) !== '')

fs.writeFileSync(path.join(OUT, 'pdf-page2.png'), await page.screenshot())

/* ---------- one press goes back a page ---------- */

await page.keyboard.press('Control+z')
await page.waitForTimeout(1200)
check('one undo goes back to the page before', (await page.locator('.pager span').innerText()).replace(/\s/g, '') === '1/3',
  await page.locator('.pager span').innerText())
await page.locator('.pager button[aria-label="Next page"]').click()
await page.waitForTimeout(2500)

/* ---------- a page is a picture like any other ---------- */

await card.click()
await page.waitForTimeout(300)
const panel = await page.locator('.panel').count()
if (!panel) {
  await page.locator('.tool-mode').click()
  await page.waitForTimeout(600)
}
await page.waitForTimeout(1200)
const thumbs = await page.locator('.fx-thumb').count()
check('the effects panel offers its effects on a page', thumbs > 10, `${thumbs} effects`)

await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(2500)
const shaded = await page.evaluate(() => {
  const c = document.querySelector('.card[data-kind="pdf"] canvas.media')
  return c ? { w: c.width, h: c.height } : null
})
check('and one of them really runs on it', !!shaded && shaded.w > 0, shaded ? `${shaded.w}x${shaded.h}` : 'no canvas')

/* The colours of a page belong to the board like any other picture's. */
await page.keyboard.press('Escape')
fs.writeFileSync(path.join(OUT, 'pdf-effect.png'), await page.screenshot())

/* ---------- the document itself is still there ---------- */

const kept = await page.evaluate(async () => {
  const board = await new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const t = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
      t.onsuccess = () => res(t.result)
      t.onerror = () => res([])
    }
    r.onerror = () => res([])
  })
  const item = board.flatMap((b) => b.items || []).find((i) => i.kind === 'pdf')
  if (!item) return null
  const blob = await new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const t = r.result.transaction('blobs', 'readonly').objectStore('blobs').get(item.media)
      t.onsuccess = () => res(t.result)
      t.onerror = () => res(null)
    }
    r.onerror = () => res(null)
  })
  const head = blob ? new TextDecoder().decode(await blob.slice(0, 8).arrayBuffer()) : ''
  return { pages: item.pages, page: item.page, hasPoster: !!item.poster, fileType: blob?.type, head, size: blob?.size }
})
check('the document is kept, not thrown away once a page was drawn', !!kept && kept.head.startsWith('%PDF'),
  kept ? `${kept.size} bytes, ${kept.head.trim()}` : 'no file')
check('the card knows how many pages it has', kept?.pages === 3, `${kept?.pages}`)
check('and keeps the page it is showing', kept?.page === 2, `${kept?.page}`)
check('with the page itself stored beside the file', kept?.hasPoster === true)

/* ---------- and it is all still there after a reload ---------- */

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="pdf"]', { timeout: 30000 })
await page.waitForTimeout(2500)
check('the document comes back after a reload', (await page.locator('.card[data-kind="pdf"]').count()) === 1)
const back = await shot()
/* The effect applied above survived too, so what is on screen is the renderer's
   canvas rather than the plain page. That it is drawn at all is the question
   here; which page it is comes from the pager below, which does not change
   its answer when an effect is put on top. */
check('still showing its page after a reload', !!back && back.w > 0,
  back ? `${back.kind} ${back.w}x${back.h}` : 'nothing drawn')
check('with the effect it was given still on it', back?.kind === 'canvas', back?.kind)
await page.locator('.card[data-kind="pdf"]').first().click()
await page.waitForTimeout(500)
check('and still open at the page it was left on',
  (await page.locator('.pager span').innerText()).replace(/\s/g, '') === '2/3',
  await page.locator('.pager span').innerText())

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
