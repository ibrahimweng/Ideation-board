/* Two, three or four things held up against each other.
 *
 *   npm run dev &
 *   node test/compare.mjs http://localhost:5173
 *
 * Comparing is the act the rest of the app is in service of. A board is for
 * gathering, a mark is for recording what you decided, and the deciding itself
 * is nearly always between two things — this one or that one — which the show
 * could not help with, because it puts one thing on screen at a time and the
 * question when you are choosing is what the other one looked like.
 *
 * So: the things are on screen together and large, the decision can be made
 * from inside without going back to the board for it, and the board's own keys
 * stand down while it is up.
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)

/* Wide ones and tall ones, so the arrangement has something to decide. */
await page.evaluate(async () => {
  const paint = async (i, wide) => {
    const c = document.createElement('canvas')
    c.width = wide ? 900 : 400
    c.height = wide ? 500 : 700
    const x = c.getContext('2d')
    x.fillStyle = `hsl(${i * 67} 55% 50%)`
    x.fillRect(0, 0, c.width, c.height)
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
  }
  const names = ['zellige', 'plaster', 'oak-batten', 'brass-tap', 'terracotta']
  const dt = new DataTransfer()
  for (let i = 0; i < names.length; i++) dt.items.add(new File([await paint(i, i % 2 === 0)], `${names[i]}.jpg`, { type: 'image/jpeg' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 400, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForTimeout(10000)
ok('setup: five references', (await page.locator('.card[data-kind="image"]').count()) === 5,
   `${await page.locator('.card[data-kind="image"]').count()} cards`)

const pointOn = (i) => page.evaluate((i) => {
  const c = document.querySelectorAll('.card')[i]
  if (!c) return null
  const r = c.getBoundingClientRect()
  for (let dy = 4; dy < r.height - 4; dy += 4) {
    for (let dx = 4; dx < r.width - 4; dx += 4) {
      const x = Math.round(r.left + dx)
      const y = Math.round(r.top + dy)
      const el = document.elementFromPoint(x, y)
      if (el && !el.closest('.card-handles') && el.closest('.card') === c) return { x, y }
    }
  }
  return null
}, i)

const cells = () => page.evaluate(() => {
  const list = [...document.querySelectorAll('.compare-cell')]
  const tops = new Set(list.map((c) => Math.round(c.getBoundingClientRect().top / 10)))
  return {
    n: list.length,
    rows: tops.size,
    focused: list.findIndex((c) => c.hasAttribute('data-on')),
    picks: list.map((c) => c.dataset.pick || '-'),
    names: list.map((c) => c.querySelector('.compare-say span')?.textContent || ''),
    /* The largest picture in it, to say the things are actually large. */
    biggest: Math.max(0, ...list.map((c) => {
      const m = c.querySelector('.present-media, .present-stage')
      const r = m?.getBoundingClientRect()
      return r ? r.width * r.height : 0
    })),
  }
})

/* ---------- one is not a comparison ---------- */
const one = await pointOn(0)
await page.mouse.click(one.x, one.y)
await page.waitForTimeout(300)
await page.keyboard.press('c')
await page.waitForTimeout(700)
ok('one thing on its own is not something to compare', (await page.locator('.compare').count()) === 0)
ok('and it says so', /two or more/i.test(await page.locator('.toast').innerText().catch(() => '')),
   await page.locator('.toast').innerText().catch(() => 'nothing'))

/* ---------- two ---------- */
const two = await pointOn(1)
await page.keyboard.down('Shift')
await page.mouse.click(two.x, two.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(300)
await page.keyboard.press('c')
await page.waitForTimeout(1300)
let shown = await cells()
ok('two are held up side by side', (await page.locator('.compare').count()) === 1 && shown.n === 2 && shown.rows === 1,
   `${shown.n} cells in ${shown.rows} row`)
ok('and the bar says how many', /2 side by side/.test(await page.locator('.present-count').innerText()),
   await page.locator('.present-count').innerText())
/* Large is the whole point: on the board these are cards among thirty. */
ok('each is far bigger than a card on the board', shown.biggest > 1440 * 900 * 0.12,
   `${Math.round(shown.biggest / 1000)}k square pixels`)
ok('each says what it is', shown.names.every((n) => n.endsWith('.jpg')), shown.names.join(', '))
fs.writeFileSync(path.join(OUT, 'compare-two.png'), await page.screenshot())

/* ---------- deciding from inside it ---------- */
ok('the first one has the keys to begin with', shown.focused === 0, `cell ${shown.focused + 1}`)
await page.keyboard.press('i')
await page.waitForTimeout(500)
shown = await cells()
ok('I keeps the one being looked at', shown.picks[0] === 'in', shown.picks.join(','))
ok('and it says so on the picture, not only afterwards',
   /kept/i.test((await page.locator('.compare-say em').first().innerText().catch(() => ''))),
   await page.locator('.compare-say em').first().innerText().catch(() => 'nothing'))

await page.keyboard.press('ArrowRight')
await page.waitForTimeout(400)
shown = await cells()
ok('the arrows move which one the keys act on', shown.focused === 1, `cell ${shown.focused + 1}`)
await page.keyboard.press('o')
await page.waitForTimeout(500)
shown = await cells()
ok('O cuts that one', shown.picks[1] === 'out', shown.picks.join(','))
ok('and the one that was kept is still kept', shown.picks[0] === 'in', shown.picks.join(','))
fs.writeFileSync(path.join(OUT, 'compare-marked.png'), await page.screenshot())

/* Its number picks it out, which is what the number on it is for. */
await page.keyboard.press('1')
await page.waitForTimeout(300)
ok('a number picks the one it is written on', (await cells()).focused === 0)

/* ---------- the board underneath stands down ----------
   Both this and the board listen on the window, so without a rule about who
   has the keyboard the arrows that move between pictures also nudge whatever
   is selected on the board behind, eight pixels at a time and invisibly. */
const before = await page.evaluate(() => document.querySelector('.surface').style.transform)
const boxes = await page.evaluate(() =>
  [...document.querySelectorAll('.card')].map((c) => `${c.style.transform}`).join('|'))
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(80)
}
await page.waitForTimeout(400)
ok('the board is not moved by the arrows',
   (await page.evaluate(() => document.querySelector('.surface').style.transform)) === before)
ok('and nothing on it is nudged',
   (await page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => `${c.style.transform}`).join('|'))) === boxes)

/* ---------- leaving ---------- */
await page.keyboard.press('Escape')
await page.waitForTimeout(700)
ok('Escape leaves it', (await page.locator('.compare').count()) === 0)
ok('and what was decided inside it is on the board', (await page.locator('.card[data-pick]').count()) === 2,
   `${await page.locator('.card[data-pick="in"]').count()} kept, ${await page.locator('.card[data-pick="out"]').count()} cut`)

/* ---------- more than four ---------- */
await page.keyboard.press('Escape')
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
await page.keyboard.press('c')
await page.waitForTimeout(1500)
shown = await cells()
ok('four is the most it will hold up at once', shown.n === 4 && shown.rows === 2,
   `${shown.n} cells in ${shown.rows} rows`)
ok('and it says what it left out',
   /1 more not shown/i.test(await page.locator('.compare-more').innerText().catch(() => '')),
   await page.locator('.compare-more').innerText().catch(() => 'said nothing'))
fs.writeFileSync(path.join(OUT, 'compare-four.png'), await page.screenshot())
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

/* ---------- it is in the command list too ---------- */
await page.keyboard.press('Escape')
const at = await pointOn(0)
await page.mouse.click(at.x, at.y)
await page.keyboard.down('Shift')
const other = await pointOn(2)
await page.mouse.click(other.x, other.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(300)
await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
await page.locator('.cmd-input').fill('against each other')
await page.waitForTimeout(400)
const row = await page.locator('.cmd-row').first().innerText().catch(() => '')
ok('the command list offers it, and says how many', /2 selected/.test(row), row.replace('\n', ' — '))
await page.locator('.cmd-row').first().click()
await page.waitForTimeout(1300)
ok('and running it opens the same thing', (await page.locator('.compare-cell').count()) === 2)
await page.keyboard.press('Escape')

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
