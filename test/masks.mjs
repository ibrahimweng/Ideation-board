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

const offAllMasks = async () => {
  const on = page.locator('.mask-off[data-on]')
  for (let i = (await on.count()) - 1; i >= 0; i--) await on.nth(i).click()
  await page.waitForTimeout(900)
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
/* Read on the blue square rather than on the grey: draining a grey towards
   grey leaves it exactly where it was, so a grey cannot tell the difference
   between an overlay that leaves the picture alone and one that drains all of
   it. A saturated colour can. */
const notRed = await sample(0.88, 0.88)
check('and shows it in red', red && red[0] > red[1] + 40 && red[0] > red[2] + 40, JSON.stringify(red))
/* Not merely neutral where the mask is not — the photograph itself, to the
   level. That is what makes clicking the picture to pick a colour off it an
   honest thing to do while the overlay is up. */
check('and leaves the picture alone everywhere else',
      notRed && Math.abs(notRed[0] - 40) <= 2 && Math.abs(notRed[2] - 220) <= 2, JSON.stringify(notRed))
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

/* ---------- putting one somewhere, by pointing at it ----------
 *
 * The panel can say how soft a gradient is. It cannot say where — where is a
 * place on a photograph, and the only honest way to give a place is to point
 * at it. So the last thing to prove is that the handles on the picture move
 * the mask, and move it to where they were dragged.
 */
await page.locator('.mask-list .mask').nth(3).locator('.mask-off').click()  /* the colour one off */
await page.waitForTimeout(500)
await addMask('Radial gradient')
const art = page.locator('.mask-art')
check('a mask being placed puts its handles on the picture', (await art.count()) === 1)
check('and the handles are the ones that kind has', (await art.locator('.mk-radial .mk-grip').count()) === 2,
      `${await art.locator('.mk-grip').count()} grips`)

const frame = await art.boundingBox()
const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
/* Drag the middle handle up and left, into the bright band. */
await page.mouse.move(centre.x, centre.y)
await page.mouse.down()
await page.mouse.move(centre.x - frame.width * 0.3, centre.y - frame.height * 0.36, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(900)

await hideOverlay()
await setMask('Exposure', -2)
const moved = await sample(0.2, 0.14)
const away = await sample(0.5, 0.6)
check('dragging the middle moves the mask to where it was dragged', moved[0] < 190, `${moved[0]}`)
check('and takes it off where it was', Math.abs(away[0] - 128) <= 4, `${away[0]}`)
fs.writeFileSync(path.join(OUT, 'masks-dragged.png'), await page.screenshot())

/* And the ring, which is how it is made bigger. A point well outside it at
   the size it was drawn, inside it once the rim has been dragged out to twice
   the radius. */
const wideBefore = await sample(0.55, 0.25)
check('a point outside the mask is untouched to start with', Math.abs(wideBefore[0] - 128) <= 4, `${wideBefore[0]}`)
await page.locator('.mask-list .mask').nth(4).locator('.mask-eye').click()
await page.waitForTimeout(700)
const ring = await page.locator('.mask-art').boundingBox()
await page.mouse.move(ring.x + ring.width * 0.5, ring.y + ring.height * 0.14)
await page.mouse.down()
await page.mouse.move(ring.x + ring.width * 0.8, ring.y + ring.height * 0.14, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(900)
await hideOverlay()
const wideAfter = await sample(0.55, 0.25)
check('dragging the ring makes the mask bigger', wideAfter[0] < 110, `${wideBefore[0]} -> ${wideAfter[0]}`)
await page.locator('.mask-list .mask').nth(4).locator('.mask-off').click()
await page.waitForTimeout(700)

/* ---------- painting one by hand ---------- */
await addMask('Brush')
check('a brush mask offers a surface to paint on', (await page.locator('.mask-art .mk-ground').count()) === 1)
const canvasBox = await page.locator('.mask-art').boundingBox()
await page.mouse.move(canvasBox.x + canvasBox.width * 0.25, canvasBox.y + canvasBox.height * 0.75)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(
    canvasBox.x + canvasBox.width * (0.25 + i * 0.03),
    canvasBox.y + canvasBox.height * 0.75,
    { steps: 2 }
  )
}
await page.mouse.up()
await page.waitForTimeout(900)
check('painting leaves strokes on the mask',
      /stroke/.test(await page.locator('.mask-body .panel-note').first().innerText()),
      await page.locator('.mask-body .panel-note').first().innerText())

await hideOverlay()
await setMask('Exposure', -2)
const painted = await sample(0.3, 0.75)
const unpainted = await sample(0.75, 0.3)
check('and the edit lands under the paint', painted[0] < 110, `${painted[0]}`)
check('and nowhere the brush did not go', Math.abs(unpainted[0] - 128) <= 4, `${unpainted[0]}`)

/* A second stroke, somewhere else. The first one could land on a brush that
   is baked once and then cached for ever; the second one cannot. */
await page.locator('.mask-list .mask').nth(5).locator('.mask-eye').click()
await page.waitForTimeout(600)
const again = await page.locator('.mask-art').boundingBox()
await page.mouse.move(again.x + again.width * 0.62, again.y + again.height * 0.42)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(again.x + again.width * (0.62 + i * 0.02), again.y + again.height * 0.42, { steps: 2 })
}
await page.mouse.up()
await page.waitForTimeout(900)
await hideOverlay()
const second = await sample(0.66, 0.42)
check('a second stroke lands too, on a brush that has already been baked once',
      second[0] < 110, `${second[0]}`)
check('and the first one is still there', (await sample(0.3, 0.75))[0] < 110, `${(await sample(0.3, 0.75))[0]}`)
fs.writeFileSync(path.join(OUT, 'masks-brush.png'), await page.screenshot())
await page.locator('.mask-list .mask').nth(5).locator('.mask-off').click()
await page.waitForTimeout(700)

/* ---------- the compare key, over a mask being shown ----------
 *
 * Holding it asks for the photograph and nothing else, which includes not the
 * red overlay. The bug this catches is not a wrong picture — it is the card
 * reading one thing fewer than it did on the render before, which React ends
 * the whole board over. */
await page.locator('.mask-list .mask').nth(5).locator('.mask-eye').click()
await page.waitForTimeout(700)
await page.keyboard.down('\\')
await page.waitForTimeout(700)
const held = await sample(0.45, 0.75)
check('holding the compare key over a mask being shown gives the photograph',
      !!held && Math.abs(held[0] - 128) <= 4, held ? `${held[0]}` : 'there is no card left to read')
await page.keyboard.up('\\')
await page.waitForTimeout(700)
const released = await sample(0.45, 0.75)
check('and letting go brings the overlay back',
      !!released && released[0] > released[1] + 40, JSON.stringify(released))
check('and the board is still standing', errors.length === 0, errors.join(' | '))
await hideOverlay()
await page.locator('.mask-list .mask').nth(5).locator('.mask-off').click()
await page.waitForTimeout(700)

/* ---------- the handles, on a zoomed picture ----------
 *
 * The handles live inside the card's frame, which is what keeps them on the
 * photograph when it is pushed about inside its card. The cost is that the
 * frame's own zoom applies to them as well: a picture at 1.6 had handles half
 * as big again as they should be, and a drag aimed at one landed beside it.
 */
await offAllMasks()
await tab().click()
await page.waitForTimeout(250)
const zoomBox = page.locator('.fx-controls', { hasText: 'Frame' }).locator('.ctl', { hasText: /^Zoom/ }).locator('input.ctl-num').first()
const hasZoom = (await zoomBox.count()) > 0
if (hasZoom) {
  await zoomBox.scrollIntoViewIfNeeded()
  await zoomBox.fill('1.6')
  await zoomBox.press('Enter')
  await page.waitForTimeout(700)
}
check('the picture can be zoomed inside its card', hasZoom)
await addMask('Radial gradient')
const zArt = await page.locator('.mask-art').boundingBox()
const grip = await page.locator('.mask-art .mk-radial .mk-grip').first().boundingBox()
/* The middle handle is drawn at the middle of the frame, so where it is drawn
   is a thing this can check without knowing anything about the transform. */
check('and the middle handle is drawn in the middle of it',
      Math.abs(grip.x + grip.width / 2 - (zArt.x + zArt.width / 2)) < 8 &&
        Math.abs(grip.y + grip.height / 2 - (zArt.y + zArt.height / 2)) < 8,
      `handle at ${Math.round(grip.x + grip.width / 2)},${Math.round(grip.y + grip.height / 2)} in a box centred on ${Math.round(zArt.x + zArt.width / 2)},${Math.round(zArt.y + zArt.height / 2)}`)
/* And it is the size a handle should be on screen, not that size times the
   card's zoom. Fourteen across at zoom one; the check allows a wide band
   because what is being caught is a factor of 1.6, not a pixel. */
check('and it is the size a handle is, not that size times the zoom',
      grip.width > 8 && grip.width < 20, `${grip.width.toFixed(1)} across`)
await offAllMasks()
if (hasZoom) {
  await zoomBox.scrollIntoViewIfNeeded()
  await zoomBox.fill('1')
  await zoomBox.press('Enter')
  await page.waitForTimeout(600)
}

/* ---------- taking something out ----------
 *
 * Paint over the thing, say where the good pixels come from. Read on the blue
 * square, which is the only saturated thing in the picture and so the only
 * place where "these pixels came from somewhere else" is a number rather than
 * a feeling.
 */
await offAllMasks()
await addMask('Brush')
const brushArt = await page.locator('.mask-art').boundingBox()
/* A short stroke across the middle of the blue square. */
await page.mouse.move(brushArt.x + brushArt.width * 0.84, brushArt.y + brushArt.height * 0.86)
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(brushArt.x + brushArt.width * (0.84 + i * 0.008), brushArt.y + brushArt.height * 0.86, { steps: 2 })
}
await page.mouse.up()
await page.waitForTimeout(800)
await hideOverlay()
const blueBefore = await sample(0.86, 0.86)
check('the brush is over the blue square', blueBefore[2] > blueBefore[0] + 80, JSON.stringify(blueBefore))

await page.locator('.mask-body button', { hasText: 'Clone' }).first().click()
await page.waitForTimeout(1000)
const cloned = await sample(0.86, 0.86)
check('cloning brings pixels in from somewhere else on the same picture',
      Math.abs(cloned[0] - 128) <= 6 && Math.abs(cloned[2] - 128) <= 6, JSON.stringify(cloned))
const untouched = await sample(0.94, 0.94)
check('and only where the brush went', untouched[2] > untouched[0] + 80, JSON.stringify(untouched))
fs.writeFileSync(path.join(OUT, 'masks-clone.png'), await page.screenshot())

/* And heal is the same repair with the tone left alone — which is the whole
   difference between the two and the reason both exist. Clone brought the grey
   of the other place with it; heal takes only its texture, so the blue tone
   stays. On a photograph that is what makes a patch stop looking like a patch;
   on a flat blue square it is what makes the square stay blue, which is the
   same statement and easier to read off a number. */
await page.locator('.mask-body button', { hasText: 'Heal' }).first().click()
await page.waitForTimeout(1100)
const healed = await sample(0.86, 0.86)
check('and heal is the same repair with the tone of where it lands kept',
      healed && Math.abs(healed[2] - 220) < 25 && Math.abs(cloned[2] - 128) < 10,
      `clone ${JSON.stringify(cloned)}, heal ${JSON.stringify(healed)}, from ${JSON.stringify(blueBefore)}`)
await page.locator('.mask-body button', { hasText: 'No repair' }).click()
await page.waitForTimeout(900)
const unrepaired = await sample(0.86, 0.86)
check('and taking the repair off puts the blue back',
      unrepaired[2] > unrepaired[0] + 80, JSON.stringify(unrepaired))
await offAllMasks()

/* ---------- what is kept between one mask and the next ----------
 *
 * Eight bits a channel cannot hold a number above one, so a highlight pushed
 * up by one mask is clipped before the next mask can see it, and the recovery
 * has nothing left to recover. Three stops up and three stops down over the
 * same place is the plainest way to ask: through eight-bit buffers a mid grey
 * comes back at 98, through sixteen it comes back where it started.
 */
await offAllMasks()
await addMask('The whole picture')
await hideOverlay()
await setMask('Exposure', 3)
const blown = await sample(0.5, 0.6)
check('three stops up takes a mid grey past white', blown[0] > 250, `${blown[0]}`)
await addMask('The whole picture')
await hideOverlay()
await setMask('Exposure', -3)
const back = await sample(0.5, 0.6)
check('and the next mask can pull it back, because the buffer between them is deeper than the screen',
      Math.abs(back[0] - 128) <= 3, `128 -> ${blown[0]} -> ${back[0]}`)
await offAllMasks()

/* The colour range back on, since the export below is read on the blue
   square it found. */
await page.locator('.mask-list .mask').nth(3).locator('.mask-off').click()
await page.waitForTimeout(800)

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

/* ---------- an overlay does not follow the panel ----------
 *
 * Its switch is on the panel, and the panel is about one card at a time. An
 * overlay left on the card before is a red picture with no control anywhere on
 * screen that turns it off. */
/* Read by the card's own id from here on, because a second picture is about
   to arrive and "the first image card" stops being a way to name one. */
const first = await page.locator('.card[data-kind="image"]').first().getAttribute('data-id')
const sampleOn = (cid, fx, fy) =>
  page.evaluate(({ cid, fx, fy }) => {
    const card = document.querySelector(`.card[data-id="${cid}"]`)
    const el = card?.querySelector('canvas.media') || card?.querySelector('img.media')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(r.width))
    c.height = Math.max(1, Math.round(r.height))
    const g = c.getContext('2d', { willReadFrequently: true })
    try {
      g.drawImage(el, 0, 0, c.width, c.height)
    } catch {
      return null
    }
    const d = g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data
    return [d[0], d[1], d[2]]
  }, { cid, fx, fy })

await page.locator('.mask-list .mask').nth(5).locator('.mask-eye').click()
await page.waitForTimeout(800)
const litUp = await sampleOn(first, 0.45, 0.75)
check('a mask being shown is red on its card', litUp[0] > litUp[1] + 40, JSON.stringify(litUp))
await drop({ x: 980, y: 380 })
await page.waitForTimeout(1600)
const two = await page.locator('.card[data-kind="image"]').count()
check('a second picture arrives', two === 2, `${two}`)
await page.locator('.card[data-kind="image"]').nth(1).click()
await page.waitForTimeout(1200)
const leftBehind = await sampleOn(first, 0.45, 0.75)
check('and selecting it takes the overlay off the one before',
      !!leftBehind && Math.abs(leftBehind[0] - leftBehind[1]) < 12, JSON.stringify(leftBehind))

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
