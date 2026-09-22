/* Shapes: the vector layer, and the tools that draw one.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/shapes.mjs http://localhost:4173
 *
 * The geometry itself is checked in test/unit/shapes.test.ts, where the
 * numbers can be written down. This is about the gestures: that arming a tool
 * takes the board out of selecting and into drawing, that what you drag out is
 * the shape you get, that Shift keeps it regular, and that a line drawn dead
 * across still leaves a card anybody can get hold of again.
 *
 * Clears the board's stored data first.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const BASE = process.argv[2] || 'http://localhost:4173'
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

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
await page.evaluate(() => indexedDB.deleteDatabase('ideation.board.db'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* Every shape card on the board, as the record has it. */
const shapes = () => page.evaluate(() =>
  [...document.querySelectorAll('.card[data-kind="shape"]')].map((el) => {
    const p = el.querySelector('svg path:not(.shape-hit)')
    return {
      id: el.dataset.id,
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
      d: p?.getAttribute('d') || '',
      fill: p?.getAttribute('fill') || '',
      stroke: p?.getAttribute('stroke') || '',
      sel: el.hasAttribute('data-sel'),
      heads: el.querySelectorAll('svg path').length,
    }
  })
)
const last = async () => (await shapes()).at(-1)
const cmds = (d) => (d.match(/[A-Za-z]/g) || []).join('')

const rail = () => page.locator('.rail')
const pick = async (name, group = 'Shapes') => {
  /* The rail holds one of each group; the rest are behind the corner mark.
     Scoped to the rail, because the panel names itself after the shape it is
     working on and a tab called Rectangle is not the rectangle tool. */
  const on = await rail().getByRole('button', { name, exact: true }).count()
  if (!on) {
    await rail().getByRole('button', { name: group, exact: true }).click()
    await page.waitForTimeout(200)
    await page.getByRole('menuitem', { name, exact: true }).click()
  } else {
    await rail().getByRole('button', { name, exact: true }).click()
  }
  await page.waitForTimeout(250)
}

const clicks = async (pts) => {
  for (const [x, y] of pts) {
    await page.mouse.click(x, y)
    await page.waitForTimeout(140)
  }
}

const drag = async (x, y, x2, y2, opts = {}) => {
  if (opts.shift) await page.keyboard.down('Shift')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x2, y2, { steps: 12 })
  if (opts.mid) await opts.mid()
  await page.mouse.up()
  if (opts.shift) await page.keyboard.up('Shift')
  await page.waitForTimeout(400)
}

/* --- arming --- */
await pick('Rectangle')
const armed = await page.evaluate(() => document.querySelector('.viewport')?.getAttribute('data-tool'))
ok('the board knows a shape tool is armed', armed === 'rect', `data-tool=${armed}`)

/* --- what you drag out is what you get --- */
await drag(420, 260, 700, 440)
const rect = await last()
ok('a drag makes a rectangle the size it was dragged',
   !!rect && Math.abs(rect.w - 280) <= 3 && Math.abs(rect.h - 180) <= 3,
   rect ? `${rect.w}x${rect.h}` : 'nothing made')
ok('and it is a closed four-sided path', !!rect && cmds(rect.d) === 'MHVHZ', rect?.d)
ok('and it arrives selected', !!rect?.sel)

/* --- the tool stands down after one --- */
const after = await page.evaluate(() => document.querySelector('.viewport')?.getAttribute('data-tool'))
ok('one press, one shape, and the tool stands down', after === null, `data-tool=${after}`)

/* --- drawing is not selecting --- */
await pick('Rectangle')
await drag(400, 240, 740, 470)
const caught = await page.evaluate(() => document.querySelectorAll('.card[data-sel]').length)
ok('drawing over a card does not select it', caught === 1, `${caught} selected`)

/* --- shift keeps it regular --- */
await pick('Rectangle')
await drag(200, 560, 500, 640, { shift: true })
const square = await last()
ok('shift makes a square of a rectangle', !!square && square.w === square.h, square ? `${square.w}x${square.h}` : '—')

/* --- an ellipse is arcs --- */
await pick('Ellipse')
await drag(820, 240, 1000, 420)
const ell = await last()
ok('an ellipse is two arcs that close', !!ell && cmds(ell.d) === 'MAAZ', ell?.d?.slice(0, 40))

/* --- a polygon and a star have the right number of corners --- */
await pick('Polygon')
await drag(820, 470, 960, 610)
const poly = await last()
ok('a polygon is a six-sided run of lines', !!poly && cmds(poly.d) === 'MLLLLLZ', cmds(poly?.d || ''))

await pick('Star')
await drag(1010, 470, 1150, 610)
const star = await last()
ok('a star is ten points', !!star && cmds(star.d) === 'M' + 'L'.repeat(9) + 'Z', cmds(star?.d || ''))

/* --- a line drawn dead across is still a card you can get hold of --- */
await pick('Line')
await drag(260, 700, 560, 700)
const line = await last()
ok('a line drawn dead across still has a box to grab',
   !!line && line.h >= 12 && Math.abs(line.w - 300) <= 3, line ? `${line.w}x${line.h}` : '—')
ok('and the line runs through the middle of it', !!line && /^M0 [0-9.]+L[0-9.]+ [0-9.]+$/.test(line.d), line?.d)

/* --- an arrow wears a head --- */
await pick('Arrow')
await drag(620, 700, 900, 780)
const arrow = await last()
ok('an arrow is a line with a head on the end', !!arrow && arrow.heads === 3, `${arrow?.heads} paths (hit, line, head)`)

/* --- shift on a line holds it straight --- */
await pick('Line')
await drag(620, 820, 900, 836, { shift: true })
const held = await last()
ok('shift holds a line to an eighth of a turn', !!held && held.h <= 12, held ? `${held.w}x${held.h}` : '—')

/* --- a press rather than a drag still makes one --- */
/* Well clear of the right-hand side: something is selected by now, so the
   effects drawer is out and anything pressed under it is pressed on the
   drawer rather than on the board. */
const before = (await shapes()).length
await pick('Rectangle')
await page.mouse.click(200, 200)
await page.waitForTimeout(400)
ok('a press rather than a drag still makes one', (await shapes()).length === before + 1)

/* --- the key walks the group --- */
await page.mouse.click(160, 830)
await page.keyboard.press('m')
await page.waitForTimeout(200)
const one = await page.evaluate(() => document.querySelector('.viewport')?.getAttribute('data-tool'))
await page.keyboard.press('m')
await page.waitForTimeout(200)
const two = await page.evaluate(() => document.querySelector('.viewport')?.getAttribute('data-tool'))
ok('the group key walks along the group', !!one && !!two && one !== two, `${one} -> ${two}`)
await page.keyboard.press('Escape')

/* ---------------------------------------------------------------------------
 * The pens.
 *
 * Not one drag but a run of presses, so what is being checked is that the
 * points survive between them, that the line goes where it was told rather
 * than near it, and that there is more than one way to say you have finished.
 * ------------------------------------------------------------------------- */

await pick('Pen', 'Pens')
await clicks([[200, 200], [400, 300], [300, 450]])
const dots = await page.evaluate(() => document.querySelectorAll('.draft-dot').length)
ok('a pen shows the points it has placed while it is placing them', dots === 3, `${dots} dots`)
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
const pen = await last()
ok('and Enter says that is the shape', !!pen && cmds(pen.d) === 'MLL', pen?.d)
ok('and the line goes exactly where it was told', pen?.d === 'M0 0L200 100L100 250', pen?.d)
ok('and the tool stands down with it',
   (await page.evaluate(() => document.querySelector('.viewport')?.getAttribute('data-tool'))) === null)

/* --- pressing back on the first point closes the path --- */
await pick('Pen', 'Pens')
await clicks([[250, 600], [420, 620], [330, 760], [250, 600]])
await page.waitForTimeout(300)
const shut = await last()
ok('pressing back on the first point closes the path', !!shut && shut.d.endsWith('Z'), shut?.d)

/* --- and on the last point leaves it open, which is what a double-click is --- */
await pick('Pen', 'Pens')
await clicks([[820, 600], [960, 660], [900, 780], [900, 780]])
await page.waitForTimeout(300)
const open = await last()
ok('pressing back on the last point finishes it open', !!open && !open.d.endsWith('Z'), open?.d)

/* --- the curvature tool bends the line through its points --- */
await pick('Curvature', 'Pens')
await clicks([[600, 200], [700, 320], [820, 200], [940, 340], [940, 340]])
await page.waitForTimeout(300)
const curve = await last()
ok('the curvature tool runs a curve through every point', !!curve && /^MC*C$/.test(cmds(curve.d)), cmds(curve?.d || ''))

/* Drawn as curves is not the same as curved: a cubic whose controls sit on
 * its own endpoints is a straight line written the long way round. So the
 * path is sampled and measured against the straight run through the points
 * it was given, which is exactly the thing the tool exists not to be. */
const bow = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.card[data-kind="shape"]')].at(-1)
    ?.querySelector('svg path:not(.shape-hit)')
  if (!p) return -1
  const anchors = (p.getAttribute('d').match(/[MC][^MCZ]*/g) || []).map((seg) => {
    const v = seg.slice(1).trim().split(/[\s,]+/).map(Number)
    return [v[v.length - 2], v[v.length - 1]]
  })
  const len = p.getTotalLength()
  let worst = 0
  for (let i = 0; i <= 200; i++) {
    const q = p.getPointAtLength((i / 200) * len)
    let near = Infinity
    for (let j = 0; j < anchors.length - 1; j++) {
      const [ax, ay] = anchors[j]
      const [bx, by] = anchors[j + 1]
      const dx = bx - ax
      const dy = by - ay
      const l2 = dx * dx + dy * dy
      const t = Math.max(0, Math.min(1, l2 ? ((q.x - ax) * dx + (q.y - ay) * dy) / l2 : 0))
      near = Math.min(near, Math.hypot(q.x - (ax + t * dx), q.y - (ay + t * dy)))
    }
    worst = Math.max(worst, near)
  }
  return Math.round(worst * 10) / 10
})
ok('and really bends, rather than being a straight line written as a curve',
   bow > 5, `${bow} away from the straight run through the points`)

/* And it passes through the points rather than near them: the gaps between
 * the anchors are exactly the gaps between the presses. */
const through = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.card[data-kind="shape"]')].at(-1)
    ?.querySelector('svg path:not(.shape-hit)')
  const anchors = (p.getAttribute('d').match(/[MC][^MCZ]*/g) || []).map((seg) => {
    const v = seg.slice(1).trim().split(/[\s,]+/).map(Number)
    return [v[v.length - 2], v[v.length - 1]]
  })
  return anchors.map(([x, y]) => [Math.round(x - anchors[0][0]), Math.round(y - anchors[0][1])])
})
ok('and it passes through them rather than near them',
   JSON.stringify(through) === JSON.stringify([[0, 0], [100, 120], [220, 0], [340, 140]]),
   JSON.stringify(through))

/* --- the pencil follows the hand and is tidied after it --- */
await pick('Pencil', 'Pens')
await page.mouse.move(620, 560)
await page.mouse.down()
for (let i = 0; i <= 40; i++) await page.mouse.move(620 + i * 7, 560 + Math.sin(i / 4) * 60)
await page.mouse.up()
await page.waitForTimeout(400)
const drawn2 = await last()
const segs = (drawn2?.d.match(/C/g) || []).length
ok('the pencil makes a curve from a freehand stroke', segs > 2, `${segs} curve segments`)
ok('and throws away most of what it sampled on the way', segs < 25, `${segs} of 41 samples kept`)
ok('and stays where it was drawn', !!drawn2 && Math.abs(drawn2.w - 280) <= 8, `${drawn2?.w} wide`)

/* --- escape finishes a half-drawn path rather than losing it --- */
const sofar = (await shapes()).length
await pick('Pen', 'Pens')
await clicks([[1000, 560], [1060, 700]])
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
ok('escape finishes a path rather than throwing it away', (await shapes()).length === sofar + 1)

/* --- one point is not a path --- */
const alone = (await shapes()).length
await pick('Pen', 'Pens')
await page.mouse.click(160, 300)
await page.waitForTimeout(200)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
ok('and one point on its own makes nothing', (await shapes()).length === alone)

/* ---------------------------------------------------------------------------
 * Moving the points about.
 *
 * A mode of its own, because four corner handles that stretch the whole thing
 * and an anchor on every point are two different jobs that must not be on
 * screen at once.
 * ------------------------------------------------------------------------- */

const marks = () => page.evaluate(() => ({
  dots: document.querySelectorAll('.node-dot').length,
  grips: document.querySelectorAll('.node-grip').length,
  corners: document.querySelectorAll('.card-handles .handle').length,
  round: document.querySelectorAll('circle.node-dot').length,
}))
/* Where each anchor is on screen, which is what must not move when the box is
   pulled back round them. */
const anchors = () => page.evaluate(() =>
  [...document.querySelectorAll('.node-dot')].map((el) => {
    const r = el.getBoundingClientRect()
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]
  })
)
/* A point that really is on the drawn line, in screen coordinates. Guessing
   at one and missing puts the points away instead of bending anything. */
const onLine = (t) => page.evaluate((t) => {
  const el = [...document.querySelectorAll('.card[data-kind="shape"]')].at(-1)
  const path = el.querySelector('svg path:not(.shape-hit)')
  const at = path.getPointAtLength(path.getTotalLength() * t)
  const r = el.getBoundingClientRect()
  const z = r.width / el.offsetWidth
  return [Math.round(r.x + at.x * z), Math.round(r.y + at.y * z)]
}, t)
const boxOfLast = () => page.evaluate(() => {
  const r = [...document.querySelectorAll('.card[data-kind="shape"]')].at(-1).getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
})

/* A fresh three-point path to work on, well clear of everything else. */
await page.mouse.click(160, 830)
await page.waitForTimeout(200)
await pick('Pen', 'Pens')
await clicks([[300, 300], [600, 300], [600, 600]])
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
ok('a drawn path is a straight run of lines to start with', (await last())?.d === 'M0 0L300 0L300 300', (await last())?.d)

/* --- in --- */
await page.mouse.dblclick(380, 301)
await page.waitForTimeout(400)
const opened2 = await marks()
ok('twice on a drawing opens its points', opened2.dots === 3, `${opened2.dots} anchors`)
ok('and its corner handles stand down while they are open', opened2.corners === 0, `${opened2.corners} corner handles`)

/* --- drag an anchor --- */
const before2 = await last()
await page.mouse.move(600, 300)
await page.mouse.down()
await page.mouse.move(680, 240, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
const moved = await last()
ok('dragging an anchor moves that point', !!moved && moved.d !== before2?.d, moved?.d)
ok('and the box is pulled back round the points', !!moved && moved.w === 380 && moved.h === 360, `${moved?.w}x${moved?.h}`)
const kept2 = await anchors()
ok('without the drawing moving on screen',
   kept2.some(([x, y]) => Math.abs(x - 680) <= 2 && Math.abs(y - 240) <= 2), JSON.stringify(kept2))

/* --- bend the line --- */
const straight = await last()
const [gx, gy] = await onLine(0.8)
await page.mouse.move(gx, gy)
await page.mouse.down()
await page.mouse.move(gx + 90, gy + 20, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
const bent = await last()
ok('dragging the line bends that segment', !!bent && (bent.d.match(/C/g) || []).length > (straight.d.match(/C/g) || []).length,
   cmds(bent?.d || ''))

/* --- put a point on the line --- */
const had = (await marks()).dots
const [ax, ay] = await onLine(0.25)
await page.mouse.dblclick(ax, ay)
await page.waitForTimeout(400)
ok('twice on the line puts a point on it', (await marks()).dots === had + 1, `${had} -> ${(await marks()).dots}`)

/* --- take one away --- */
const many = (await marks()).dots
const spot = (await anchors())[1]
await page.keyboard.down('Alt')
await page.mouse.click(spot[0], spot[1])
await page.keyboard.up('Alt')
await page.waitForTimeout(400)
ok('alt on an anchor takes it away', (await marks()).dots === many - 1, `${many} -> ${(await marks()).dots}`)

/* --- corner to smooth and back --- */
const first = (await anchors())[0]
const wasRound = (await marks()).round
await page.mouse.dblclick(first[0], first[1])
await page.waitForTimeout(400)
const nowRound = (await marks()).round
ok('twice on an anchor turns a corner smooth', nowRound === wasRound + 1, `${wasRound} -> ${nowRound} round`)
ok('and gives it handles to pull on', (await marks()).grips >= 1, `${(await marks()).grips} handles`)
await page.mouse.dblclick(first[0], first[1])
await page.waitForTimeout(400)
ok('and again turns it back into a corner', (await marks()).round === wasRound)

/* --- several at once, and a box round them --- */
/* One side of a shape is four points, and moving them one at a time is four
   drags that each have to end in the same place. */
const picked = () => page.evaluate(() => document.querySelectorAll('.node-dot[data-on]').length)
const all = await anchors()
const sweep = async (x0, y0, x1, y1, shift = false) => {
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x1, y1, { steps: 12 })
  await page.waitForTimeout(120)
  const mid = await page.evaluate(() => document.querySelectorAll('.node-lasso').length)
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
  await page.waitForTimeout(250)
  return mid
}
/* Worked out again each time rather than kept: the points move during this
   stretch, the box is pulled back round them every time they do, and the
   space a box can be swept from moves with it. */
const round = async () => {
  const ps = await anchors()
  return {
    lo: [Math.min(...ps.map((p) => p[0])) - 25, Math.min(...ps.map((p) => p[1])) - 25],
    hi: [Math.max(...ps.map((p) => p[0])) + 25, Math.max(...ps.map((p) => p[1])) + 25],
  }
}
let edge = await round()
const sweepShown = await sweep(edge.lo[0], edge.lo[1], edge.hi[0], edge.hi[1])
ok('a box is drawn while it is being swept', sweepShown === 1, `${sweepShown}`)
ok('and a box round the lot picks all of them', (await picked()) === all.length, `${await picked()} of ${all.length}`)

/* --- and they move together --- */
const was3 = await anchors()
const from3 = was3[0]
await page.mouse.move(from3[0], from3[1])
await page.mouse.down()
await page.mouse.move(from3[0] + 60, from3[1] + 40, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(400)
const now3 = await anchors()
ok('dragging any one of them moves them all, by the same amount',
   now3.length === was3.length && now3.every(([x, y], i) => Math.abs(x - was3[i][0] - 60) <= 2 && Math.abs(y - was3[i][1] - 40) <= 2),
   `${JSON.stringify(was3)} -> ${JSON.stringify(now3)}`)
ok('and they stay picked afterwards', (await picked()) === all.length, `${await picked()}`)

/* --- the arrows nudge what is picked --- */
const was4 = await anchors()
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(400)
const now4 = await anchors()
ok('an arrow key nudges every picked point',
   now4.every(([x, y], i) => Math.abs(x - was4[i][0] - 2) <= 1 && Math.abs(y - was4[i][1]) <= 1),
   `${JSON.stringify(was4)} -> ${JSON.stringify(now4)}`)

/* --- shift takes one back out --- */
const anyOne = (await anchors())[0]
await page.keyboard.down('Shift')
await page.mouse.click(anyOne[0], anyOne[1])
await page.keyboard.up('Shift')
await page.waitForTimeout(300)
ok('shift on a picked anchor takes it back out', (await picked()) === all.length - 1, `${await picked()}`)
await page.keyboard.down('Shift')
await page.mouse.click(anyOne[0], anyOne[1])
await page.keyboard.up('Shift')
await page.waitForTimeout(300)
ok('and puts it back', (await picked()) === all.length, `${await picked()}`)

/* --- a press on the empty space lets go --- */
edge = await round()
await page.mouse.click(edge.lo[0], edge.lo[1])
await page.waitForTimeout(300)
ok('a press on the space round them lets go of all of them', (await picked()) === 0, `${await picked()}`)
ok('and leaves the points themselves open', (await marks()).dots === all.length, `${(await marks()).dots}`)

/* --- out --- */
/* Two presses when something is picked and one when nothing is: the first
   lets go of the points, and only then does the second leave. One press
   undoing two things is one press too many. */
edge = await round()
await sweep(edge.lo[0], edge.lo[1], edge.hi[0], edge.hi[1])
ok('picked again, to prove the first escape is about them', (await picked()) === all.length, `${await picked()}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok('escape lets go of the picked points first', (await picked()) === 0 && (await marks()).dots === all.length,
   `${await picked()} picked, ${(await marks()).dots} anchors`)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
const shut2 = await marks()
ok('and escape again puts the points away', shut2.dots === 0)
ok('and the corner handles come back', shut2.corners === 4, `${shut2.corners} corner handles`)

/* --- the curvature tool opens an existing line --- */
await pick('Curvature', 'Pens')
const [cx2, cy2] = await onLine(0.5)
await page.mouse.click(cx2, cy2)
await page.waitForTimeout(400)
ok('the curvature tool on a line that exists opens that line', (await marks()).dots > 0, `${(await marks()).dots} anchors`)
ok('and stands down rather than drawing a second one',
   (await page.evaluate(() => document.querySelector('.viewport')?.getAttribute('data-tool'))) === null)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------------------------------------------------------------------------
 * The panel, and baking.
 * ------------------------------------------------------------------------- */

const panel = () => page.evaluate(() => [...document.querySelectorAll('.panel-tabs button')].map((b) => b.textContent))
const record = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('.card[data-kind="shape"]')].at(-1)
  const r = el.getBoundingClientRect()
  const path = el.querySelector('svg path:not(.shape-hit)')
  return {
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    baked: el.hasAttribute('data-baked'),
    picture: !!el.querySelector('img.media'),
    fill: path?.getAttribute('fill') || null,
    stroke: path?.getAttribute('stroke') || null,
    width: path?.getAttribute('stroke-width') || null,
    d: path?.getAttribute('d') || null,
  }
})

await page.mouse.click(160, 830)
await page.waitForTimeout(200)
await pick('Star')
await drag(300, 250, 600, 550)
ok('a drawing gets a panel of its own, named after it', (await panel())[0] === 'Star', (await panel()).join('/'))

/* --- the controls really change the drawing --- */
const asStar = (await record()).d
await page.locator('.ctl', { hasText: 'Points' }).first().locator('input[type=range]').fill('9')
await page.waitForTimeout(400)
const nine = await record()
ok('changing the points changes the drawing', cmds(nine.d) === 'M' + 'L'.repeat(17) + 'Z', cmds(nine.d))
ok('and it is a different drawing from the one it was', nine.d !== asStar)

/* A stroke has to be given a colour before a width means anything: a width
   with no colour is a line nobody asked to see. */
await page.locator('.fx-controls', { hasText: 'Stroke' }).first().locator('.type-inks button').nth(1).click()
await page.waitForTimeout(300)
await page.locator('.ctl', { hasText: 'Width' }).first().locator('input[type=range]').fill('20')
await page.waitForTimeout(400)
const inked = await record()
ok('a stroke colour and a width both reach the drawing', inked.width === '20' && inked.stroke !== 'none', `${inked.stroke} at ${inked.width}`)

/* --- typed position --- */
await page.locator('.shape-num', { hasText: 'X' }).first().locator('input').fill('700')
await page.waitForTimeout(400)
const put = await record()
ok('a position typed in puts it there', Math.abs(put.x - (300 + 400)) <= 2, `x ${put.x}`)

/* --- bake it --- */
const drawnBox = await record()
await page.getByRole('button', { name: 'Bake into a picture' }).click()
await page.waitForTimeout(2000)
const cooked = await record()
ok('baking turns a drawing into a picture', cooked.baked && cooked.picture, JSON.stringify({ baked: cooked.baked, picture: cooked.picture }))
ok('and the effects are offered on it now', (await panel()).includes('Effect'), (await panel()).join('/'))
/* A stroke straddles the line it is on, so half a twenty-pixel one hangs
   outside the box. Baking the box alone would give a star with its points
   filed off, so the picture is the box plus that and the card grows to
   match — which leaves the drawing exactly where it was on the board. */
ok('and it grows by the half of the stroke that hung outside the box',
   Math.abs(cooked.x - (drawnBox.x - 10)) <= 1 && Math.abs(cooked.w - (drawnBox.w + 20)) <= 1,
   `${drawnBox.x},${drawnBox.w} -> ${cooked.x},${cooked.w}`)

/* --- and back --- */
await page.getByRole('button', { name: 'Back to the drawing' }).click()
await page.waitForTimeout(600)
const raw = await record()
ok('and the drawing comes back exactly where it was',
   !raw.baked && raw.x === drawnBox.x && raw.y === drawnBox.y && raw.w === drawnBox.w && raw.h === drawnBox.h,
   `${drawnBox.x},${drawnBox.y} ${drawnBox.w}x${drawnBox.h} -> ${raw.x},${raw.y} ${raw.w}x${raw.h}`)
ok('and it is the drawing it was, not a picture of one', raw.d === drawnBox.d)

/* --- and a drawing selected with a photograph stays out of the way --- */
/* The two have the effects in common and nothing else, so the panel stays
   where both of them can be worked on rather than showing one of them its
   own controls and the other nothing. */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 300
  const x = c.getContext('2d')
  x.fillStyle = '#E5484D'
  x.fillRect(0, 0, 400, 300)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'mix.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 240, clientY: 300 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)
await page.mouse.click(160, 830)
await page.waitForTimeout(200)
await pick('Rectangle')
await drag(1000, 200, 1120, 300)
await page.waitForTimeout(300)
ok('a drawing on its own gets the drawing panel', (await panel())[0] === 'Rectangle', (await panel()).join('/'))
const pic = await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="image"]')
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
await page.keyboard.down('Shift')
await page.mouse.click(pic.x, pic.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(400)
ok('and with a photograph beside it the panel stays on the effects',
   (await panel()).includes('Effect'), (await panel()).join('/'))

/* --- and full screen it is drawn rather than left blank --- */
/* Present and Compare both draw a card through the same stage, and the stage
 * could only show pixels. A drawing has none, so full screen it was an empty
 * rectangle — which looks exactly like a card that failed to load. */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.mouse.click(160, 830)
await page.waitForTimeout(200)
await pick('Star')
await drag(1160, 200, 1300, 340)
await page.waitForTimeout(400)
await page.keyboard.press('p')
await page.waitForTimeout(900)
const staged = await page.evaluate(() => {
  const path = document.querySelector('.present-stage svg.present-media path')
  return path ? path.getAttribute('d') : null
})
ok('a drawing shown full screen is drawn', !!staged && staged.length > 10, staged?.slice(0, 30) || 'nothing on the stage')
await page.keyboard.press('Escape')
await page.waitForTimeout(600)

/* ---------------------------------------------------------------------------
 * The colour of a line, which is not a colour.
 *
 * This app made this mistake once, wrote state/type.ts about it, and made it
 * again in the shapes: every line was born with `#18181B` on the record — the
 * light theme's own ink, copied out of the stylesheet by hand — so every line
 * on a dark board was near-black on near-black.
 * ------------------------------------------------------------------------- */

await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.mouse.click(160, 830)
await page.waitForTimeout(200)
await pick('Line')
await drag(200, 250, 420, 330)
await page.waitForTimeout(300)

/* What the line is really painted in, against the ground it is on. */
const painted = () => page.evaluate(() => {
  const path = [...document.querySelectorAll('.card[data-kind="shape"] svg path:not(.shape-hit)')].at(-1)
  const lum = (c) => {
    const [r, g, b] = (c.match(/\d+/g) || [0, 0, 0]).map(Number).map((v) => {
      const n = v / 255
      return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ink = lum(getComputedStyle(path).stroke)
  const ground = lum(getComputedStyle(document.body).backgroundColor)
  const hi = Math.max(ink, ground)
  const lo = Math.min(ink, ground)
  return { said: path.getAttribute('stroke'), contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10 }
})

const onPale = await painted()
ok('a line nobody has coloured says so rather than naming a colour', onPale.said === 'currentColor', onPale.said)
ok('and reads against a pale board', onPale.contrast > 4, `${onPale.contrast}:1`)

await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
await page.waitForTimeout(400)
const onDark = await painted()
ok('and against a dark one, which is the whole of the bug', onDark.contrast > 4, `${onDark.contrast}:1`)

/* And a board saved before the colour was a choice comes back readable. */
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.card[data-kind="shape"]')].at(-1)
  window.__old = el.dataset.id
})
await page.evaluate(async (id) => {
  const db = await new Promise((r) => { const q = indexedDB.open('ideation.board.db', 1); q.onsuccess = () => r(q.result) })
  const store = db.transaction('boards', 'readwrite').objectStore('boards')
  const all = await new Promise((r) => { const t = store.getAll(); t.onsuccess = () => r(t.result) })
  for (const rec of all) {
    for (const it of rec.items || []) if (it.id === id) it.shape = { ...it.shape, stroke: '#18181B' }
    store.put(rec)
  }
}, await page.evaluate(() => window.__old))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2200)
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
await page.waitForTimeout(400)
const reopened = await painted()
ok('a line drawn before the colour was a choice comes back readable on a dark board',
   reopened.contrast > 4, `${reopened.contrast}:1, said ${reopened.said}`)
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'))
await page.waitForTimeout(300)

/* --- it is hit where it is painted --- */
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
const ring = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.card[data-kind="shape"]')].find((e) => e.dataset.id)
  return el ? el.dataset.id : null
})
ok('every shape card has an id on it', !!ring)

/* --- it survives a reload --- */
const kept = (await shapes()).length
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const back = await shapes()
ok('shapes come back after a reload', back.length === kept && kept > 0, `${kept} -> ${back.length}`)
ok('and they come back drawn', back.every((s) => s.d.length > 3))

/* ---------------------------------------------------------------------------
 * Out of the app.
 *
 * A drawing has no pixels, which is fine on the board and is the whole
 * question on the way out: the poster is a canvas and the page is a file, and
 * neither of them can photograph something that was never a photograph. Both
 * draw the drawing instead.
 * ------------------------------------------------------------------------- */

const palette = async (text) => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.locator('.cmd-input').fill(text)
  await page.waitForTimeout(400)
  return page.locator('.cmd-row').first()
}

const [sheet] = await Promise.all([page.waitForEvent('download'), (await palette('one picture')).click()])
const sheetFile = path.join(OUT, `shapes-${sheet.suggestedFilename()}`)
await sheet.saveAs(sheetFile)
await page.waitForTimeout(700)

/* How much of the sheet is the blue every shape on this board is filled
 * with. None of it means the drawings never left the screen. */
const drawn3 = await page.evaluate(async (data) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + data
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let blue = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 30 && d[i] < 80 && d[i + 1] > 90 && d[i + 1] < 140 && d[i + 2] > 210) blue++
  }
  return { blue, of: d.length / 4 }
}, fs.readFileSync(sheetFile).toString('base64'))
ok('the board poster draws the drawings rather than a grey square',
   drawn3.blue > 4000, `${drawn3.blue} pixels of fill in ${drawn3.of}`)

const [html] = await Promise.all([page.waitForEvent('download'), (await palette('anyone can open')).click()])
const htmlFile = path.join(OUT, `shapes-${html.suggestedFilename()}`)
await html.saveAs(htmlFile)
await page.waitForTimeout(500)
const written = fs.readFileSync(htmlFile, 'utf8')
/* The board is JSON inside the page, so its markup arrives escaped. */
ok('the exported page carries a drawing as a drawing', /"svg":"\\u003csvg /.test(written))
ok('and carries the path itself, not a photograph of it', /u003cpath d=/.test(written))
ok('and gives it no card to sit in', /\.vec\{background:none/.test(written))
/* Written into the page rather than handed to an <img> as data. An SVG in an
   <img> is a document of its own and cannot see the page around it, so a line
   nobody gave a colour would come out black on a page read in the dark. */
ok('and writes it into the page rather than as a picture of itself',
   /n\.innerHTML = it\.svg/.test(written) && !/image%2Fsvg/.test(written))
ok('and lets the page decide what colour a line nobody coloured is',
   written.includes('currentColor') && /\.vec\{[^}]*color:var\(--ink\)/.test(written))
/* A drawing is a few hundred bytes. A picture of one is a few hundred
   thousand, and a board of forty would be a file nobody can send. */
ok('and costs what a drawing costs', written.length < 4_000_000, `${Math.round(written.length / 1024)}kB`)

console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none')
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
