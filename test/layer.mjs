/* How a card sits with the cards under it.
 *
 *   npm run build && npm run test:browser -- layer
 *   node test/layer.mjs http://localhost:4173
 *
 * Every other thing in the panel is about one picture on its own. These two
 * are about two of them at once, which is most of what a moodboard is for: a
 * texture laid over a photograph, a wordmark knocked out of a colour field, a
 * scan of a print held at a quarter strength over the thing it is being
 * compared with. Until now the only way to say any of that was to open
 * something else, do it there, and bring the answer back as a flat picture.
 *
 * The checks are on the composited pixels, because that is the only place the
 * question is really answered. Two solid cards, one over the other: yellow
 * under, blue over. Multiplied they make a near-black green that neither of
 * them is, so an overlap that is still flat blue means the blending never
 * happened and an overlap that is flat anything else means it happened wrong.
 *
 * The one that is easy to get wrong and hard to notice is the last of them:
 * a card set to multiply, over nothing at all, must still look like itself.
 * Blending against an empty board is blending against transparency, and a
 * mode that darkens will happily darken a card into the paper if the stacking
 * is not what you thought it was.
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

/* Flat colours, so every pixel of a card is the same answer and a sample can
 * be taken anywhere inside it. */
const drop = (fill, name, at) =>
  page.evaluate(
    async ({ fill, name, at }) => {
      const c = document.createElement('canvas')
      c.width = 600
      c.height = 400
      const x = c.getContext('2d')
      x.fillStyle = fill
      x.fillRect(0, 0, 600, 400)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], name, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { fill, name, at }
  )

await drop('#ffdd00', 'under.png', { x: 180, y: 200 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(900)
await drop('#0044ff', 'over.png', { x: 430, y: 330 })
await page.waitForTimeout(1400)

const ids = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="image"]')].map((c) => c.dataset.id)
)
check('two cards on the board', ids.length === 2, `${ids.length}`)
const [UNDER, OVER] = ids

/* Four places worth sampling, worked out from where the cards actually landed
 * rather than from where they were dropped. */
const places = async () =>
  page.evaluate(
    ({ under, over }) => {
      const a = document.querySelector(`.card[data-id="${under}"]`).getBoundingClientRect()
      const b = document.querySelector(`.card[data-id="${over}"]`).getBoundingClientRect()
      const mid = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
      /* The overlap, if there is one. */
      const o = {
        x0: Math.max(a.x, b.x), y0: Math.max(a.y, b.y),
        x1: Math.min(a.right, b.right), y1: Math.min(a.bottom, b.bottom),
      }
      return {
        under: { x: a.x + 30, y: a.y + 30 },
        over: { x: b.right - 30, y: b.bottom - 30 },
        both: o.x1 > o.x0 && o.y1 > o.y0 ? { x: (o.x0 + o.x1) / 2, y: (o.y0 + o.y1) / 2 } : null,
        empty: { x: 1050, y: 780 },
        overlap: Math.round(Math.max(0, o.x1 - o.x0)) * Math.round(Math.max(0, o.y1 - o.y0)),
        _unused: mid,
      }
    },
    { under: UNDER, over: OVER }
  )

let where = await places()
check('and they overlap, which is the whole subject', where.overlap > 8000, `${where.overlap}px²`)

/* The colours on the glass. A screenshot is a PNG and the page has a decoder,
 * so it goes back in and comes out as pixels. */
async function seen() {
  const shot = await page.screenshot()
  return page.evaluate(
    async ({ bytes, at }) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      const x = c.getContext('2d')
      x.drawImage(bmp, 0, 0)
      const one = (p) => {
        if (!p) return null
        const d = x.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data
        return { r: d[0], g: d[1], b: d[2] }
      }
      const out = {}
      for (const k of ['under', 'over', 'both', 'empty']) out[k] = one(at[k])
      return out
    },
    { bytes: [...shot], at: where }
  )
}

const near = (c, r, g, b, slack = 26) =>
  !!c && Math.abs(c.r - r) <= slack && Math.abs(c.g - g) <= slack && Math.abs(c.b - b) <= slack
const say = (c) => (c ? `rgb(${c.r}, ${c.g}, ${c.b})` : 'nothing')

let px = await seen()
check('the card underneath is its own colour', near(px.under, 255, 221, 0), say(px.under))
check('and the one on top covers it completely to begin with', near(px.both, 0, 68, 255), say(px.both))

/* ---------- opacity ---------- */

const select = async (id) => {
  await page.locator(`.card[data-id="${id}"]`).click({ position: { x: 20, y: 20 } })
  await page.waitForTimeout(300)
}
const adjust = async () => {
  await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
  await page.waitForTimeout(300)
}
const num = (label) => page.locator('.ctl', { hasText: label }).first().locator('input.ctl-num')
const blend = (name) => page.locator('.blend-row button', { hasText: name }).first()

await select(OVER)
await adjust()
check('the panel has somewhere to say it', (await page.locator('.fx-controls h4', { hasText: 'Layer' }).count()) === 1)

await num('Opacity').fill('40')
await num('Opacity').press('Enter')
await page.waitForTimeout(400)
check('the panel took the figure that was typed in', (await num('Opacity').inputValue()).startsWith('40'),
  await num('Opacity').inputValue())
await page.waitForTimeout(600)
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

px = await seen()
/* 40% blue over yellow: nearly half of each, and neither of the two. */
check('at forty percent the card underneath comes through',
  !!px.both && px.both.r > 60 && px.both.r < 210 && px.both.b > 60 && px.both.b < 210,
  say(px.both))
check('and it is not just the one on top any more', !near(px.both, 0, 68, 255), say(px.both))
check('nor just the one underneath', !near(px.both, 255, 221, 0), say(px.both))

fs.writeFileSync(path.join(OUT, 'layer-opacity.png'), await page.screenshot())

/* ---------- and the fades that were already there still fade ---------- */

/* Three things can fade a card — what it was given here, whether it matches
 * the search, and whether it has been cut — and they have to multiply rather
 * than one of them winning. */
const opacityOf = (id) =>
  page.evaluate((cid) => Number(getComputedStyle(document.querySelector(`.card[data-id="${cid}"]`)).opacity), id)

check('the card is at what it was set to', Math.abs((await opacityOf(OVER)) - 0.4) < 0.02,
  `${await opacityOf(OVER)}`)
await select(OVER)
await page.keyboard.press('o')
await page.waitForTimeout(500)
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
/* Off the card: a cut card comes back up under the pointer, which is a rule
   of its own and would be measured instead of the one being asked about. */
await page.mouse.move(1180, 820)
await page.waitForTimeout(500)
check('marking it cut fades it further rather than instead',
  Math.abs((await opacityOf(OVER)) - 0.16) < 0.03, `${await opacityOf(OVER)}`)
await select(OVER)
await page.keyboard.press('o')
await page.waitForTimeout(500)
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check('and taking the mark off leaves it where it was',
  Math.abs((await opacityOf(OVER)) - 0.4) < 0.02, `${await opacityOf(OVER)}`)

/* A card can be taken all the way down, and something has to still say where
 * it is. The ring is drawn on the card itself, so it fades with it — the
 * handles are not, and they are what is left to point at. */
await select(OVER)
await adjust()
await num('Opacity').fill('4')
await num('Opacity').press('Enter')
await page.waitForTimeout(700)
check('a card taken almost to nothing is still visibly the selected one',
  (await page.locator('.card-handles .handle').count()) >= 4,
  `${await page.locator('.card-handles .handle').count()} handles`)
check('and is still there to be picked up', (await page.locator('.card[data-sel]').count()) === 1)

/* ---------- blending ---------- */

await select(OVER)
await adjust()
await num('Opacity').fill('100')
await num('Opacity').press('Enter')
await page.waitForTimeout(500)
await blend('Multiply').click()
await page.waitForTimeout(600)
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

where = await places()
px = await seen()
/* Yellow times blue is a near-black green: (255,221,0) x (0,68,255) / 255. */
check('multiplied, the overlap is a colour neither card is',
  !!px.both && px.both.r < 60 && px.both.b < 60, say(px.both))
check('and it is the one the two of them make', near(px.both, 0, 59, 0, 40), say(px.both))
/* The half that hangs off the edge is over nothing, and blending against
   nothing has to leave a card looking like itself. */
check('the part hanging over the empty board is still its own colour',
  near(px.over, 0, 68, 255), say(px.over))
check('and the board around it is untouched', !!px.empty && px.empty.r > 200 && px.empty.g > 200,
  say(px.empty))

fs.writeFileSync(path.join(OUT, 'layer-multiply.png'), await page.screenshot())

/* ---------- the compare key holds it back too ---------- */

await page.keyboard.down('Backslash')
await page.waitForTimeout(500)
px = await seen()
check('holding the original puts the blending back to nothing', near(px.both, 0, 68, 255), say(px.both))
await page.keyboard.up('Backslash')
await page.waitForTimeout(500)
px = await seen()
check('and letting go brings it back', px.both.r < 60 && px.both.b < 60, say(px.both))

/* ---------- one step of undo, and it survives a reload ---------- */

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)
px = await seen()
check('undo takes the blending off', near(px.both, 0, 68, 255), say(px.both))
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(700)
px = await seen()
check('and redo puts it back', px.both.r < 60 && px.both.b < 60, say(px.both))

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(2200)
where = await places()
px = await seen()
check('and it is all still there after a reload', px.both.r < 60 && px.both.b < 60, say(px.both))

/* ---------- a saved look carries it ---------- */

await select(OVER)
await page.locator('.panel-tabs button', { hasText: 'Looks' }).click()
await page.waitForTimeout(500)
const save = page.locator('.look-actions button', { hasText: 'Save this look' })
check('a card with only a blend mode on it still has something to save', (await save.count()) === 1)
await save.click()
await page.waitForTimeout(400)
/* The name is offered from what the treatment actually is, so a look that is
   nothing but a blend mode has to be able to say so. */
const suggested = await page.locator('.look-name input').inputValue()
check('and the name it offers says what it does', /multiply/i.test(suggested), suggested)
await page.locator('.look-name button', { hasText: 'Save' }).click()
await page.waitForTimeout(700)
check('a tile appears for it', (await page.locator('.look-grid .look').count()) === 1)

await select(UNDER)
await page.locator('.panel-tabs button', { hasText: 'Looks' }).click()
await page.waitForTimeout(500)
await page.locator('.look-shot').first().click()
await page.waitForTimeout(900)
const underMix = await page.evaluate(
  (cid) => getComputedStyle(document.querySelector(`.card[data-id="${cid}"]`)).mixBlendMode,
  UNDER
)
check('and putting it on another card brings the blend mode with it', underMix === 'multiply', underMix)

/* ---------- and it survives being taken off the machine ---------- */

/* The effect and the tone are baked into each card's picture on the way out.
 * These two cannot be — they are about a card and the one under it — so both
 * exports have to carry them and put them back, or a board that leaves looks
 * nothing like the board that was made. */

const palette = async (text) => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.locator('.cmd-input').fill(text)
  await page.waitForTimeout(400)
  return page.locator('.cmd-row').first()
}

const [sheet] = await Promise.all([page.waitForEvent('download'), (await palette('one picture')).click()])
const sheetFile = path.join(OUT, `layer-${sheet.suggestedFilename()}`)
await sheet.saveAs(sheetFile)
await page.waitForTimeout(700)

/* How much of the exported sheet is the colour only the two of them together
 * make. None of it means the blending never left the screen. */
const madeOf = await page.evaluate(async (data) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + data
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let mixed = 0
  let blue = 0
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
    if (r < 50 && g > 25 && g < 100 && b < 50) mixed++
    else if (r < 60 && g > 40 && g < 110 && b > 200) blue++
  }
  return { mixed, blue, of: d.length / 4 }
}, fs.readFileSync(sheetFile).toString('base64'))

check('the sheet it exports has the blended colour on it', madeOf.mixed > 2000,
  `${madeOf.mixed} pixels of it`)
check('and still has the part that was over nothing', madeOf.blue > 2000, `${madeOf.blue} pixels`)

const [html] = await Promise.all([page.waitForEvent('download'), (await palette('anyone can open')).click()])
const htmlFile = path.join(OUT, `layer-${html.suggestedFilename()}`)
await html.saveAs(htmlFile)
await page.waitForTimeout(500)
const page1 = fs.readFileSync(htmlFile, 'utf8')
check('the page it writes carries the blend mode', /"mix":"multiply"/.test(page1))
check('and knows how to put it back on', /mixBlendMode/.test(page1))
check('and carries the opacity the same way', /--op/.test(page1) && /"op":/.test(page1))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
