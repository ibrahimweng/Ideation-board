/* Sound is for sound design.
 *
 *   npm run build && npm run test:browser -- sound
 *   node test/sound.mjs http://localhost:4173
 *
 * A sound card drew its own waveform and played, and that was the whole of it.
 * On a board where a photograph takes sixty-nine treatments and can be varied
 * twelve ways, sound was the one medium you could only look at.
 *
 * The checks are about the three things that make a treatment real rather than
 * a live filter that vanishes with the tab: that it is rendered and saved, so
 * it survives a reload; that the waveform on the card is the treated sound and
 * not a picture of what it used to be; and that the file that was dropped is
 * never written over, so taking it all off puts the original back.
 *
 * They are measured off the peaks the card draws from, because that is the one
 * number a browser will give you about a sound without playing it — and it is
 * also exactly what a person sees.
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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
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
await page.waitForTimeout(1500)

/* The clip is loud, then quiet, then loud again, which is what makes any of
   this assertable: an effect that changes the shape has to change it
   somewhere in particular. */
await page.evaluate(async (b64) => {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  const dt = new DataTransfer()
  dt.items.add(new File([arr], 'reference.wav', { type: 'audio/wav' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 520, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, wavBase64())
await page.waitForSelector('.card[data-kind="audio"]', { timeout: 20000 })
await page.waitForTimeout(1600)

/* What the board has written down about the sound. The peaks are the ones the
   card draws its waveform from, so reading them is reading the picture. */
const saved = () =>
  page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('ideation.board.db')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const get = (storeName, key) =>
      new Promise((res) => {
        const t = db.transaction(storeName, 'readonly')
        const r = t.objectStore(storeName).get(key)
        r.onsuccess = () => res(r.result)
        r.onerror = () => res(null)
      })
    const all = await new Promise((res) => {
      const t = db.transaction('boards', 'readonly')
      const r = t.objectStore('boards').getAll()
      r.onsuccess = () => res(r.result || [])
      r.onerror = () => res([])
    })
    const it = all.flatMap((b) => b.items || []).find((i) => i.kind === 'audio')
    if (!it) return null
    const file = await get('blobs', it.media)
    const heard = it.heard ? await get('blobs', it.heard) : null
    return {
      peaks: it.peaks || [],
      chain: (it.chain || []).map((l) => l.fxid),
      heard: it.heard || null,
      secs: it.secs || 0,
      fileSize: file?.size || 0,
      heardSize: heard?.size || 0,
      heardType: heard?.type || null,
    }
  })

/* Loudness over one part of the track, as a share of the whole. */
const loudIn = (peaks, from, to) => {
  const a = Math.floor(peaks.length * from)
  const b = Math.max(a + 1, Math.floor(peaks.length * to))
  return Math.round(peaks.slice(a, b).reduce((s, v) => s + v, 0) / (b - a))
}

const first = await saved()
check('a sound arrives with a waveform', (first?.peaks || []).length > 100, `${first?.peaks.length} peaks`)
check('and nothing on it yet', first?.chain.length === 0 && !first?.heard, JSON.stringify(first?.chain))
/* The fixture is loud at the start and quiet at the end. If that is not what
   the peaks say, nothing below means anything. */
check('drawn from the sound rather than from nothing',
  loudIn(first.peaks, 0, 0.2) > loudIn(first.peaks, 0.8, 1) + 20,
  `${loudIn(first.peaks, 0, 0.2)} at the start, ${loudIn(first.peaks, 0.8, 1)} at the end`)

/* ---------- the panel is a sound panel ---------- */

await page.locator('.card[data-kind="audio"]').click({ position: { x: 30, y: 8 } })
await page.waitForTimeout(600)
if (!(await page.locator('.panel').count())) {
  await page.locator('.tool-mode').click()
  await page.waitForTimeout(700)
}
check('selecting a sound gives it a panel rather than a rail',
  (await page.locator('.panel-rail').count()) === 0 && (await page.locator('.snd-pick').count()) > 0,
  `${await page.locator('.snd-pick').count()} effects offered`)
const offered = await page.locator('.snd-pick b').allInnerTexts()
check('with a curated list of them', offered.length >= 12, offered.join(', '))
check('and each says what it does, because a sound has no thumbnail',
  (await page.locator('.snd-pick em').allInnerTexts()).every((t) => t.trim().length > 4))

fs.writeFileSync(path.join(OUT, 'sound-panel.png'), await page.screenshot())

const put = async (name, ms = 3000) => {
  await page.locator('.snd-pick', { hasText: name }).first().click()
  await page.waitForTimeout(ms)
  return saved()
}
const clear = async () => {
  const off = page.locator('.ghost', { hasText: 'Back to the original' })
  if (await off.count()) {
    await off.click()
    await page.waitForTimeout(2000)
  }
}

/* ---------- it is rendered, not filtered ---------- */

const reversed = await put('Reverse')
check('an effect is rendered and saved beside the file',
  !!reversed?.heard && reversed.heardSize > 1000, `${reversed?.heardSize} bytes`)
check('as a sound file anything can open', reversed?.heardType === 'audio/wav', reversed?.heardType)
/* Backwards means the quiet end is now the loud one. Nothing but a real
   render of the samples does that. */
check('and reversing it really turns the sound round',
  loudIn(reversed.peaks, 0, 0.2) < loudIn(reversed.peaks, 0.8, 1) - 20,
  `${loudIn(reversed.peaks, 0, 0.2)} at the start, ${loudIn(reversed.peaks, 0.8, 1)} at the end`)
check('the waveform on the card follows the treatment',
  JSON.stringify(reversed.peaks) !== JSON.stringify(first.peaks))

/* ---------- and the file it came from is untouched ---------- */

await clear()
const back = await saved()
check('taking it off puts the original back', !back?.heard && back?.chain.length === 0)
check('because the file was never written over', back?.fileSize === first.fileSize,
  `${first.fileSize} then ${back?.fileSize}`)
check('and the waveform comes back with it',
  JSON.stringify(back.peaks) === JSON.stringify(first.peaks))

/* ---------- a treatment that changes the length ---------- */

const wet = await put('Reverb', 4000)
check('a reverb makes the sound longer than it was, because a tail is sound',
  wet.secs > first.secs + 0.3, `${first.secs.toFixed(2)}s then ${wet.secs.toFixed(2)}s`)
await clear()

/* ---------- one that changes the shape ---------- */

const gated = await put('Gate', 4000)
/* A gate chops it into pieces, so the waveform must have holes in it that the
   original does not. */
const holes = (peaks) => peaks.filter((v) => v < 3).length
check('a gate chops the sound into pieces', holes(gated.peaks) > holes(first.peaks) + 10,
  `${holes(first.peaks)} silent buckets then ${holes(gated.peaks)}`)

/* ---------- effects stack ---------- */

await page.locator('.fx-layer-add').click()
await page.waitForTimeout(1200)
const stacked = await put('Bit crush', 4000)
check('a second effect can go on top of the first', stacked.chain.length === 2,
  stacked.chain.join(' then '))
check('and both are kept, in the order they were put on',
  stacked.chain[0] === 'gate' && stacked.chain[1] === 'crush', stacked.chain.join(' then '))

fs.writeFileSync(path.join(OUT, 'sound-treated.png'), await page.screenshot())

/* ---------- out of the board ---------- */

const palette = async (text) => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.locator('.cmd-input').fill(text)
  await page.waitForTimeout(400)
  return page.locator('.cmd-row').first()
}
const [got] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  (await palette('export the selected sound')).click(),
])
const file = path.join(OUT, `sound-${got.suggestedFilename()}`)
await got.saveAs(file)
await page.waitForTimeout(600)
const bytes = fs.readFileSync(file)
check('the treated sound exports', bytes.length > 1000, `${bytes.length} bytes`)
check('and what comes out is really a WAV',
  bytes.slice(0, 4).toString('utf8') === 'RIFF' && bytes.slice(8, 12).toString('utf8') === 'WAVE',
  bytes.slice(0, 12).toString('utf8').replace(/[^\x20-\x7e]/g, '.'))
check('named as the treatment rather than as the file that was dropped',
  /treated/.test(got.suggestedFilename()), got.suggestedFilename())

/* ---------- and it comes back ---------- */

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="audio"]', { timeout: 20000 })
await page.waitForTimeout(2000)
const after = await saved()
check('a treated sound comes back after a reload', after?.chain.length === 2, (after?.chain || []).join(' then '))
check('still playing the render rather than the file', after?.heard === stacked.heard)
check('and still drawing it', JSON.stringify(after.peaks) === JSON.stringify(stacked.peaks))

/* ---------- twelve of it ---------- */

/* The grid was the best thing on the picture side and sound had none of it.
   Twelve renders rather than twelve looks, so this is the one place where
   what a variation costs is worth checking as well as what it is. */
const board = () =>
  page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('ideation.board.db')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const all = await new Promise((res) => {
      const t = db.transaction('boards', 'readonly')
      const r = t.objectStore('boards').getAll()
      r.onsuccess = () => res(r.result || [])
      r.onerror = () => res([])
    })
    const items = all.flatMap((b) => b.items || []).filter((i) => i.kind === 'audio')
    return items.map((i) => ({
      id: i.id,
      chain: (i.chain || []).map((l) => l.fxid).join('+'),
      heard: !!i.heard,
      pick: i.pick || null,
      peaks: (i.peaks || []).join(','),
      x: i.x,
      y: i.y,
    }))
  })

await page.locator('.card[data-kind="audio"]').first().click({ position: { x: 30, y: 8 } })
await page.waitForTimeout(600)
const wasOne = await board()
await page.keyboard.press('v')
/* Twelve renders in order. Generous, because this is the one key on the board
   that does real work rather than scheduling it. */
await page.waitForTimeout(26000)

const twelve = await board()
const kids = twelve.filter((i) => !wasOne.some((w) => w.id === i.id))
check('one press makes twelve versions of a sound', kids.length === 12, `${kids.length} made`)
check('and every one of them was rendered', kids.every((k) => k.heard), `${kids.filter((k) => k.heard).length} of 12`)
check('each with a treatment of its own', kids.every((k) => k.chain), kids.map((k) => k.chain).join(' '))
/* Twelve versions that come out the same is a worse answer than one version. */
check('and they are not twelve of the same thing',
  new Set(kids.map((k) => k.chain)).size >= 9, `${new Set(kids.map((k) => k.chain)).size} distinct chains`)
/* The waveform is the thing you scan before you listen to any of them, so it
   is the thing that has to differ. */
check('drawn differently, so the grid can be read before it is heard',
  new Set(kids.map((k) => k.peaks)).size >= 10, `${new Set(kids.map((k) => k.peaks)).size} distinct waveforms`)
/* A variation you cannot hear is a square of the grid spent on nothing. */
check('and none of them is too short to hear',
  kids.every((k) => k.peaks.split(',').filter((v) => Number(v) > 2).length > 4),
  kids.map((k) => k.peaks.split(',').filter((v) => Number(v) > 2).length).join(' '))
check('laid out four across and three down',
  new Set(kids.map((k) => k.x)).size === 4 && new Set(kids.map((k) => k.y)).size === 3,
  `${new Set(kids.map((k) => k.x)).size} × ${new Set(kids.map((k) => k.y)).size}`)
/* Some of them stack a second effect, which is where a gate into a reverb
   comes from. Asked as a rate would flake; asked of the whole batch it is a
   fact about this batch. */
check('and a stacked pair carries both, in order',
  kids.filter((k) => k.chain.includes('+')).every((k) => k.chain.split('+').length === 2),
  kids.filter((k) => k.chain.includes('+')).map((k) => k.chain).join(' ') || 'none paired this time')

fs.writeFileSync(path.join(OUT, 'sound-twelve.png'), await page.screenshot())

/* The whole round is one press, not thirteen. A grid you cannot cheaply throw
   away is a grid nobody will risk making — and every render writes to the card,
   so this is the check that keeps twelve of those from being twelve steps. */
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await page.waitForTimeout(2500)
check('and the whole round is one press of undo', (await board()).length === 1,
  `${(await board()).length} sounds left`)

/* ---------- and it refuses what it cannot afford ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(800)
await page.evaluate(async (b64) => {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  const dt = new DataTransfer()
  dt.items.add(new File([arr], 'long.wav', { type: 'audio/wav' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 520, clientY: 400 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
}, wavBase64({ secs: 45 }))
await page.waitForSelector('.card[data-kind="audio"]', { timeout: 20000 })
await page.waitForTimeout(2000)

await page.locator('.card[data-kind="audio"]').first().click({ position: { x: 30, y: 8 } })
await page.waitForTimeout(600)
await page.keyboard.press('v')
await page.waitForTimeout(3000)
/* Twelve renders of a long track is half a gigabyte in a browser that keeps
   everything you own inside one quota. Refusing is right; refusing without
   saying what to do instead is not. */
check('a long sound is not varied twelve ways', (await board()).length === 1,
  `${(await board()).length} sounds on the board`)
const told = await page.locator('.said').textContent().catch(() => '')
check('and it says to trim it first, which is the first effect in the list',
  /trim/i.test(told), told)

/* ---------- what it sounded like before ---------- */

/* Every picture medium drops its effect while the compare key is held. A sound
   is the one where that question gets asked oftener than any other — nobody
   judges a treatment against nothing — and the only answer the board had was
   the panel's Back to the original, which takes the chain off: two presses of
   undo and a lost train of thought, which is the exact problem the compare key
   was written to solve.

   Measured on both halves of the card, because either one alone can be right
   while the other is wrong: the shape that is drawn, and the file that plays. */

await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await clear()
await page.locator('.card[data-kind="audio"]').first().click({ position: { x: 30, y: 8 } })
await page.waitForTimeout(500)
await put('Reverse', 3500)

/* The bars of the waveform, from the path the card draws. */
const bars = () =>
  page.evaluate(() => {
    const p = document.querySelector('.card[data-kind="audio"] .wave-rest')
    if (!p) return null
    const out = []
    for (const m of (p.getAttribute('d') || '').matchAll(/M[\d.]+ ([\d.]+)H[\d.]+V([\d.]+)/g)) {
      out.push(parseFloat(m[2]) - parseFloat(m[1]))
    }
    return out
  })
const heavy = (list, from, to) => {
  const cut = list.slice(Math.floor(list.length * from), Math.floor(list.length * to))
  return cut.reduce((a, b) => a + b, 0) / Math.max(1, cut.length)
}
const playing = () =>
  page.evaluate(() => document.querySelector('.card[data-kind="audio"] audio')?.src || '')

const treatedBars = await bars()
const treatedFile = await playing()
check('setup: reversed, so the card draws the loud end at the end',
  !!treatedBars && heavy(treatedBars, 0.8, 1) > heavy(treatedBars, 0, 0.2) * 1.5,
  `${heavy(treatedBars, 0, 0.2).toFixed(3)} then ${heavy(treatedBars, 0.8, 1).toFixed(3)}`)

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.down('\\')
await page.waitForTimeout(700)
const heldBars = await bars()
const heldFile = await playing()
check('holding the compare key draws the sound as it arrived',
  !!heldBars && heavy(heldBars, 0, 0.2) > heavy(heldBars, 0.8, 1) * 1.5,
  `${heavy(heldBars, 0, 0.2).toFixed(3)} at the start, ${heavy(heldBars, 0.8, 1).toFixed(3)} at the end`)
check('and puts the file it arrived as back under the player',
  !!heldFile && heldFile !== treatedFile, heldFile === treatedFile ? 'same file' : 'a different file')

await page.keyboard.up('\\')
await page.waitForTimeout(700)
const backBars = await bars()
check('and letting go gives the treatment back',
  JSON.stringify(backBars) === JSON.stringify(treatedBars),
  `${heavy(backBars, 0, 0.2).toFixed(3)} then ${heavy(backBars, 0.8, 1).toFixed(3)}`)
check('with the treated file under the player again', (await playing()) === treatedFile)

/* An untreated sound has nothing to swap, and the key must not restart it —
   which is what assigning the address it already has would do. */
await clear()
await page.waitForTimeout(800)
const plainFile = await playing()
await page.evaluate(() => {
  const el = document.querySelector('.card[data-kind="audio"] audio')
  if (el) el.currentTime = 0.9
})
await page.keyboard.down('\\')
await page.waitForTimeout(500)
const kept = await page.evaluate(() => document.querySelector('.card[data-kind="audio"] audio')?.currentTime ?? -1)
await page.keyboard.up('\\')
check('and on a sound with nothing on it the key leaves the track where it was',
  kept > 0.5 && (await playing()) === plainFile, `${kept.toFixed(2)}s`)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
