/* A card you write.
 *
 *   npm run build && npm run test:browser -- sketch
 *   node test/sketch.mjs http://localhost:4173
 *
 * Every other picture on this board arrived from somewhere. This one is
 * written, which makes it the only material here that can be asked for a
 * hundred nearly-right things and edited between each one.
 *
 * The checks are about the four things that make that safe and useful rather
 * than a programming toy: that the code really drew the card, that the dice
 * can be thrown again without touching the code, that a loop with no end in it
 * costs a card and not the tab, and that what comes out is a picture like any
 * other — effects, export, reload, all of it.
 *
 * The one that matters most is the quietest: a sketch runs with nothing it
 * could use to reach out of the browser, and the way to know that is to ask it
 * from the inside.
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
await page.waitForTimeout(1500)

/* Waits for a run to finish rather than guessing at how long one takes: a
 * sketch is somebody's code and the honest answer is "until it stops". */
const settled = async (ms = 20000) => {
  /* The first run is started by the board rather than by the editor, so there
     is a moment before the editor is showing that it is busy at all. */
  await page.waitForTimeout(700)
  await page.waitForFunction(() => !document.querySelector('.sketch-running'), null, { timeout: ms }).catch(() => {})
  await page.waitForTimeout(900)
}

/* The average colour of the card's picture, over the pixels that are there. */
const look = () =>
  page.evaluate(() => {
    const el = document.querySelector('.card[data-kind="sketch"] img.media, .card[data-kind="sketch"] canvas.media')
    if (!el) return null
    const c = document.createElement('canvas')
    c.width = 40
    c.height = 40
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.drawImage(el, 0, 0, 40, 40)
    const d = cx.getImageData(0, 0, 40, 40).data
    let r = 0, g = 0, b = 0
    let hash = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]
      hash = (hash * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0
    }
    const n = d.length / 4
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), hash }
  })

const write = async (code) => {
  await page.locator('.sketch-code textarea').fill(code)
  await page.locator('.sketch-sheet button', { hasText: /^Run$/ }).click()
  await settled()
}

/* ---------- one press, and there is a card with something on it ---------- */

await page.click('.viewport', { position: { x: 560, y: 420 } })
await page.keyboard.press('w')
await page.waitForSelector('.sketch-shown img', { timeout: 20000 }).catch(() => {})
await settled()

check('one press makes a card and opens its code', (await page.locator('.sketch-sheet').count()) === 1)
check('and there is a card behind it', (await page.locator('.card[data-kind="sketch"]').count()) === 1)
check('which already has something on it, rather than being an empty box you must feed',
  (await page.locator('.sketch-shown img').count()) === 1)

const first = await look()
check('and what is on it was drawn by the code', !!first && first.hash !== 0, JSON.stringify(first))
fs.writeFileSync(path.join(OUT, 'sketch-opened.png'), await page.screenshot())

/* ---------- the same code, another throw ---------- */

await page.locator('.sketch-sheet button', { hasText: 'Roll again' }).click()
await settled()
const rolled = await look()
check('rolling again keeps the code and changes the picture',
  !!rolled && !!first && rolled.hash !== first.hash, `${first?.hash} then ${rolled?.hash}`)

/* ---------- a line changed, and the card follows ---------- */

await write(`ctx.fillStyle = '#20c020'
ctx.fillRect(0, 0, w, h)`)
const green = await look()
check('changing the code changes the card', !!green && green.g > green.r + 60 && green.g > green.b + 60,
  JSON.stringify(green))

/* ---------- the size it is given is the shape of the card ---------- */

const shape = await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="sketch"] img.media')
  return el ? { w: el.naturalWidth, h: el.naturalHeight } : null
})
check('drawn at the shape of the card, with the long side at full size',
  !!shape && Math.max(shape.w, shape.h) === 1024, JSON.stringify(shape))

/* ---------- something that will not run ---------- */

await write('this is not javascript at all')
check('a line that will not run says so', (await page.locator('.sketch-error').count()) === 1,
  await page.locator('.sketch-error').innerText().catch(() => ''))
const kept = await look()
check('and the card keeps the last picture that worked', !!kept && !!green && kept.hash === green.hash)

/* ---------- something that will never finish ---------- */

const began = Date.now()
await write('while (true) { Math.sqrt(9) }')
const waited = Date.now() - began
const said = await page.locator('.sketch-error').innerText().catch(() => '')
check('a loop with no end in it is stopped', /stopped/.test(said), said)
check('and stopped in seconds rather than never', waited < 15000, `${waited} ms`)
/* The whole point of running it away from the board. */
check('the board is still there afterwards', (await page.locator('.card[data-kind="sketch"]').count()) === 1)
check('and still answers', await page.evaluate(() => !!document.querySelector('.viewport')))

/* ---------- and it cannot reach out of the browser ---------- */

await write(`const reachable = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'Worker']
  .filter((k) => typeof self[k] !== 'undefined')
if (reachable.length) throw new Error('still here: ' + reachable.join(', '))
ctx.fillStyle = '#2040d0'
ctx.fillRect(0, 0, w, h)`)
const shut = await page.locator('.sketch-error').count()
check('a sketch has nothing to reach out of the browser with',
  shut === 0, await page.locator('.sketch-error').innerText().catch(() => ''))
const blue = await look()
check('and the sketch that asked drew its answer', !!blue && blue.b > blue.r + 60, JSON.stringify(blue))

/* ---------- reading the card wired into it ---------- */

await page.locator('.sketch-sheet button', { hasText: 'Done' }).click()
await page.waitForTimeout(600)

await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 300
  c.height = 300
  const x = c.getContext('2d')
  x.fillStyle = '#e00000'
  x.fillRect(0, 0, 300, 300)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'red.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 1150, clientY: 430 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForTimeout(2200)

const ids = await page.evaluate(() =>
  [...document.querySelectorAll('.card')].map((c) => ({ id: c.dataset.id, kind: c.dataset.kind })))
const red = ids.find((i) => i.kind === 'image')?.id
const sketch = ids.find((i) => i.kind === 'sketch')?.id

const rbox = await page.locator(`.card[data-id="${red}"]`).boundingBox()
await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2)
await page.waitForTimeout(400)
const port = await page.evaluate((cid) => {
  const el = document.querySelector(`.card[data-id="${cid}"]`)
  const dot = el?.nextElementSibling?.querySelector?.('.port-w') || el?.nextElementSibling?.querySelector?.('.port-e')
  return dot ? dot.getBoundingClientRect().toJSON() : null
}, red)
check('the picture offers a port to wire from', !!port)
const onto = await page.locator(`.card[data-id="${sketch}"]`).boundingBox()
await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2)
await page.mouse.down()
await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(1200)

await page.locator(`.card[data-id="${sketch}"]`).dblclick()
await page.waitForTimeout(800)
check('double clicking a sketch opens its code, not a slideshow',
  (await page.locator('.sketch-sheet').count()) === 1)
check('and it says a card is wired in',
  /a card is wired in/.test(await page.locator('.sketch-hint').innerText()),
  await page.locator('.sketch-hint').innerText())

/* The dice are in this one as well as the picture, so that rolling it later
   shows whether it ran at all — drawing the same card again on its own would
   produce the same picture whether the dice moved or not. */
await write(`if (!img) throw new Error('nothing was wired in')
ctx.drawImage(img, 0, 0, w, h)
ctx.fillStyle = 'rgb(0, ' + Math.round(rand(80, 250)) + ', 0)'
ctx.fillRect(0, 0, w, h * 0.2)`)
const read = await look()
check('a sketch can read the card wired into it',
  !!read && read.r > read.g + 40 && read.r > read.b + 60, JSON.stringify(read))

fs.writeFileSync(path.join(OUT, 'sketch-wired.png'), await page.screenshot())

await page.locator('.sketch-sheet button', { hasText: 'Done' }).click()
await page.waitForTimeout(700)

/* A narrow window, so that the reload below comes up with the panel closed.
   What follows is about a board nothing has looked at yet, and the panel looks
   at things — it asks which card feeds which, which is the one thing the roll
   below must not depend on somebody having asked first. */
await page.setViewportSize({ width: 860, height: 900 })
await page.waitForTimeout(400)

/* ---------- and it comes back ---------- */

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="sketch"]', { timeout: 20000 })
await page.waitForTimeout(2500)
check('a sketch comes back after a reload', (await page.locator('.card[data-kind="sketch"]').count()) === 1)

/* ---------- rolled without opening it, on a board just opened ---------- */

/* Which card feeds which is worked out when something on screen asks for it,
   and none of this asks: the board has only just opened and the menu is not
   React reading a card. If the wire were missed the sketch would throw rather
   than draw, and the picture would not move at all — which is exactly what
   this can tell apart, because the code uses the dice as well as the card. */
check('and it comes up with nothing having asked about the wires',
  (await page.locator('.panel').count()) === 0)

/* What the board has actually written down, which is where the throw of the
   dice lives: the picture alone cannot tell one press of undo from two,
   because the first press puts the picture back either way. */
const stored = async () => {
  const read = () =>
    page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('ideation.board.db')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const all = await new Promise((res) => {
        const t = db.transaction('boards', 'readonly')
        const r = t.objectStore('boards').getAll()
        r.onsuccess = () => res(r.result || [])
        r.onerror = () => res([])
      })
      const it = all.flatMap((b) => b.items || []).find((i) => i.kind === 'sketch')
      return it ? it.roll : null
    })
  return read()
}
const settle = async (was, ms = 6000) => {
  const until = Date.now() + ms
  let now = await stored()
  while (now === was && Date.now() < until) {
    await page.waitForTimeout(200)
    now = await stored()
  }
  return now
}

const beforeRoll = await look()
const rollBefore = await stored()
/* The board comes back where it was left, which by now is panned so that the
   card is off the left of the window — and a card nobody can see is a card
   nobody can right click. */
await page.keyboard.press('1')
await page.waitForTimeout(1400)
const solid = page.locator('.card[data-kind="sketch"]').first()
await solid.click({ position: { x: 30, y: 8 } })
await page.waitForTimeout(300)
await solid.click({ button: 'right', position: { x: 30, y: 8 } })
await page.waitForTimeout(500)
const entries = await page.locator('.menu > button').allInnerTexts()
check('a sketch card offers to roll again without opening it',
  entries.some((l) => l.includes('Roll again')), entries.map((l) => l.split('\n')[0]).join(' | '))
await page.locator('.menu > button', { hasText: 'Roll again' }).click()
await page.waitForTimeout(4000)

const afterRoll = await look()
check('and rolling it there really runs it',
  !!afterRoll && !!beforeRoll && afterRoll.hash !== beforeRoll.hash,
  `${beforeRoll?.hash} then ${afterRoll?.hash}`)
check('with the wired card still read, on a board nothing had looked at yet',
  /* Both halves, deliberately. A sketch handed nothing throws rather than
     draws, and the card then goes on showing the picture from before — which
     is red, and would pass a check that only asked about the colour. */
  !!afterRoll && !!beforeRoll && afterRoll.hash !== beforeRoll.hash &&
  afterRoll.r > afterRoll.g + 40 && afterRoll.r > afterRoll.b + 60,
  JSON.stringify(afterRoll))

const rollAfter = await settle(rollBefore)
check('on a new throw of the dice', rollAfter !== rollBefore, `${rollBefore} then ${rollAfter}`)

await page.keyboard.press('Control+z')
await page.waitForTimeout(1800)
const undone = await look()
check('and one press of undo puts the picture back',
  !!undone && undone.hash === beforeRoll.hash, `${undone?.hash} want ${beforeRoll?.hash}`)
/* The whole throw, not half of it. A roll that wrote the dice and the picture
   as two steps looks undone after one press and is not: the next press would
   take the picture back further while this one is still on the board. */
check('and the dice with it, because a throw is one thing that happened',
  (await settle(rollAfter)) === rollBefore, `${await stored()} want ${rollBefore}`)

/* ---------- a picture like any other ---------- */

await page.setViewportSize({ width: 1500, height: 950 })
await page.waitForTimeout(700)
const sketchId = await page.evaluate(() => document.querySelector('.card[data-kind="sketch"]')?.dataset.id)
await page.locator(`.card[data-id="${sketchId}"]`).click()
await page.waitForTimeout(400)
if (!(await page.locator('.panel').count())) {
  await page.locator('.tool-mode').click()
  await page.waitForTimeout(600)
}
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.waitForTimeout(800)
const thumb = page.locator('.fx-thumb', { hasText: 'Halftone' }).first()
if (await thumb.count()) {
  await thumb.click()
  await page.waitForTimeout(2500)
}
check('every effect works on it, because it is a picture',
  (await page.locator(`.card[data-id="${sketchId}"] canvas.media`).count()) === 1)

const back = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('ideation.board.db')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const all = await new Promise((res) => {
    const t = db.transaction('boards', 'readonly')
    const r = t.objectStore('boards').getAll()
    r.onsuccess = () => res(r.result || [])
    r.onerror = () => res([])
  })
  const it = all.flatMap((b) => b.items || []).find((i) => i.kind === 'sketch')
  return it ? { code: it.code, roll: it.roll, poster: !!it.poster } : null
})
check('with the code that drew it', !!back && /drawImage/.test(back.code || ''), (back?.code || '').slice(0, 40))
check('and the throw of the dice it was drawn on', typeof back?.roll === 'number', String(back?.roll))
check('and the picture beside it', back?.poster === true)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
