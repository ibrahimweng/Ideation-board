/* A sound on the board.
 *
 *   npm run build && npm run test:browser -- audio
 *   node test/audio.mjs http://localhost:4173
 *
 * An audio card used to be the browser's own grey player bar with a filename
 * over it: the one thing on the board that looked like a web page rather than
 * like part of the app, and eight identical grey bars on a board holding eight
 * tracks. It shows the waveform now, and the waveform is the scrub bar.
 *
 * The clip is written by hand in test/fixtures/wav.mjs and is loud, then
 * quiet, then loud again — so "the waveform has a shape" is something that can
 * actually be asserted rather than assumed. A test that only counted peaks
 * would pass against a flat line, which is the one thing a waveform must
 * never be.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { wavBase64 } from './fixtures/wav.mjs'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    /* So play() is not refused for want of a gesture, and so a runner with no
       sound card still decodes. */
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

let pass = 0
let fail = 0
const check = (name, ok, extra) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra === undefined ? '' : `  — ${extra}`}`)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1400)

/* ---------- drop a track ---------- */

const b64 = wavBase64()
await page.evaluate(async (data) => {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'reference-track.wav', { type: 'audio/wav' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, b64)

await page.waitForSelector('.card[data-kind="audio"]', { timeout: 20000 })
await page.waitForTimeout(1800)

check('a dropped sound becomes an audio card', (await page.locator('.card[data-kind="audio"]').count()) === 1)
check('and not the browser player bar it used to be',
  (await page.locator('.card[data-kind="audio"] audio[controls]').count()) === 0)
check('it draws its own waveform', (await page.locator('.sound-svg').count()) === 1)
check('and its own play button', (await page.locator('.sound-play').count()) === 1)

/* ---------- the waveform is the sound, not decoration ---------- */

const peaks = await page.evaluate(async () => {
  const board = await new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const t = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
      t.onsuccess = () => res(t.result)
      t.onerror = () => res([])
    }
    r.onerror = () => res([])
  })
  const item = board.flatMap((b) => b.items || []).find((i) => i.kind === 'audio')
  return item ? { peaks: item.peaks || [], secs: item.secs || 0 } : null
})

check('the track was really decoded', !!peaks && peaks.peaks.length > 50, `${peaks?.peaks.length} peaks`)
check('and its length was read off it', !!peaks && Math.abs(peaks.secs - 2) < 0.2, `${peaks?.secs?.toFixed(2)}s`)

if (peaks?.peaks.length) {
  const p = peaks.peaks
  const share = (from, to) => {
    const slice = p.slice(Math.floor(p.length * from), Math.floor(p.length * to))
    return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length)
  }
  /* The clip is loud, then quiet, then loud. If the waveform does not say so,
     it is decoration rather than a picture of this particular sound. */
  const loud1 = share(0.02, 0.2)
  const quiet = share(0.3, 0.5)
  const loud2 = share(0.58, 0.76)
  check('the waveform has the shape of this track and not of any track',
    loud1 > quiet * 3 && loud2 > quiet * 3,
    `loud ${loud1.toFixed(0)}, quiet ${quiet.toFixed(0)}, loud ${loud2.toFixed(0)}`)
  check('and it is normalised, so a quiet recording is still a shape',
    Math.max(...p) >= 95, `loudest ${Math.max(...p)}`)
}

fs.writeFileSync(path.join(OUT, 'audio-card.png'), await page.screenshot())

/* ---------- it says how long it is, before anybody presses anything ---------- */

const times = await page.locator('.sound-time span').allInnerTexts()
check('the card says the length of the track', times[1] === '0:02', times.join(' / '))
check('and where you are in it', times[0] === '0:00', times.join(' / '))

/* ---------- playing ---------- */

await page.locator('.sound-play').click()
await page.waitForTimeout(900)
const wasPlaying = await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="audio"] audio')
  return el ? { paused: el.paused, at: el.currentTime } : null
})
check('pressing play plays it', !!wasPlaying && !wasPlaying.paused)
check('and the time moves with it', !!wasPlaying && wasPlaying.at > 0, `${wasPlaying?.at?.toFixed(2)}s`)
check('and the button says what it will do next',
  (await page.locator('.sound-play').getAttribute('aria-label')) === 'Pause')

await page.locator('.sound-play').click()
await page.waitForTimeout(400)
check('pressing it again stops it', await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="audio"] audio')
  return !!el && el.paused
}))

/* ---------- the waveform is the scrub bar ---------- */

const wave = await page.locator('.sound-wave').boundingBox()
await page.mouse.move(Math.round(wave.x + wave.width * 0.75), Math.round(wave.y + wave.height / 2))
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(400)
const sought = await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="audio"] audio')
  return el ? el.currentTime : null
})
check('pressing three quarters along the waveform goes three quarters in',
  sought !== null && Math.abs(sought - 1.5) < 0.25, `${sought?.toFixed(2)}s of 2s`)

check('the played part of the waveform is drawn apart from the rest',
  (await page.locator('.wave-done').count()) === 1 && (await page.locator('.wave-rest').count()) === 1)

/* ---------- and it can be reached without a pointer ---------- */

check('the waveform is a slider anything reading the page can understand', await page.evaluate(() => {
  const el = document.querySelector('.sound-wave')
  return el?.getAttribute('role') === 'slider' && !!el.getAttribute('aria-valuetext')
}))

await page.locator('.sound-wave').focus()
await page.keyboard.press('ArrowLeft')
await page.waitForTimeout(300)
const nudged = await page.evaluate(() => document.querySelector('.card[data-kind="audio"] audio')?.currentTime)
check('and an arrow key moves through the track', typeof nudged === 'number' && nudged < sought,
  `${sought?.toFixed(2)}s -> ${nudged?.toFixed(2)}s`)

/* ---------- and it is all still there afterwards ---------- */

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="audio"]', { timeout: 20000 })
await page.waitForTimeout(1500)
check('the track comes back after a reload', (await page.locator('.card[data-kind="audio"]').count()) === 1)
check('with its waveform, without decoding it again', (await page.locator('.sound-svg path').count()) >= 2)
check('and still says how long it is', (await page.locator('.sound-time span').allInnerTexts())[1] === '0:02')

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
