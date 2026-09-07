/* The name plate over a photograph.
 *
 *   npm run build && npm run test:browser -- plate
 *   node test/plate.mjs http://localhost:4173
 *
 * A board of photographs should look like a board of photographs, so a card's
 * name comes forward when you are on it and goes away again when you are not.
 * Over a picture it is set on a halftone screen rather than a plate, and the
 * whole argument for the screen is that you can still see the photograph
 * through it — coverage instead of opacity, which is the method this app is
 * about.
 *
 * It was not doing that. The screen was drawn at 0.97 coverage, and because a
 * dot's radius is scaled so that a coverage of one is comfortably solid, 0.97
 * put the dots half a width into each other: the bottom sixteen pixels came
 * out as a black slab with a dotted fringe above it, which is the pale band
 * across the picture the screen exists to avoid, in black. On a pale brand
 * sheet it read as damage.
 *
 * So there are two things to hold at once here, and one of them is easy to
 * lose while fixing the other: white words have to stay readable over any
 * photograph, and the photograph has to stay visible between the dots. Both
 * are measured off the composited pixels rather than off the stylesheet,
 * because the thing that matters is what ends up on the glass.
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
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.removeItem('ideation.path')
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

/* ---------- the tile itself ---------- */

/* Read out of the stylesheet and rasterised, so this is the screen the page is
 * really using rather than a copy of the recipe that made it. */
const tile = await page.evaluate(async () => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--screen-up').trim()
  const src = raw.replace(/^url\((['"]?)/, '').replace(/(['"]?)\)$/, '')
  const img = new Image()
  img.src = src
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  const cov = []
  for (let y = 0; y < c.height; y++) {
    let ink = 0
    for (let px = 0; px < c.width; px++) ink += d[(y * c.width + px) * 4 + 3] / 255
    cov.push(ink / c.width)
  }
  /* Bottom first: the dark end. */
  cov.reverse()
  const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length
  return { w: img.width, h: img.height, dark: mean(cov.slice(0, 8)), light: mean(cov.slice(-8)) }
})

check('the screen is a tile the height of the plate it sits in', tile.h === 38, `${tile.w}x${tile.h}`)
/* The band the letters sit on. Above two thirds the dots merge into the flat
   fill the screen is here to avoid; below about half there is not enough ink
   left to carry white words over a white photograph. */
check('its dark end is inked enough to carry white words', tile.dark > 0.5, tile.dark.toFixed(3))
check('and not so inked that the dots have merged into a slab', tile.dark < 0.78, tile.dark.toFixed(3))
/* Not nothing: a screen that fades out ends in dots too small to see rather
   than in an edge. But most of the picture has to be through it. */
check('and its light end is all but clear',
  tile.light < 0.18 && tile.light < tile.dark / 3, tile.light.toFixed(3))

/* ---------- and what it does to a photograph ---------- */

/* A pale sheet, which is the worst case for a dark screen: on anything dark
 * the words would be legible with no screen at all. */
const drop = (fill, name) =>
  page.evaluate(
    async ({ fill, name }) => {
      const c = document.createElement('canvas')
      c.width = 800
      c.height = 600
      const x = c.getContext('2d')
      x.fillStyle = fill
      x.fillRect(0, 0, 800, 600)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], name, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 350, clientY: 300 })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { fill, name }
  )

await drop('#f4f1ea', 'pale-brand-sheet.png')
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1300)

const card = page.locator('.card[data-kind="image"]').first()
const box = await card.boundingBox()
/* The plate only shows on a card you are on, which is the point of it. */
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(500)

/* The screenshot is a PNG, and the page has a decoder in it, so it goes back
 * in and comes out as pixels. Measuring the composited card is the only way to
 * make a claim about legibility that is about what is on the glass rather than
 * about what the recipe says. */
async function bands() {
  const png = await card.screenshot()
  return page.evaluate(
    async ({ bytes }) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      const x = c.getContext('2d')
      x.drawImage(bmp, 0, 0)
      const H = c.height
      /* Both bounds are heights above the bottom edge of the card, the far
         one first, since that is how the plate is described everywhere else. */
      const strip = (from, to) => {
        const d = x.getImageData(8, H - from, c.width - 16, from - to).data
        const lum = []
        for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
        const mean = lum.reduce((a, l) => a + l, 0) / lum.length
        const sd = Math.sqrt(lum.reduce((a, l) => a + (l - mean) ** 2, 0) / lum.length)
        return {
          mean: +mean.toFixed(1),
          min: +Math.min(...lum).toFixed(1),
          max: +Math.max(...lum).toFixed(1),
          sd: +sd.toFixed(1),
          /* How much of the strip is the photograph rather than ink. One
             bright pixel proves nothing — a slab has pinholes at its dot
             edges too — so what matters is the share. */
          open: +(lum.filter((l) => l > 150).length / lum.length).toFixed(3),
        }
      }
      return {
        /* Counted up from the bottom of the card. */
        foot: strip(8, 2),
        text: strip(22, 9),
        fade: strip(38, 26),
        clear: strip(70, 50),
      }
    },
    { bytes: [...png] }
  )
}

const pale = await bands()

check('above the plate the photograph is untouched', pale.clear.sd < 2 && pale.clear.mean > 225,
  `mean ${pale.clear.mean}, spread ${pale.clear.sd}`)
/* The whole argument for a screen rather than a plate. If the dots had merged
   this would be a flat black bar and the brightest pixel in it would be black
   too — which is exactly what it was. */
check('the photograph is still visible between the dots', pale.foot.open > 0.15,
  `${Math.round(pale.foot.open * 100)}% of the strip under the words is photograph`)
check('so the plate is a screen and not a bar', pale.foot.sd > 40, `spread ${pale.foot.sd}`)
/* And the other half, which is easy to lose while fixing the first. */
check('the words are white', pale.text.max > 235, `${pale.text.max}`)
check('on something dark enough to read them against', pale.text.mean < 150,
  `mean under the words is ${pale.text.mean}`)
check('the screen fades out rather than ending at an edge',
  pale.foot.mean < pale.text.mean && pale.text.mean < pale.fade.mean && pale.fade.mean < pale.clear.mean,
  `${pale.foot.mean} → ${pale.text.mean} → ${pale.fade.mean} → ${pale.clear.mean}`)

fs.writeFileSync(path.join(OUT, 'plate-pale.png'), await card.screenshot())

/* ---------- the plate comes and goes ---------- */

await page.mouse.move(30, 700)
await page.waitForTimeout(500)
const away = await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="image"] .card-chrome')
  return el ? Number(getComputedStyle(el).opacity) : -1
})
check('off the card the name goes away and the photograph is whole again', away === 0, `${away}`)

/* ---------- and on a dark photograph it is still a screen ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(600)
await drop('#14161c', 'night-plate.png')
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1300)
const dark = page.locator('.card[data-kind="image"]').first()
const dbox = await dark.boundingBox()
await page.mouse.move(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2)
await page.waitForTimeout(500)
const night = await page.evaluate(
  async ({ bytes }) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const x = c.getContext('2d')
    x.drawImage(bmp, 0, 0)
    const d = x.getImageData(8, c.height - 22, c.width - 16, 13).data
    let max = 0
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      if (l > max) max = l
    }
    return +max.toFixed(1)
  },
  { bytes: [...(await dark.screenshot())] }
)
check('white words are still white over a dark photograph', night > 235, `${night}`)

fs.writeFileSync(path.join(OUT, 'plate-dark.png'), await dark.screenshot())

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
