/* The tone a board was saved with, drawn two ways.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/develop.mjs http://localhost:4173
 *
 * Every picture on every board ever made here was toned by six CSS filter
 * functions on the compositor. Developing properly means a shader does that
 * work instead — and that is only safe if the shader does the same arithmetic,
 * because otherwise every board anybody has ever saved opens looking different.
 *
 * So this suite asks a real browser to run the filters, reads the pixels it
 * produced, and compares them against `legacyTone` — the same module the
 * shader is fed from, imported here rather than reimplemented, so there is no
 * third version of the arithmetic to drift.
 */
import { chromium } from 'playwright'
import { legacyStages, runStages } from '../src/state/develop.ts'

const BASE = process.argv[2] || 'http://localhost:4173'

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 600 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

/* The filter string the board has always written. Kept here in the words
   `adjustCSS` uses, so that if it ever changes this suite says so. */
const css = ({ exp, con, sat, warm }) => {
  const f = []
  if (exp) f.push(`brightness(${(1 + exp / 100).toFixed(3)})`)
  if (con) f.push(`contrast(${(1 + con / 100).toFixed(3)})`)
  if (sat !== 100) f.push(`saturate(${(sat / 100).toFixed(3)})`)
  if (warm > 0) f.push(`sepia(${(warm / 150).toFixed(3)}) saturate(${(1 + warm / 300).toFixed(3)})`)
  if (warm < 0) f.push(`hue-rotate(${(warm * 0.4).toFixed(1)}deg) saturate(${(1 + -warm / 400).toFixed(3)})`)
  return f.join(' ')
}

/* Twelve colours across the cube, including the ones that catch a matrix out:
   the primaries, the greys, and a skin tone. */
const COLOURS = [
  [255, 0, 0], [0, 255, 0], [0, 0, 255],
  [255, 255, 0], [0, 255, 255], [255, 0, 255],
  [0, 0, 0], [128, 128, 128], [255, 255, 255],
  [224, 172, 140], [40, 60, 90], [200, 120, 40],
]

/* What the browser makes of them. One draw per colour, at a known pixel. */
const through = (filter, colours) =>
  page.evaluate(
    ([f, list]) => {
      const c = document.createElement('canvas')
      c.width = list.length
      c.height = 1
      const ctx = c.getContext('2d', { willReadFrequently: true })
      /* Painted first, then re-drawn through the filter, because a filter on a
         fill is a filter on the shape and not on what is under it. */
      list.forEach(([r, g, b], i) => {
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(i, 0, 1, 1)
      })
      const src = document.createElement('canvas')
      src.width = c.width
      src.height = 1
      src.getContext('2d').drawImage(c, 0, 0)
      ctx.clearRect(0, 0, c.width, 1)
      ctx.filter = f || 'none'
      ctx.drawImage(src, 0, 0)
      ctx.filter = 'none'
      const d = ctx.getImageData(0, 0, c.width, 1).data
      return list.map((_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]])
    },
    [filter, colours]
  )

/* And what the model says they should be, run stage by stage with a clamp
   between each — which is the whole reason this suite exists. */
const predict = (four, [r, g, b]) =>
  runStages(legacyStages(four), [r / 255, g / 255, b / 255]).map((c) => Math.round(c * 255))

/* Every setting a card can be saved with, including the two that only ever run
   one at a time and the combinations that put a matrix in the wrong order. */
const CASES = [
  { name: 'nothing at all', exp: 0, con: 0, sat: 100, warm: 0 },
  { name: 'brightness up', exp: 40, con: 0, sat: 100, warm: 0 },
  { name: 'brightness down', exp: -35, con: 0, sat: 100, warm: 0 },
  { name: 'contrast up', exp: 0, con: 50, sat: 100, warm: 0 },
  { name: 'contrast down', exp: 0, con: -40, sat: 100, warm: 0 },
  { name: 'saturation up', exp: 0, con: 0, sat: 180, warm: 0 },
  { name: 'saturation down to grey', exp: 0, con: 0, sat: 0, warm: 0 },
  { name: 'warm', exp: 0, con: 0, sat: 100, warm: 70 },
  { name: 'cool', exp: 0, con: 0, sat: 100, warm: -70 },
  { name: 'all four at once, warm', exp: 25, con: 30, sat: 140, warm: 55 },
  { name: 'all four at once, cool', exp: -20, con: -25, sat: 60, warm: -45 },
]

let worst = 0
let worstAt = ''
for (const c of CASES) {
  const got = await through(css(c), COLOURS)
  let off = 0
  let where = ''
  COLOURS.forEach((col, i) => {
    const want = predict(c, col)
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(got[i][k] - want[k])
      if (d > off) {
        off = d
        where = `rgb(${col}) → browser ${got[i]} vs model ${want}`
      }
    }
  })
  if (off > worst) {
    worst = off
    worstAt = c.name
  }
  /* Two levels out of 255. The browser rounds once on the way in and once on
     the way out, and the model rounds once, so one level is unavoidable and
     two is the honest bound. Anything larger is a different matrix, not
     rounding. */
  check(`${c.name} matches the browser`, off <= 2, `worst channel off by ${off}${off > 2 ? `; ${where}` : ''}`)
}

check('and nothing drifts more than rounding anywhere', worst <= 2, `worst ${worst} on "${worstAt}"`)

/* The one that would be missed by testing each filter alone: the order they
   run in. Saturation is written before warmth, and a browser applies a filter
   list left to right, so a warm desaturated picture is not the same as a
   desaturated warm one. */
const swapped = await through('sepia(0.400) saturate(1.200) saturate(0.400)', COLOURS)
const asWritten = await through('saturate(0.400) sepia(0.400) saturate(1.200)', COLOURS)
const differs = COLOURS.some((_, i) => [0, 1, 2].some((k) => Math.abs(swapped[i][k] - asWritten[i][k]) > 3))
check('the order the filters run in is not an accident', differs)

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
