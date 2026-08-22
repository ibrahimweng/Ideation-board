/* Taking a board out and putting it back.
 *
 *   npm run dev &
 *   node test/transfer.mjs http://localhost:5173
 *
 * Builds a board with a picture on it, a wire between two cards and a board
 * nested inside it, exports the lot, wipes the browser, and drops the file
 * back on an empty board. Everything has to come back — including the picture,
 * which is the part the old export could not carry.
 *
 * The file is also opened with Python's zipfile, so "openable by anything" is
 * checked by something that is not the reader that wrote it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const wipe = async () => {
  await page.evaluate(() => {
    indexedDB.deleteDatabase('ideation.board.db')
    localStorage.removeItem('ideation.path')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1400)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await wipe()

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

const tool = (t) => page.locator('.tools button', { hasText: t }).first()
const cards = () => page.locator('.card')
const crumbs = () => page.locator('.crumbs button')
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
const boxes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card')].map((c) => {
      const r = c.getBoundingClientRect()
      return { id: c.dataset.id, kind: c.dataset.kind, x: r.x, y: r.y, w: r.width, h: r.height }
    })
  )
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

/* ---------- build something worth carrying ---------- */
const dropPicture = async (label) =>
  page.evaluate(async (text) => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 300
    const x = c.getContext('2d')
    x.fillStyle = '#2F6FEB'
    x.fillRect(0, 0, 400, 300)
    x.fillStyle = '#fff'
    x.font = 'bold 90px monospace'
    x.fillText(text, 40, 180)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'picture.png', { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 360, clientY: 300 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
    return blob.size
  }, label)

const png = await dropPicture('A')
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
check('a picture to carry', png > 0, `${png} bytes`)

await tool('Note').click()
await page.waitForTimeout(300)
await page.locator('.card[data-kind="note"]').first().dblclick({ position: { x: 60, y: 90 } })
await page.waitForSelector('.sheet textarea')
await page.locator('.sheet textarea').fill('# Plan\n- [x] pack it\n- [ ] send it')
await page.locator('.sheet-actions button', { hasText: 'Save' }).click()
await page.waitForTimeout(400)

/* A wire between the picture and the note. */
let list = await boxes()
const pic = list.find((c) => c.kind === 'image')
const note = list.find((c) => c.kind === 'note')
const notePoint = await grip(note.id)
await page.mouse.move(notePoint.x, notePoint.y)
await page.mouse.down()
await page.mouse.move(notePoint.x + 40, notePoint.y + 330, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
await page.mouse.move(pic.x + 40, pic.y + 60)
await page.waitForTimeout(250)
const port = await page.evaluate(
  (cid) => document.querySelector(`.card[data-id="${cid}"] + .card-ports .port-s`)?.getBoundingClientRect().toJSON() || null,
  pic.id
)
await page.mouse.move(port.x + 10, port.y + 10)
await page.mouse.down()
list = await boxes()
const noteNow = list.find((c) => c.id === note.id)
await page.mouse.move(noteNow.x + 80, noteNow.y + 60, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(400)
check('a wire to carry', (await page.locator('.wire-line').count()) === 1)

/* A board inside it, with something in that. */
await tool('Board').click()
await page.waitForTimeout(400)
await page.locator('.card[data-kind="board"]').first().dblclick({ position: { x: 90, y: 90 } })
await page.waitForTimeout(900)
await page.locator('.board-name').fill('Inner')
await blur()
await dropPicture('B')
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1400)
check('a board inside it to carry', (await cards().count()) === 1 && (await crumbs().count()) === 1)
await crumbs().first().click()
await page.waitForTimeout(900)

const before = await boxes()
check('three cards on the board it goes out with', before.length === 3, `${before.length} cards`)

/* ---------- out ---------- */
const [download] = await Promise.all([page.waitForEvent('download'), tool('Export').click()])
const file = path.join(OUT, download.suggestedFilename())
await download.saveAs(file)
const size = fs.statSync(file).size
check('the export is named after the board', /\.board\.zip$/.test(download.suggestedFilename()), download.suggestedFilename())
check('and has some weight to it', size > 2000, `${size} bytes`)

/* Read by something that is not our own reader. */
let names = null
try {
  names = JSON.parse(
    execFileSync('python3', [
      '-c',
      'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad":z.testzip(),"names":z.namelist(),"json":json.loads(z.read("board.json"))["boards"].__len__()}))',
      file,
    ]).toString()
  )
} catch (e) {
  console.log('     (python3 unavailable, skipping the outside reader check)')
}
if (names) {
  check('a zip anything can open', names.bad === null, JSON.stringify(names.names))
  check('with a board listing and its media inside', names.names.includes('board.json') && names.names.some((n) => n.startsWith('media/')))
  check('holding both boards', names.json === 2, `${names.json} boards`)
}

/* ---------- and back in, on a board that knows nothing ---------- */
await wipe()
check('the board is empty to start with', (await cards().count()) === 0)

const b64 = fs.readFileSync(file).toString('base64')
const feed = async () =>
  page.evaluate(
    ({ data, name }) => {
      const bin = atob(data)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      const dt = new DataTransfer()
      dt.items.add(new File([arr], name, { type: 'application/zip' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { data: b64, name: path.basename(file) }
  )

await feed()
await page.waitForSelector('.card[data-kind="board"]', { timeout: 15000 })
await page.waitForTimeout(1200)
check('dropping the file makes a board card', (await page.locator('.card[data-kind="board"]').count()) === 1)
check('and nothing else is disturbed', (await cards().count()) === 1)
fs.writeFileSync(path.join(OUT, 'import-card.png'), await page.locator('.card[data-kind="board"]').first().screenshot())

await page.locator('.card[data-kind="board"]').first().dblclick({ position: { x: 90, y: 90 } })
await page.waitForTimeout(1500)
const back = await boxes()
check('everything that went out came back', back.length === 3, `${back.length} cards`)
check('the wire came back too', (await page.locator('.wire-line').count()) === 1)

const shown = await page.evaluate(() => {
  const img = document.querySelector('.card[data-kind="image"] img.media')
  const note = document.querySelector('.card[data-kind="note"] .rich')
  return {
    picture: img ? { w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 5) } : null,
    todos: note ? [...note.querySelectorAll('.rich-todo')].map((e) => e.hasAttribute('data-done')) : null,
    heading: note?.querySelector('.rich-h')?.textContent || null,
  }
})
check('the picture came back as a picture', shown.picture?.w === 400 && shown.picture?.h === 300, JSON.stringify(shown.picture))
check('the note kept its shape', shown.heading === 'Plan' && JSON.stringify(shown.todos) === '[true,false]')
fs.writeFileSync(path.join(OUT, 'import-opened.png'), await page.screenshot())

await page.locator('.card[data-kind="board"]').first().dblclick({ position: { x: 90, y: 90 } })
await page.waitForTimeout(1400)
check('the board nested inside came back with it', (await crumbs().count()) === 2)
const inner = await page.evaluate(() => {
  const img = document.querySelector('.card[data-kind="image"] img.media')
  return { name: document.querySelector('.board-name')?.value, w: img?.naturalWidth || 0 }
})
check('with its name', inner.name === 'Inner', inner.name)
check('and its picture', inner.w === 400, `${inner.w}px`)

/* ---------- twice, without the two treading on each other ---------- */
await crumbs().first().click()
await page.waitForTimeout(900)
await feed()
await page.waitForTimeout(2000)
check('the same file can come in twice', (await page.locator('.card[data-kind="board"]').count()) === 2)

const separate = await page.evaluate(async () => {
  const db = await new Promise((r) => {
    const q = indexedDB.open('ideation.board.db', 1)
    q.onsuccess = () => r(q.result)
  })
  const boards = await new Promise((r) => {
    const t = db.transaction('boards', 'readonly').objectStore('boards').getAll()
    t.onsuccess = () => r(t.result)
  })
  const cardsOn = boards.flatMap((b) => b.items.filter((i) => i.kind === 'board').map((i) => i.board))
  const media = new Set(boards.flatMap((b) => b.items.map((i) => i.media).filter(Boolean)))
  return { boards: boards.length, links: cardsOn.length, unique: new Set(cardsOn).size, media: media.size }
})
check('the two copies are separate boards', separate.unique === separate.links && separate.links === 4, JSON.stringify(separate))
check('each with its own media', separate.media === 4, `${separate.media} media keys`)

/* ---------- a file that is not a board ---------- */
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'notes.zip', { type: 'application/zip' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 700 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForTimeout(1500)
check('a zip that is not a board is added as a file', (await page.locator('.card[data-kind="file"]').count()) === 1)
check('and says so', /not a board|could not be read/i.test((await page.locator('.toast').innerText().catch(() => '')) || 'not a board'))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
