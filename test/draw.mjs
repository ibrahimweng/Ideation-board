/* Asking for a picture that does not exist yet.
 *
 *   npm run build && node scripts/browser-tests.mjs draw
 *
 * The board has no server, so the key that pays for a generated picture is
 * held in the browser and the request goes straight out of it. Everything that
 * follows from that has to be true:
 *
 *   no key            -> the sheet asks for one, and says where it is kept
 *   a key             -> the models it can see, filtered to the ones that draw
 *   a prompt          -> a card at once, then the picture in it
 *   four prompts      -> four cards, side by side, all picked out
 *   a model that writes -> its own words back, and no empty card left behind
 *   a refused key     -> one sentence, not a stack trace
 *   an export         -> no key anywhere in the file
 *
 * The API is a server on this machine, on its own origin, speaking the shapes
 * Google's discovery document describes — including a 400 for a request field
 * a model does not support, which is the one thing the adapter has to survive
 * without anybody knowing in advance which models those are. Nothing here
 * touches the internet, and no real key is ever needed.
 */
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const BASE = process.argv[2] || 'http://localhost:5173'
const PORT = Number(process.env.AI_PORT || 5199)
const HOST = `http://127.0.0.1:${PORT}`
const API = `${HOST}/v1beta`
const KEY = 'AIzaSyFAKEKEY_ThisIsNotARealKey_000123'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

/* ---------- a real PNG, 200 by 120, written here ---------- */
const png = (w, h, rgb) => {
  function crc32(buf) {
    let c = ~0
    for (const b of buf) {
      c ^= b
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    const head = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(head))
    return Buffer.concat([len, head, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PICTURE = png(200, 120, [0x20, 0x80, 0xd0]).toString('base64')

/* ---------- the API, as the discovery document describes it ---------- */
const MODELS = [
  { name: 'models/fake-image-2.0-generate', displayName: 'Fake Image', description: 'Generates images.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/fake-imagen-1.0-generate', displayName: 'Fake Imagen', description: 'An image model.', supportedGenerationMethods: ['predict'] },
  /* Answers to predict, and its name says nothing about that. Guessing from
   * the name gets this one wrong, which is why the listing's word on it is
   * written down when it is picked rather than worked out again later. */
  { name: 'models/fake-drawing-3.0-generate', displayName: 'Fake Drawing', description: 'Generates images.', supportedGenerationMethods: ['predict'] },
  { name: 'models/fake-flash', displayName: 'Fake Flash', description: 'A fast text model.', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/fake-embed', displayName: 'Fake Embed', description: 'Embeddings.', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/fake-refuse-image', displayName: 'Fake Refuser', description: 'Generates images.', supportedGenerationMethods: ['generateContent'] },
]

/* What the browser actually asked for, so the test can check the request and
 * not just the answer. */
const seen = []

const server = http.createServer((req, res) => {
  const url = new URL(req.url, HOST)
  const head = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'x-goog-api-key, content-type',
  }
  if (req.method === 'OPTIONS') return res.writeHead(204, head).end()
  const send = (code, body) => res.writeHead(code, { ...head, 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  const bad = (code, message, status = 'INVALID_ARGUMENT') => send(code, { error: { code, message, status } })

  const key = req.headers['x-goog-api-key']
  /* The key must arrive as a header and never in the address. */
  if (url.searchParams.has('key')) return bad(400, 'The key must not be in the URL.')
  if (!key) return bad(403, "Method doesn't allow unregistered callers.", 'PERMISSION_DENIED')
  if (key === 'wrong-key') return bad(400, 'API key not valid. Please pass a valid API key.')
  if (key !== KEY) return bad(400, 'API key not valid. Please pass a valid API key.')

  if (url.pathname === '/v1beta/models' && req.method === 'GET') {
    seen.push({ path: url.pathname, key })
    return send(200, { models: MODELS })
  }

  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let json = {}
    try {
      json = JSON.parse(body || '{}')
    } catch {
      return bad(400, 'Bad JSON.')
    }
    seen.push({ path: url.pathname, key, body: json })
    const who = url.pathname.replace('/v1beta/models/', '')

    /* A real request takes seconds. Answering instantly would mean the card
     * that goes down before the picture arrives could never be seen, which is
     * the very thing worth checking. */
    const slow = (fn) => setTimeout(fn, 700)

    if (who === 'fake-image-2.0-generate:generateContent') {
      /* A model that does not take an image config, which is a 400 and not a
       * documented fact about any particular model — so the adapter has to
       * find that out by asking and then ask again without it. */
      if (json?.generationConfig?.imageConfig) return bad(400, 'imageConfig is not supported by this model.')
      return slow(() => send(200, {
        candidates: [{
          content: { role: 'model', parts: [{ text: 'Here it is.' }, { inlineData: { mimeType: 'image/png', data: PICTURE } }] },
          finishReason: 'STOP',
        }],
      }))
    }
    if (who === 'fake-drawing-3.0-generate:predict') {
      return slow(() => send(200, { predictions: [{ mimeType: 'image/png', bytesBase64Encoded: PICTURE }] }))
    }
    if (who === 'fake-imagen-1.0-generate:predict') {
      return slow(() => send(200, { predictions: [{ mimeType: 'image/png', bytesBase64Encoded: PICTURE }] }))
    }
    if (who === 'fake-flash:generateContent') {
      return send(200, {
        candidates: [{ content: { role: 'model', parts: [{ text: 'I am a text model and cannot draw.' }] }, finishReason: 'STOP' }],
      })
    }
    if (who === 'fake-refuse-image:generateContent') {
      return send(200, { promptFeedback: { blockReason: 'SAFETY' } })
    }
    return bad(404, 'No such model.', 'NOT_FOUND')
  })
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const cards = () => page.evaluate(() =>
  [...document.querySelectorAll('.card')].map((c) => {
    const img = c.querySelector('img.media')
    const r = c.getBoundingClientRect()
    return {
      kind: c.dataset.kind,
      id: c.dataset.id,
      picture: !!img,
      drawing: !!c.querySelector('.placeholder[data-drawing]'),
      x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
    }
  })
)

/* Away from the middle: an empty board puts its first-run panel there, and a
 * click that lands on one of its buttons is a card nobody asked for. */
const openSheet = async () => {
  await page.locator('.viewport').click({ position: { x: 90, y: 780 } })
  await page.keyboard.press('d')
  await page.waitForSelector('.gen-sheet', { timeout: 4000 })
}

/* ---------- with no key at all ---------- */
await openSheet()
ok('with no key the sheet says where a key is kept',
   /this browser only/i.test(await page.locator('.gen-intro').innerText()))
ok('and opens on the place to put one', (await page.locator('.gen-settings input[type="password"]').count()) === 1)
ok('and there is nothing to draw with yet', (await page.locator('.gen-prompt').count()) === 0)
fs.writeFileSync(path.join(OUT, 'draw-nokey.png'), await page.screenshot())

/* ---------- a key, and an address of our own ---------- */
const addressField = page.locator('.gen-settings label', { hasText: 'Address' }).locator('input')
await addressField.fill(API)
await page.locator('.gen-settings input[type="password"]').fill('wrong-key')
await page.locator('.gen-settings label', { hasText: 'Key' }).locator('button', { hasText: 'Save' }).click()
await page.waitForTimeout(900)
ok('a key that is refused says so in a sentence',
   /not accepted|refused/i.test(await page.locator('.gen-warn').innerText()),
   await page.locator('.gen-warn').innerText().catch(() => 'nothing'))

await page.locator('.gen-settings input[type="password"]').fill(KEY)
await page.locator('.gen-settings label', { hasText: 'Key' }).locator('button', { hasText: 'Save' }).click()
await page.waitForTimeout(900)

const offered = await page.locator('ul.gen-models button').allInnerTexts()
ok('a working key lists the models that can draw',
   offered.includes('fake-image-2.0-generate') && offered.includes('fake-imagen-1.0-generate'), JSON.stringify(offered))
ok('and leaves out the ones that only write or count',
   !offered.includes('fake-flash') && !offered.includes('fake-embed'), JSON.stringify(offered))
ok('the key travelled as a header, never in the address',
   seen.length > 0 && seen.every((s) => s.key === KEY))
ok('a model is chosen for you so a key and a prompt is enough',
   (await page.locator('.gen-settings label', { hasText: 'Model' }).locator('input').inputValue()).length > 0)

/* ---------- one prompt ---------- */
await page.locator('ul.gen-models button', { hasText: 'fake-image-2.0-generate' }).click()
await page.locator('.gen-prompt').fill('a cracked terracotta pot on a windowsill')
await page.locator('.gen-row', { hasText: 'Shape' }).locator('button', { hasText: 'Wide' }).click()
await page.locator('.sheet-actions button', { hasText: 'Draw' }).click()

/* The card is down before the picture is, which is the difference between a
 * ten second wait and a request that looks like it failed. */
await page.waitForSelector('.placeholder[data-drawing]', { timeout: 3000 })
const mid = await cards()
ok('a card is on the board before the picture arrives',
   mid.length === 1 && mid[0].drawing && !mid[0].picture, JSON.stringify(mid))
ok('and it is already the shape that was asked for',
   mid[0] && Math.abs(mid[0].w / mid[0].h - 16 / 9) < 0.05, mid[0] ? `${mid[0].w}x${mid[0].h}` : 'no card')

await page.waitForSelector('.card img.media', { timeout: 15000 })
await page.waitForTimeout(700)
let list = await cards()
ok('then the picture is in it', list.length === 1 && list[0].picture && !list[0].drawing, JSON.stringify(list))
ok('and the card takes the shape of the picture that came back, not the one asked for',
   list[0] && Math.abs(list[0].w / list[0].h - 200 / 120) < 0.06,
   list[0] ? `${list[0].w}x${list[0].h} for a 200x120 picture` : 'no card')

/* The step-down: asked with the image config, refused, asked again without. */
const tries = seen.filter((s) => s.path.endsWith('fake-image-2.0-generate:generateContent'))
ok('a field the model will not take is dropped and the request asked again',
   tries.length === 2 && !!tries[0].body?.generationConfig?.imageConfig && !tries[1].body?.generationConfig?.imageConfig,
   JSON.stringify(tries.map((t) => !!t.body?.generationConfig?.imageConfig)))

/* The prompt stays on the card, so the board still says what was asked for. */
await page.keyboard.press('/')
await page.keyboard.type('terracotta')
await page.waitForTimeout(700)
ok('the prompt is kept, so the search box finds the picture by it',
   (await page.locator('.card[data-dim="true"]').count()) === 0 && (await page.locator('.card').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
fs.writeFileSync(path.join(OUT, 'draw-one.png'), await page.screenshot())

/* ---------- the other family of model ---------- */
await openSheet()
await page.locator('.gen-more').click()
await page.waitForSelector('ul.gen-models button', { timeout: 6000 })
ok('opening the sheet again already knows the models', true)
await page.locator('ul.gen-models button', { hasText: 'fake-imagen-1.0-generate' }).click()
await page.locator('.gen-prompt').fill('the same pot, at night')
await page.locator('.sheet-actions button', { hasText: 'Draw' }).click()
await page.waitForTimeout(4000)
list = await cards()
ok('a model that answers to predict rather than generateContent works the same',
   list.length === 2 && list.every((c) => c.picture), JSON.stringify(list.map((c) => c.picture)))
const pred = seen.find((s) => s.path.endsWith('fake-imagen-1.0-generate:predict'))
ok('and was asked in the shape that family takes',
   !!pred && pred.body?.instances?.[0]?.prompt === 'the same pot, at night', JSON.stringify(pred?.body || null))

/* ---------- four at once ---------- */
await openSheet()
await page.locator('.gen-more').click()
await page.waitForSelector('ul.gen-models button', { timeout: 6000 })
await page.locator('ul.gen-models button', { hasText: 'fake-image-2.0-generate' }).click()
await page.locator('.gen-prompt').fill('four ways to light a pot')
await page.locator('.gen-row', { hasText: 'How many' }).locator('button', { hasText: '4' }).click()
await page.locator('.sheet-actions button', { hasText: 'Draw 4' }).click()
await page.waitForTimeout(6000)
list = await cards()
const four = list.slice(-4)
ok('four asked for is four cards', list.length === 6, `${list.length} cards`)
ok('and every one of them has a picture in it', four.every((c) => c.picture), JSON.stringify(four.map((c) => c.picture)))
ok('laid out in a row, not on top of each other',
   new Set(four.map((c) => c.x)).size === 4, JSON.stringify(four.map((c) => c.x)))
ok('and all four are picked out, so comparing them is one key away',
   (await page.locator('.card[data-sel="true"]').count()) === 4,
   `${await page.locator('.card[data-sel="true"]').count()} selected`)
fs.writeFileSync(path.join(OUT, 'draw-four.png'), await page.screenshot())

/* ---------- a model that writes rather than draws ---------- */
const before = (await cards()).length
await openSheet()
await page.locator('.gen-more').click()
await page.waitForTimeout(300)
await page.locator('.gen-settings label', { hasText: 'Model' }).locator('input').fill('fake-flash')
await page.locator('.gen-row', { hasText: 'How many' }).locator('button', { hasText: '1' }).click()
await page.locator('.gen-prompt').fill('a pot')
await page.locator('.sheet-actions button', { hasText: 'Draw' }).click()
await page.waitForSelector('.toast', { timeout: 8000 })
await page.waitForTimeout(1200)
const said = await page.locator('.toast').innerText().catch(() => '')
ok('a model that writes hands back its own words rather than a shrug',
   /cannot draw/i.test(said), said || 'nothing said')
ok('and leaves no empty card behind', (await cards()).length === before, `${(await cards()).length} cards, was ${before}`)

/* A card put down for a picture that never came is not a thing you did, so it
 * has no business in the history. Recorded, its arrival and its removal would
 * sit there as two steps that cancel out, and the next press of undo would
 * hand the empty card back. */
await page.locator('.viewport').click({ position: { x: 90, y: 780 } })
await page.keyboard.press('Control+z')
await page.waitForTimeout(700)
const afterUndo = await cards()
ok('and undo does not bring the empty card back from the dead',
   afterUndo.length <= before && !afterUndo.some((c) => c.kind === 'image' && !c.picture),
   `${afterUndo.length} cards, ${afterUndo.filter((c) => !c.picture).length} without a picture`)
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(700)

/* ---------- a prompt that is refused ---------- */
await openSheet()
await page.locator('.gen-more').click()
await page.waitForTimeout(300)
await page.locator('.gen-settings label', { hasText: 'Model' }).locator('input').fill('fake-refuse-image')
await page.locator('.gen-prompt').fill('something it will not do')
await page.locator('.sheet-actions button', { hasText: 'Draw' }).click()
await page.waitForSelector('.toast', { timeout: 8000 })
await page.waitForTimeout(1000)
ok('a refused prompt says it was refused, and why',
   /refused/i.test(await page.locator('.toast').innerText().catch(() => '')),
   await page.locator('.toast').innerText().catch(() => 'nothing'))

/* ---------- it survives a reload, so the picture is really held here ------- */
await page.waitForTimeout(1400)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2600)
list = await cards()
ok('every generated picture is still there after a reload',
   list.length === 6 && list.every((c) => c.picture), JSON.stringify(list.map((c) => c.picture)))

/* ---------- a model whose name does not say how to ask it ---------- */
await openSheet()
await page.locator('.gen-more').click()
await page.waitForSelector('ul.gen-models button', { timeout: 6000 })
await page.locator('ul.gen-models button', { hasText: 'fake-drawing-3.0-generate' }).click()
/* Reloaded in between, so nothing is left in memory to remember it by: the
 * only thing that can get this right is what was written down when it was
 * picked out of the list. */
await page.keyboard.press('Escape')
await page.locator('.sheet-actions button', { hasText: 'Close' }).click({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(500)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2200)
await openSheet()
await page.locator('.gen-prompt').fill('a pot, by a model with an unhelpful name')
await page.locator('.sheet-actions button', { hasText: 'Draw' }).click()
await page.waitForTimeout(4500)
ok('a model that answers to predict but is not named for it is still asked correctly',
   seen.some((s) => s.path.endsWith('fake-drawing-3.0-generate:predict')) &&
   !seen.some((s) => s.path.endsWith('fake-drawing-3.0-generate:generateContent')),
   JSON.stringify(seen.filter((s) => s.path.includes('fake-drawing')).map((s) => s.path)))
ok('and its picture is on the board like any other', (await cards()).length === 7, `${(await cards()).length} cards`)

/* ---------- and the key is in none of it ---------- */
const stored = await page.evaluate(() => {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    out[k] = localStorage.getItem(k)
  }
  return out
})
const carriers = Object.entries(stored).filter(([, v]) => (v || '').includes(KEY)).map(([k]) => k)
ok('the key is in local storage under its own name and nowhere else',
   carriers.length === 1 && carriers[0] === 'ideation.ai.key', JSON.stringify(carriers))

const record = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('ideation.board.db')
  req.onsuccess = () => {
    const db = req.result
    const tx = db.transaction('boards', 'readonly')
    const all = tx.objectStore('boards').getAll()
    all.onsuccess = () => resolve(JSON.stringify(all.result))
    all.onerror = () => resolve('')
  }
  req.onerror = () => resolve('')
}))
ok('and in none of the boards this browser holds', record.length > 0 && !record.includes(KEY),
   record.length ? 'checked' : 'could not read the boards')

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button[aria-label="Export"], button[title^="Export board"]').first().click(),
])
const file = path.join(OUT, download.suggestedFilename())
await download.saveAs(file)
const inZip = execFileSync('python3', [
  '-c',
  'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nk=sys.argv[2].encode()\nprint(",".join(n for n in z.namelist() if k in z.read(n)) or "none")',
  file, KEY,
]).toString().trim()
ok('and in no part of an exported board file', inZip === 'none', inZip)

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
server.close()
process.exit(failed.length || errors.length ? 1 : 0)
