/* The seven things that cover the board.
 *
 *   npm run build && npm run test:browser -- dialogs
 *   node test/dialogs.mjs http://localhost:4173
 *
 * The help, the two sheets that ask for something, the note editor, the
 * command list, the show and the comparison. Each one covers the whole window,
 * takes the keyboard off the board and has to be got out of before anything
 * else can happen, which is what a dialog is — and not one of them behaved
 * like one.
 *
 * Three things, and all three matter most to the person least able to work
 * around them: Tab walked out of the open sheet and off down a toolbar that
 * was covered up; nothing announced what had opened, because a div over the
 * window is a div; and closing dropped the focus on the body, so the next Tab
 * started again from the top of a page with fourteen buttons on it.
 *
 * So each one is put through the same four questions, which is the point of
 * doing it with a table rather than seven times by hand: does it say what it
 * is, does the focus go in, does the focus stay in, and does the focus come
 * back out to where it started.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173'

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

/* Something to work on: two pictures and a note, which between them are what
 * every one of the seven needs to have anything to show. */
await page.evaluate(async () => {
  const one = async (hue, at) => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 400
    const x = c.getContext('2d')
    x.fillStyle = `hsl(${hue}, 60%, 55%)`
    x.fillRect(0, 0, 600, 400)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], `p${hue}.png`, { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at, clientY: 260 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }
  await one(200, 200)
  await new Promise((r) => setTimeout(r, 700))
  await one(30, 700)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)

/* Where the focus is, said in a way a failure can be read from. */
const focus = () =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'the page itself'
    const name = el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim().slice(0, 24)
    return `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}${name ? ` "${name}"` : ''}`
  })

const inside = (sel) =>
  page.evaluate((s) => {
    const box = document.querySelector(s)
    return !!box && (box === document.activeElement || box.contains(document.activeElement))
  }, sel)

/* What the box says it is, read the way a screen reader would ask. */
const says = (sel) =>
  page.evaluate((s) => {
    const box = document.querySelector(s)
    if (!box) return null
    const by = box.getAttribute('aria-labelledby')
    const named = by ? document.getElementById(by) : null
    return {
      role: box.getAttribute('role'),
      modal: box.getAttribute('aria-modal'),
      name: (box.getAttribute('aria-label') || named?.textContent || '').trim(),
      /* The same rule the trap uses, `-1` spelled out on every part of it:
         a button taken out of the tab order on purpose is still a button. */
      able: [...box.querySelectorAll(
        'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), ' +
        'input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), ' +
        'textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.getClientRects().length > 0).length,
    }
  }, sel)

const gone = (sel) => page.evaluate((s) => !document.querySelector(s), sel)

/* The seven, and how each is got into and out of.
 *
 * `by` is a button wherever there is one, because the focus coming back is
 * only checkable when something had it to begin with — a sheet opened with a
 * key was opened from the board, and the board is not a place the focus can
 * return to. */
const SHEETS = [
  {
    what: 'the command list',
    by: '.tool-bar [aria-label="Commands"], [aria-label="Commands"]',
    box: '.cmd',
    out: 'Escape',
  },
  {
    what: 'the help',
    by: '[aria-label="Help"]',
    box: '.help',
    out: 'Escape',
  },
  {
    what: 'the draw sheet',
    by: '[aria-label="Draw"]',
    box: '.gen-sheet',
    out: 'Escape',
  },
  {
    what: 'the note editor',
    open: async () => {
      await page.keyboard.press('n')
      await page.waitForSelector('.card[data-kind="note"]', { timeout: 8000 })
      await page.waitForTimeout(500)
      await page.locator('.card[data-kind="note"]').first().dblclick({ position: { x: 60, y: 50 } })
    },
    box: '.sheet',
    out: 'Escape',
  },
  {
    what: 'the show',
    open: async () => {
      await page.keyboard.press('p')
    },
    box: '.present',
    out: 'Escape',
  },
  {
    what: 'the comparison',
    open: async () => {
      await page.keyboard.press('Control+a')
      await page.waitForTimeout(300)
      await page.keyboard.press('c')
    },
    box: '.compare',
    out: 'Escape',
  },
  {
    /* The only one with no button of its own: it is reached through the
     * command list, which closes itself first so the sheet is not fighting it
     * for the focus. Which makes it the one worth checking that the focus
     * still lands somewhere sensible on the way out. */
    what: 'the relay sheet',
    open: async () => {
      await page.keyboard.press('Control+k')
      await page.waitForSelector('.cmd-input', { timeout: 8000 })
      await page.locator('.cmd-input').fill('Connect to Claude')
      await page.waitForTimeout(400)
      await page.keyboard.press('Enter')
    },
    box: '.gen-sheet',
    out: 'Escape',
  },
]

for (const s of SHEETS) {
  /* Back to a known place: nothing selected, nothing focused, nothing open. */
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  let opener = null
  if (s.by) {
    const button = page.locator(s.by).first()
    if (!(await button.count())) {
      check(`${s.what} can be opened`, false, `no ${s.by}`)
      continue
    }
    opener = await button.evaluate((el) => el.getAttribute('aria-label') || el.className)
    await button.click()
  } else {
    await s.open()
  }
  await page.waitForSelector(s.box, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(700)

  const said = await says(s.box)
  if (!said) {
    check(`${s.what} opens`, false, 'never appeared')
    continue
  }

  /* ---- it says what it is ---- */
  check(`${s.what} says it is a dialog`, said.role === 'dialog', `role="${said.role}"`)
  check(`${s.what} says everything behind it is out of reach`, said.modal === 'true',
    `aria-modal="${said.modal}"`)
  check(`${s.what} has a name to announce`, said.name.length > 0, `"${said.name}"`)

  /* ---- the focus goes in ---- */
  check(`${s.what} takes the focus when it opens`, await inside(s.box), await focus())

  /* ---- and stays in ---- */
  /* One press past the last thing in it. If the trap were missing this would
     be out on the toolbar underneath, which is the whole complaint. */
  for (let i = 0; i <= said.able; i++) await page.keyboard.press('Tab')
  await page.waitForTimeout(200)
  check(`${s.what} keeps the focus when Tab runs off the end`, await inside(s.box),
    `${said.able} places to go, then ${await focus()}`)

  /* And backwards, which is the half everyone forgets. */
  for (let i = 0; i <= said.able; i++) await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(200)
  check(`${s.what} keeps it going the other way too`, await inside(s.box), await focus())

  /* ---- and comes back out ---- */
  await page.keyboard.press(s.out)
  await page.waitForTimeout(600)
  check(`${s.what} closes`, await gone(s.box))
  if (opener) {
    const back = await focus()
    check(`${s.what} hands the focus back to what opened it`, back.includes(opener), back)
  }
}

/* ---------- and one of them opening over another ---------- */

/* The command list opens over anything you are in the middle of — that is the
 * point of it — so it is the one case where two of these are on screen at
 * once, and the one that would break a trap written as a single window
 * listener rather than as one per box. */
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.locator('.card[data-kind="note"]').first().dblclick({ position: { x: 60, y: 50 } })
await page.waitForSelector('.sheet', { timeout: 8000 })
await page.waitForTimeout(600)
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 8000 })
await page.waitForTimeout(600)
check('the command list opens over an open sheet', !(await gone('.sheet')))
check('and takes the focus off it', await inside('.cmd'), await focus())
await page.keyboard.press('Escape')
await page.waitForTimeout(700)
check('closing it leaves the sheet underneath open', !(await gone('.sheet')))
check('with the focus back inside that', await inside('.sheet'), await focus())
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
check('and the last one out puts the board back', await gone('.sheet'))

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
