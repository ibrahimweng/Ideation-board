/* Masks: where an edit happens.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/masks.mjs http://localhost:4173
 *
 * Every check here asks the same question in a different way: did the edit
 * land where the mask is and nowhere else? A masking feature that brightens
 * the whole picture, or brightens nothing, passes every test you can write
 * about its user interface and is worthless — so nothing here reads the panel
 * for an answer. It reads the pixels.
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

/* Four quarters of one flat grey, with a strong blue square in the bottom
   right. Flat so a local edit shows up as a number rather than as a feeling;
   the blue square is for the colour range, which has to find something it can
   tell apart from the rest. */
const drop = (at) =>
  page.evaluate(async ({ at }) => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 600
    const x = c.getContext('2d')
    x.fillStyle = 'rgb(128,128,128)'
    x.fillRect(0, 0, 600, 600)
    /* A bright band across the top, for luminance range. */
    x.fillStyle = 'rgb(225,225,225)'
    x.fillRect(0, 0, 600, 120)
    x.fillStyle = 'rgb(40,90,220)'
    x.fillRect(420, 420, 180, 180)
    /* Its mirror: the same saturation and the same brightness, a different
       hue. There so that "find this colour" has to mean the hue and not the
       distance in RGB — the two are a long way apart on a colour wheel and
       exactly as far apart as each other from grey. */
    x.fillStyle = 'rgb(220,90,40)'
    x.fillRect(0, 420, 180, 180)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'quarters.png', { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, { at })

const sample = (fx, fy) =>
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
    const d = ctx.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data
    return [d[0], d[1], d[2]]
  }, { fx, fy })

const drawnBy = () =>
  page.evaluate(() => {
    const card = document.querySelector('.card[data-kind="image"]')
    return card?.querySelector('canvas.media') ? 'canvas' : card?.querySelector('img.media') ? 'img' : 'nothing'
  })

const tab = () => page.locator('.panel-tabs button', { hasText: 'Develop' }).first()

/* A slider inside the open mask, by its label, typed into rather than dragged
   so the figure is the figure. Scoped to `.mask-body`, because "Exposure"
   also names a slider in the panel above and the whole point of this suite is
   that those two are different things. */
const setMask = async (label, value) => {
  const box = page
    .locator('.mask-body .ctl', { hasText: new RegExp(`^${label}`) })
    .locator('input.ctl-num')
    .first()
  await box.scrollIntoViewIfNeeded()
  await box.fill(String(value))
  await box.press('Enter')
  await page.waitForTimeout(700)
}

/* Adding a mask turns its overlay on, which is right — a mask nobody can see
   is not yet a place. Every check that reads the photograph has to put it away
   again first. */
const hideOverlay = async () => {
  const eye = page.locator('.mask-eye[data-on]')
  if (await eye.count()) {
    await eye.first().click()
    await page.waitForTimeout(700)
  }
}

const addMask = async (name) => {
  await tab().click()
  await page.waitForTimeout(250)
  const add = page.locator('.masks > .mask-add > button', { hasText: 'New mask' })
  await add.scrollIntoViewIfNeeded()
  await add.click()
  await page.waitForTimeout(200)
  await page.locator('.masks > .mask-add .mask-kinds button', { hasText: name }).first().click()
  await page.waitForTimeout(900)
}

/* ---------- a picture to work on ---------- */
await drop({ x: 520, y: 380 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(400)

check('the picture starts as the browser drew it', (await drawnBy()) === 'img', await drawnBy())

/* ---------- a linear gradient ----------
 *
 * The default runs down the top of the frame, so the top is inside it and the
 * bottom is not. The whole claim of masking is in these two numbers. */
await addMask('Linear gradient')
check('adding a mask shows where it is', (await drawnBy()) === 'canvas', await drawnBy())
const red = await sample(0.5, 0.06)
const notRed = await sample(0.5, 0.94)
check('and shows it in red', red && red[0] > red[1] + 40 && red[0] > red[2] + 40, JSON.stringify(red))
check('and only where it is', notRed && Math.abs(notRed[0] - notRed[1]) < 10, JSON.stringify(notRed))
fs.writeFileSync(path.join(OUT, 'masks-overlay.png'), await page.screenshot())

/* Off again, so the checks below read the photograph and not the overlay. */
await hideOverlay()

await setMask('Exposure', 2)
const inside = await sample(0.5, 0.06)
const outside = await sample(0.5, 0.94)
check('a masked exposure lifts what is inside it', inside[0] > 250, `${inside[0]}`)
check('and leaves what is outside it exactly alone', Math.abs(outside[0] - 128) <= 2, `${outside[0]}`)
fs.writeFileSync(path.join(OUT, 'masks-linear.png'), await page.screenshot())

/* ---------- invert ---------- */
await page.locator('.mask-inv').first().click()
await page.waitForTimeout(800)
const flippedIn = await sample(0.5, 0.06)
const flippedOut = await sample(0.5, 0.94)
check('inverting a part swaps inside for outside', flippedOut[0] > 200 && Math.abs(flippedIn[0] - 225) <= 3,
      `${flippedIn[0]} / ${flippedOut[0]}`)
await page.locator('.mask-inv[data-on]').first().click()
await page.waitForTimeout(800)

/* ---------- amount ----------
 *
 * Read on an exposure pulled down rather than up, because the bright band is
 * nearly white and two stops up clips whatever the amount is — which would
 * have made this check pass on a slider that did nothing. */
await setMask('Exposure', -2)
const full = await sample(0.5, 0.06)
await setMask('Amount', 50)
const half = await sample(0.5, 0.06)
check('the amount slider backs the whole mask off',
      half[0] > full[0] + 30 && half[0] < 225 - 20, `${full[0]} at 100%, ${half[0]} at 50%, from 225`)
check('and does it by halves', Math.abs(half[0] - (full[0] + 225) / 2) < 8,
      `${half[0]} vs ${Math.round((full[0] + 225) / 2)}`)
await setMask('Amount', 100)
await setMask('Exposure', 2)

/* ---------- switching it off ---------- */
await page.locator('.mask-off').first().click()
await page.waitForTimeout(900)
check('a mask switched off leaves nothing behind', (await drawnBy()) === 'img', await drawnBy())
const off = await sample(0.5, 0.06)
check('and the picture is the photograph again', Math.abs(off[0] - 225) <= 3, `${off[0]}`)
await page.locator('.mask-off').first().click()
await page.waitForTimeout(900)

/* ---------- a second mask, on a different place ----------
 *
 * Two masks have to be two edits. The failure this catches is the one every
 * multi-pass pipeline has at least once: the second pass reads the original
 * instead of what the first pass wrote, and the first edit disappears. */
await addMask('Luminance range')
await hideOverlay()
await setMask('Darkest', 0)
await setMask('Brightest', 60)
await setMask('Exposure', -2)
const lit = await sample(0.5, 0.06)
const dimmed = await sample(0.5, 0.94)
check('a second mask lands on its own place', dimmed[0] < 80, `${dimmed[0]}`)
check('and the first mask is still there under it', lit[0] > 245, `${lit[0]}`)
fs.writeFileSync(path.join(OUT, 'masks-two.png'), await page.screenshot())

/* ---------- the three ways parts combine ----------
 *
 * Add, subtract, intersect — the complete set, and the reason to have parts
 * at all. Built out of two regions that are easy to read off the picture: a
 * radial wound up to cover the whole card, and the bright band across the top.
 * With the same two probes, each of the three gives a different answer, so one
 * pair of numbers tells all three apart. */
await page.locator('.mask-off').first().click()      /* the gradient off */
await page.waitForTimeout(400)
await page.locator('.mask-list .mask').nth(1).locator('.mask-off').click()   /* and the luminance one */
await page.waitForTimeout(700)

await addMask('Radial gradient')
await hideOverlay()
await setMask('Size', 100)
await setMask('Feather', 0)
await setMask('Exposure', -2)
const everywhere = [await sample(0.5, 0.06), await sample(0.5, 0.94)]
check('a radial wound all the way up covers the whole card',
      everywhere[0][0] < 140 && everywhere[1][0] < 80, JSON.stringify(everywhere.map((p) => p[0])))

/* And now the band, as a second part of the same mask. */
const openMask = page.locator('.mask[data-open]').first()
await openMask.locator('.mask-add > button', { hasText: 'Add to this mask' }).click()
await page.waitForTimeout(250)
await openMask.locator('.mask-kinds button', { hasText: 'Luminance range' }).click()
await page.waitForTimeout(700)
const part2 = openMask.locator('.mask-part').nth(1)
const setPart2 = async (label, v) => {
  const box = part2.locator('.ctl', { hasText: new RegExp(`^${label}`) }).locator('input.ctl-num').first()
  await box.scrollIntoViewIfNeeded()
  await box.fill(String(v))
  await box.press('Enter')
  await page.waitForTimeout(650)
}
/* A range that holds the band and not the grey. A luminance range reads the
   picture the mask pass was handed — here the photograph, since the masks
   above it are switched off — so the figures are the photograph's own: the
   band is at 88 out of 100 and the grey at 50. */
await setPart2('Darkest', 70)
await setPart2('Brightest', 100)
await setPart2('Softness', 5)

const op = async (name) => {
  await part2.locator('.mask-ops button', { hasText: name }).click()
  await page.waitForTimeout(800)
  return [(await sample(0.5, 0.06))[0], (await sample(0.5, 0.94))[0]]
}

const added = await op('Add')
check('add keeps both regions', added[0] < 140 && added[1] < 80, JSON.stringify(added))
const subbed = await op('Subtract')
check('subtract takes the band back out', subbed[0] > 215 && subbed[1] < 80, JSON.stringify(subbed))
const crossed = await op('Intersect')
check('intersect keeps only where both are', crossed[0] < 140 && crossed[1] > 120, JSON.stringify(crossed))
fs.writeFileSync(path.join(OUT, 'masks-ops.png'), await page.screenshot())

/* ---------- a colour range ---------- */
await page.locator('.mask-list .mask').nth(2).locator('.mask-off').click()
await page.waitForTimeout(700)
await addMask('Colour range')
await hideOverlay()
const blueWas = await sample(0.88, 0.88)
const redWas = await sample(0.12, 0.88)
check('the two squares are where the test thinks they are',
      blueWas[2] > blueWas[0] + 80 && redWas[0] > redWas[2] + 80, `${JSON.stringify(blueWas)} ${JSON.stringify(redWas)}`)
await page.locator('.mask-body .mask-pick input').first().fill('#2856dc')
await page.waitForTimeout(700)
await setMask('Range', 40)
await setMask('Exposure', 2)
const bluePatch = await sample(0.88, 0.88)
const redPatch = await sample(0.12, 0.88)
const notBlue = await sample(0.5, 0.6)
check('a colour range finds the colour it was given', bluePatch[2] > 240, JSON.stringify(bluePatch))
check('and not its mirror image, which is the same distance from grey',
      Math.abs(redPatch[0] - 220) <= 4 && Math.abs(redPatch[1] - 90) <= 4, JSON.stringify(redPatch))
check('and leaves everything that is not it', Math.abs(notBlue[0] - 128) <= 3, JSON.stringify(notBlue))
fs.writeFileSync(path.join(OUT, 'masks-colour.png'), await page.screenshot())

/* ---------- and it survives leaving ----------
 *
 * An export goes down a different road: not the card's canvas but a one-shot
 * render at the picture's own resolution, and the same road the poster and the
 * exported page take. A develop that reaches the screen and not the file is
 * the worst kind of bug in a photo editor — you would find out about it after
 * sending the picture to somebody. */
const px = async (file, fx, fy) =>
  page.evaluate(
    async ({ data, fx, fy }) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + data
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0)
      const d = g.getImageData(Math.round(img.width * fx), Math.round(img.height * fy), 1, 1).data
      return [d[0], d[1], d[2], img.width, img.height]
    },
    { data: fs.readFileSync(file).toString('base64'), fx, fy }
  )

const at = await page.locator('.card[data-kind="image"]').first().boundingBox()
await page.mouse.click(at.x + at.width / 2, at.y + 12)
await page.waitForTimeout(250)
await page.mouse.click(at.x + at.width / 2, at.y + 12, { button: 'right' })
await page.waitForTimeout(300)
const entry = page.locator('.menu button', { hasText: 'Export as PNG' })
check('a masked card can still be exported', (await entry.count()) === 1)
const [download] = await Promise.all([page.waitForEvent('download'), entry.click()])
const file = path.join(OUT, 'masks-export.png')
await download.saveAs(file)
await page.waitForTimeout(400)

const outBlue = await px(file, 0.88, 0.88)
const outGrey = await px(file, 0.5, 0.6)
check('the exported file is the picture\u2019s own resolution', outBlue[3] >= 600, `${outBlue[3]}x${outBlue[4]}`)
check('and the masked edit is in it', outBlue[2] > 240, JSON.stringify(outBlue.slice(0, 3)))
check('and only where the mask was', Math.abs(outGrey[0] - 128) <= 4, JSON.stringify(outGrey.slice(0, 3)))

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
