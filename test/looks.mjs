/* Saving a treatment and putting it on other cards.
 *
 *   npm run dev &
 *   node test/looks.mjs http://localhost:5173
 *
 * A board of pictures is usually one decision made a dozen times. A look is
 * that decision, kept: the effect, its parameters and the tone, under a name,
 * in the browser rather than in the board, so last week's is waiting on
 * today's board. What it must not carry is the framing — zoom, offset,
 * rotation, flip belong to the particular photograph they were set on, and
 * carrying them across would wreck eleven crops to copy one.
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
  localStorage.removeItem('ideation.path')
  localStorage.removeItem('ideation.looks')
  localStorage.removeItem('ideation.look.clipboard')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

/* Two pictures, dropped side by side rather than one below the other: a card
 * is 420 by 345, so stacking them would leave the lower one's title bar under
 * the upper one the moment the upper one is raised by a click. */
const drop = (hue, at) =>
  page.evaluate(
    async ({ hue, at }) => {
      const c = document.createElement('canvas')
      c.width = 800
      c.height = 600
      const x = c.getContext('2d')
      const g = x.createLinearGradient(0, 0, 800, 600)
      g.addColorStop(0, `hsl(${hue}, 70%, 30%)`)
      g.addColorStop(1, `hsl(${hue + 40}, 80%, 72%)`)
      x.fillStyle = g
      x.fillRect(0, 0, 800, 600)
      x.fillStyle = '#fff'
      x.beginPath()
      x.arc(400, 300, 130, 0, Math.PI * 2)
      x.fill()
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], `p${hue}.png`, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { hue, at }
  )

await drop(210, { x: 150, y: 180 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(700)
await drop(20, { x: 620, y: 180 })
await page.waitForTimeout(1400)

/* What a card is wearing, read off the card rather than out of the store: the
 * tone is a CSS filter on its body, the effect is a canvas in it, the grain is
 * an overlay's opacity and the framing is the body's transform. */
const worn = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    if (!card) return null
    const body = card.querySelector('.card-body')
    const grain = card.querySelector('.grain')
    return {
      filter: body ? body.style.filter || '' : '',
      frame: card.querySelector('.card-frame')?.style.transform || '',
      grain: grain ? Number(grain.style.opacity) : 0,
      shaded: !!card.querySelector('.card-body canvas'),
    }
  }, id)

const ids = () =>
  page.evaluate(() => [...document.querySelectorAll('.card[data-kind="image"]')].map((c) => c.dataset.id))

/* A point on a card that is really that card, since two of them may overlap. */
const grip = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    if (!card) return null
    const r = card.getBoundingClientRect()
    for (let dx = 12; dx < r.width - 12; dx += 10) {
      const x = r.x + dx
      const y = r.y + 10
      if (document.elementFromPoint(x, y)?.closest('.card') === card) return { x, y }
    }
    return null
  }, id)

const select = async (id) => {
  const at = await grip(id)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(250)
}

const tab = (t) => page.locator('.panel-tabs button', { hasText: t }).first()
const slider = (label) => page.locator('.ctl', { hasText: label }).first().locator("input[type='range']")

const list = await ids()
check('two pictures on the board', list.length === 2, `${list.length}`)
const [A, B] = list

/* ---------- the tab is there, and says so when there is nothing to save ---------- */
await select(A)
check('the panel offers a third tab', (await tab('Looks').count()) === 1)
await tab('Looks').click()
await page.waitForTimeout(300)
check(
  'a card with nothing on it has nothing to save',
  (await page.locator('.look-actions button', { hasText: 'Save this look' }).count()) === 0
)
check('and it says why', (await page.locator('.panel-note').first().innerText()).includes('Nothing on this card'))

/* ---------- grade one card ---------- */
await tab('Effect').click()
await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(1500)
await tab('Develop').click()
await page.locator('.preset-row button', { hasText: 'Noir' }).click()
await page.waitForTimeout(400)
await slider('Grain').fill('40')
await page.waitForTimeout(400)

const graded = await worn(A)
check('the card is wearing something now', !!graded.filter && graded.shaded && graded.grain > 0.3, JSON.stringify(graded))

/* ---------- save it ---------- */
await tab('Looks').click()
await page.waitForTimeout(300)
const save = page.locator('.look-actions button', { hasText: 'Save this look' })
check('now there is something to save', (await save.count()) === 1)
await save.click()
await page.waitForTimeout(200)
const suggested = await page.locator('.look-name input').inputValue()
check('the name is filled in from what it actually is', /Halftone/.test(suggested) && /mono/.test(suggested), suggested)
await page.locator('.look-name input').fill('House style')
await page.locator('.look-name button', { hasText: 'Save' }).click()
await page.waitForTimeout(700)
check('a tile appears for it', (await page.locator('.look-grid .look').count()) === 1)
check('under the name given', (await page.locator('.look-title').first().innerText()) === 'House style')
fs.writeFileSync(path.join(OUT, 'looks-saved.png'), await page.screenshot())

/* ---------- put it on another card ---------- */
await select(B)
await tab('Looks').click()
await page.waitForTimeout(300)
const before = await worn(B)
check('the other card is still plain', !before.filter && !before.shaded, JSON.stringify(before))

/* Give it a framing of its own first, which the look must leave alone. */
await tab('Develop').click()
await slider('Zoom').fill('1.6')
await page.waitForTimeout(400)
const framed = await worn(B)
check('and it is framed its own way', /scale\(1.6/.test(framed.frame), framed.frame)

await tab('Looks').click()
await page.waitForTimeout(400)
await page.locator('.look-shot').first().click()
await page.waitForTimeout(1500)
const wearing = await worn(B)
check('clicking the look puts it on', wearing.filter === graded.filter && wearing.shaded, JSON.stringify(wearing))
check('grain comes with it', Math.abs(wearing.grain - graded.grain) < 0.01, `${wearing.grain} vs ${graded.grain}`)
check('the framing is left alone', wearing.frame === framed.frame, `${wearing.frame} vs ${framed.frame}`)
check('and it says what it did', (await page.locator('.toast').count()) === 1, await page.locator('.toast').innerText().catch(() => ''))

await page.keyboard.press('Control+z')
await page.waitForTimeout(700)
const undone = await worn(B)
check('applying a look is one step of undo', !undone.filter && !undone.shaded, JSON.stringify(undone))
check('and the undo leaves the framing where it was', /scale\(1.6/.test(undone.frame), undone.frame)

/* ---------- a whole selection at once ---------- */
await page.keyboard.press('Escape')
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
await tab('Looks').click()
await page.waitForTimeout(300)
await page.locator('.look-shot').first().click()
await page.waitForTimeout(1600)
const both = [await worn(A), await worn(B)]
check('a look goes onto everything selected', both.every((w) => w.filter === graded.filter), JSON.stringify(both.map((w) => w.filter)))
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)
check('and that too is one step', !(await worn(B)).filter)

/* ---------- copy and paste from the card menu ---------- */
await page.keyboard.press('Escape')
await select(A)
let at = await grip(A)
await page.mouse.click(at.x, at.y, { button: 'right' })
await page.waitForTimeout(300)
const copy = page.locator('.menu button', { hasText: 'Copy look' })
check('a graded card offers its look to be copied', (await copy.count()) === 1)
await copy.click()
await page.waitForTimeout(300)

await select(B)
at = await grip(B)
await page.mouse.click(at.x, at.y, { button: 'right' })
await page.waitForTimeout(300)
const paste = page.locator('.menu button', { hasText: 'Paste look' })
check('and another card offers to wear it', (await paste.count()) === 1)
await paste.click()
await page.waitForTimeout(1500)
const pasted = await worn(B)
check('pasting puts the same treatment on', pasted.filter === graded.filter && pasted.shaded, JSON.stringify(pasted))
check('and still leaves the framing', /scale\(1.6/.test(pasted.frame), pasted.frame)

/* ---------- a look carries the develop, masks and all ----------
 *
 * The reason to have looks at all: a grade made once on the best frame, put
 * on the other eleven. A look that dropped the develop would carry the six
 * CSS filters and leave behind the exposure, the curve and every local edit —
 * which is nearly the whole of the treatment, and the sort of loss nobody
 * notices until the pictures are wrong.
 */
await select(A)
await tab('Develop').click()
await page.waitForTimeout(300)
const devBox = page.locator('.develop .ctl', { hasText: /^Exposure/ }).locator('input.ctl-num').first()
await devBox.scrollIntoViewIfNeeded()
await devBox.fill('1.5')
await devBox.press('Enter')
await page.waitForTimeout(800)
const addMask = page.locator('.masks > .mask-add > button', { hasText: 'New mask' })
await addMask.scrollIntoViewIfNeeded()
await addMask.click()
await page.waitForTimeout(200)
await page.locator('.masks > .mask-add .mask-kinds button', { hasText: 'Radial gradient' }).click()
await page.waitForTimeout(900)
const maskBox = page.locator('.mask-body .ctl', { hasText: /^Exposure/ }).locator('input.ctl-num').first()
await maskBox.scrollIntoViewIfNeeded()
await maskBox.fill('-4')
await maskBox.press('Enter')
await page.waitForTimeout(800)
await page.locator('.mask-eye[data-on]').first().click()
await page.waitForTimeout(600)

/* Read off the card, like everything else here — but averaged over a block
   rather than taken from one pixel. The look being carried has a halftone in
   it, so every pixel of these cards is either ink or paper and a single one
   says nothing about the tone underneath. Thirty across is several dots, and
   the average of those is the tone. */
const pixelOf = (id, fx, fy) =>
  page.evaluate(({ cid, fx, fy }) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    const el = card?.querySelector('canvas.media') || card?.querySelector('img.media')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(r.width))
    c.height = Math.max(1, Math.round(r.height))
    const g = c.getContext('2d', { willReadFrequently: true })
    try {
      g.drawImage(el, 0, 0, c.width, c.height)
    } catch {
      return null
    }
    const n = 30
    const x0 = Math.max(0, Math.min(c.width - n, Math.round(c.width * fx - n / 2)))
    const y0 = Math.max(0, Math.min(c.height - n, Math.round(c.height * fy - n / 2)))
    const d = g.getImageData(x0, y0, n, n).data
    const sum = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      sum[0] += d[i]
      sum[1] += d[i + 1]
      sum[2] += d[i + 2]
    }
    const px = d.length / 4
    return sum.map((v) => Math.round(v / px))
  }, { cid: id, fx, fy })

await tab('Looks').click()
await page.waitForTimeout(300)
await page.locator('.look-actions button', { hasText: 'Save this look' }).click()
await page.waitForTimeout(200)
const devName = await page.locator('.look-name input').inputValue()
check('a look with a mask in it says so in its name', /mask/.test(devName), devName)
await page.locator('.look-name input').fill('Graded')
await page.locator('.look-name button', { hasText: 'Save' }).click()
await page.waitForTimeout(700)


await select(B)
await tab('Looks').click()
await page.waitForTimeout(400)
const bCornerWas = await pixelOf(B, 0.12, 0.12)
const bMiddleWas = await pixelOf(B, 0.5, 0.5)
await page.locator('.look-shot').first().click()
await page.waitForTimeout(1800)
const bCorner = await pixelOf(B, 0.12, 0.12)
const bMiddle = await pixelOf(B, 0.5, 0.5)
check('a look carries the develop onto another card', bCorner[0] > bCornerWas[0] + 20,
      `the dark corner ${bCornerWas[0]} -> ${bCorner[0]}`)
/* Two movements in opposite directions on one photograph, which is the one
   thing a global develop cannot do: the corner comes up by the stop and a half
   the look carries, and the disc in the middle goes down by the four stops the
   look's mask takes out of it. */
check('and the mask with it, which is the half a global develop cannot do',
      bMiddle[0] < bMiddleWas[0] - 60,
      `the disc ${bMiddleWas[0]} -> ${bMiddle[0]} while the corner went ${bCornerWas[0]} -> ${bCorner[0]}`)
await tab('Develop').click()
await page.waitForTimeout(400)
check('and the other card now has the mask in its own list',
      (await page.locator('.mask-list .mask').count()) === 1,
      `${await page.locator('.mask-list .mask').count()} masks`)
await page.keyboard.press('Control+z')
await page.waitForTimeout(900)
check('and putting a look on is still one step of undo',
      Math.abs((await pixelOf(B, 0.12, 0.12))[0] - bCornerWas[0]) <= 3,
      `${bCornerWas[0]} -> ${(await pixelOf(B, 0.12, 0.12))[0]}`)

/* ---------- renaming ---------- */
await select(A)
await tab('Looks').click()
await page.waitForTimeout(300)
await page.locator('.look-title').first().dblclick()
await page.waitForTimeout(200)
await page.locator('.look-rename').fill('Cover set')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
check('a look can be renamed', (await page.locator('.look-title').first().innerText()) === 'Cover set')

/* ---------- it outlives the board ---------- */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
const after = await ids()
await select(after[0])
await tab('Looks').click()
await page.waitForTimeout(500)
check('a saved look is still there after a reload', (await page.locator('.look-grid .look').count()) === 2,
      `${await page.locator('.look-grid .look').count()}`)
check('with the name it was given', (await page.locator('.look-title').first().innerText()) === 'Cover set')
check(
  'and the copied one is still on the clipboard',
  (await page.locator('.look-paste').count()) === 1
)

/* ---------- and can be thrown away ---------- */
for (let i = 0; i < 2; i++) {
  await page.locator('.look').first().hover()
  await page.waitForTimeout(150)
  await page.locator('.look-drop').first().click()
  await page.waitForTimeout(400)
}
check('a look can be forgotten', (await page.locator('.look-grid .look').count()) === 0)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
await select((await ids())[0])
await tab('Looks').click()
await page.waitForTimeout(400)
check('and stays forgotten', (await page.locator('.look-grid .look').count()) === 0)

fs.writeFileSync(path.join(OUT, 'looks-end.png'), await page.screenshot())
check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
