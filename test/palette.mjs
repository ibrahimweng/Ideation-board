/* The command list, the icon toolbar, and the panel that stands down.
 *
 *   npm run dev &
 *   node test/palette.mjs http://localhost:5173
 *
 * A toolbar can only hold what fits across the top of the window. The command
 * list has no such limit, so the things that were never in the toolbar are as
 * reachable as the things that were — and every entry says which keys run it,
 * so using the list is how you learn to stop using it.
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
await page.waitForTimeout(1200)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

const cards = () => page.locator('.card').count()
const open = async () => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(350)
}
const rows = () => page.locator('.cmd-row').allInnerTexts()
const chosen = () => page.locator('.cmd-row[data-at] .cmd-name').innerText()

/* ---------- the toolbar says what it is without words ---------- */
const bar = await page.evaluate(() =>
  [...document.querySelectorAll('.tools button')].map((b) => ({
    name: b.getAttribute('aria-label'),
    title: b.getAttribute('title'),
    words: b.textContent.trim(),
    icon: !!b.querySelector('svg'),
  }))
)
check('every toolbar button is an icon', bar.every((b) => b.icon), `${bar.filter((b) => !b.icon).length} without one`)
check('and carries its name for anything reading the page', bar.every((b) => b.name), bar.map((b) => b.name).join(' '))
check('only the mode button keeps its words', bar.filter((b) => b.words).length === 1, bar.filter((b) => b.words).map((b) => b.words).join(','))

/* ---------- opening and closing ---------- */
await open()
check('the command list opens on the shortcut', (await page.locator('.cmd').count()) === 1)
check('and every entry is there to be found', (await page.locator('.cmd-row').count()) > 15, `${await page.locator('.cmd-row').count()} entries`)
fs.writeFileSync(path.join(OUT, 'palette-open.png'), await page.screenshot())

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('Escape puts it away', (await page.locator('.cmd').count()) === 0)

await open()
await page.mouse.click(60, 700)
await page.waitForTimeout(300)
check('and so does pressing outside it', (await page.locator('.cmd').count()) === 0)

/* ---------- finding, and running ---------- */
await open()
await page.keyboard.type('note')
await page.waitForTimeout(350)
const noteRows = await rows()
check('typing narrows the list', noteRows.length < 8 && noteRows.length > 0, `${noteRows.length} left`)
check('and what you asked for is first', (await chosen()).toLowerCase().includes('note'), await chosen())

const before = await cards()
await page.keyboard.press('Enter')
await page.waitForTimeout(600)
check('Enter runs it', (await cards()) === before + 1, `${before} -> ${await cards()}`)
check('and the list closes behind it', (await page.locator('.cmd').count()) === 0)

/* Letters in order, with gaps: the whole point of the matching. */
await page.keyboard.press('Escape')
await open()
await page.keyboard.type('tdy')
await page.waitForTimeout(350)
check('the letters need only be in order, not together', /tidy/i.test(await chosen()), await chosen())

/* ---------- arrowing ---------- */
await page.keyboard.press('Escape')
await open()
const first = await chosen()
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(200)
const second = await chosen()
check('the arrows move the choice', first !== second, `${first} -> ${second}`)
await page.keyboard.press('ArrowUp')
await page.waitForTimeout(200)
check('and back again', (await chosen()) === first)

/* ---------- what needs a selection cannot be run without one ---------- */
await page.keyboard.press('Escape')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await open()
await page.keyboard.type('delete the selection')
await page.waitForTimeout(350)
check('a command with nothing to act on is offered but not live',
  (await page.locator('.cmd-row').count()) === 1 && (await page.locator('.cmd-row:disabled').count()) === 1)
const held = await cards()
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check('and pressing Enter on it does nothing', (await cards()) === held, `${held} -> ${await cards()}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- a command the toolbar never had room for ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.evaluate(() => document.documentElement.dataset.theme)
await open()
await page.keyboard.type('dark')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check('the theme can be set from the list', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
await open()
await page.keyboard.type('light')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check('and set back', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light')

/* ---------- nothing selected: the panel stands down to a rail ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const railW = await page.evaluate(() => {
  const p = document.querySelector('.panel')
  return p ? Math.round(p.getBoundingClientRect().width) : -1
})
check('with nothing selected the panel is a rail', railW > 0 && railW < 90, `${railW}px wide`)

/* Something to work on, and it comes back. */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 800
  c.height = 600
  const x = c.getContext('2d')
  x.fillStyle = '#557'
  x.fillRect(0, 0, 800, 600)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)
const at = await page.evaluate(() => {
  const r = document.querySelector('.card[data-kind="image"]').getBoundingClientRect()
  return { x: Math.round(r.x + 60), y: Math.round(r.y + 20) }
})
await page.mouse.click(at.x, at.y)
await page.waitForTimeout(900)
const fullW = await page.evaluate(() => Math.round(document.querySelector('.panel').getBoundingClientRect().width))
check('selecting a picture opens it again', fullW > 240, `${fullW}px wide`)

/* ---------- finding an effect by name ---------- */
const thumbs = () => page.locator('.fx-thumb').count()
const allThumbs = await thumbs()
check('every effect is listed', allThumbs > 25, `${allThumbs}`)
await page.locator('.fx-find input').fill('half')
await page.waitForTimeout(400)
const some = await thumbs()
check('and typing narrows them', some > 0 && some < allThumbs, `${some} of ${allThumbs}`)
check('to the one asked for', (await page.locator('.fx-thumb').first().getAttribute('title')) === 'Halftone')
await page.locator('.fx-find input').fill('zzzz')
await page.waitForTimeout(400)
check('a name nothing has says so', (await thumbs()) === 0 && (await page.locator('.panel-note').count()) === 1)
await page.locator('.fx-find-clear').click()
await page.waitForTimeout(400)
check('and clearing brings them all back', (await thumbs()) === allThumbs, `${await thumbs()}`)
fs.writeFileSync(path.join(OUT, 'palette-panel.png'), await page.screenshot())

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
