/* Checks that effects follow a playing video rather than freezing on a still.
 *
 *   npm run dev &
 *   node test/video.mjs http://localhost:5173
 *
 * The test records a short clip in the page itself, so there is no video file
 * to keep in the repository. It then drops the clip on the board, applies an
 * effect and samples the card while the video plays. If the effect is wired to
 * playback the samples differ from each other. If it is stuck on the poster
 * frame they are all identical. */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* Record a clip whose picture changes a lot from frame to frame. */
const made = await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 640; c.height = 480
  const x = c.getContext('2d')
  const stream = c.captureStream(25)
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  const type = types.find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) return { ok: false, reason: 'no MediaRecorder support' }
  const rec = new MediaRecorder(stream, { mimeType: type })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start()

  let f = 0
  await new Promise((done) => {
    const draw = () => {
      f++
      /* Big, obvious changes so a frozen frame is unmistakable. */
      x.fillStyle = `hsl(${(f * 9) % 360} 80% 45%)`
      x.fillRect(0, 0, 640, 480)
      x.fillStyle = '#fff'
      x.fillRect((f * 13) % 560, 40, 80, 400)
      x.fillStyle = '#000'
      x.font = 'bold 120px monospace'
      x.fillText(String(f % 10), 260, 300)
      if (f < 75) requestAnimationFrame(draw)
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
  const vp = document.querySelector('.viewport')
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 260 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  vp.dispatchEvent(ev)
  return { ok: true, bytes: blob.size, type }
})

if (!made.ok) {
  console.error('FAIL: could not record a test clip:', made.reason)
  await browser.close()
  process.exit(1)
}
console.log('recorded clip:', made.bytes, 'bytes,', made.type)

await page.waitForSelector('.card[data-kind="video"]', { timeout: 30000 })
await page.waitForTimeout(2500)

const card = page.locator('.card[data-kind="video"]').first()
fs.writeFileSync(path.join(OUT, 'video-plain.png'), await card.screenshot())

/* Native controls before the effect, our own bar after it. */
const nativeControls = await page.locator('.card[data-kind="video"] video[controls]').count()

await card.click({ position: { x: 60, y: 10 } })
await page.waitForTimeout(400)
await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(2500)

const hasBar = await page.locator('.video-bar').count()
const stillEffected = await card.screenshot()
fs.writeFileSync(path.join(OUT, 'video-effected-paused.png'), stillEffected)

/* Play, then sample the card several times. */
await page.locator('.video-play').click()
await page.waitForTimeout(600)

const frames = []
for (let i = 0; i < 5; i++) {
  frames.push(await card.screenshot())
  await page.waitForTimeout(420)
}
frames.forEach((f, i) => fs.writeFileSync(path.join(OUT, `video-frame-${i}.png`), f))

const distinct = new Set(frames.map((f) => f.toString('base64'))).size
const playingReported = await page.evaluate(() => {
  const v = document.querySelector('.card[data-kind="video"] video')
  return { paused: v.paused, t: +v.currentTime.toFixed(2), w: v.videoWidth }
})

await page.locator('.video-play').click()
await page.waitForTimeout(700)

/* A paused card must still show the frame it is parked on, not go blank. */
const pausedShot = await card.screenshot()
fs.writeFileSync(path.join(OUT, 'video-paused-after.png'), pausedShot)

/* Reload, to confirm an effected video card comes back. The poster is stored
 * under its own key for this reason: keyed to the video, the source loader
 * would be handed the video file and asked to decode it as an image. */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="video"]', { timeout: 30000 })
await page.waitForTimeout(3000)
const afterReload = await page.locator('.card[data-kind="video"]').first().screenshot()
fs.writeFileSync(path.join(OUT, 'video-after-reload.png'), afterReload)

console.log(JSON.stringify({
  nativeControlsBeforeEffect: nativeControls === 1,
  customBarAfterEffect: hasBar === 1,
  videoPlayed: !playingReported.paused || playingReported.t > 0,
  currentTime: playingReported.t,
  distinctFramesWhilePlaying: `${distinct} of ${frames.length}`,
  pausedFrameNotBlank: pausedShot.length > 8000,
  effectSurvivesReload: afterReload.length > 8000,
  pageErrors: errors,
}, null, 2))

const ok =
  nativeControls === 1 &&
  hasBar === 1 &&
  playingReported.t > 0 &&
  distinct >= 3 &&
  pausedShot.length > 8000 &&
  afterReload.length > 8000 &&
  errors.length === 0

console.log(ok ? '\nPASS' : '\nFAIL')
await browser.close()
process.exit(ok ? 0 : 1)
