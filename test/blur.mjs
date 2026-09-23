/* The blur gallery: saying where the blur comes from.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/blur.mjs http://localhost:4173
 *
 * Photoshop's gallery is five entries on a submenu, and every one of them is
 * the same two questions: how the blur is shaped, and where it happens. The
 * second is a mask. So what has to be proved here is not that a picture can be
 * softened — anything can soften a picture — but that the soft part is where
 * the mask is and the sharp part is not.
 *
 * Blur is read as an edge losing its edge. A hard black line on white is 0 one
 * side and 255 the other; blurred, the pixels either side of it move towards
 * each other, and how far they moved is how blurred it is. That is a number,
 * and it can be read at two places on the same picture.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:4173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  const t = m.text()
  if (/shader|GL_|WebGL|program/i.test(t) && m.type() === 'error') errors.push('console: ' + t)
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.removeItem('ideation.path')
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

/* A grid of hard black squares on white: an edge everywhere, at every place
   the checks want to read one. */
const drop = (at) =>
  page.evaluate(async ({ at }) => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 600
    const x = c.getContext('2d')
    x.fillStyle = '#fff'
    x.fillRect(0, 0, 600, 600)
    x.fillStyle = '#000'
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
      if ((i + j) % 2) x.fillRect(i * 30, j * 30, 30, 30)
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'grid.png', { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, { at })

/* How sharp the picture is around a point: the spread of the values in a small
   window. A hard checkerboard fills the whole range, so the spread is near
   255; blurred, the blacks and whites run into each other and it collapses.
   One number, read the same way everywhere. */
const sharpness = (fx, fy) =>
  page.evaluate(async ({ fx, fy }) => {
    const card = document.querySelector('.card[data-kind="image"]')
    if (!card) return null
    const el = card.querySelector('canvas.media') || card.querySelector('img.media')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(r.width))
    c.height = Math.max(1, Math.round(r.height))
    const ctx = c.getContext('2d', { willReadFrequently: true })
    try {
      ctx.drawImage(el, 0, 0, c.width, c.height)
    } catch {
      return null
    }
    const n = 34
    const x0 = Math.max(0, Math.min(c.width - n, Math.round(c.width * fx - n / 2)))
    const y0 = Math.max(0, Math.min(c.height - n, Math.round(c.height * fy - n / 2)))
    const d = ctx.getImageData(x0, y0, n, n).data
    let lo = 255
    let hi = 0
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return hi - lo
  }, { fx, fy })

const tab = () => page.locator('.panel-tabs button', { hasText: 'Develop' }).first()

const hideOverlay = async () => {
  const eye = page.locator('.mask-eye[data-on]')
  if (await eye.count()) {
    const was = await fingerprint()
    await eye.first().click()
    await settle(was)
  }
}

const addBlur = async (name) => {
  await tab().click()
  await page.waitForTimeout(250)
  const add = page.locator('.masks .blurs > button', { hasText: 'New blur' })
  await add.scrollIntoViewIfNeeded()
  await add.click()
  await page.waitForTimeout(200)
  const was = await fingerprint()
  await page.locator('.masks .blurs .mask-kinds button', { hasText: name }).first().click()
  await settle(was)
  await hideOverlay()
}

/* What the card looks like right now, as one number. Used to wait for a
   render rather than sleep through it: under load a shader pass can take
   several seconds, and a number chosen in advance is a number that is too
   small on a busy machine — which is the one kind of failure that shows up
   only when the whole suite runs at once. */
const fingerprint = () =>
  page.evaluate(() => {
    const card = document.querySelector('.card[data-kind="image"]')
    const el = card?.querySelector('canvas.media') || card?.querySelector('img.media')
    if (!el) return 'none'
    const r = el.getBoundingClientRect()
    const c = document.createElement('canvas')
    c.width = 24
    c.height = 24
    const g = c.getContext('2d', { willReadFrequently: true })
    try {
      g.drawImage(el, 0, 0, 24, 24)
    } catch {
      return 'x'
    }
    const d = g.getImageData(0, 0, 24, 24).data
    let h = 0
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i]) | 0
    return String(h)
  })

/* Waits until the picture has changed from what it was and then held still.
   Returns false if it never changed, which the caller can report rather than
   discover as a wrong number three checks later. */
const settle = async (was) => {
  const until = Date.now() + 12000
  let last = null
  while (Date.now() < until) {
    const now = await fingerprint()
    if (now !== was && now === last) return true
    last = now
    await page.waitForTimeout(160)
  }
  return false
}

const setMask = async (label, value) => {
  const box = page.locator('.mask-body .ctl', { hasText: new RegExp(`^${label}`) }).locator('input.ctl-num').first()
  await box.scrollIntoViewIfNeeded()
  const was = await fingerprint()
  await box.fill(String(value))
  await box.press('Enter')
  await settle(was)
}

const offAll = async () => {
  const on = page.locator('.mask-off[data-on]')
  const n = await on.count()
  if (!n) return
  const was = await fingerprint()
  for (let i = n - 1; i >= 0; i--) await on.nth(i).click()
  await settle(was)
}

/* ---------- a picture with an edge everywhere in it ---------- */
await drop({ x: 520, y: 380 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(400)

const crisp = await sharpness(0.5, 0.5)
check('the picture starts hard-edged everywhere', crisp > 200, `${crisp}`)

/* ---------- iris blur: sharp inside the ellipse, soft outside ----------
 *
 * The one the gallery is for. A subject stays sharp, everything round it goes
 * soft, and the line between them is a shape you can drag. */
await addBlur('Iris blur')
const middle = await sharpness(0.5, 0.5)
const corner = await sharpness(0.08, 0.1)
check('an iris blur leaves the middle sharp', middle > 190, `${middle}`)
check('and softens the corner', corner < 110, `${corner}`)
check('which is the whole point of it', middle - corner > 90, `${middle} vs ${corner}`)
fs.writeFileSync(path.join(OUT, 'blur-iris.png'), await page.screenshot())

/* An iris is an ellipse already turned inside out — the blur is outside it —
   so the Invert button puts it back the other way: soft in the middle, sharp
   around it, which is the other half of what an ellipse is for. */
const invert = page.locator('.mask-body .mask-inv').first()
await invert.click()
await page.waitForTimeout(1000)
const flipMiddle = await sharpness(0.5, 0.5)
const flipCorner = await sharpness(0.08, 0.1)
check('inverting it blurs the middle instead', flipCorner - flipMiddle > 90, `${flipMiddle} vs ${flipCorner}`)
await invert.click()
await page.waitForTimeout(900)

/* The amount, which has to be a dial and not a switch. The margin is small
   because the picture is deliberately the hardest case there is — a
   checkerboard of twenty-one pixel squares, which even a gentle defocus very
   nearly wipes out. What is being asked is only that the number does
   something, in the direction its name says. */
await setMask('Blur', 8)
const gentle = await sharpness(0.08, 0.1)
check('a smaller amount is a smaller blur', gentle > corner + 10, `${corner} at 55, ${gentle} at 8`)
await offAll()

/* ---------- tilt-shift: sharp across a band ---------- */
await addBlur('Tilt-shift')
const band = await sharpness(0.5, 0.5)
const above = await sharpness(0.5, 0.08)
const below = await sharpness(0.5, 0.92)
check('a tilt-shift keeps the band down the middle sharp', band > 190, `${band}`)
check('and softens above it and below it', above < 120 && below < 120, `${above} above, ${below} below`)
fs.writeFileSync(path.join(OUT, 'blur-tilt.png'), await page.screenshot())
await offAll()

/* ---------- motion: a blur with a direction ----------
 *
 * The thing that makes it motion rather than defocus is that it only smears
 * one way. Read across the grain and the edges are still there; read along it
 * and they are gone. A defocus would take both. */
await addBlur('Motion blur')
await setMask('Blur', 60)

const grain = async () =>
  page.evaluate(async () => {
    const card = document.querySelector('.card[data-kind="image"]')
    const el = card.querySelector('canvas.media')
    const r = el.getBoundingClientRect()
    const c = document.createElement('canvas')
    c.width = Math.round(r.width)
    c.height = Math.round(r.height)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(el, 0, 0, c.width, c.height)
    const row = ctx.getImageData(0, Math.round(c.height * 0.5), c.width, 1).data
    const col = ctx.getImageData(Math.round(c.width * 0.5), 0, 1, c.height).data
    const spread = (d) => {
      let lo = 255
      let hi = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < lo) lo = d[i]
        if (d[i] > hi) hi = d[i]
      }
      return hi - lo
    }
    return { row: spread(row), col: spread(col) }
  })

/* A blur with a direction leaves one axis of the picture alone and takes the
   other. Which axis is which is not the interesting part; that turning the
   control by a right angle swaps them is, because it is the only reading that
   cannot be given by a blur which has no direction at all. */
await setMask('Direction', 0)
const flat = await grain()
await setMask('Direction', 90)
const turned = await grain()
check('a motion blur takes one axis and leaves the other',
      Math.abs(flat.row - flat.col) > 60, `${flat.row} along the rows, ${flat.col} down the columns`)
check('and turning it by a right angle swaps them',
      (flat.row - flat.col) * (turned.row - turned.col) < 0,
      `${flat.row}/${flat.col} at 0°, ${turned.row}/${turned.col} at 90°`)
fs.writeFileSync(path.join(OUT, 'blur-motion.png'), await page.screenshot())
await offAll()

/* ---------- spin: soft at the rim, sharp at the middle it turns on ---------- */
await addBlur('Spin blur')
await setMask('Blur', 60)
const hub = await sharpness(0.5, 0.5)
const rim = await sharpness(0.5, 0.28)
check('a spin blur leaves the point it turns on alone', hub > rim + 50, `${hub} at the middle, ${rim} out from it`)
fs.writeFileSync(path.join(OUT, 'blur-spin.png'), await page.screenshot())
await offAll()

/* ---------- field: the whole picture, and then not ---------- */
await addBlur('Field blur')
const allOfIt = [await sharpness(0.2, 0.2), await sharpness(0.8, 0.8)]
check('a field blur takes the whole picture', allOfIt.every((v) => v < 130), JSON.stringify(allOfIt))

/* And then a hole cut in it, which is the answer to "say where the blur comes
   from": the blur is a mask, so anything that can be taken out of a mask can
   be taken out of the blur. */
const one = page.locator('.mask[data-open]').first()
await one.locator('.mask-add > button', { hasText: 'Add to this mask' }).click()
await page.waitForTimeout(250)
await one.locator('.mask-kinds button', { hasText: 'Radial gradient' }).click()
await page.waitForTimeout(400)
const part2 = one.locator('.mask-part').nth(1)
await part2.locator('.mask-ops button', { hasText: 'Subtract' }).click()
await page.waitForTimeout(1100)
const hole = await sharpness(0.5, 0.5)
const rest = await sharpness(0.1, 0.1)
check('and a shape subtracted from it is a hole in the blur', hole - rest > 80, `${hole} in the hole, ${rest} outside it`)
fs.writeFileSync(path.join(OUT, 'blur-field-hole.png'), await page.screenshot())

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
