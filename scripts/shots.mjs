/* The five Figma-shaped gestures, photographed.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/shots.mjs http://localhost:4173
 *
 * Not a test — nothing here asserts anything. It builds a board, puts each
 * gesture into the state worth looking at, and takes the picture. Pointer
 * position matters in every one of them (a gap handle is invisible until it is
 * approached), so the pointer is left where it belongs and the shot is taken
 * with it still there.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:4173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.shots')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('pageerror', (e) => console.log('ERR', e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.removeItem('ideation.path')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
/* Deleting the database is refused while the app still holds it open, so the
   board can survive a wipe. Whatever is left is cleared the way a person
   would. */
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
await page.keyboard.press('Delete')
await page.waitForTimeout(400)

/* The effects panel is open when the app opens and takes a third of the
   window. Most of these pictures are about the board. */
const panel = async (want) => {
  await blurAll()
  const open = await page.locator('.panel').count()
  if (!!open !== want) {
    await page.keyboard.press('e')
    await page.waitForTimeout(350)
  }
}
const blurAll = () => page.evaluate(() => document.activeElement?.blur?.())

let n = 0
const shot = async (name) => {
  const file = path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file })
  console.log(file)
}

const rail = () => page.locator('.rail')
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
const clear = async () => {
  await blur()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}
/* Select all deliberately leaves sections out — they are the ground, and
   selecting the ground with everything on it is not what anybody means — so
   whatever is left after it is cleared one at a time. */
const cards = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card')].map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset.id, kind: c.dataset.kind, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
  )
const wipe = async () => {
  await clear()
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(200)
  await page.keyboard.press('Delete')
  await page.waitForTimeout(300)
  for (let i = 0; i < 6; i++) {
    const left = await cards()
    if (!left.length) break
    await page.mouse.click(left[0].x + 12, left[0].y + 12)
    await page.waitForTimeout(200)
    await page.keyboard.press('Delete')
    await page.waitForTimeout(250)
  }
  await clear()
}
const tool = async (name, group) => {
  if (await rail().getByRole('button', { name, exact: true }).count()) {
    await rail().getByRole('button', { name, exact: true }).click()
  } else {
    await rail().getByRole('button', { name: group, exact: true }).click()
    await page.waitForTimeout(220)
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  await page.waitForTimeout(250)
}
const drawBox = async (name, x0, y0, x1, y1, group = 'Shapes') => {
  await tool(name, group)
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x1, y1, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}
const grip = (id) =>
  page.evaluate((cid) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    const r = card.getBoundingClientRect()
    for (let dx = 14; dx < r.width - 14; dx += 6) {
      const x = r.x + dx
      const y = r.y + 12
      if (document.elementFromPoint(x, y)?.closest('.card') === card) return { x, y }
    }
    return null
  }, id)

/* Deleting the database is refused while the app still holds it open, so a
   board can survive a wipe. Whatever is left is cleared the way a person
   would. */
await wipe()

/* ---------- 1 & 2: the gaps, as something to take hold of ---------- */
/* Each one made and then moved, rather than four made and then four moved:
   they all arrive in the middle of the view on top of one another, and a card
   underneath another is a card nothing can take hold of. Labels rather than
   notes, because four of them fit in a row worth photographing and a label is
   written in place. */
await panel(false)
const words = ['Ship it', 'Cut it', 'Park it', 'Try again']
/* Far enough apart that tidying reads them as one row rather than a grid:
   `tidyOnto` keeps roughly the shape the selection already has. */
const spread = [{ x: 230, y: 300 }, { x: 640, y: 480 }, { x: 1050, y: 320 }, { x: 420, y: 660 }]
let list = []
for (let i = 0; i < 4; i++) {
  await rail().getByRole('button', { name: 'Label', exact: true }).click()
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  list = await cards()
  const fresh = list[list.length - 1]
  /* Written in place, which is what a label is for. Leaving the field is what
     commits it — Escape means leave it as it was. */
  await page.mouse.dblclick(fresh.x + 40, fresh.y + fresh.h / 2)
  await page.waitForTimeout(350)
  if (await page.locator('.label-write').count()) {
    await page.locator('.label-write').fill(words[i])
    await page.mouse.click(1300, 820)
    await page.waitForTimeout(300)
  }
  list = await cards()
  const at = await grip(fresh.id)
  if (at) {
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(spread[i].x, spread[i].y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
}
list = await cards()
await clear()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
await page.mouse.move(720, 760)
await shot('scattered-no-handles')

await page.keyboard.press('Control+Alt+t')
await page.waitForTimeout(500)
/* Onto a gap handle, which is invisible until it is approached. */
const gap = await page.evaluate(() => {
  const g = document.querySelector('.smart-gap:not([data-across])')
  if (!g) return null
  const r = g.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (gap) {
  await page.mouse.move(gap.x, gap.y)
  await page.waitForTimeout(200)
  await shot('smart-handles')
  await page.mouse.down()
  await page.mouse.move(gap.x + 70, gap.y, { steps: 14 })
  await page.waitForTimeout(200)
  await shot('smart-gap-dragged')
  await page.mouse.up()
  await page.waitForTimeout(250)
}

/* ---------- 3 & 4: how far apart two things are ---------- */
await clear()
list = await cards()
await page.mouse.click(list[0].x + 40, list[0].y + 14)
await page.waitForTimeout(250)
await page.keyboard.down('Alt')
await page.mouse.move(list[2].x + list[2].w * 0.4, list[2].y + list[2].h * 0.5)
await page.waitForTimeout(250)
await shot('measure-across')
await page.keyboard.up('Alt')

/* ---------- 4: one thing inside another ---------- */
await wipe()
await tool('Section')
await page.mouse.move(320, 240)
await page.mouse.down()
await page.mouse.move(1000, 640, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
await clear()
/* A note, with nothing typed onto it: a note is written in a sheet rather
   than in place, so keystrokes aimed at one land on the board instead — and
   on this board a bare letter is a tool. */
await rail().getByRole('button', { name: 'Note', exact: true }).click()
await page.waitForTimeout(400)
await clear()
list = await cards()
const note = list.find((c) => c.kind === 'note')
const frame = list.find((c) => c.kind === 'section')
if (note && frame) {
  const at = await grip(note.id)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(560, 400, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await clear()
  /* The note selected, the section pointed at: four figures, one for each
     side of the space it is sitting in. */
  await page.mouse.click(560 + 40, 400 + 6)
  await page.waitForTimeout(250)
  await page.keyboard.down('Alt')
  await page.mouse.move(frame.x + 40, frame.y + frame.h - 40)
  await page.waitForTimeout(250)
  await shot('measure-inside')
  await page.keyboard.up('Alt')
}

/* ---------- 5, 6: two shapes into one ---------- */
await wipe()
await drawBox('Rectangle', 380, 260, 700, 560)
await drawBox('Ellipse', 560, 380, 860, 640)
await clear()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
list = await cards()
await page.mouse.click(list[0].x + list[0].w * 0.25, list[0].y + list[0].h * 0.25, { button: 'right' })
await page.waitForTimeout(400)
await shot('boolean-menu')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
await clear()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
await page.keyboard.press('Control+Alt+s')
await page.waitForTimeout(600)
await clear()
await page.mouse.move(1150, 760)
await shot('boolean-subtracted')

/* A hole you can press through: a circle wholly inside a square. */
await wipe()
await drawBox('Rectangle', 420, 240, 820, 640)
await drawBox('Ellipse', 520, 340, 720, 540)
await clear()
await page.keyboard.press('Control+a')
await page.waitForTimeout(250)
await page.keyboard.press('Control+Alt+s')
await page.waitForTimeout(600)
await clear()
await page.mouse.move(1150, 760)
await shot('boolean-hole')

/* ---------- 7: several points at once ---------- */
await wipe()
await tool('Pen', 'Pens')
for (const [x, y] of [[420, 560], [520, 320], [660, 470], [800, 300], [900, 560]]) {
  await page.mouse.click(x, y)
  await page.waitForTimeout(180)
}
await page.keyboard.press('Enter')
await page.waitForTimeout(450)
list = await cards()
const drawn = list.find((c) => c.kind === 'shape')
if (drawn) {
  await page.mouse.dblclick(520, 320)
  await page.waitForTimeout(450)
  /* A box swept round the three on the left, held open for the picture. */
  await page.mouse.move(390, 270)
  await page.mouse.down()
  await page.mouse.move(700, 600, { steps: 14 })
  await page.waitForTimeout(220)
  await shot('nodes-lasso')
  await page.mouse.up()
  await page.waitForTimeout(250)
  await page.mouse.move(700, 760)
  await shot('nodes-picked')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

/* ---------- 8: a number's name, as a way to change it ---------- */
await wipe()
await panel(true)
await drawBox('Star', 460, 260, 780, 580)
await page.waitForTimeout(400)
const word = page.locator('.ctl', { hasText: /^Points/ }).locator('label.scrub')
if (await word.count()) {
  await word.scrollIntoViewIfNeeded()
  const b = await word.boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 14 })
  await page.waitForTimeout(250)
  await shot('scrub-a-number')
  await page.mouse.up()
} else {
  await shot('shape-panel')
}

await browser.close()
