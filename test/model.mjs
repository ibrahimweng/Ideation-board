/* A model on the board.
 *
 *   npm run build && npm run test:browser -- model
 *   node test/model.mjs http://localhost:4173
 *
 * A .glb used to arrive as a grey card with three letters on it, which on a
 * board about looking at things is the wrong answer for the file a product
 * designer works in all day. Now it is a picture of itself with the file kept
 * beside it, which is the shape a PDF and a Photoshop document already have —
 * so everything downstream works with no special case at all.
 *
 * Four things are worth proving, and none of them can be proved by counting
 * cards:
 *
 *   - it really rendered, and rendered both materials;
 *   - the camera really moved, which is the only way to know the turn is a
 *     turn and not a CSS rotation of one picture;
 *   - the materials and UV sets were read off the file rather than guessed at;
 *   - and it goes back out as a model, wearing what it was given.
 *
 * The fixture is built for those: two boxes side by side in two named
 * materials, one warm and one cool. Which one is on the left is a fact about
 * where the camera is standing, so turning it half way round has to swap them
 * — and a picture handed to one of them has to change that one and not the
 * other.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { makeGltf } from './fixtures/gltf.mjs'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
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

/* ---------- dropping one ---------- */

const dropFile = (bytes, name, type, at = { x: 620, y: 430 }) =>
  page.evaluate(
    async ({ data, name, type, at }) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(data)], name, { type }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { data: [...bytes], name, type, at }
  )

await dropFile(makeGltf({ textured: true }), 'lockup.gltf', 'model/gltf+json')
await page.waitForSelector('.card[data-kind="model"]', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2500)

check('a model becomes a card with a picture of itself on it',
  (await page.locator('.card[data-kind="model"]').count()) === 1)
check('and not a grey rectangle with three letters on it',
  (await page.locator('.card[data-kind="file"]').count()) === 0)

/* The average colour of a patch of the card's picture, over the pixels that
 * are actually the model: the background is transparent, and counting it would
 * wash every reading towards nothing. */
const patch = (x0, x1, y0, y1) =>
  page.evaluate(
    ({ x0, x1, y0, y1 }) => {
      const el = document.querySelector('.card[data-kind="model"] img.media, .card[data-kind="model"] canvas.media')
      if (!el) return null
      const W = 120
      const H = 120
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const cx = c.getContext('2d', { willReadFrequently: true })
      cx.clearRect(0, 0, W, H)
      cx.drawImage(el, 0, 0, W, H)
      const d = cx.getImageData(
        Math.floor(W * x0), Math.floor(H * y0),
        Math.max(1, Math.floor(W * (x1 - x0))), Math.max(1, Math.floor(H * (y1 - y0)))
      ).data
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++
      }
      if (!n) return { r: 0, g: 0, b: 0, n: 0, w: el.naturalWidth || el.width }
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), n, w: el.naturalWidth || el.width }
    },
    { x0, x1, y0, y1 }
  )

/* Warm minus cool. Positive is the orange box, negative is the blue one. */
const heat = (p) => (p && p.n > 40 ? p.r - p.b : null)

const halves = async () => ({
  left: heat(await patch(0.04, 0.44, 0.3, 0.7)),
  right: heat(await patch(0.56, 0.96, 0.3, 0.7)),
})

const first = await patch(0.02, 0.98, 0.02, 0.98)
check('the picture is a real render, not an empty frame', !!first && first.n > 2000,
  first ? `${first.n} pixels of model, ${first.w}px square` : 'no picture')
check('at the size the rest of the app decodes to', first?.w === 1024, `${first?.w}px`)

const shot0 = await halves()
check('both materials are on it, one warm and one cool',
  shot0.left !== null && shot0.right !== null && Math.sign(shot0.left) !== Math.sign(shot0.right),
  JSON.stringify(shot0))

fs.writeFileSync(path.join(OUT, 'model-dropped.png'), await page.screenshot())

/* ---------- what it read out of the file ---------- */

const saved = () =>
  page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('ideation.board.db')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const read = (storeName, key) =>
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
    const items = all.flatMap((b) => b.items || [])
    const it = items.find((i) => i.kind === 'model')
    if (!it) return null
    const file = await read('blobs', it.media)
    const wornKey = it.skins ? Object.values(it.skins)[0] : null
    const worn = wornKey ? await read('blobs', wornKey) : null
    return {
      parts: it.parts,
      stage: it.stage,
      skins: it.skins || null,
      /* Whether the picture a material is wearing is really there, which is a
         different question from whether the card remembers its name. */
      wornBytes: worn?.size || 0,
      hasPoster: !!it.poster,
      fileSize: file?.size || 0,
    }
  })

const read0 = await saved()
check('the materials the file declares are read off it, in order',
  JSON.stringify((read0?.parts || []).map((p) => p.name)) === '["Shell","Trim"]',
  JSON.stringify(read0?.parts))
check('with the UV set each one reads, because the file says so',
  (read0?.parts || []).every((p) => JSON.stringify(p.uv) === '[0]'),
  JSON.stringify((read0?.parts || []).map((p) => p.uv)))
/* The fixture gives Shell a real colour map and leaves Trim flat, so "what is
   this material textured with" has two different right answers to find. */
check('and what each is textured with, where it is textured at all',
  JSON.stringify((read0?.parts || []).map((p) => p.maps)) === '[["colour"],[]]',
  JSON.stringify((read0?.parts || []).map((p) => p.maps)))
check('the model file itself is kept, not thrown away once the picture was made',
  (read0?.fileSize || 0) > 400, `${read0?.fileSize} bytes`)
check('with the view stored beside it', read0?.hasPoster === true)

/* ---------- turning it ---------- */

const card = await page.locator('.card[data-kind="model"]').boundingBox()
const mid = { x: card.x + card.width / 2, y: card.y + card.height / 2 }

await page.mouse.move(mid.x, mid.y)
await page.keyboard.down('Alt')
await page.mouse.down()
/* 0.55 degrees a pixel, so this is a little over half a turn. */
await page.mouse.move(mid.x + 330, mid.y, { steps: 22 })
await page.mouse.up()
await page.keyboard.up('Alt')
await page.waitForTimeout(4000)

const turnedStage = (await saved())?.stage
check('Alt-dragging turns the model', Math.abs((turnedStage?.yaw ?? 35) - 35) > 100,
  JSON.stringify(turnedStage))

const shot1 = await halves()
check('and the camera really moved: the two materials have swapped sides',
  shot1.left !== null && shot1.right !== null &&
  Math.sign(shot1.left) === Math.sign(shot0.right) && Math.sign(shot1.right) === Math.sign(shot0.left),
  `${JSON.stringify(shot0)} then ${JSON.stringify(shot1)}`)

fs.writeFileSync(path.join(OUT, 'model-turned.png'), await page.screenshot())

/* One press of undo, for the whole turn. */
await page.keyboard.press('Control+z')
await page.waitForTimeout(2500)
const back = (await saved())?.stage
check('and the whole turn is one press of undo', Math.abs((back?.yaw ?? 0) - 35) < 1,
  JSON.stringify(back))

/* ---------- in and out ---------- */

const before = (await saved())?.stage?.dist
const view = () => page.evaluate(() => document.querySelector('.surface')?.style?.transform || '')
const view0 = await view()
await page.mouse.move(mid.x, mid.y)
await page.keyboard.down('Alt')
await page.mouse.wheel(0, -400)
await page.keyboard.up('Alt')
await page.waitForTimeout(2500)
const after = (await saved())?.stage?.dist
check('Alt-scrolling moves the camera in and out', after !== before && after > 0,
  `${before} then ${after}`)
/* The wheel was taken by the card. Without that it would have panned the board
   under the model, which is the same gesture doing two things at once. */
check('and the board did not move underneath it', (await view()) === view0,
  `${view0} then ${await view()}`)

/* ---------- the panel says what it is made of ---------- */

await page.locator('.card[data-kind="model"]').click()
await page.waitForTimeout(500)
if (!(await page.locator('.panel').count())) {
  await page.locator('.tool-mode').click()
  await page.waitForTimeout(600)
}
await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
await page.waitForTimeout(600)

check('the panel lists the materials', (await page.locator('.part').count()) === 2,
  `${await page.locator('.part').count()} rows`)
const rowText = await page.locator('.part').first().innerText()
check('by name', /Shell/.test(rowText), rowText.replace(/\n/g, ' / '))
const trimText = await page.locator('.part').nth(1).innerText()
check('and says what each is textured with and which UVs it reads',
  /colour/.test(rowText) && /UV 0/.test(rowText) && /no textures/.test(trimText),
  `${rowText.replace(/\n/g, ' / ')}  |  ${trimText.replace(/\n/g, ' / ')}`)
check('there is nothing to wear until a card is wired in',
  await page.locator('.part').first().locator('button', { hasText: /Wear|Again/ }).isDisabled())
/* And nothing to treat until an effect is chosen, which is the other half of
   the same row and a different reason to be disabled. */
check('and nothing to treat until an effect is chosen',
  await page.locator('.part').first().locator('button', { hasText: 'Treat' }).isDisabled())

/* ---------- wearing a card ---------- */

await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 400
  const x = c.getContext('2d')
  x.fillStyle = '#00d000'
  x.fillRect(0, 0, 400, 400)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'green.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 1120, clientY: 430 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForTimeout(2500)

const ids = await page.evaluate(() =>
  [...document.querySelectorAll('.card')].map((c) => ({ id: c.dataset.id, kind: c.dataset.kind })))
const green = ids.find((i) => i.kind === 'image')?.id
const solid = ids.find((i) => i.kind === 'model')?.id

const portOf = (id) =>
  page.evaluate((cid) => {
    const el = document.querySelector(`.card[data-id="${cid}"]`)
    const layer = el?.nextElementSibling
    const dot = layer?.querySelector?.('.port-w') || layer?.querySelector?.('.port-e')
    return dot ? dot.getBoundingClientRect().toJSON() : null
  }, id)

const gbox = await page.locator(`.card[data-id="${green}"]`).boundingBox()
await page.mouse.move(gbox.x + gbox.width / 2, gbox.y + gbox.height / 2)
await page.waitForTimeout(400)
const port = await portOf(green)
check('the picture offers a port to wire from', !!port)
const onto = await page.locator(`.card[data-id="${solid}"]`).boundingBox()
await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2)
await page.mouse.down()
await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(1500)

await page.locator(`.card[data-id="${solid}"]`).click()
await page.waitForTimeout(600)
if (!(await page.locator('.part').count())) {
  await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
  await page.waitForTimeout(500)
}
check('and now the materials can be handed it',
  !(await page.locator('.part').first().locator('button', { hasText: /Wear|Again/ }).isDisabled()))

const worn0 = await halves()
await page.locator('.part').first().locator('button', { hasText: /Wear|Again/ }).click()
await page.waitForTimeout(4000)

const worn1 = await halves()
const read1 = await saved()
check('the model comes back wearing it', !!read1?.skins?.Shell, JSON.stringify(read1?.skins))
check('on the material it was given to, and not the other one',
  worn1.left !== null && worn1.right !== null &&
  (Math.abs(worn1.left - worn0.left) > 40) !== (Math.abs(worn1.right - worn0.right) > 40),
  `${JSON.stringify(worn0)} then ${JSON.stringify(worn1)}`)

fs.writeFileSync(path.join(OUT, 'model-worn.png'), await page.screenshot())

/* ---------- and out again as a model ---------- */

const palette = async (text) => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.locator('.cmd-input').fill(text)
  await page.waitForTimeout(400)
  return page.locator('.cmd-row').first()
}

const [got] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  (await palette('glb')).click(),
])
const file = path.join(OUT, `model-${got.suggestedFilename()}`)
await got.saveAs(file)
await page.waitForTimeout(600)

const bytes = fs.readFileSync(file)
check('it exports as a model, not only as a picture of one',
  got.suggestedFilename().endsWith('.glb'), got.suggestedFilename())
check('and what comes out is really a glTF binary',
  bytes.slice(0, 4).toString('utf8') === 'glTF', bytes.slice(0, 4).toString('utf8'))

/* Read the JSON chunk back: header is twelve bytes, then a length and a type
 * for each chunk. If the material names and the picture are not in there, the
 * export is a model of something else. */
const json = (() => {
  try {
    const len = bytes.readUInt32LE(12)
    return JSON.parse(bytes.slice(20, 20 + len).toString('utf8'))
  } catch {
    return null
  }
})()
check('carrying the materials it came in with',
  JSON.stringify((json?.materials || []).map((m) => m.name).sort()) === '["Shell","Trim"]',
  JSON.stringify((json?.materials || []).map((m) => m.name)))
check('and the picture that was put on one of them, inside the file',
  (json?.images || []).length === 1 && (json?.textures || []).length === 1,
  `${(json?.images || []).length} images`)

/* ---------- it is a picture like any other ---------- */

await page.locator(`.card[data-id="${solid}"]`).click()
await page.waitForTimeout(400)
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.waitForTimeout(700)
const halftone = page.locator('.fx-thumb', { hasText: 'Halftone' }).first()
if (await halftone.count()) {
  await halftone.click()
  await page.waitForTimeout(2500)
}
check('every effect works on it, because it is a picture',
  (await page.locator(`.card[data-id="${solid}"] canvas.media`).count()) === 1)

/* Full screen, where four places used to write out a list of the kinds that
   have a picture and every one of them would have left this one out. */
await page.locator(`.card[data-id="${solid}"]`).dblclick()
await page.waitForTimeout(1200)
check('and it shows full screen like any other picture',
  (await page.locator('.present-stage img, .present-stage canvas').count()) > 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(600)

/* ---------- what the material is actually wearing ---------- */

/* The skin as bytes, rather than as a patch of the lit render. The model's own
   base colour multiplies whatever texture it is given, so reading the card
   tells you a colour changed and not which colour it changed to. This reads
   the file the material was handed. */
const skin = () =>
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
    const it = all.flatMap((b) => b.items || []).find((i) => i.kind === 'model')
    const key = it?.skins?.Shell
    if (!key) return null
    const blob = await get('blobs', key)
    if (!blob) return null
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = 24
    c.height = 24
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.drawImage(bmp, 0, 0, 24, 24)
    const d = cx.getImageData(0, 0, 24, 24).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
    const n = d.length / 4
    return { key, r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), w: bmp.width, type: blob.type }
  })

const plain = await skin()
check('the material is handed a picture of the card, not a pointer at its file',
  !!plain && plain.key.startsWith('skn'), JSON.stringify(plain))
check('and that picture is the green one that was wired in',
  !!plain && plain.g > plain.r + 60 && plain.g > plain.b + 60, JSON.stringify(plain))
check('at a size worth putting on a model', !!plain && plain.w >= 256, `${plain?.w}px`)

/* Now change the card and hand it over again. A card on this board is a
   photograph plus what has been done to it, and the whole point of putting one
   on a material is to see the treatment on the thing. */
await page.locator(`.card[data-id="${green}"]`).click()
await page.waitForTimeout(500)
await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
await page.waitForTimeout(500)
const sat = page.locator('.ctl').filter({ hasText: 'Saturation' }).locator('.ctl-num')
await sat.fill('0')
await sat.press('Enter')
await page.waitForTimeout(1200)

await page.locator(`.card[data-id="${solid}"]`).click()
await page.waitForTimeout(700)
if (!(await page.locator('.part').count())) {
  await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
  await page.waitForTimeout(500)
}
await page.locator('.part').first().locator('button', { hasText: /Wear|Again/ }).click()
await page.waitForTimeout(4000)

const treated = await skin()
check('a card taken to greyscale is worn in greyscale',
  !!treated && Math.abs(treated.r - treated.g) < 14 && Math.abs(treated.g - treated.b) < 14,
  JSON.stringify(treated))
check('which is a different picture from the one before it',
  !!treated && !!plain && treated.key !== plain.key, `${plain?.key} then ${treated?.key}`)

/* ---------- the texture it came with, treated ---------- */

/* The other half of "add effects to those": a model that arrives with a colour
   map has a picture inside it, and until this the only thing that could be
   done to that picture was to throw it away and put another one there.

   This is also the check the old fixture could not have made. It had no
   textures at all, so every check about materials passed for want of anything
   to fail on. */
await page.locator('.part').first().locator('button', { hasText: 'Take off' }).click()
await page.waitForTimeout(3500)
check('starting again from the texture the model came with', !(await saved())?.skins)

const beforeTreat = await skin()
check('with nothing worn, there is no skin file at all', beforeTreat === null)

/* Choose an effect on the card, exactly as on any other card, then say "that,
   on this material". */
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.waitForTimeout(700)
await page.locator('.fx-thumb', { hasText: 'Threshold' }).first().click()
await page.waitForTimeout(2200)
await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
await page.waitForTimeout(700)

check('and now there is something to treat it with',
  !(await page.locator('.part').first().locator('button', { hasText: 'Treat' }).isDisabled()))
await page.locator('.part').first().locator('button', { hasText: 'Treat' }).click()
await page.waitForTimeout(4500)

const treatedSkin = await skin()
check('the texture the model came with can be run through an effect',
  !!treatedSkin && treatedSkin.key.startsWith('skn'), JSON.stringify(treatedSkin))
/* The fixture texture is four flat colours. Threshold turns it to black and
   white, so what comes back has to have lost its colour. */
check('and what comes back is the effect, not the texture',
  !!treatedSkin &&
    Math.abs(treatedSkin.r - treatedSkin.g) < 30 && Math.abs(treatedSkin.g - treatedSkin.b) < 30,
  JSON.stringify(treatedSkin))

fs.writeFileSync(path.join(OUT, 'model-treated.png'), await page.screenshot())

/* A material with no texture has nothing to treat, and says so rather than
   offering a button that would do nothing. */
check('a material with no texture of its own is not offered it',
  (await page.locator('.part').nth(1).locator('button', { hasText: 'Treat' }).count()) === 0)

/* Back to a worn card for the trip out of the browser below. */
await page.locator('.panel-tabs button', { hasText: 'Effect' }).click()
await page.waitForTimeout(600)
await page.locator('.fx-thumb', { hasText: 'Original' }).first().click()
await page.waitForTimeout(1500)
await page.locator('.panel-tabs button', { hasText: 'Adjust' }).click()
await page.waitForTimeout(700)
await page.locator('.part').first().locator('button', { hasText: /Wear|Again/ }).click()
await page.waitForTimeout(4000)

/* ---------- and taken off again ---------- */

await page.locator('.part').first().locator('button', { hasText: 'Take off' }).click()
await page.waitForTimeout(3500)
check('and it can be taken off again', !(await saved())?.skins, JSON.stringify((await saved())?.skins))

/* Back on, for the trip out of the browser below. */
await page.locator('.part').first().locator('button', { hasText: /Wear|Again/ }).click()
await page.waitForTimeout(3500)

/* ---------- out of this browser and back into it ---------- */

/* The picture a material is wearing is held by address rather than by card, so
   a board that leaves has to take that file with it and rename it on the way
   back in — or the model returns undressed the first time it is turned. */
const [zipped] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.keyboard.press('Control+s'),
])
const zipFile = path.join(OUT, `model-${zipped.suggestedFilename()}`)
await zipped.saveAs(zipFile)
await page.waitForTimeout(800)
const worn = await saved()
check('a board with a dressed model exports', fs.statSync(zipFile).size > 2000,
  `${fs.statSync(zipFile).size} bytes`)

await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
await page.evaluate(
  ({ data, name }) => {
    const bin = atob(data)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([arr], name, { type: 'application/zip' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  },
  { data: fs.readFileSync(zipFile).toString('base64'), name: path.basename(zipFile) }
)
await page.waitForSelector('.card[data-kind="board"]', { timeout: 20000 })
await page.waitForTimeout(2500)

const came = await saved()
check('and comes back still wearing what it was given',
  !!came?.skins && Object.keys(came.skins).length === 1, JSON.stringify(came?.skins))
check('with the picture itself, renamed like everything else in the file',
  (came?.wornBytes || 0) > 0 && came.skins.Shell !== worn?.skins?.Shell,
  `${came?.wornBytes} bytes, ${worn?.skins?.Shell} then ${came?.skins?.Shell}`)

/* Back to the board that was made here, for the last of the checks. */
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
await dropFile(makeGltf({ textured: true }), 'lockup.gltf', 'model/gltf+json')
await page.waitForSelector('.card[data-kind="model"]', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2500)

/* ---------- coming back ---------- */

const wasStage = (await saved())?.stage
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="model"]', { timeout: 20000 })
await page.waitForTimeout(2500)
check('a model comes back after a reload', (await page.locator('.card[data-kind="model"]').count()) === 1)
const nowStage = (await saved())?.stage
check('showing what it was left showing',
  !!nowStage && Math.abs(nowStage.yaw - wasStage.yaw) < 1 && Math.abs(nowStage.dist - wasStage.dist) < 0.01,
  `${JSON.stringify(wasStage)} then ${JSON.stringify(nowStage)}`)

/* ---------- twelve of it ---------- */

/* Pressing V on a model gave twelve treatments of one camera angle, because a
   model card has pixels and pixels get the picture dice. The thing worth
   having twelve of is the model, seen from twelve places — so the dice it gets
   now are the camera's.

   Three things make that true rather than merely different: twelve real
   renders, twelve angles that go round the object instead of landing wherever
   randomness put them, and twelve pictures that are not the same picture. */

const models = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open('ideation.board.db')
      r.onsuccess = () => res(r.result)
    })
    const all = await new Promise((res) => {
      const t = db.transaction('boards', 'readonly')
      const r = t.objectStore('boards').getAll()
      r.onsuccess = () => res(r.result || [])
      r.onerror = () => res([])
    })
    return all
      .flatMap((b) => b.items || [])
      .filter((i) => i.kind === 'model')
      .map((i) => ({ id: i.id, stage: i.stage, poster: i.poster }))
  })

const [SOURCE] = await models()
await page.locator(`.card[data-id="${SOURCE.id}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
await page.keyboard.press('v')

/* Twelve three.js renders on a software rasteriser take as long as they take,
   so this waits for the work rather than for a number of seconds. */
let shot = []
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000)
  shot = (await models()).filter((m) => m.id !== SOURCE.id)
  if (shot.length === 12 && shot.every((m) => m.poster && m.poster !== SOURCE.poster)) break
}
check('twelve of the model, each photographed for itself',
  shot.length === 12 && shot.every((m) => m.poster && m.poster !== SOURCE.poster),
  `${shot.length} cards, ${shot.filter((m) => m.poster && m.poster !== SOURCE.poster).length} rendered`)

/* Sorted round the circle, the distance from each angle to the next. Twelve
   even shares of the turn, nudged, cannot leave a gap much wider than one
   share; twelve random angles almost always do, and that gap is the half of
   the object nobody got a look at. */
const round = shot
  .map((m) => ((((m.stage.yaw - SOURCE.stage.yaw) % 360) + 360) % 360))
  .sort((a, b) => a - b)
const gaps = round.map((a, i) => (i ? a - round[i - 1] : a + 360 - round[round.length - 1]))
check('and they go round it, a share of the turn each, not wherever chance put them',
  gaps.length === 12 && gaps.every((g) => g > 8 && g < 52),
  `${Math.round(Math.min(...gaps))}° to ${Math.round(Math.max(...gaps))}° apart`)

/* Angles differing is a fact about numbers. Pictures differing is the fact
   worth having, so the renders themselves are read back and compared. */
const looks = await page.evaluate(async (keys) => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('ideation.board.db')
    r.onsuccess = () => res(r.result)
  })
  const get = (key) =>
    new Promise((res) => {
      const t = db.transaction('blobs', 'readonly')
      const r = t.objectStore('blobs').get(key)
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
    })
  const out = []
  for (const key of keys) {
    const blob = await get(key)
    if (!blob) { out.push('missing'); continue }
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.clearRect(0, 0, 16, 16)
    cx.drawImage(bmp, 0, 0, 16, 16)
    bmp.close()
    const d = cx.getImageData(0, 0, 16, 16).data
    let sig = ''
    for (let i = 0; i < d.length; i += 4) {
      sig += d[i + 3] < 128 ? '.' : String.fromCharCode(97 + ((d[i] + d[i + 1] * 2 + d[i + 2] * 3) % 26))
    }
    out.push(sig)
  }
  return out
}, shot.map((m) => m.poster))
check('and twelve different pictures, not one picture twelve times',
  new Set(looks).size === 12, `${new Set(looks).size} distinct`)

fs.writeFileSync(path.join(OUT, 'model-twelve.png'), await page.screenshot())

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await page.waitForTimeout(2500)
check('and the whole round is one press of undo',
  (await models()).length === 1, `${(await models()).length} models left`)

/* ---------- something only named like one ---------- */

await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(600)

const junk = new Uint8Array(500)
for (let i = 0; i < junk.length; i++) junk[i] = (i * 41) % 253
await dropFile(junk, 'not-really.glb', 'model/gltf-binary')
await page.waitForTimeout(3000)
check('something only named like a model becomes a file card, not an empty one',
  (await page.locator('.card[data-kind="file"]').count()) === 1)
check('and nothing pretends to be a model',
  (await page.locator('.card[data-kind="model"]').count()) === 0)

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
