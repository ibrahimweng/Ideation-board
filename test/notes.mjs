/* Formatting and checklists in notes.
 *
 *   npm run dev &
 *   node test/notes.mjs http://localhost:5173
 *
 * A note is still one string. Headings, lists, checkboxes, emphasis and links
 * are marks inside it, written by the editor's buttons or typed by hand, and
 * read back when the card is drawn. So the things worth checking are that the
 * marks are drawn as what they mean, that ticking a box on the card writes the
 * tick back into the text, and that the buttons put the marks where the cursor
 * is.
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

/* The toolbar is icons: found by accessible name, not by printed words. */
/* The making tools live down the left now, not in the top row. */
const tool = (t) => page.locator(`.rail button[aria-label="${t}"]`).first()
const note = () => page.locator('.card[data-kind="note"]').first()
const blur = () => page.evaluate(() => document.activeElement?.blur?.())
const textOf = () =>
  page.evaluate(() => {
    const el = document.querySelector('.card[data-kind="note"]')
    return el ? el.dataset.id : null
  })

await tool('Note').click()
await page.waitForSelector('.card[data-kind="note"]', { timeout: 5000 })
await page.waitForTimeout(300)

/* ---------- write a note with everything in it ---------- */
const body = [
  '# Launch',
  'A **bold** claim and an *aside*, with `code` and https://example.com',
  '- one',
  '- two',
  '1. first',
  '> borrowed',
  '- [ ] draft the brief',
  '- [x] book the room',
].join('\n')

await note().dblclick({ position: { x: 60, y: 90 } })
await page.waitForSelector('.sheet textarea', { timeout: 5000 })
await page.locator('.sheet textarea').fill(body)
await page.locator('.sheet-actions button', { hasText: 'Save' }).click()
await page.waitForTimeout(500)

const drawn = await page.evaluate(() => {
  const n = document.querySelector('.card[data-kind="note"] .rich')
  if (!n) return null
  return {
    heads: [...n.querySelectorAll('.rich-h')].map((e) => e.textContent),
    bold: [...n.querySelectorAll('strong')].map((e) => e.textContent),
    italic: [...n.querySelectorAll('em')].map((e) => e.textContent),
    code: [...n.querySelectorAll('.rich-code')].map((e) => e.textContent),
    links: [...n.querySelectorAll('.rich-link')].map((e) => e.getAttribute('href')),
    bullets: [...n.querySelectorAll('.rich-li .rich-bullet')].map((e) => e.textContent),
    quote: n.querySelector('.rich-quote')?.textContent || null,
    todos: [...n.querySelectorAll('.rich-todo')].map((e) => ({
      done: e.hasAttribute('data-done'),
      text: e.textContent.replace(/^[✓]/, '').trim(),
    })),
    marks: n.textContent.includes('**') || n.textContent.includes('- [ ]'),
  }
})

check('a heading is drawn as one', drawn.heads.length === 1 && drawn.heads[0] === 'Launch')
check('bold and italic are drawn as themselves', drawn.bold[0] === 'bold' && drawn.italic[0] === 'aside')
check('code keeps its own face', drawn.code[0] === 'code')
check('an address becomes a link', drawn.links[0] === 'https://example.com')
check('lists get their marks', drawn.bullets.join(' ') === '• • 1.')
check('a quote is set apart', drawn.quote === 'borrowed')
check('checkboxes are drawn as boxes', drawn.todos.length === 2)
check('and remember which are ticked', drawn.todos[0].done === false && drawn.todos[1].done === true)
check('the marks themselves are not shown', drawn.marks === false)
check('the card bar counts them off', (await page.locator('.card-todo').first().innerText()).trim() === '1/2')
fs.writeFileSync(path.join(OUT, 'note-rich.png'), await note().screenshot())

/* ---------- ticking one on the card ---------- */
await page.locator('.rich-todo .rich-box').first().click()
await page.waitForTimeout(400)
const after = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="note"] .rich-todo')].map((e) => e.hasAttribute('data-done'))
)
check('ticking a box on the card works', after[0] === true && after[1] === true)
check('and the bar keeps up', (await page.locator('.card-todo').first().innerText()).trim() === '2/2')

/* It is written into the text, which is the only place it is kept. The wait is
 * longer than the autosave's, or the reload would land before the tick was
 * written and the check would be measuring the debounce. */
await page.waitForTimeout(1200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
const kept = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="note"] .rich-todo')].map((e) => e.hasAttribute('data-done'))
)
check('the tick was written into the note', kept[0] === true && kept[1] === true, JSON.stringify(kept))

await page.locator('.rich-todo .rich-box').first().click()
await page.waitForTimeout(400)
check('and it unticks again', await page.evaluate(() => !document.querySelector('.rich-todo').hasAttribute('data-done')))

/* ---------- the editor's buttons ---------- */
await note().dblclick({ position: { x: 60, y: 90 } })
await page.waitForSelector('.sheet textarea', { timeout: 5000 })
const ta = page.locator('.sheet textarea')
await ta.fill('plain words here')
await page.evaluate(() => {
  const el = document.querySelector('.sheet textarea')
  el.focus()
  el.setSelectionRange(6, 11)
})
await page.locator('.note-tools button[title^="Bold"]').click()
await page.waitForTimeout(200)
check('the bold button wraps the selection', (await ta.inputValue()) === 'plain **words** here')

await page.locator('.note-tools button[title^="Bold"]').click()
await page.waitForTimeout(200)
check('and takes it off again', (await ta.inputValue()) === 'plain words here')

await page.locator('.note-tools button[title^="Checklist"]').click()
await page.waitForTimeout(200)
check('the checklist button marks the line', (await ta.inputValue()) === '- [ ] plain words here')

await page.locator('.note-tools button[title^="Heading"]').click()
await page.waitForTimeout(200)
check('marks stack on one line', (await ta.inputValue()) === '## - [ ] plain words here')

await ta.fill('one\ntwo')
await page.evaluate(() => {
  const el = document.querySelector('.sheet textarea')
  el.focus()
  el.setSelectionRange(0, 7)
})
await page.locator('.note-tools button[title^="Bullet"]').click()
await page.waitForTimeout(200)
check('a line mark covers every line the selection touches', (await ta.inputValue()) === '- one\n- two')

await page.locator('.sheet-actions button', { hasText: 'Save' }).click()
await page.waitForTimeout(400)
check('what the buttons wrote is what the card draws', (await page.locator('.rich-li').count()) === 2)
fs.writeFileSync(path.join(OUT, 'note-editor.png'), await page.screenshot())

/* ---------- a plain note is still a plain note ---------- */
await tool('Note').click()
await page.waitForTimeout(400)
/* The one just made, which arrives picked up. Two notes made in a row overlap
   by design — the second is offset by a cascade, not put somewhere else — so
   "the last one in the document" is not the same as "the one on top", and
   reaching for the wrong one means reaching for a card with another sitting
   over it. */
await page.locator('.card[data-kind="note"][data-sel]').dblclick({ position: { x: 60, y: 90 } })
await page.waitForSelector('.sheet textarea', { timeout: 5000 })
await page.locator('.sheet textarea').fill('just some words\nand a second line')
await page.locator('.sheet-actions button', { hasText: 'Save' }).click()
await page.waitForTimeout(400)
const plain = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card[data-kind="note"] .rich')]
  const last = cards[cards.length - 1]
  return { paras: last.querySelectorAll('.rich-p').length, text: last.textContent }
})
check('plain text is left alone', plain.paras === 2 && plain.text.includes('just some words'))

/* ---------- a link a note is not allowed to be ----------
 *
 * A note is not always one you wrote: an imported board file brings its notes
 * with it, and so does the relay. The card used to put whatever was in the
 * brackets straight into an href, so a `javascript:` link in somebody else's
 * board was one click from reading every board in IndexedDB and the picture
 * key in localStorage. `test/unit/richlinks.test.ts` holds the rule; this
 * holds the card that has to apply it.
 *
 * No parentheses and no spaces in the payload, because the parser stops at
 * either — this is the shape one would really have to take. */
await tool('Note').click()
await page.waitForTimeout(400)
/* Again the one just made, not the last one in the document. */
await page.locator('.card[data-kind="note"][data-sel]').dblclick({ position: { x: 60, y: 90 } })
await page.waitForSelector('.sheet textarea', { timeout: 5000 })
await page.locator('.sheet textarea').fill(
  '[run me](javascript:location=`https://evil.example`)\n' +
    '[a document](data:text/html;base64,PHNjcmlwdD4=)\n' +
    '[safe](https://example.com/ok)'
)
await page.locator('.sheet-actions button', { hasText: 'Save' }).click()
await page.waitForTimeout(500)

const links = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card[data-kind="note"] .rich')]
  const last = cards[cards.length - 1]
  return {
    hrefs: [...last.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    text: last.textContent,
  }
})

check(
  'a javascript: link in a note is not drawn as a link',
  !links.hrefs.some((h) => /^\s*javascript:/i.test(h || '')),
  JSON.stringify(links.hrefs)
)
check(
  'nor is a data: document',
  !links.hrefs.some((h) => /^\s*data:/i.test(h || '')),
  JSON.stringify(links.hrefs)
)
check('but the words of both are still on the card', links.text.includes('run me') && links.text.includes('a document'))
check('and an ordinary address still works', links.hrefs.includes('https://example.com/ok'))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
