/* Holding a picture up against what it started as, and typing a setting in.
 *
 *   npm run build && node test/finish.mjs http://localhost:4173
 *
 * Two things every tool that grades a picture has and this board did not.
 *
 * The first is a way to see the picture without the grade. Judging an effect
 * against nothing is guesswork, and the only way to do it here was to take the
 * effect off, look, and put it back — two undo steps and a lost train of
 * thought. It is held rather than toggled, because a mode that hides your work
 * is the worst kind of mode to be left in by accident: you would come back an
 * hour later to a board that looks like you had done nothing.
 *
 * The second is a number you can type. Every figure in the panel was read-only,
 * so a setting could not be entered exactly, copied, or matched across two
 * cards by hand — and repeating a treatment is most of what the panel is for.
 *
 * So the checks here are mostly about the edges rather than the happy path:
 * that the hold ends when the window loses focus (a held key sends its keyup
 * to whoever took the focus, not to us), that it files nothing in the undo
 * history, and that a typed number that is out of range is brought into it
 * rather than accepted or dropped.
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
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1400)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

/* Two pictures side by side, so neither one's title bar can end up under the
 * other when one of them is raised by a click. */
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
 * tone is a CSS filter on its body, the effect is a canvas inside it, the grain
 * is an overlay's opacity and the framing is a transform. */
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

const plain = (w) => !!w && w.filter === '' && w.frame === '' && w.grain === 0 && !w.shaded

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
/* The panel's own controls take the focus as they are used, and a slider keeps
 * the arrow keys for itself, so a check about the board's own keys starts by
 * handing the focus back to the board. */
const blur = () => page.evaluate(() => document.activeElement?.blur())
const selectNone = async () => {
  await blur()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

const tab = (t) => page.locator('.panel-tabs button', { hasText: t }).first()
const row = (label) => page.locator('.ctl', { hasText: label }).first()
const slider = (label) => row(label).locator("input[type='range']")
const numberBox = (label) => row(label).locator('input.ctl-num')

/* Grades a card the same way twice, so the two of them can be told apart from
 * each other only by which one is selected. */
async function grade(id) {
  await select(id)
  await tab('Effect').click()
  await page.locator('.fx-thumb[title="Halftone"]').click()
  await page.waitForTimeout(1800)
  await tab('Adjust').click()
  await page.waitForTimeout(300)
  await page.locator('.preset-row button', { hasText: 'Noir' }).click()
  await page.waitForTimeout(400)
  await slider('Grain').fill('40')
  await page.waitForTimeout(800)
  await slider('Zoom').fill('1.4')
  await page.waitForTimeout(500)
  await blur()
}

const list = await ids()
check('two pictures on the board', list.length === 2, `${list.length}`)
const [A, B] = list

/* ---------- holding the key ---------- */

await grade(A)
const graded = await worn(A)
check('a card can be graded to compare against', !plain(graded), JSON.stringify(graded))
check('with a shader, a tone, grain and a crop on it',
  graded.shaded && graded.filter !== '' && graded.grain > 0 && graded.frame !== '',
  JSON.stringify(graded))

await page.keyboard.down('Backslash')
await page.waitForTimeout(500)
const held = await worn(A)
check('holding the key takes the shader off', held.shaded === false)
check('and the tone with it', held.filter === '', `"${held.filter}"`)
check('and the grain', held.grain === 0, `${held.grain}`)
/* All four go together. Half a comparison is not one: the question being asked
   is what the picture looked like before any of this, not before some of it. */
check('and the crop, so what is shown is the picture as it arrived', held.frame === '', `"${held.frame}"`)

fs.writeFileSync(path.join(OUT, 'finish-holding.png'), await page.screenshot())

await page.keyboard.up('Backslash')
await page.waitForTimeout(500)
const back = await worn(A)
check('letting go puts every part of it back', JSON.stringify(back) === JSON.stringify(graded),
  JSON.stringify(back))

/* ---------- and it files nothing ---------- */

/* The last thing done to this card was the crop, so one undo should take the
   crop off and nothing else. Measured once on its own, then again after three
   holds: if a hold had written anything into the history, the second undo
   would spend itself putting the comparison back instead — the exact failure
   that makes a compare key worse than useless. */
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
const oneBack = await worn(A)
check('one undo takes the last thing done and leaves the rest',
  oneBack.frame === '' && oneBack.shaded && oneBack.grain > 0, JSON.stringify(oneBack))
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(600)
check('and redo puts it back', JSON.stringify(await worn(A)) === JSON.stringify(graded))

for (let i = 0; i < 3; i++) {
  await page.keyboard.down('Backslash')
  await page.waitForTimeout(200)
  await page.keyboard.up('Backslash')
  await page.waitForTimeout(200)
}
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
check('three holds later, undo is still exactly where it was',
  JSON.stringify(await worn(A)) === JSON.stringify(oneBack), JSON.stringify(await worn(A)))
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(600)
check('and so is redo', JSON.stringify(await worn(A)) === JSON.stringify(graded))

/* Undo itself, from a focused slider. Reaching for it straight after moving
   one is the common case, and a panel where that does nothing is a panel that
   feels broken. */
await slider('Grain').focus()
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
check('and undo works with the focus still in the panel', (await worn(A)).frame === '',
  JSON.stringify(await worn(A)))
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(600)
check('as does redo', (await worn(A)).frame !== '')
check('while the compare key works there too', await (async () => {
  await page.keyboard.down('Backslash')
  await page.waitForTimeout(400)
  const p = plain(await worn(A))
  await page.keyboard.up('Backslash')
  await page.waitForTimeout(300)
  return p
})())
await blur()

/* ---------- what it applies to ---------- */

await grade(B)
await select(A)
await page.keyboard.down('Backslash')
await page.waitForTimeout(400)
check('with one card selected only that card shows its original',
  plain(await worn(A)) && !plain(await worn(B)),
  `A ${plain(await worn(A)) ? 'plain' : 'graded'}, B ${plain(await worn(B)) ? 'plain' : 'graded'}`)
await page.keyboard.up('Backslash')
await page.waitForTimeout(400)

await selectNone()
await page.keyboard.down('Backslash')
await page.waitForTimeout(400)
check('with nothing selected the whole board shows what it started as',
  plain(await worn(A)) && plain(await worn(B)))
await page.keyboard.up('Backslash')
await page.waitForTimeout(400)
check('and the whole board comes back', !plain(await worn(A)) && !plain(await worn(B)))

/* ---------- the ways a hold can end without a keyup ---------- */

/* A key held down while the window loses focus sends its keyup to whatever
   took the focus. Without this the board would be left showing none of your
   work, with no way to work out why. */
await page.keyboard.down('Backslash')
await page.waitForTimeout(300)
check('the comparison is on', plain(await worn(A)))
await page.evaluate(() => window.dispatchEvent(new Event('blur')))
await page.waitForTimeout(300)
check('losing the window ends the hold rather than leaving it switched on',
  !plain(await worn(A)), JSON.stringify(await worn(A)))
await page.keyboard.up('Backslash')
await page.waitForTimeout(200)

/* Typing is not comparing. A backslash is a character somebody may want in a
   note, and while they are writing one the board must not read it as a key. */
await selectNone()
await page.keyboard.press('n')
await page.waitForSelector('.card[data-kind="note"]', { timeout: 8000 })
await page.waitForTimeout(600)
await page.locator('.card[data-kind="note"]').first().dblclick({ position: { x: 60, y: 60 } })
await page.waitForSelector('textarea', { timeout: 8000 })
await page.waitForTimeout(400)
const editor = page.locator('textarea').first()
await editor.fill('')
await editor.type('a\\b')
await page.waitForTimeout(400)
check('a backslash typed into a note is a backslash',
  (await editor.inputValue()).includes('a\\b'), JSON.stringify(await editor.inputValue()))
check('and the board does not read it as the compare key', !plain(await worn(A)),
  JSON.stringify(await worn(A)))
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await blur()
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)

/* ---------- the button that does the same thing ---------- */

await select(A)
await tab('Adjust').click()
await page.waitForTimeout(300)
const button = page.locator('.panel-compare button')
check('the panel offers it too, for anyone who does not know the key',
  (await button.count()) === 1)
check('and says which key it is', (await button.locator('em').innerText()).trim() === '\\')
check('and starts unpressed', (await button.getAttribute('aria-pressed')) === 'false')

const box = await button.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.waitForTimeout(400)
check('pressing it shows the original', plain(await worn(A)), JSON.stringify(await worn(A)))
check('and it says it is pressed', (await button.getAttribute('aria-pressed')) === 'true')
await page.mouse.up()
await page.waitForTimeout(400)
check('letting go puts it back', !plain(await worn(A)))
check('and it says so', (await button.getAttribute('aria-pressed')) === 'false')

/* Dragging off a held button never sends the mouseup to it, which is the
   pointer's version of losing the window. */
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.waitForTimeout(300)
await page.mouse.move(box.x + box.width / 2, box.y - 200, { steps: 6 })
await page.waitForTimeout(400)
check('sliding off the button ends the hold', !plain(await worn(A)), JSON.stringify(await worn(A)))
await page.mouse.up()
await page.waitForTimeout(200)

/* ---------- a number that can be typed ---------- */

await select(A)
await tab('Adjust').click()
await page.waitForTimeout(400)
check('every slider now has a figure that can be typed into',
  (await page.locator('.fx-controls input.ctl-num').count()) >= 10,
  `${await page.locator('.fx-controls input.ctl-num').count()} of them`)

const grainBox = numberBox('Grain')
await grainBox.click()
await page.waitForTimeout(200)
await grainBox.fill('72')
await grainBox.press('Enter')
await page.waitForTimeout(700)
check('a typed number reaches the card', (await worn(A)).grain === 0.72, `${(await worn(A)).grain}`)
check('and the slider moves to it', (await slider('Grain').inputValue()) === '72',
  await slider('Grain').inputValue())

/* Out of range is brought into range rather than accepted or thrown away: a
   panel that silently ignores what you typed is worse than one that has no
   box at all, because you would go on believing the number took. */
await grainBox.click()
await grainBox.fill('900')
await grainBox.press('Enter')
await page.waitForTimeout(700)
check('a number past the end of the range is brought back to the end of it',
  (await slider('Grain').inputValue()) === '100', await slider('Grain').inputValue())

await grainBox.click()
await grainBox.fill('-40')
await grainBox.press('Enter')
await page.waitForTimeout(700)
check('and one below the start comes back to the start',
  (await slider('Grain').inputValue()) === '0', await slider('Grain').inputValue())

await grainBox.click()
await grainBox.fill('55')
await grainBox.press('Enter')
await page.waitForTimeout(600)
await grainBox.click()
await grainBox.fill('12')
await grainBox.press('Escape')
await page.waitForTimeout(600)
check('Escape puts the box back and leaves the card alone',
  (await slider('Grain').inputValue()) === '55', await slider('Grain').inputValue())

/* Something that is not a number at all. */
await grainBox.click()
await grainBox.fill('wide')
await grainBox.press('Enter')
await page.waitForTimeout(600)
check('and nonsense changes nothing', (await slider('Grain').inputValue()) === '55',
  await slider('Grain').inputValue())

/* A step of 0.01 across a range of two, which is what makes a typed figure
   worth having: two hundred presses from end to end otherwise. */
const zoomBox = numberBox('Zoom')
await zoomBox.click()
await zoomBox.fill('2.25')
await zoomBox.press('Enter')
await page.waitForTimeout(700)
check('a figure with a decimal in it is kept to the decimal',
  (await slider('Zoom').inputValue()) === '2.25', await slider('Zoom').inputValue())
check('and it is shown that way rather than rounded off',
  (await zoomBox.inputValue()).startsWith('2.25'), await zoomBox.inputValue())

/* ---------- and a way back to where it started ---------- */

await slider('Zoom').dblclick()
await page.waitForTimeout(600)
check('double-clicking a slider puts it back where it started',
  (await slider('Zoom').inputValue()) === '1', await slider('Zoom').inputValue())
await slider('Grain').dblclick()
await page.waitForTimeout(600)
check('for every one of them', (await slider('Grain').inputValue()) === '0',
  await slider('Grain').inputValue())

fs.writeFileSync(path.join(OUT, 'finish-panel.png'), await page.screenshot())

/* ---------- and the keyboard alone can do all of it ---------- */

await grainBox.focus()
await page.waitForTimeout(200)
check('the figure can be reached by keyboard', await grainBox.evaluate((el) => el === document.activeElement))
await grainBox.fill('33')
await grainBox.press('Enter')
await page.waitForTimeout(600)
check('and committed with Enter', (await slider('Grain').inputValue()) === '33',
  await slider('Grain').inputValue())

/* Shift with an arrow moves in tens, because a range of two hundred in steps
   of one is forty presses from end to end. */
await slider('Grain').focus()
await slider('Grain').press('Shift+ArrowRight')
await page.waitForTimeout(500)
check('shift with an arrow moves the slider in tens',
  (await slider('Grain').inputValue()) === '43', await slider('Grain').inputValue())

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
