/* One card read through another.
 *
 *   npm run build && npm run test:browser -- pair
 *   node test/pair.mjs http://localhost:4173
 *
 * Every effect on this board treated one picture. The ones that matter most on
 * a moodboard treat two: a texture pushed through a photograph, a photograph
 * knocked out of a shape, a palette taken off one image and put onto another.
 * Doing any of it meant leaving, doing it somewhere else, and bringing the
 * answer back flat.
 *
 * The wire is the wiring. The board could already draw a line between two
 * cards and the line meant nothing; now, when the card it points at is running
 * an effect that wants a second picture, the card at the other end is that
 * picture. Nothing else is added — no picker, no second selection mode.
 *
 * So the checks are about the wire being read and about what happens without
 * one. An effect that needs a partner and has none has to still be an effect
 * rather than an error, or it cannot sit in the list beside the others.
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
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

/* Two pictures that cannot be mistaken for one another: a flat grey field to
 * be treated, and a hard black-and-white split to treat it with. A stencil cut
 * with the split has to come out half one thing and half the other, which is
 * a shape no single-picture effect could produce from flat grey. */
const drop = (draw, name, at) =>
  page.evaluate(
    async ({ draw, name, at }) => {
      const c = document.createElement('canvas')
      c.width = 600
      c.height = 400
      const x = c.getContext('2d')
      new Function('x', 'w', 'h', draw)(x, 600, 400)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], name, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { draw, name, at }
  )

await drop("x.fillStyle='#7f7f7f';x.fillRect(0,0,w,h)", 'flat.png', { x: 220, y: 250 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1000)
await drop("x.fillStyle='#000';x.fillRect(0,0,w,h);x.fillStyle='#fff';x.fillRect(0,0,w/2,h)", 'split.png', { x: 800, y: 250 })
await page.waitForTimeout(1400)

const ids = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="image"]')].map((c) => c.dataset.id)
)
check('two pictures on the board', ids.length === 2, `${ids.length}`)
const [FLAT, SPLIT] = ids

/* What the treated card is actually showing, left half against right half. */
const halves = () =>
  page.evaluate((id) => {
    const el = document.querySelector(`.card[data-id="${id}"] canvas.media, .card[data-id="${id}"] img.media`)
    if (!el) return null
    const w = el.naturalWidth || el.width
    const h = el.naturalHeight || el.height
    if (!w) return null
    const c = document.createElement('canvas')
    c.width = 40
    c.height = 20
    const x = c.getContext('2d')
    x.drawImage(el, 0, 0, 40, 20)
    const mean = (x0, x1) => {
      const d = x.getImageData(x0, 4, x1 - x0, 12).data
      let s = 0
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      return Math.round(s / (d.length / 4))
    }
    return { left: mean(2, 16), right: mean(24, 38), shaded: el.tagName === 'CANVAS' }
  }, FLAT)

const select = async (id) => {
  await page.locator(`.card[data-id="${id}"]`).click({ position: { x: 20, y: 20 } })
  await page.waitForTimeout(350)
}
const effect = async (name) => {
  await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
  await page.waitForTimeout(250)
  await page.locator('.fx-search input, .fx-find input, .panel input[placeholder*="effect" i]').first().fill(name).catch(() => {})
  await page.waitForTimeout(250)
  await page.locator(`.fx-thumb[title="${name}"]`).click()
  await page.waitForTimeout(2600)
}

/* ---------- an effect that wants a partner, with none ---------- */

await select(FLAT)
await effect('Stencil')
const alone = await halves()
check('a two-picture effect works with nothing wired to it', !!alone && alone.shaded, JSON.stringify(alone))
/* Flat grey cut against itself: the whole card goes one way, because there is
   no edge in a flat field for a threshold to find. */
check('and reads the card itself, so both halves come out the same',
  !!alone && Math.abs(alone.left - alone.right) < 12, JSON.stringify(alone))

check('the panel says what it is waiting for',
  /drag from this card/i.test(await page.locator('.fx-hint').first().innerText()),
  await page.locator('.fx-hint').first().innerText())

/* ---------- draw the wire ---------- */

const wires = () => page.locator('.wire')
check('no wires yet', (await wires().count()) === 0)

/* From the card that will be read, to the card that will read it. */
const box = await page.locator(`.card[data-id="${SPLIT}"]`).boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(400)
/* This card's ports, not whichever card's ports happen to be first in the
   document: a selected card shows its own, and there are two cards here. */
const portOf = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    const layer = card?.nextElementSibling
    const dot = layer?.querySelector?.('.port-w') || layer?.querySelector?.('.port-e')
    return dot ? dot.getBoundingClientRect().toJSON() : null
  }, id)
const port = await portOf(SPLIT)
check('the card offers a port to drag from', !!port)
const target = await page.locator(`.card[data-id="${FLAT}"]`).boundingBox()
await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2)
await page.mouse.down()
await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(3000)

check('the two are wired together', (await wires().count()) === 1)

const wired = await halves()
check('and the treated card is cut by the other one',
  !!wired && Math.abs(wired.left - wired.right) > 60,
  JSON.stringify(wired))
/* The split is white on the left, so the left half keeps the picture and the
   right half falls through to the colour behind. */
check('the light side of the map keeps the picture', !!wired && wired.left < wired.right,
  `${wired.left} left, ${wired.right} right`)

fs.writeFileSync(path.join(OUT, 'pair-stencil.png'), await page.screenshot())

/* Ending a wire on a card is not selecting it, so the panel is showing
   something else by now. */
await select(FLAT)
check('and the panel says it is reading it',
  /reading the card wired/i.test(await page.locator('.fx-hint').first().innerText()),
  await page.locator('.fx-hint').first().innerText())

/* ---------- the wire is the only wiring ---------- */

/* Taking the line away takes the second picture away, which is the whole
   argument for using the line rather than a field in a panel. */
await page.locator('.wire').first().click({ force: true })
await page.waitForTimeout(400)
await page.keyboard.press('Delete')
await page.waitForTimeout(2600)
check('cutting the wire takes the second picture with it', (await wires().count()) === 0)
const cut = await halves()
check('and the card goes back to reading itself',
  !!cut && Math.abs(cut.left - cut.right) < 12, JSON.stringify(cut))

/* ---------- the other two ---------- */

await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(400)
const port2 = await portOf(SPLIT)
check('the port is there to drag from again', !!port2)
await page.mouse.move(port2.x + port2.width / 2, port2.y + port2.height / 2)
await page.mouse.down()
await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(2600)
check('wired again', (await wires().count()) === 1)

await select(FLAT)
await effect('Through')
const through = await halves()
/* Flat grey read through a black-and-white picture: the whole card takes one
   colour off the line it reads, and grey is not that colour. */
check('Through colours the picture from the other one',
  !!through && (through.left < 90 || through.left > 170), JSON.stringify(through))

await effect('Displace')
const displaced = await halves()
check('Displace pushes it about with the other one', !!displaced && displaced.shaded,
  JSON.stringify(displaced))

fs.writeFileSync(path.join(OUT, 'pair-through.png'), await page.screenshot())

/* ---------- it survives a reload, because a wire is a card ---------- */

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(3000)
check('the wire is still there after a reload', (await wires().count()) === 1)
const back = await halves()
check('and the card is still reading through it', !!back && back.shaded, JSON.stringify(back))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
