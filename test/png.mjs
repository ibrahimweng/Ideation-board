/* Getting the look out.
 *
 *   npm run dev &
 *   node test/png.mjs http://localhost:5173
 *
 * An export has to be the card, not the shader. What you see is a shader
 * render, then a CSS filter, then a framing transform, then grain, and an
 * export that carried only the first of those would hand back something you
 * were never looking at. So the checks are: the file is the picture's own
 * resolution rather than the card's, the effect is baked into it, the tone is
 * baked into it, the framing is baked into it, and the shape is the card's.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
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

/* A big picture, so "the picture's own resolution" is unmistakably not the
 * card's, with a circle in it whose shape can be measured and a strong colour
 * whose saturation can be. */
const SRC_W = 1800
const SRC_H = 1200
await page.evaluate(
  async ({ w, h }) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d')
    x.fillStyle = '#f2efe6'
    x.fillRect(0, 0, w, h)
    x.fillStyle = '#e5251f'
    x.beginPath()
    x.arc(w / 2, h / 2, h * 0.22, 0, Math.PI * 2)
    x.fill()
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'circle.png', { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 420, clientY: 320 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  },
  { w: SRC_W, h: SRC_H }
)
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1400)

const card = page.locator('.card[data-kind="image"]').first()
const grip = async () => {
  const b = await card.boundingBox()
  return { x: b.x + 60, y: b.y + 10 }
}

/* Reads a saved PNG: its size, and what is in it. */
const readPng = (file) =>
  page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const s = document.createElement('canvas')
    s.width = img.width
    s.height = img.height
    const x = s.getContext('2d')
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, s.width, s.height).data
    let x0 = s.width
    let x1 = -1
    let y0 = s.height
    let y1 = -1
    let rr = 0
    let gg = 0
    let bb = 0
    let n = 0
    for (let py = 0; py < s.height; py++) {
      for (let px = 0; px < s.width; px++) {
        const i = (py * s.width + px) * 4
        rr += d[i]
        gg += d[i + 1]
        bb += d[i + 2]
        n++
        /* The circle, whatever an effect has done to its edges. */
        if (d[i] > 130 && d[i + 1] < 130 && d[i + 2] < 130) {
          if (px < x0) x0 = px
          if (px > x1) x1 = px
          if (py < y0) y0 = py
          if (py > y1) y1 = py
        }
      }
    }
    const mr = rr / n
    const mg = gg / n
    const mb = bb / n
    return {
      w: s.width,
      h: s.height,
      circle: x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1 },
      /* How far apart the channels are on average: a desaturated picture has
       * almost none of this. */
      colour: Math.round(Math.max(mr, mg, mb) - Math.min(mr, mg, mb)),
    }
  }, fs.readFileSync(file).toString('base64'))

let saved = 0
const exportNow = async (label) => {
  const at = await grip()
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(250)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.waitForTimeout(300)
  const entry = page.locator('.menu button', { hasText: 'Export as PNG' })
  if (!(await entry.count())) return null
  const [download] = await Promise.all([page.waitForEvent('download'), entry.click()])
  /* Every export of the same card suggests the same name, so they are kept
   * apart here or each would overwrite the last and every comparison between
   * two of them would be a comparison of one with itself. */
  const file = path.join(OUT, `png-${++saved}-${label}-${download.suggestedFilename()}`)
  await download.saveAs(file)
  await page.waitForTimeout(400)
  return file
}

/* ---------- a plain card ---------- */
const plainFile = await exportNow('plain')
check('the card menu offers an export', !!plainFile, plainFile ? path.basename(plainFile) : 'no entry')
const plain = await readPng(plainFile)
const cardBox = await card.boundingBox()
check(
  'the file is the picture’s resolution, not the card’s',
  plain.w > cardBox.width * 3,
  `${plain.w}x${plain.h} from a card ${Math.round(cardBox.width)} wide`
)
/* The card is the picture: there is no title bar taking height off it. */
check('and the shape the card is', Math.abs(plain.w / plain.h - cardBox.width / cardBox.height) < 0.03,
  `${(plain.w / plain.h).toFixed(2)} vs ${(cardBox.width / cardBox.height).toFixed(2)}`)
check('the circle is a circle', plain.circle && Math.abs(plain.circle.w / plain.circle.h - 1) < 0.05, JSON.stringify(plain.circle))
check('and it is in colour', plain.colour > 20, `channel spread ${plain.colour}`)

/* ---------- with an effect on it ---------- */
await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(2000)
const fxFile = await exportNow('halftone')
const withFx = await readPng(fxFile)
check('an effect is baked into the file', !!fxFile && withFx.w === plain.w, `${withFx.w}x${withFx.h}`)
const changed = await page.evaluate(
  async ({ a, b }) => {
    const load = async (data) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + data
      await img.decode()
      const s = document.createElement('canvas')
      s.width = 32
      s.height = 32
      const x = s.getContext('2d')
      x.drawImage(img, 0, 0, 32, 32)
      return x.getImageData(0, 0, 32, 32).data
    }
    const A = await load(a)
    const B = await load(b)
    let n = 0
    for (let i = 0; i < A.length; i += 4) n += Math.abs(A[i] - B[i])
    return Math.round(n / (A.length / 4))
  },
  { a: fs.readFileSync(plainFile).toString('base64'), b: fs.readFileSync(fxFile).toString('base64') }
)
check('and it is really a different picture', changed > 12, `${changed} apart per pixel`)

/* ---------- with the tone turned down ---------- */
await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
await page.waitForTimeout(300)
await page.locator('.preset-row button', { hasText: 'B&W' }).click()
await page.waitForTimeout(1200)
const bwFile = await exportNow('bw')
const bw = await readPng(bwFile)
check('the tone is baked in too', bw.colour < 12, `channel spread ${bw.colour}, was ${plain.colour}`)

/* ---------- with the framing moved ---------- */
/* The tone goes back to normal first, or the circle this measures would still
 * be grey from the check before and there would be nothing red to find. */
await page.locator('.preset-row button', { hasText: 'Original' }).click()
await page.waitForTimeout(900)
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.panel .ctl')].find((r) => r.textContent.includes('Zoom'))
  const input = row.querySelector('input[type="range"]')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '2')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(1200)
const zoomFile = await exportNow('zoom')
const zoomed = await readPng(zoomFile)
check(
  'the framing is baked in',
  zoomed.circle && plain.circle && zoomed.circle.w > plain.circle.w * 1.6,
  `circle ${zoomed.circle?.w} wide, was ${plain.circle?.w}`
)
fs.copyFileSync(zoomFile, path.join(OUT, 'png-framed.png'))

/* ---------- with grain over it ---------- */
/* The last thing the card lays down, and the one an export is most likely to
 * forget: it is neither the shader nor a filter but a texture on top. */
const flatness = (file) =>
  page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const s = document.createElement('canvas')
    s.width = img.width
    s.height = img.height
    const x = s.getContext('2d')
    x.drawImage(img, 0, 0)
    /* A corner, which is flat background in this picture. */
    const d = x.getImageData(20, 20, 200, 200).data
    let sum = 0
    let sum2 = 0
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]
      sum += v
      sum2 += v * v
      n++
    }
    const mean = sum / n
    return Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean)) * 10) / 10
  }, fs.readFileSync(file).toString('base64'))

/* Measured against the card rather than against a number: overlay blending on
 * a pale background is subtle by nature, and what matters is that the export
 * carries as much of it as the card shows. */
/* Unused by the grain check now, kept for reading a file's local variance. */
const noiseOn = (shot) =>
  page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const s = document.createElement('canvas')
    s.width = img.width
    s.height = img.height
    const x = s.getContext('2d')
    x.drawImage(img, 0, 0)
    const side = Math.min(60, Math.floor(Math.min(img.width, img.height) / 4))
    /* From the bottom of the card, not the top. The name plate is a scrim
     * that fades from dark to nothing across the top of a picture, and a
     * gradient read as noise is a very noisy corner indeed. */
    const d = x.getImageData(4, img.height - side - 4, side, side).data
    let sum = 0
    let sum2 = 0
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i]
      sum2 += d[i] * d[i]
      n++
    }
    const mean = sum / n
    return Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean)) * 10) / 10
  }, shot)

const cardShot = async () =>
  (await page.locator('.card[data-kind="image"] .card-body').first().screenshot()).toString('base64')

/* How much two pictures of the card differ, per pixel. Grain over a pale
 * ground in overlay is a fraction of a level per pixel — too little to find as
 * variance inside one picture, and unmistakable as a difference between two. */
const perPixelDiff = (a, b) =>
  page.evaluate(async ([d1, d2]) => {
    const load = async (data) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + data
      await img.decode()
      const s = document.createElement('canvas')
      s.width = img.width
      s.height = img.height
      s.getContext('2d').drawImage(img, 0, 0)
      return s.getContext('2d').getImageData(0, 0, s.width, s.height).data
    }
    const A = await load(d1)
    const B = await load(d2)
    if (A.length !== B.length) return -1
    let sum = 0
    let n = 0
    for (let i = 0; i < A.length; i += 4) {
      sum += Math.abs(A[i] - B[i])
      n++
    }
    return Math.round((sum / n) * 100) / 100
  }, [a, b])

const before = await flatness(plainFile)
const cardBefore = await cardShot()
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.panel .ctl')].find((r) => r.textContent.includes('Grain'))
  const input = row.querySelector('input[type="range"]')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '70')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(1200)
const onCard = await cardShot()
const grainFile = await exportNow('grain')
const after = await flatness(grainFile)
/* Both ends of the promise: the slider does something to the card, and the
 * file carries what the card shows. */
const moved = await perPixelDiff(cardBefore, onCard)
check('the grain shows on the card', moved > 0.5, `${moved} levels per pixel`)
check(
  'the grain is baked into the file as well',
  after > before + 2,
  `${after} of noise in a flat corner, ${before} with no grain`
)

/* ---------- several at once ---------- */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 900
  c.height = 700
  const x = c.getContext('2d')
  x.fillStyle = '#123a63'
  x.fillRect(0, 0, 900, 700)
  x.fillStyle = '#e8b06a'
  x.fillRect(120, 120, 400, 300)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'second.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 980, clientY: 620 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForTimeout(1800)
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
const [zipDownload] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+e')])
const zipFile = path.join(OUT, zipDownload.suggestedFilename())
await zipDownload.saveAs(zipFile)
check('several cards come out as a zip', /\.zip$/.test(zipDownload.suggestedFilename()), zipDownload.suggestedFilename())

let names = null
try {
  names = JSON.parse(
    execFileSync('python3', [
      '-c',
      'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad":z.testzip(),"names":z.namelist()}))',
      zipFile,
    ]).toString()
  )
} catch {
  console.log('     (python3 unavailable, skipping the outside reader check)')
}
if (names) {
  check('with a picture for each card in it', names.bad === null && names.names.length === 2, JSON.stringify(names.names))
  check('and they are PNGs', names.names.every((n) => n.endsWith('.png')))
}

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
