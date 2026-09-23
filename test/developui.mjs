/* The develop panel, and the pass behind it.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node test/developui.mjs http://localhost:4173
 *
 * The other develop suite proves the arithmetic; this one proves it reaches
 * the picture. Every check here reads the pixels off the card and asks whether
 * moving a slider did what the slider is named after — which is the only
 * question that matters about a photo editor and the only one a unit test
 * cannot answer.
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
  /* A shader that will not build says so here and nowhere else. */
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

/* A flat mid-grey picture with a white disc and a dark corner in it: flat
   enough that a tone slider shows up as one number, and varied enough that
   highlights, shadows and local contrast each have something to work on. */
const drop = (at) =>
  page.evaluate(async ({ at }) => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 600
    const x = c.getContext('2d')
    x.fillStyle = 'rgb(128,128,128)'
    x.fillRect(0, 0, 600, 600)
    x.fillStyle = 'rgb(242,242,242)'
    x.beginPath()
    x.arc(300, 300, 120, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = 'rgb(28,28,28)'
    x.fillRect(0, 0, 90, 90)
    /* A saturated patch, for the colour checks. */
    x.fillStyle = 'rgb(200,60,60)'
    x.fillRect(480, 480, 100, 100)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'flat.png', { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, { at })

/* What is actually on the card, read back off whatever is drawing it — the
   canvas when the shader is running, the <img> when it is not. */
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

const panel = async (name) => {
  await page.locator('.panel-tabs button', { hasText: 'Develop' }).click()
  await page.waitForTimeout(250)
  const head = page.locator('.dev-sec .dev-head', { hasText: name })
  if (await head.count()) {
    const open = await head.first().getAttribute('aria-expanded')
    if (open !== 'true') {
      await head.first().click()
      await page.waitForTimeout(200)
    }
  }
}

/* Set one slider by typing into its own box, which is exact where a drag is
   not, and is a control the panel already had. */
const set = async (label, value) => {
  const box = page.locator('.ctl', { hasText: new RegExp(`^${label}`) }).locator('input.ctl-num').first()
  await box.scrollIntoViewIfNeeded()
  await box.fill(String(value))
  await box.press('Enter')
  await page.waitForTimeout(650)
}

const reset = async (section) => {
  const btn = page.locator('.dev-sec', { hasText: section }).locator('.dev-reset').first()
  if (await btn.count()) {
    await btn.click()
    await page.waitForTimeout(500)
  }
}

/* ---------- a picture to develop ---------- */
await drop({ x: 520, y: 380 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1200)
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(400)

check('an undeveloped picture is drawn by the browser, not the shader', (await drawnBy()) === 'img', await drawnBy())
const before = await sample(0.5, 0.15)
check('and it is the flat grey it was made as', before && Math.abs(before[0] - 128) <= 4, JSON.stringify(before))

/* ---------- exposure ---------- */
await panel('Basic')
await set('Exposure', 1)
check('one stop of exposure puts the shader on the card', (await drawnBy()) === 'canvas', await drawnBy())
const up = await sample(0.5, 0.15)
/* A stop is twice the light. Mid grey at 128 is 0.216 in linear; doubled and
   put back through the transfer function it lands near 185. */
check('and one stop is twice the light, not twice the number',
      up && up[0] > 170 && up[0] < 200, `${JSON.stringify(before)} -> ${JSON.stringify(up)}`)
fs.writeFileSync(path.join(OUT, 'develop-exposure.png'), await page.screenshot())

await set('Exposure', -1)
const down = await sample(0.5, 0.15)
check('and a stop down is half of it', down && down[0] > 75 && down[0] < 102, JSON.stringify(down))
await set('Exposure', 0)

/* ---------- contrast ----------
 *
 * Contrast is a power law about middle grey in linear light, so the thing to
 * ask is not only "did the ends separate" but "did the pivot hold". Middle
 * grey in linear light is 0.18; sRGB 128 sits just above it at 0.216, so a
 * contrast of +100 nudges it up and no more. A contrast pivoted half way up
 * the sRGB numbers instead — which is what almost every naive implementation
 * does, CSS's own contrast() included — would take that same grey down to the
 * eighties, because half way up the numbers is nearly three quarters of the
 * light. */
await set('Contrast', 100)
const cDisc = await sample(0.5, 0.5)
const cMid = await sample(0.5, 0.15)
const cDark = await sample(0.08, 0.08)
check('contrast pushes the ends apart', cDisc[0] > 250 && cDark[0] < 12, `${cDark[0]} .. ${cDisc[0]}`)
check('and pivots on middle grey, not on half way up the numbers',
      Math.abs(cMid[0] - 128) <= 18, `128 -> ${cMid[0]}`)
await set('Contrast', -100)
const fDisc = await sample(0.5, 0.5)
const fDark = await sample(0.08, 0.08)
check('and taking it off brings them back together',
      fDisc[0] < 242 - 20 && fDark[0] > 28 + 20, `${fDark[0]} .. ${fDisc[0]}`)
await set('Contrast', 0)

/* ---------- highlights and shadows ---------- */
const midWas = await sample(0.5, 0.15)
const discWas = await sample(0.5, 0.5)
await set('Highlights', -100)
const discNow = await sample(0.5, 0.5)
const midNow = await sample(0.5, 0.15)
check('pulling the highlights down darkens the bright part', discNow[0] < discWas[0] - 10, `${discWas[0]} -> ${discNow[0]}`)
check('and leaves the midtones where they were', Math.abs(midNow[0] - midWas[0]) <= 6, `${midWas[0]} -> ${midNow[0]}`)
await set('Highlights', 0)

const darkWas = await sample(0.08, 0.08)
await set('Shadows', 100)
const darkNow = await sample(0.08, 0.08)
check('lifting the shadows lifts the dark corner', darkNow[0] > darkWas[0] + 8, `${darkWas[0]} -> ${darkNow[0]}`)
await set('Shadows', 0)

/* ---------- white balance ---------- */
await set('Temperature', 80)
const warm = await sample(0.5, 0.15)
check('warming a grey makes it warm, and actually cools the blue',
      warm[0] > warm[2] + 15, JSON.stringify(warm))
await set('Temperature', -80)
const cool = await sample(0.5, 0.15)
check('and cooling it goes the other way, which sepia could never do',
      cool[2] > cool[0] + 15, JSON.stringify(cool))
/* A balance moves the colour and leaves the light alone, which is the whole
 * difference between it and a colour wash. The mean of the three channels
 * cannot see that — a temperature slider pushes red up and blue down by the
 * same amount, so the mean is preserved by the shape of the thing whether the
 * shader normalises or not. Luminance can see it: weighted 0.21/0.72/0.07,
 * red and blue are not interchangeable, and a gain vector that is not divided
 * by its own luminance takes the picture with it. */
const luma = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
await set('Temperature', 100)
const hotter = await sample(0.5, 0.15)
check('with the light kept, so it is a white balance and not a colour wash',
      Math.abs(luma(hotter) - 128) < 2.5 && Math.abs(luma(cool) - 128) < 2.5,
      `warm ${luma(hotter).toFixed(1)}, cool ${luma(cool).toFixed(1)}`)
check('and the two ends of it are the same brightness as each other',
      Math.abs(luma(hotter) - luma(cool)) < 2,
      `${luma(hotter).toFixed(1)} vs ${luma(cool).toFixed(1)}`)
await set('Temperature', 0)

/* ---------- saturation and vibrance ---------- */
const redWas = await sample(0.85, 0.85)
await set('Saturation', -100)
const grey = await sample(0.85, 0.85)
check('saturation at the bottom takes all the colour out',
      Math.abs(grey[0] - grey[1]) < 8 && Math.abs(grey[1] - grey[2]) < 8, `${JSON.stringify(redWas)} -> ${JSON.stringify(grey)}`)
await set('Saturation', 0)

/* ---------- vignette ----------
 *
 * Read on the bottom-left corner, which is plain grey in the source: the
 * top-left one is already painted dark, so asking whether it is darker than
 * the middle would have been answered by the photograph rather than by the
 * slider. And read before against after, for the same reason. */
await panel('Effects')
const cornerWas = await sample(0.04, 0.9)
/* The dead centre, where a vignette is defined to do nothing — a point a
 * third of the way out is not "the middle", and a vignette with its midpoint
 * at 50 genuinely reaches it. */
const middleWas = await sample(0.5, 0.5)
await set('Amount', -80)
const corner = await sample(0.04, 0.9)
const middle = await sample(0.5, 0.5)
check('a negative vignette darkens the corner, the way Lightroom means it',
      corner[0] < cornerWas[0] - 20, `${cornerWas[0]} -> ${corner[0]}`)
check('and leaves the middle of the frame alone',
      Math.abs(middle[0] - middleWas[0]) <= 2, `${middleWas[0]} -> ${middle[0]}`)
await set('Amount', 80)
const opened = await sample(0.04, 0.9)
check('and a positive one opens the corner up instead',
      opened[0] > cornerWas[0] + 20, `${cornerWas[0]} -> ${opened[0]}`)
fs.writeFileSync(path.join(OUT, 'develop-vignette.png'), await page.screenshot())
await set('Amount', 0)

/* ---------- the whole chain, doing nothing ----------
 *
 * Midpoint is a develop parameter like any other, so moving it puts the card
 * on the shader — but with the vignette amount at zero it changes no pixel,
 * and neither does anything else at its default. So the card is now running
 * every stage of the pipeline with every stage neutral, and what comes out has
 * to be the photograph, to the level. That is the one check that catches a
 * toLinear and a toSRGB which are not each other's inverse, or a stage whose
 * neutral is not quite neutral: errors that are invisible on any single slider
 * and ruin every picture on the board. */
await set('Midpoint', 60)
check('a neutral develop still goes through the shader', (await drawnBy()) === 'canvas', await drawnBy())
const through = [await sample(0.5, 0.5), await sample(0.5, 0.15), await sample(0.08, 0.08), await sample(0.85, 0.85)]
const want = [242, 128, 28, 200]
check('and the whole pipeline at its neutral gives the picture back untouched',
      through.every((p, i) => p && Math.abs(p[0] - want[i]) <= 1),
      `${JSON.stringify(through.map((p) => p && p[0]))} vs ${JSON.stringify(want)}`)
await reset('Effects')

/* ---------- the tone curve ----------
 *
 * The one control in the panel that is not a slider, and until now the one
 * with nothing proving it reaches the picture. Press the middle of the line,
 * drag it up, and the midtones have to come up with it while the ends stay
 * where they are — which is the whole of what a curve is for and what
 * separates it from an exposure slider.
 */
await panel('Tone curve')
const curve = page.locator('.curve').first()
check('the panel has a curve to drag', (await curve.count()) === 1)
const cbox = await curve.boundingBox()
const midWasC = await sample(0.5, 0.15)
const discWasC = await sample(0.5, 0.5)
const darkWasC = await sample(0.08, 0.08)
/* Press at half way along and a little above the line, then drag up. Pressing
   the line puts a point there and hands it to the same drag, so this is one
   gesture rather than two. */
await page.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.5)
await page.mouse.down()
await page.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.28, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(900)
check('pressing the line puts a point on it', (await page.locator('.curve-pt').count()) === 3,
      `${await page.locator('.curve-pt').count()} points`)
const midNowC = await sample(0.5, 0.15)
const discNowC = await sample(0.5, 0.5)
const darkNowC = await sample(0.08, 0.08)
check('lifting the middle of the curve lifts the midtones', midNowC[0] > midWasC[0] + 40,
      `${midWasC[0]} -> ${midNowC[0]}`)
/* And moves them far more than it moves the ends. Not "leaves the ends alone",
   which would be a claim about x=0 and x=1 and not about a picture: a curve
   through three points is a curve, so a highlight at 242 and a shadow at 28
   both come up a little. What separates it from an exposure slider is the
   shape — the middle moves several times as far as either end. */
const dMid = Math.abs(midNowC[0] - midWasC[0])
const dEnds = Math.max(Math.abs(discNowC[0] - discWasC[0]), Math.abs(darkNowC[0] - darkWasC[0]))
check('and moves them several times as far as it moves either end',
      dMid > dEnds * 3,
      `middle ${midWasC[0]}->${midNowC[0]}, ends ${discWasC[0]}->${discNowC[0]} and ${darkWasC[0]}->${darkNowC[0]}`)
fs.writeFileSync(path.join(OUT, 'develop-curve.png'), await page.screenshot())

/* And dragging that point off the top takes it away again, which is how every
   curve widget has worked for thirty years. */
const pt = await page.locator('.curve-pt').nth(1).boundingBox()
await page.mouse.move(pt.x + pt.width / 2, pt.y + pt.height / 2)
await page.mouse.down()
await page.mouse.move(pt.x + pt.width / 2, cbox.y - cbox.height * 0.3, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(900)
check('and dragging it off the top takes it away', (await page.locator('.curve-pt').count()) === 2,
      `${await page.locator('.curve-pt').count()} points`)
const backC = await sample(0.5, 0.15)
check('which puts the picture back', Math.abs(backC[0] - midWasC[0]) <= 3, `${midWasC[0]} -> ${backC[0]}`)

/* ---------- the colour mixer ----------
 *
 * Eight bands of hue, each with its own hue, saturation and luminance. The
 * claim to prove is that it is a mixer and not a global: pushing the reds has
 * to move the red patch and leave the grey beside it alone. */
await panel('Colour')
const redWasM = await sample(0.85, 0.85)
const greyWasM = await sample(0.5, 0.15)
await page.locator('.dev-bands button').first().click()
await page.waitForTimeout(300)
await set('Luminance', 100)
const redNowM = await sample(0.85, 0.85)
const greyNowM = await sample(0.5, 0.15)
check('the colour mixer moves the band it was pointed at', redNowM[0] > redWasM[0] + 15,
      `${redWasM[0]} -> ${redNowM[0]}`)
check('and leaves a grey alone, which has no hue to be in a band',
      Math.abs(greyNowM[0] - greyWasM[0]) <= 3, `${greyWasM[0]} -> ${greyNowM[0]}`)
await set('Luminance', 0)
await set('Saturation', -100)
const drained = await sample(0.85, 0.85)
check('and taking the saturation out of one band drains that colour only',
      Math.abs(drained[0] - drained[1]) < 24 && Math.abs((await sample(0.5, 0.15))[0] - greyWasM[0]) <= 3,
      JSON.stringify(drained))
await set('Saturation', 0)
fs.writeFileSync(path.join(OUT, 'develop-mixer.png'), await page.screenshot())
await reset('Colour')

/* ---------- optics ----------
 *
 * Distortion is read as a straight line stopping being straight. The picture
 * has a hard disc in the middle of it, and a barrel or a pincushion moves its
 * edge in or out — so the question is where the edge of the disc is, measured
 * along one row, and whether the correction moves it the way its sign says. */
await panel('Optics')
/* Read at the dark corner rather than on the disc in the middle. A radial
   correction goes as the square of the distance from the centre, which is the
   physics and not a choice: near the middle it barely moves anything, and the
   check has to be asked where the answer is. */
const cornerEdge = async () =>
  page.evaluate(async () => {
    const card = document.querySelector('.card[data-kind="image"]')
    const el = card.querySelector('canvas.media') || card.querySelector('img.media')
    const r = el.getBoundingClientRect()
    const c = document.createElement('canvas')
    c.width = Math.round(r.width)
    c.height = Math.round(r.height)
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(el, 0, 0, c.width, c.height)
    const row = g.getImageData(0, Math.round(c.height * 0.04), c.width, 1).data
    /* Walking out from the left, where the dark square stops. */
    for (let x = 0; x < c.width; x++) if (row[x * 4] > 100) return x / c.width
    return 1
  })

const straight = await cornerEdge()
await set('Distortion', 100)
const barrelled = await cornerEdge()
await set('Distortion', -100)
const pinched = await cornerEdge()
check('distortion moves a straight edge, and the two signs move it opposite ways',
      Math.abs(barrelled - straight) > 0.02 && (barrelled - straight) * (pinched - straight) < 0,
      `${straight.toFixed(3)} straight, ${barrelled.toFixed(3)} at +100, ${pinched.toFixed(3)} at -100`)
await set('Distortion', 0)
const backAgain = await cornerEdge()
check('and nought puts it back exactly where it was', Math.abs(backAgain - straight) < 0.005,
      `${straight.toFixed(3)} -> ${backAgain.toFixed(3)}`)

/* Chromatic aberration reads the same edge on two channels: correcting it
   pulls red and blue to different sizes, so the edge is in a different place
   for each of them. */
await set('Chromatic aberration', 100)
const split = await page.evaluate(async () => {
  const card = document.querySelector('.card[data-kind="image"]')
  const el = card.querySelector('canvas.media')
  const r = el.getBoundingClientRect()
  const c = document.createElement('canvas')
  c.width = Math.round(r.width)
  c.height = Math.round(r.height)
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(el, 0, 0, c.width, c.height)
  const row = g.getImageData(0, Math.round(c.height * 0.5), c.width, 1).data
  let most = 0
  for (let x = 0; x < c.width; x++) most = Math.max(most, Math.abs(row[x * 4] - row[x * 4 + 2]))
  return most
})
check('chromatic aberration reads red and blue at different sizes', split > 20, `${split}`)
await set('Chromatic aberration', 0)
await reset('Optics')

/* ---------- and it all comes back off ---------- */
await panel('Basic')
await set('Exposure', 2)
check('developed again', (await drawnBy()) === 'canvas')
const undev = page.locator('.develop button', { hasText: 'Undevelop' })
check('there is a way back to the photograph', (await undev.count()) === 1)
await undev.first().click()
await page.waitForTimeout(700)
check('and taking it off puts the browser back in charge', (await drawnBy()) === 'img', await drawnBy())
const after = await sample(0.5, 0.15)
check('with the picture exactly as it arrived', after && Math.abs(after[0] - 128) <= 4, JSON.stringify(after))

check('no page errors', errors.length === 0, errors.join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
