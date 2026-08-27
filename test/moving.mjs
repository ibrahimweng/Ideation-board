/* Pictures that move, with an effect on them.
 *
 *   npm run build && node scripts/browser-tests.mjs moving
 *
 * A GIF on the board played, because it was an <img> and the browser played
 * it. The moment an effect went on it the card became a canvas fed by the
 * renderer, the renderer had been handed one still, and the picture stopped.
 *
 * The obvious fix does not work, and this suite records that too: drawImage
 * and createImageBitmap on an animating <img> both hand back the first frame,
 * attached or not, visible or not. So the frames are decoded properly instead.
 *
 * Everything here is measured by screenshotting the painted card rather than
 * by reading pixels back, because what is being claimed is what a person sees.
 * The last check is the one that keeps the fix honest: a still picture must
 * still be drawn once and left alone, or every photograph on the board would
 * have quietly become a video.
 */
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { animatedGif } from './fixtures/agif.mjs'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const GIF = animatedGif({
  w: 64, h: 64,
  palette: [[220, 40, 40], [30, 80, 220], [40, 190, 90], [230, 200, 40]],
  frames: [0, 1, 2, 3],
  delay: 8,
}).toString('base64')

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* Why the whole thing had to be built this way. */
const readback = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/gif;base64,' + b64
  img.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px'
  document.body.appendChild(img)
  await img.decode()
  const seen = new Set()
  for (let i = 0; i < 20; i++) {
    const bmp = await createImageBitmap(img, { resizeWidth: 4, resizeHeight: 4 })
    const cv = new OffscreenCanvas(4, 4)
    const c = cv.getContext('2d')
    c.drawImage(bmp, 0, 0)
    bmp.close()
    const d = c.getImageData(1, 1, 1, 1).data
    seen.add(`${d[0]},${d[1]},${d[2]}`)
    await new Promise((r) => setTimeout(r, 45))
  }
  img.remove()
  return [...seen]
}, GIF)
ok('reading an animating <img> back really does only ever give the first frame',
   readback.length === 1, readback.join(' / ') + ' — which is why the frames are decoded instead')

const drop = (b64, name, type, at) =>
  page.evaluate(({ b64, name, type, at }) => {
    const bin = atob(b64)
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([u8], name, { type }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, { b64, name, type, at })

/* How many different pictures the card paints over a second and a half. */
const painted = async (sel = '.card .media', shots = 18, gap = 80) => {
  const seen = new Set()
  for (let i = 0; i < shots; i++) {
    const buf = await page.locator(sel).first().screenshot().catch(() => null)
    if (buf) seen.add(createHash('sha1').update(buf).digest('hex'))
    await page.waitForTimeout(gap)
  }
  return seen.size
}

/* Selecting by keyboard: a click has to find the card, and Tab always does. */
const pickFirst = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.keyboard.press('1')
  await page.waitForTimeout(500)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(400)
}

const shade = async (name = 'Halftone') => {
  if (!(await page.locator('.fx-thumb').count())) {
    await page.keyboard.press('e')
    await page.waitForTimeout(500)
  }
  const t = page.locator(`.fx-thumb[title="${name}"]`)
  if (!(await t.count())) return false
  await t.click()
  await page.waitForTimeout(2200)
  return true
}

/* ---------- a GIF ---------- */
await drop(GIF, 'spin.gif', 'image/gif', { x: 480, y: 380 })
await page.waitForTimeout(2200)
ok('a dropped GIF is a picture card', (await page.locator('.card[data-kind="image"]').count()) === 1)
const plainGif = await painted()
ok('and it moves', plainGif > 1, `${plainGif} distinct frames painted`)
ok('and it is written down as one that moves, so nothing has to work it out again',
   await page.evaluate(() => new Promise((res) => {
     const r = indexedDB.open('ideation.board.db')
     r.onsuccess = () => {
       const all = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
       all.onsuccess = () => res(all.result.some((b) => (b.items || []).some((i) => i.anim === true)))
       all.onerror = () => res(false)
     }
     r.onerror = () => res(false)
   })))

await pickFirst()
ok('an effect can be put on it', await shade())
ok('the card is now drawn by the renderer', (await page.locator('.card canvas.media').count()) === 1)
const shadedGif = await painted()
ok('and it is still moving', shadedGif > 1, `${shadedGif} distinct frames painted with an effect on it`)
fs.writeFileSync(path.join(OUT, 'moving-gif.png'), await page.screenshot())

/* ---------- and it is still moving after a reload ---------- */
await page.waitForTimeout(1200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2600)
ok('after a reload the effect is still on it', (await page.locator('.card canvas.media').count()) === 1)
const afterReload = await painted()
ok('and it is still moving then too', afterReload > 1, `${afterReload} distinct frames painted`)

/* ---------- a video ---------- */
const made = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 320; c.height = 240
  const x = c.getContext('2d')
  const stream = c.captureStream(25)
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) return { ok: false, reason: 'no MediaRecorder' }
  const rec = new MediaRecorder(stream, { mimeType: type })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start()
  let f = 0
  await new Promise((done) => {
    const draw = () => {
      f++
      x.fillStyle = `hsl(${(f * 11) % 360} 80% 45%)`
      x.fillRect(0, 0, 320, 240)
      x.fillStyle = '#fff'
      x.fillRect((f * 9) % 260, 20, 60, 200)
      if (f < 80) requestAnimationFrame(draw)
      else done()
    }
    draw()
  })
  rec.stop()
  await new Promise((r) => (rec.onstop = r))
  const blob = new Blob(chunks, { type })
  if (!blob.size) return { ok: false, reason: 'empty recording' }
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'clip.webm', { type: 'video/webm' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 900, clientY: 380 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
  return { ok: true }
})
ok('a video can be recorded to drop on the board', made.ok, made.reason || '')

if (made.ok) {
  await page.waitForTimeout(3200)
  ok('a dropped video is a video card', (await page.locator('.card[data-kind="video"]').count()) === 1)
  await page.locator('.card[data-kind="video"] video').first().evaluate((v) => {
    v.muted = true
    v.loop = true
    return v.play()
  }).catch(() => {})
  await page.waitForTimeout(700)
  const plainVideo = await painted('.card[data-kind="video"] video')
  ok('and it plays', plainVideo > 1, `${plainVideo} distinct frames painted`)

  await page.locator('.card[data-kind="video"]').first().click({ position: { x: 8, y: 8 } })
  await page.waitForTimeout(500)
  ok('an effect can be put on the video too', await shade())
  const shadedVideo = await painted('.card[data-kind="video"] canvas')
  ok('and it is still playing', shadedVideo > 1, `${shadedVideo} distinct frames painted with an effect on it`)
  fs.writeFileSync(path.join(OUT, 'moving-video.png'), await page.screenshot())
}

/* ---------- and a still picture is still a still picture ---------- */
/* The check that keeps the rest honest. Feeding every effected card a reel of
   frames would make every photograph on the board cost what a video costs, and
   nothing above would have noticed. */
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
const STILL = animatedGif({ w: 64, h: 64, palette: [[200, 90, 30]], frames: [0], delay: 8 }).toString('base64')
await drop(STILL, 'flat.gif', 'image/gif', { x: 480, y: 380 })
await page.waitForTimeout(2000)
await pickFirst()
await shade()
const stillFrames = await painted('.card .media', 12, 90)
ok('a picture that does not move is drawn once and left alone',
   stillFrames === 1, `${stillFrames} distinct frames painted — more than one means every photograph became a video`)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || errors.length ? 1 : 0)
