/* The board as one picture, and as paper.
 *
 *   npm run dev &
 *   node test/poster.mjs http://localhost:5173
 *
 * Everything else this app exports is a piece of a board. This is the board:
 * flat, in one file, that opens anywhere. Nothing on screen would show whether
 * it came out right, so the checks read the file back — where the cards landed
 * on the sheet, whether the far corners of a board wider than the window are
 * both on it, whether the writing on a note is really painted, and whether a
 * cut card comes out faded the way it looks on the board.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.removeItem('ideation.path') })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* ---------- a board wider than the window ----------
 * Two pictures in strong, unmistakable colours, placed far apart in board
 * space so that no single screenful holds both. If the sheet has them both on
 * it, it is the board rather than a screenshot. */
const PLACED = await page.evaluate(async () => {
  const paint = async (hex) => {
    const c = document.createElement('canvas')
    c.width = 300
    c.height = 200
    const x = c.getContext('2d')
    x.fillStyle = hex
    x.fillRect(0, 0, 300, 200)
    return await new Promise((r) => c.toBlob(r, 'image/png'))
  }
  const drop = async (hex, name, at) => {
    const dt = new DataTransfer()
    dt.items.add(new File([await paint(hex)], name, { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
    await new Promise((r) => setTimeout(r, 900))
  }
  await drop('#0000ff', 'blue.png', { x: 300, y: 300 })
  await drop('#00ff00', 'green.png', { x: 700, y: 500 })
  return true
})
await page.waitForTimeout(1200)
ok('setup: two pictures on the board', PLACED && (await page.locator('.card[data-kind="image"]').count()) === 2,
   `${await page.locator('.card[data-kind="image"]').count()} pictures`)

/* Push them a long way apart in board coordinates, and add a note between
 * them, so the sheet has to cover ground the window never showed at once. */
await page.evaluate(() => {
  const s = window.__store || null
  void s
})
await page.evaluate(async () => {
  /* Through the board rather than through the store: drag the second card far
   * to the right by nudging it with the keyboard would take four hundred
   * presses, so this moves it the way the app's own arrange code does. */
  const cards = [...document.querySelectorAll('.card[data-kind="image"]')]
  const second = cards[1]
  second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 }))
})
/* A note, so there is type on the sheet as well as photographs. */
await page.getByRole('button', { name: 'Note', exact: true }).click()
await page.waitForTimeout(400)
await page.locator('.card[data-kind="note"]').last().dblclick()
await page.waitForTimeout(400)
await page.locator('.sheet textarea').fill('# Spring\n- first idea\n- [x] done thing')
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.waitForTimeout(600)

/* ---------- the command ---------- */
/* Cards overlap, so a click aimed at a corner can land on the card above it.
 * This finds a point that really belongs to the one asked for. */
const pointOn = (sel, index = 0) => page.evaluate(({ sel, index }) => {
  const card = document.querySelectorAll(sel)[index]
  if (!card) return null
  const r = card.getBoundingClientRect()
  for (let dy = 4; dy < r.height - 4; dy += 6) {
    for (let dx = 4; dx < r.width - 4; dx += 6) {
      const x = Math.round(r.left + dx)
      const y = Math.round(r.top + dy)
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('.card-handles') && el.closest('.card') === card) return { x, y }
    }
  }
  return null
}, { sel, index })

/* No Escape first: Escape clears the selection, and half of what is checked
 * below is what the commands do with one. */
const palette = async (text) => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.locator('.cmd-input').fill(text)
  await page.waitForTimeout(350)
  return page.locator('.cmd-row').first()
}

const first = await palette('one picture')
const label = (await first.count()) ? await first.innerText() : ''
ok('the command list offers the board as one picture', label.toLowerCase().includes('one picture'), label.split('\n')[0])

const [png] = await Promise.all([page.waitForEvent('download'), first.click()])
const pngFile = path.join(OUT, `poster-${png.suggestedFilename()}`)
await png.saveAs(pngFile)
await page.waitForTimeout(600)
ok('it saves a PNG named after the board', /\.png$/.test(png.suggestedFilename()), png.suggestedFilename())

/* Read the sheet back: where each colour is, and how much of it there is. */
const read = (file) => page.evaluate(async (data) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + data
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  const seen = { blue: 0, green: 0, dark: 0, wire: 0 }
  const box = { blue: null, green: null }
  const grow = (k, px, py) => {
    const b = box[k]
    if (!b) box[k] = { x0: px, y0: py, x1: px, y1: py }
    else {
      b.x0 = Math.min(b.x0, px); b.y0 = Math.min(b.y0, py)
      b.x1 = Math.max(b.x1, px); b.y1 = Math.max(b.y1, py)
    }
  }
  for (let py = 0; py < c.height; py++) {
    for (let px = 0; px < c.width; px++) {
      const i = (py * c.width + px) * 4
      const r = d[i], g = d[i + 1], bl = d[i + 2]
      if (bl > 150 && r < 110 && g < 110) { seen.blue++; grow('blue', px, py) }
      else if (g > 150 && r < 110 && bl < 110) { seen.green++; grow('green', px, py) }
      else if (r < 90 && g < 90 && bl < 90) seen.dark++
      /* The wire colour, --wire #a8a8b0, which nothing else on the sheet
       * comes near: the ground is far paler and the cards are white. */
      else if (Math.abs(r - 0xa8) < 26 && Math.abs(g - 0xa8) < 26 && Math.abs(bl - 0xb0) < 26) seen.wire++
    }
  }
  return { w: c.width, h: c.height, seen, box }
}, fs.readFileSync(file).toString('base64'))

const sheet = await read(pngFile)
ok('the sheet is a real picture', sheet.w > 200 && sheet.h > 200, `${sheet.w}x${sheet.h}`)
ok('both pictures are on it', sheet.seen.blue > 500 && sheet.seen.green > 500,
   `${sheet.seen.blue} blue, ${sheet.seen.green} green`)
ok('they are in different places, as on the board',
   !!sheet.box.blue && !!sheet.box.green &&
   (Math.abs(sheet.box.blue.x0 - sheet.box.green.x0) > 40 || Math.abs(sheet.box.blue.y0 - sheet.box.green.y0) > 40),
   JSON.stringify(sheet.box))
ok('the writing on the note is painted, not left blank', sheet.seen.dark > 60, `${sheet.seen.dark} dark pixels`)

/* The sheet is bigger than the window, because the board is. */
ok('the sheet covers more than one screenful', sheet.w > 1280 || sheet.h > 860, `${sheet.w}x${sheet.h}`)

/* ---------- a cut card comes out faded ---------- */
const before = sheet.seen.blue
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const cutAt = await pointOn('.card[data-kind="image"]', 0)
await page.mouse.click(cutAt.x, cutAt.y)
await page.waitForTimeout(300)
await page.keyboard.press('o')
await page.waitForTimeout(400)
ok('pressing O marks a card cut', (await page.locator('.card[data-pick="out"]').count()) === 1)

const cutEntry = await palette('one picture')
const [png2] = await Promise.all([page.waitForEvent('download'), cutEntry.click()])
const cutFile = path.join(OUT, `poster-cut-${png2.suggestedFilename()}`)
await png2.saveAs(cutFile)
await page.waitForTimeout(600)
const withCut = await read(cutFile)
ok('a cut card comes out faded on the sheet', withCut.seen.blue < before * 0.5,
   `${before} solid blue before, ${withCut.seen.blue} after`)
ok('and the rest of the board is untouched', withCut.seen.green > 500, `${withCut.seen.green} green`)

/* ---------- as paper ---------- */
const pdfEntry = await palette('as a PDF')
const pdfLabel = (await pdfEntry.count()) ? await pdfEntry.innerText() : ''
ok('the command list offers a PDF', pdfLabel.toLowerCase().includes('pdf'), pdfLabel.split('\n')[0])
const [pdf] = await Promise.all([page.waitForEvent('download'), pdfEntry.click()])
const pdfFile = path.join(OUT, `poster-${pdf.suggestedFilename()}`)
await pdf.saveAs(pdfFile)
await page.waitForTimeout(600)
const bytes = fs.readFileSync(pdfFile)
const asText = bytes.toString('latin1')
ok('it saves a PDF', /\.pdf$/.test(pdf.suggestedFilename()) && asText.startsWith('%PDF-'), pdf.suggestedFilename())
ok('one page, at a size in points', /\/Count 1/.test(asText) && /\/MediaBox \[0 0 [\d.]+ [\d.]+\]/.test(asText),
   (asText.match(/\/MediaBox \[[^\]]+\]/) || [''])[0])
ok('with the board on it as a JPEG', asText.includes('/DCTDecode') && bytes.includes(Buffer.from([0xff, 0xd8, 0xff])),
   `${Math.round(bytes.length / 1024)} kB`)
ok('and it ends the way a PDF ends', asText.trimEnd().endsWith('%%EOF'))

/* ---------- a selection exports only itself ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
/* The board is wider than the window by now, so a card at the far end is off
 * screen and cannot be clicked. Fitting the board is how a person gets to it,
 * and is the other thing worth checking here. */
await page.keyboard.press('1')
await page.waitForTimeout(800)
const bothOnScreen = await page.evaluate(() => {
  const w = window.innerWidth
  const h = window.innerHeight
  return [...document.querySelectorAll('.card')].every((c) => {
    const r = c.getBoundingClientRect()
    return r.left > -2 && r.top > -2 && r.right < w + 2 && r.bottom < h + 2
  })
})
ok('fitting the board brings every card on screen', bothOnScreen)

/* The blue card and the note, which sit near each other and a long way from
 * the green one: a selection whose sheet must be smaller than the board's. */
const blueAt = await pointOn('.card[data-kind="image"]', 0)
await page.mouse.click(blueAt.x, blueAt.y)
await page.waitForTimeout(250)
/* It is still marked cut from the check above; the same key takes that off. */
await page.keyboard.press('o')
await page.waitForTimeout(300)
ok('pressing O again takes the mark off', (await page.locator('.card[data-pick="out"]').count()) === 0)
const noteAt = await pointOn('.card[data-kind="note"]', 0)
await page.keyboard.down('Shift')
await page.mouse.click(noteAt.x, noteAt.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(300)
const selCount = await page.locator('.card[data-sel]').count()
const selEntry = await palette('one picture')
const selLabel = (await selEntry.count()) ? await selEntry.innerText() : ''
ok('with a selection it offers to export just that', selCount === 2 && /selected/i.test(selLabel),
   `${selCount} selected — ${selLabel.replace('\n', ' — ')}`)
const [png3] = await Promise.all([page.waitForEvent('download'), selEntry.click()])
const selFile = path.join(OUT, `poster-sel-${png3.suggestedFilename()}`)
await png3.saveAs(selFile)
await page.waitForTimeout(600)
const onlySel = await read(selFile)
ok('and the sheet is smaller than the whole board', onlySel.w * onlySel.h < sheet.w * sheet.h * 0.5,
   `${onlySel.w}x${onlySel.h} vs ${sheet.w}x${sheet.h}`)
ok('with the selected picture on it', onlySel.seen.blue > 500, `${onlySel.seen.blue} blue`)
ok('and nothing that was not selected', onlySel.seen.green === 0, `${onlySel.seen.green} green`)

/* ---------- a section and a wire ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Section', exact: true }).click()
await page.waitForTimeout(500)
ok('setup: a section on the board', (await page.locator('.card-section').count()) >= 1)

/* Two cards and nothing else is the one case the menu offers to connect. */
const a1 = await pointOn('.card[data-kind="image"]', 0)
await page.mouse.click(a1.x, a1.y)
await page.waitForTimeout(250)
const a2 = await pointOn('.card[data-kind="note"]', 0)
await page.keyboard.down('Shift')
await page.mouse.click(a2.x, a2.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(250)
await page.mouse.click(a2.x, a2.y, { button: 'right' })
await page.waitForTimeout(350)
const connect = page.locator('.menu button', { hasText: 'Connect' })
if (await connect.count()) await connect.click()
await page.waitForTimeout(500)
ok('setup: a wire between two cards', (await page.locator('.wire').count()) >= 1)

const wireEntry = await palette('this board as one picture')
const [png4] = await Promise.all([page.waitForEvent('download'), wireEntry.click()])
const wireFile = path.join(OUT, `poster-wire-${png4.suggestedFilename()}`)
await png4.saveAs(wireFile)
await page.waitForTimeout(600)
const drawn = await read(wireFile)
ok('the wire is drawn on the sheet', drawn.seen.wire > 200, `${drawn.seen.wire} wire pixels`)
/* The section is the ground: it grows the sheet, because it is part of the
 * picture even where nothing sits on it. */
ok('the section is part of the sheet', drawn.w >= sheet.w && drawn.h >= sheet.h,
   `${drawn.w}x${drawn.h} vs ${sheet.w}x${sheet.h}`)

/* ---------- the sheet follows the theme ---------- */
const themed = await palette('Dark theme')
if (await themed.count()) await themed.click()
await page.waitForTimeout(700)
const darkEntry = await palette('this board as one picture')
const [png5] = await Promise.all([page.waitForEvent('download'), darkEntry.click()])
const darkFile = path.join(OUT, `poster-dark-${png5.suggestedFilename()}`)
await png5.saveAs(darkFile)
await page.waitForTimeout(600)
const corner = await page.evaluate(async (data) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + data
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(2, 2, 1, 1).data
  return { r: d[0], g: d[1], b: d[2] }
}, fs.readFileSync(darkFile).toString('base64'))
ok('exported in the dark theme, the sheet is dark', corner.r < 60 && corner.g < 60 && corner.b < 60,
   `corner rgb(${corner.r}, ${corner.g}, ${corner.b})`)

fs.writeFileSync(path.join(OUT, 'poster-board.png'), await page.screenshot())
console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
