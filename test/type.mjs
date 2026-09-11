/* Text you can see, and text you can set.
 *
 * The bug this suite exists for was reported like this: "when I import text on
 * the dark mode, I couldn't find it because it was imported as a black text on
 * a dark mode". Three separate things made it — the ink was baked into the
 * record, nothing selected what arrived, and there was no way to set type at
 * all — and this checks all three, plus the writing and the font fetching that
 * came with them.
 *
 *   npm run dev &
 *   node test/type.mjs http://localhost:5173
 *
 * Clears the board's stored data first.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173'
const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

/* Every request that leaves the page, so "it only asks Google when you ask it
 * to" is a measurement rather than a belief. */
const asked = []
page.on('request', (r) => { if (/fonts\.googleapis|fonts\.gstatic/.test(r.url())) asked.push(r.url()) })
/* Nothing is actually fetched: the container has no way out, and a request
 * that hangs would hold up the page. What matters is whether it was made. */
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '/* */' }))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => indexedDB.deleteDatabase('ideation.board.db'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)

/* ---------- a dark board ---------- */
await page.evaluate(() => {
  localStorage.setItem('ideation.theme', 'dark')
  document.documentElement.dataset.theme = 'dark'
})
await page.waitForTimeout(400)
ok('the board is dark, which is where the bug was',
   (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')

/* How far apart two colours are, which is the whole question: text you cannot
 * see is text drawn in the colour behind it. Not a formal contrast ratio —
 * the sum of the channel differences, which is enough to tell "invisible" from
 * "readable" and needs no assumptions about which is lighter. */
const contrast = (a, b) => {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  return Math.round(Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2))
}

/* ---------- 1. a label arrives readable, and picked up ---------- */
await page.getByRole('button', { name: 'Label', exact: true }).click()
await page.waitForTimeout(500)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

const seen = await page.evaluate(() => {
  const el = document.querySelector('.card-label')
  const s = getComputedStyle(el)
  const ground = getComputedStyle(document.querySelector('.viewport')).backgroundColor
  return { ink: s.color, ground, sel: el.hasAttribute('data-sel') }
})
const arrivedAt = contrast(seen.ink, seen.ground)
ok('a new label is drawn in ink you can read on a dark board', arrivedAt > 150,
   `${seen.ink} on ${seen.ground} — ${arrivedAt}`)
ok('and it is the card you are now working on', seen.sel)

/* The record itself, which is where the bug actually lived: a colour written
 * into it is a colour that is wrong on one of the two grounds. */
const stored = () => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('ideation.board.db', 1); q.onsuccess = () => r(q.result) })
  const boards = await new Promise((r) => { const t = db.transaction('boards', 'readonly').objectStore('boards').getAll(); t.onsuccess = () => r(t.result) })
  return boards[0]?.items || []
})
await page.waitForTimeout(900)
const label0 = (await stored()).find((i) => i.kind === 'label')
ok('nothing is written into the record for it to be wrong about', !label0.color, String(label0.color))

/* ---------- 2. a board written before any of this heals on opening ---------- */
await page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('ideation.board.db', 1); q.onsuccess = () => r(q.result) })
  const store = db.transaction('boards', 'readwrite').objectStore('boards')
  const all = await new Promise((r) => { const t = store.getAll(); t.onsuccess = () => r(t.result) })
  const b = all[0]
  for (const it of b.items) if (it.kind === 'label') it.color = '#111114'
  store.put(b)
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2200)
const healed = await page.evaluate(() => {
  const el = document.querySelector('.card-label')
  return { ink: getComputedStyle(el).color, ground: getComputedStyle(document.querySelector('.viewport')).backgroundColor }
})
ok('a label saved with the old baked-in near-black reads on a dark board',
   contrast(healed.ink, healed.ground) > 150,
   `${healed.ink} on ${healed.ground} — ${contrast(healed.ink, healed.ground)}`)

/* ---------- 3. what a drop brings arrives picked up ---------- */
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File(['A run of words that arrived from somewhere else.'], 'notes.txt', { type: 'text/plain' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 1120, clientY: 740 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForTimeout(2200)
const dropped = await page.evaluate(() => document.querySelectorAll('.card[data-sel]').length)
ok('text dropped onto the board arrives selected, so it can be found', dropped >= 1, `${dropped} selected`)

/* ---------- 4. the panel that sets it ---------- */
/* Everything on screen first: the drop moved the board to show what landed,
   which can leave the label sitting under the top bar. */
await page.keyboard.press('1')
await page.waitForTimeout(700)
await page.locator('.card-label').first().click()
await page.waitForTimeout(500)
ok('selecting a label turns the panel into a Text panel',
   (await page.locator('.panel-tabs button[data-on]').innerText()).trim() === 'Text',
   await page.locator('.panel-tabs button[data-on]').innerText())

const sizeOf = () => page.evaluate(() => {
  const s = getComputedStyle(document.querySelector('.card-label'))
  return { size: parseFloat(s.fontSize), weight: s.fontWeight, align: s.textAlign, family: s.fontFamily }
})
const before = await sizeOf()
await page.getByRole('button', { name: 'Title', exact: true }).click()
await page.waitForTimeout(500)
const asTitle = await sizeOf()
ok('a role sets size and weight together, in one press',
   asTitle.size > before.size && Number(asTitle.weight) >= 700,
   `${before.size}px → ${asTitle.size}px, weight ${asTitle.weight}`)

await page.getByRole('button', { name: 'Caption', exact: true }).click()
await page.waitForTimeout(500)
const asCaption = await sizeOf()
ok('and a different role is a different setting, not the same one twice',
   asCaption.size < asTitle.size, `${asTitle.size}px → ${asCaption.size}px`)

await page.getByRole('button', { name: 'Centre', exact: true }).click()
await page.waitForTimeout(400)
ok('alignment is a setting on the card', (await sizeOf()).align === 'center', (await sizeOf()).align)

/* ---------- 5. fonts, fetched only when one is chosen ---------- */
ok('nothing has been asked of Google up to here', asked.length === 0, asked.join(' '))

await page.selectOption('.type-family', 'playfair')
await page.waitForTimeout(900)
ok('choosing a Google family fetches it', asked.length === 1, asked.join(' '))
ok('and asks for the family that was chosen', /Playfair\+Display/.test(asked[0] || ''), asked[0] || 'nothing')
ok('and asks with display=swap, so nothing is invisible while it flies',
   /display=swap/.test(asked[0] || ''))
ok('the card is set in it', /Playfair/.test((await sizeOf()).family), (await sizeOf()).family)

const wasAsked = asked.length
await page.selectOption('.type-family', 'sans')
await page.waitForTimeout(400)
await page.selectOption('.type-family', 'playfair')
await page.waitForTimeout(700)
ok('and is never asked for twice', asked.length === wasAsked, `${asked.length} requests`)
ok('one stylesheet for it, not two',
   (await page.locator('link[data-font="playfair"]').count()) === 1)

await page.selectOption('.type-family', 'mono')
await page.waitForTimeout(500)
ok('a family the app carries asks for nothing', asked.length === wasAsked, `${asked.length} requests`)

/* ---------- 6. writing on the board ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Text', exact: true }).click()
await page.waitForTimeout(300)
ok('the text tool arms rather than dropping a card',
   (await page.locator('.viewport[data-tool="text"]').count()) === 1)
ok('and the board says so with its cursor',
   (await page.evaluate(() => getComputedStyle(document.querySelector('.viewport')).cursor)) === 'text')

const labelsBefore = await page.locator('.card-label').count()
await page.mouse.move(560, 640)
await page.mouse.down()
await page.mouse.move(900, 720, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(600)
ok('the drag draws a text box', (await page.locator('.card-label').count()) === labelsBefore + 1)
const drawn = await page.locator('.card-label').last().boundingBox()
ok('at the size it was drawn', Math.abs(drawn.width - 340) < 14, `${Math.round(drawn.width)} across`)
ok('with the caret already in it', (await page.locator('.label-write').count()) === 1)
ok('and the tool stands down, so the next drag is a drag',
   (await page.locator('.viewport[data-tool]').count()) === 0)

await page.keyboard.type('Written straight onto the board')
await page.keyboard.press('Enter')
await page.waitForTimeout(600)
ok('what you type is what it says',
   (await page.locator('.card-label').last().innerText()).includes('Written straight onto the board'),
   await page.locator('.card-label').last().innerText())

/* Escape leaves it as it was, which is the other half of typing on something. */
await page.locator('.card-label').last().dblclick()
await page.waitForTimeout(400)
ok('double-clicking a label writes on it in place, without a dialogue',
   (await page.locator('.label-write').count()) === 1 && (await page.locator('.sheet-veil').count()) === 0)
await page.keyboard.type('thrown away')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
ok('and Escape leaves it as it was',
   (await page.locator('.card-label').last().innerText()).includes('Written straight onto the board'),
   await page.locator('.card-label').last().innerText())

/* ---------- 7. it survives ---------- */
await page.waitForTimeout(1200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2400)
const kept = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.card-label')].find((e) => e.textContent.includes('Written straight'))
  const s = el && getComputedStyle(el)
  return el ? { size: parseFloat(s.fontSize), weight: s.fontWeight } : null
})
ok('the type on a card survives a reload', !!kept && kept.size > 0, kept ? `${kept.size}px ${kept.weight}` : 'gone')

console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none')
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
