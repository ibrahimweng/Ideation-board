/* Video by URL.
 *
 *   npm run dev &
 *   node test/urlvideo.mjs http://localhost:5173
 *
 * A pasted address can mean three different things, and what the board can do
 * with it depends on where it came from:
 *
 *   a video file whose host allows cross-origin reads -> plays, takes shaders
 *   a video file whose host does not                  -> plays, says so
 *   a YouTube link                                    -> embedded player
 *   anything else                                     -> stays a link
 *
 * The clip is recorded in the page and served back from a second origin on
 * this machine, one path with the cross-origin header and one without, so the
 * whole thing runs offline and neither case depends on a real CDN.
 */
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const PORT = Number(process.env.MEDIA_PORT || 5199)
const HOST = `http://127.0.0.1:${PORT}`
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

/* ---------- a second origin to serve the clip from ---------- */
let clip = null
const server = http.createServer((req, res) => {
  const url = new URL(req.url, HOST)
  const cors = url.pathname.startsWith('/open/')
  const head = {}
  if (cors) {
    head['Access-Control-Allow-Origin'] = '*'
    head['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
    head['Access-Control-Allow-Headers'] = 'Range'
    head['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges'
  }
  if (req.method === 'OPTIONS') return res.writeHead(204, head).end()

  if (url.pathname === '/page.html') {
    return res.writeHead(200, { ...head, 'Content-Type': 'text/html' }).end('<h1>not a video</h1>')
  }
  if (url.pathname === '/gone.mp4') {
    return res.writeHead(404, head).end('no')
  }
  if (!url.pathname.endsWith('/clip.webm') || !clip) {
    return res.writeHead(503, head).end('not ready')
  }

  head['Content-Type'] = 'video/webm'
  head['Accept-Ranges'] = 'bytes'
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Number(range[2]) : clip.length - 1
    const slice = clip.subarray(start, end + 1)
    head['Content-Range'] = `bytes ${start}-${end}/${clip.length}`
    head['Content-Length'] = String(slice.length)
    res.writeHead(206, head).end(req.method === 'HEAD' ? undefined : slice)
    return
  }
  head['Content-Length'] = String(clip.length)
  res.writeHead(200, head).end(req.method === 'HEAD' ? undefined : clip)
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const OPEN = `${HOST}/open/clip.webm`
const CLOSED = `${HOST}/closed/clip.webm`
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30'
const PAGE = `${HOST}/page.html`
const DEAD = `${HOST}/gone.mp4`

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
await page.evaluate(() => indexedDB.deleteDatabase('ideation.board.db'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* ---------- record a clip whose picture changes a lot ---------- */
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
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { ok: true, b64: btoa(s), bytes: blob.size }
})

if (!made.ok) {
  console.error('FAIL: could not record a test clip:', made.reason)
  await browser.close()
  server.close()
  process.exit(1)
}
clip = Buffer.from(made.b64, 'base64')
console.log('serving clip:', clip.length, 'bytes from', HOST)

/* ---------- helpers ---------- */
const pasteUrl = (u) =>
  page.evaluate((url) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', url)
    window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, u)

const clearBoard = async () => {
  await page.evaluate(() => document.activeElement?.blur?.())
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(250)
}

const results = {}
const check = (name, value) => {
  results[name] = value
  console.log(`${value === true ? 'ok  ' : value === false ? 'FAIL' : '    '} ${name}${typeof value === 'boolean' ? '' : ': ' + JSON.stringify(value)}`)
}

/* ---------- 1. a video URL its host lets us read ---------- */
await pasteUrl(OPEN)
await page.waitForSelector('.card[data-kind="video"]', { timeout: 20000 })
await page.waitForTimeout(3000)

const open = await page.evaluate(() => {
  const card = document.querySelector('.card[data-kind="video"]')
  const v = card.querySelector('video')
  return {
    cors: v.getAttribute('crossorigin'),
    ready: v.readyState,
    vw: v.videoWidth,
    vh: v.videoHeight,
    h: card.offsetHeight,
  }
})
check('cors video: asks for cross-origin access', open.cors === 'anonymous')
check('cors video: metadata loaded', open.ready >= 1 && open.vw === 640)
/* 420x266 is the sixteen-by-nine guess it is created with; the probe replaces
 * it with the clip's real four-by-three shape. */
check('cors video: card resized to the real shape', open.h > 300)

const card = page.locator('.card[data-kind="video"]').first()
await card.click({ position: { x: 60, y: 10 } })
await page.waitForTimeout(400)
/* A still is grabbed from the video for the same reason a dropped file gets
 * one: without it every effect in the panel previews as an empty swatch. */
const previews = await page
  .waitForSelector('.fx-thumb canvas', { timeout: 20000 })
  .then(() => true)
  .catch(() => false)
check('cors video: effect previews render', previews)
await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(2000)

check('cors video: shader canvas mounted', (await page.locator('.video-out').count()) === 1)
check('cors video: no unavailable note', (await page.locator('.fx-blocked').count()) === 0)

await page.locator('.video-play').click()
await page.waitForTimeout(600)
const frames = []
for (let i = 0; i < 5; i++) {
  frames.push(await card.screenshot())
  await page.waitForTimeout(420)
}
fs.writeFileSync(path.join(OUT, 'url-video-effected.png'), frames[4])
const distinct = new Set(frames.map((f) => f.toString('base64'))).size
check('cors video: effect follows playback', distinct >= 3)
check('cors video: distinct frames', `${distinct} of ${frames.length}`)

await clearBoard()

/* ---------- 2. a video URL its host will not let us read ---------- */
await pasteUrl(CLOSED)
await page.waitForSelector('.card[data-kind="video"]', { timeout: 20000 })
await page.waitForTimeout(4000)

const shut = await page.evaluate(() => {
  const c = document.querySelector('.card[data-kind="video"]')
  const v = c.querySelector('video')
  return { cors: v.getAttribute('crossorigin'), ready: v.readyState, vw: v.videoWidth }
})
check('blocked video: cross-origin request dropped', shut.cors === null)
check('blocked video: still plays', shut.ready >= 1 && shut.vw === 640)

const card2 = page.locator('.card[data-kind="video"]').first()
await card2.click({ position: { x: 60, y: 10 } })
await page.waitForTimeout(400)
const panelNote = await page.locator('.panel-note').count()
check('blocked video: panel explains why', panelNote === 1 && (await page.locator('.fx-thumb').count()) === 0)

/* Shaders are off for this one, but the CSS side of the panel is not. */
await page.locator('.panel button', { hasText: 'Open Adjust' }).click()
await page.waitForTimeout(300)
await page.locator('.preset-row button', { hasText: 'B&W' }).click()
await page.waitForTimeout(600)
const filtered = await page.evaluate(() => {
  const b = document.querySelector('.card[data-kind="video"] .card-body')
  return b ? b.style.filter : ''
})
check('blocked video: tone adjustments still apply', /saturate/.test(filtered))
fs.writeFileSync(path.join(OUT, 'url-video-blocked.png'), await card2.screenshot())

await clearBoard()

/* ---------- 2b. an effect applied to both at once ---------- */
/* The panel shows one set of controls for the whole selection, so a shader
 * chosen for a readable video lands on an unreadable one too. The unreadable
 * card cannot run it, and has to say so rather than look ignored. */
await pasteUrl(OPEN)
await page.waitForSelector('.card[data-kind="video"]', { timeout: 20000 })
await page.waitForTimeout(2500)
await pasteUrl(CLOSED)
await page.waitForTimeout(4000)
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Control+a')
await page.waitForTimeout(300)
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.locator('.fx-thumb[title="Halftone"]').click()
await page.waitForTimeout(2500)

check('mixed selection: two video cards', (await page.locator('.card[data-kind="video"]').count()) === 2)
check('mixed selection: only the readable one is shaded', (await page.locator('.video-out').count()) === 1)
check('mixed selection: the other one says why', (await page.locator('.fx-blocked').count()) === 1)
check(
  'mixed selection: note wording',
  (await page.locator('.fx-blocked').first().innerText()).trim() === 'Effects unavailable for this source'
)
fs.writeFileSync(path.join(OUT, 'url-video-mixed.png'), await page.screenshot())

await clearBoard()

/* ---------- 3. a YouTube link ---------- */
await pasteUrl(YT)
await page.waitForSelector('.card[data-kind="embed"]', { timeout: 10000 })
const embed = await page.evaluate(() => {
  const f = document.querySelector('.card[data-kind="embed"] iframe')
  return { src: f?.getAttribute('src') || '', shield: !!document.querySelector('.embed-shield') }
})
check('youtube: embedded player', embed.src === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&start=30')
check('youtube: draggable while unselected', embed.shield === true)
await page.locator('.card[data-kind="embed"]').first().click({ position: { x: 60, y: 10 } })
await page.waitForTimeout(300)
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.waitForTimeout(200)
check('youtube: player reachable once selected', (await page.locator('.embed-shield').count()) === 0)
check('youtube: effects offered as unavailable', (await page.locator('.panel-note').count()) === 1)

await clearBoard()

/* ---------- 4. a page that is not a video ---------- */
await pasteUrl(PAGE)
await page.waitForSelector('.card', { timeout: 10000 })
await page.waitForTimeout(4000)
check('web page: stays a link', (await page.locator('.card[data-kind="link"]').count()) === 1)

await clearBoard()

/* ---------- 5. a video URL that leads nowhere ---------- */
await pasteUrl(DEAD)
await page.waitForSelector('.card', { timeout: 10000 })
await page.waitForTimeout(5000)
check('dead .mp4: falls back to a link', (await page.locator('.card[data-kind="link"]').count()) === 1)

/* ---------- 6. it survives a reload ---------- */
await clearBoard()
await pasteUrl(OPEN)
await page.waitForSelector('.card[data-kind="video"]', { timeout: 20000 })
await page.waitForTimeout(3000)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="video"]', { timeout: 20000 })
await page.waitForTimeout(3000)
const back = await page.evaluate(() => {
  const v = document.querySelector('.card[data-kind="video"] video')
  return { cors: v.getAttribute('crossorigin'), ready: v.readyState }
})
check('reload: remote video comes back playable', back.ready >= 1 && back.cors === 'anonymous')

check('no page errors', errors.length === 0)
if (errors.length) console.log(errors)

const ok = Object.values(results).every((v) => v !== false)
console.log(ok ? '\nPASS' : '\nFAIL')
await browser.close()
server.close()
process.exit(ok ? 0 : 1)
