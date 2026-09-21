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

const pick = async (name, group = 'Shapes') => {
  /* The rail holds one of each group; the rest are behind the corner mark. */
  const on = await page.getByRole('button', { name, exact: true }).count()
  if (!on) {
    await page.getByRole('button', { name: group, exact: true }).click()
    await page.waitForTimeout(200)
    await page.getByRole('menuitem', { name, exact: true }).click()
  } else {
    await page.getByRole('button', { name, exact: true }).click()
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

/* --- out --- */
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
const shut2 = await marks()
ok('escape puts the points away', shut2.dots === 0)
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

console.log('\npage errors:', errors.length ? errors.slice(0, 6) : 'none')
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
