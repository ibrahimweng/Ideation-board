/* Distance, out of a photograph.
 *
 *   npm run build && npm run test:browser -- depth
 *   node test/depth.mjs http://localhost:4173
 *
 * The board could already push one picture around with another — Displace has
 * read the wired card's brightness since wires meant anything. What it could
 * not make was the picture worth pushing things around with: the one map a
 * photograph is really about, which is how far away everything in it is.
 *
 * A depth map guessed from one picture is a guess, and the checks are written
 * to say so honestly. What can be proved is not "this is correct depth" but
 * three things that are true of a depth map and false of the picture it came
 * from, and that a machine can measure:
 *
 *   - it is grey, because distance has no colour;
 *   - the near half of a picture built to be near at the bottom comes out
 *     lighter than the far half, which no amount of copying the source would
 *     give you;
 *   - and the four effects that read it read it, which is checked by giving
 *     them a map with a known shape and measuring what they did.
 *
 * The fixture is a photograph in the sense that matters here: a sharp,
 * high-contrast, saturated field along the bottom and a pale, flat, washed-out
 * one along the top. Those are the three cues the map is built on, so a picture
 * that has them all pointing the same way is a picture whose answer is known in
 * advance.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

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
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const drop = (draw, name, at) =>
  page.evaluate(
    async ({ draw, name, at }) => {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = 640
      const x = c.getContext('2d')
      new Function('x', 'w', 'h', draw)(x, 640, 640)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], name, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { draw, name, at }
  )

/* A picture that recedes rather than one with a line across it.
 *
 * The ground runs from the bottom of the frame to a horizon: at your feet the
 * texture is coarse, dark and saturated, and it gets finer, paler and flatter
 * all the way up — which is what detail, haze and the ground plane all look
 * like at once. A photograph with a hard edge between near and far would prove
 * only that the map can find an edge, and a mask is not a depth map. This one
 * has an answer at every height, so the map can be asked for one. */
const SCENE = `
for(let yy=0;yy<h;yy++){
  const t=yy/h;
  const g=Math.round(200-120*t), r=Math.round(196-170*t), bl=Math.round(214-180*t);
  x.fillStyle='rgb('+r+','+g+','+bl+')';x.fillRect(0,yy,w,1);
}
for(let yy=0;yy<h;yy++){
  const t=yy/h;
  const cell=Math.max(2,Math.round(2+t*12));
  if(yy%cell!==0) continue;
  const a=0.06+t*0.9;
  for(let xx=0;xx<w;xx+=cell*2){
    x.fillStyle='rgba(8,40,14,'+a+')';x.fillRect(xx+((yy/cell)%2?cell:0),yy,cell,cell);
  }
}
`

await drop(SCENE, 'scene.png', { x: 420, y: 380 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(1500)

const cardIds = () => page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.dataset.id))
const [SCENE_ID] = await cardIds()
check('a picture to read', !!SCENE_ID, SCENE_ID)

/* ---------- the map ---------- */

await page.locator(`.card[data-id="${SCENE_ID}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('depth map')
await page.waitForTimeout(500)
await page.keyboard.press('Enter')
await page.waitForTimeout(4500)

const after = await cardIds()
const DEPTH_ID = after.find((id) => id !== SCENE_ID && !!id)
check('the command list makes a depth map and it is a card of its own',
  (await page.locator('.card[data-kind="image"]').count()) === 2, `${after.length} cards`)
check('and it is wired into the picture it came from, which is what reads it',
  (await page.locator('.wire').count()) === 1, `${await page.locator('.wire').count()} wires`)

/* Read out of storage rather than off the screen: the card on screen is the
   map with whatever the board is doing to it, and the claim is about the file. */
const mapPixels = (id) =>
  page.evaluate(async (id) => {
    const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
    const get = (key) =>
      new Promise((res) => {
        const t = db.transaction('blobs', 'readonly')
        const q = t.objectStore('blobs').get(key)
        q.onsuccess = () => res(q.result)
        q.onerror = () => res(null)
      })
    const all = await new Promise((res) => {
      const t = db.transaction('boards', 'readonly')
      const q = t.objectStore('boards').getAll()
      q.onsuccess = () => res(q.result || [])
      q.onerror = () => res([])
    })
    const it = all.flatMap((b) => b.items || []).find((i) => i.id === id)
    if (!it?.media) return null
    const blob = await get(it.media)
    if (!blob) return null
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.drawImage(bmp, 0, 0, 64, 64)
    bmp.close()
    const d = cx.getImageData(0, 0, 64, 64).data
    const band = (from, to) => {
      let sum = 0
      let n = 0
      for (let y = Math.floor(64 * from); y < Math.floor(64 * to); y++) {
        for (let xx = 0; xx < 64; xx++) {
          const i = (y * 64 + xx) * 4
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          n++
        }
      }
      return n ? sum / n : 0
    }
    let colour = 0
    let mid = 0
    for (let i = 0; i < d.length; i += 4) {
      colour += Math.max(Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2]))
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      if (l > 20 && l < 235) mid++
    }
    return {
      bands: [band(0.02, 0.2), band(0.3, 0.45), band(0.55, 0.7), band(0.8, 0.98)],
      colour: colour / (d.length / 4),
      mid: mid / (d.length / 4),
      type: blob.type,
    }
  }, id)

const map = await mapPixels(DEPTH_ID)
check('the map is a real picture in the store, not a card pointing at the original',
  !!map && map.type === 'image/png', map?.type)
/* Distance has no colour. A map that came back with the field still green in
   it would be a map that had copied the photograph. */
check('it is grey, because a distance is not a colour', !!map && map.colour < 4,
  `${map?.colour.toFixed(2)} average spread between channels`)
/* The whole claim: a picture that recedes comes back as a map that recedes,
   at every height rather than only at the ends. */
const bands = (map?.bands || []).map((b) => Math.round(b))
check('and the picture reads nearer all the way down, not only at the ends',
  bands.length === 4 && bands[0] < bands[1] && bands[1] < bands[2] && bands[2] < bands[3],
  bands.join(' → '))
/* A map of two colours is a mask, and a mask displaces everything by one of
   two amounts. Counted over the whole picture rather than in a band, because
   where the middle distances fall is a fact about the photograph. */
check('and it is a gradient rather than a mask',
  !!map && map.mid > 0.3, `${Math.round((map?.mid || 0) * 100)}% of it is neither black nor white`)
check('with a real spread between the nearest and the furthest',
  bands.length === 4 && bands[3] - bands[0] > 60, `${bands[3] - bands[0]} apart`)

fs.writeFileSync(path.join(OUT, 'depth-map.png'), await page.screenshot())

/* ---------- copied together, the copy points at the copy ---------- */

/* A map knows the picture it was made from, and knowing it by id means every
   place that copies cards has to rewrite it — the same list that rewrites a
   wire's two ends and a card's section. Copy the pair and the new map must
   read the new picture; copy the map alone and it should still reach across to
   the one that is really there. */

const depthsOn = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
    const all = await new Promise((res) => {
      const t = db.transaction('boards', 'readonly')
      const q = t.objectStore('boards').getAll()
      q.onsuccess = () => res(q.result || [])
      q.onerror = () => res([])
    })
    const items = all.flatMap((b) => b.items || [])
    const here = new Set(items.map((i) => i.id))
    return items
      .filter((i) => i.depthOf)
      .map((i) => ({ id: i.id, of: i.depthOf, real: here.has(i.depthOf) }))
  })

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('Control+a')
await page.waitForTimeout(400)
await page.keyboard.press('Control+d')
await page.waitForTimeout(1800)
const pairs = await depthsOn()
check('a map copied with its picture points at the copy, not at the original',
  pairs.length === 2 && new Set(pairs.map((p) => p.of)).size === 2 && pairs.every((p) => p.real),
  JSON.stringify(pairs))

/* And the copies go, so the rest of this reads the board it expects. */
await page.keyboard.press('Control+z')
await page.waitForTimeout(1200)
check('and undoing the copy leaves the one map that was there',
  (await depthsOn()).length === 1, `${(await depthsOn()).length} maps`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/* ---------- and the same map, worked out properly ---------- */

/* The map above is three cues and a blur, and it is wrong in one particular
   way that no weighting fixes: it reads brightness, so a dark near thing
   against a bright far one comes out backwards. A model that has seen a few
   million photographs does not have that failure — and costs a download the
   size of a film, which is why it is a second press and not the first.

   What is checked here is the half that does not need the network: that the
   map knows what it was made from, that the offer is only made on a map, and
   that when nothing can be fetched it says so, names what it could not get,
   and leaves the map that was already there alone. That last one is the whole
   safety of it — a depth map that quietly turned into noise because a download
   was cut off would be worse than no button. */

const held = (id) =>
  page.evaluate(async (id) => {
    const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
    const all = await new Promise((res) => {
      const t = db.transaction('boards', 'readonly')
      const q = t.objectStore('boards').getAll()
      q.onsuccess = () => res(q.result || [])
      q.onerror = () => res([])
    })
    const it = all.flatMap((b) => b.items || []).find((i) => i.id === id)
    return it ? { depthOf: it.depthOf || null, media: it.media || null } : null
  }, id)

const before = await held(DEPTH_ID)
check('the map remembers the picture it was made from, which is what lets it be made again',
  before?.depthOf === SCENE_ID, JSON.stringify(before?.depthOf))

/* Nothing may leave this browser. Both addresses are refused, which is the
   same thing that happens on a train. */
const asked = []
await page.route('**/*', (route) => {
  const url = route.request().url()
  if (/jsdelivr|huggingface/i.test(url)) {
    asked.push(url)
    return route.abort()
  }
  return route.continue()
})

const spoke = () => page.evaluate(() => document.querySelector('.toast span')?.textContent || '')

await page.locator(`.card[data-id="${DEPTH_ID}"]`).click()
await page.waitForTimeout(500)
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('depth map properly')
await page.waitForTimeout(600)
const offered = await page.locator('.cmd-row').first().innerText()
check('the command list offers to work it out properly, and says it is a download',
  /properly/i.test(offered) && /download/i.test(offered), offered.replace(/\n/g, ' ').slice(0, 90))
await page.keyboard.press('Enter')
await page.waitForTimeout(6000)

const said = await spoke()
check('with nothing reachable it says so, and names what it could not get',
  /could not be (loaded|fetched)/i.test(said) && /https?:\/\//.test(said), said.slice(0, 120))
const kept = await held(DEPTH_ID)
check('and the map that was already there is untouched',
  !!kept && kept.media === before?.media, `${before?.media} then ${kept?.media}`)

/* And it is greyed out on things that are not maps: a picture has no map to
   work on, and a button that would refuse is worse than one that is plainly
   not for you. */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.locator(`.card[data-id="${SCENE_ID}"]`).click({ position: { x: 30, y: 30 } })
await page.waitForTimeout(500)
const holding = await page.evaluate(() =>
  [...document.querySelectorAll('.card[data-sel]')].map((c) => c.dataset.id))
check('setup: the picture is what is selected now',
  holding.length === 1 && holding[0] === SCENE_ID, holding.join(', '))
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('depth map properly')
await page.waitForTimeout(600)
const row = page.locator('.cmd-row', { hasText: 'properly' }).first()
check('and it is offered but not pressable on a picture, which has no map to work on',
  (await row.count()) === 1 && (await row.isDisabled()),
  `${await row.count()} rows, ${(await row.count()) ? ((await row.isDisabled()) ? 'greyed out' : 'pressable') : '-'}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.unroute('**/*')



/* ---------- the four that read one ---------- */

/* A guessed map is a guess, so the effects are not checked against one. They
   get a map drawn on purpose — the top half black, the bottom half white, one
   hard seam across the middle — and a picture whose every feature is easy to
   find: a white square on black. Then what each effect did to the near half
   and to the far half are two different numbers, and the difference between
   them is the whole claim, which is that the map was read at all.

   An effect that ignored the map would do the same thing to both halves. */

/* A clean board and a view that has not moved. The section above made twelve
   hundred pixels of depth map and pulled the view about to show it, and a card
   that is on screen but two hundred pixels wide is a card whose corner cannot
   be clicked and whose port cannot be dragged from. */
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)

const SQUARE = `x.fillStyle='#000';x.fillRect(0,0,w,h);x.fillStyle='#fff';x.fillRect(w*0.3,h*0.12,w*0.4,h*0.76)`
/* Far at the top, near at the bottom, and a slope between them rather than a
   step. A step has no width for a light to fall across, and a real depth map
   is made of slopes — a wall going away, a floor coming towards you — so a map
   with one is the honest thing to ask Relight about. */
const SPLIT = `
x.fillStyle='#000';x.fillRect(0,0,w,h*0.42);
x.fillStyle='#fff';x.fillRect(0,h*0.58,w,h*0.42);
const g=x.createLinearGradient(0,h*0.42,0,h*0.58);
g.addColorStop(0,'#000');g.addColorStop(1,'#fff');
x.fillStyle=g;x.fillRect(0,h*0.42,w,h*0.16);
`

await drop(SQUARE, 'square.png', { x: 400, y: 420 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(1600)
await drop(SPLIT, 'split.png', { x: 1010, y: 420 })
await page.waitForTimeout(1800)
/* Named by where they are rather than by the order they turn up in the
   document, which is z-order and not the order they were dropped. */
const placed = await page.evaluate(() =>
  [...document.querySelectorAll('.card')]
    .map((c) => ({ id: c.dataset.id, x: c.getBoundingClientRect().x }))
    .sort((a, b) => a.x - b.x)
)
check('setup: a picture and a map to read it with', placed.length === 2,
  placed.map((c) => c.id).join(', '))
const PIC = placed[0]?.id
const MAP = placed[1]?.id

/* The map feeds the picture, which is what all four of them read along. */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const mapBox = await page.locator(`.card[data-id="${MAP}"]`).boundingBox()
const picBox = await page.locator(`.card[data-id="${PIC}"]`).boundingBox()
await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2)
await page.waitForTimeout(500)
/* The map sits to the right of the picture, so the wire leaves by its west
   side. Which port a card offers depends on where the pointer is over it. */
/* The ports are a layer beside the card rather than inside it, so the one
   that belongs to this card is found by where it is: the west port sits on the
   card's left edge, half way down. */
const port = await page.evaluate((box) => {
  for (const p of document.querySelectorAll('.port-w')) {
    const r = p.getBoundingClientRect()
    if (!r.width) continue
    if (Math.abs(r.left + 10 - box.x) < 30 && r.top > box.y && r.top < box.y + box.height) {
      return r.toJSON()
    }
  }
  return null
}, mapBox)
if (port) {
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2)
  await page.mouse.down()
  await page.mouse.move(picBox.x + picBox.width / 2, picBox.y + picBox.height / 2, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(1800)
}
check('setup: the map is wired into the picture', (await page.locator('.wire').count()) === 1,
  `${await page.locator('.wire').count()} wires, port ${port ? 'found' : 'missing'}`)

/* What the picture looks like, half by half. `bright` is where the white
   square is, `edges` counts pixels that are neither black nor white — which is
   what a blur makes and a sharp edge does not — and `air` is how far the half
   has drifted towards a colour. */
const look = () =>
  page.evaluate((id) => {
    const el = document.querySelector(`.card[data-id="${id}"] canvas.media, .card[data-id="${id}"] img.media`)
    if (!el) return null
    const N = 80
    const c = document.createElement('canvas')
    c.width = N
    c.height = N
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.drawImage(el, 0, 0, N, N)
    const d = cx.getImageData(0, 0, N, N).data
    const half = (from, to) => {
      let wx = 0
      let wn = 0
      let soft = 0
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = from; y < to; y++) {
        for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 4
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          if (l > 128) { wx += x; wn++ }
          if (l > 40 && l < 215) soft++
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++
        }
      }
      return {
        x: wn ? wx / wn : -1,
        white: wn,
        soft: soft / n,
        r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n),
      }
    }
    return { top: half(4, 30), bottom: half(50, 76) }
  }, PIC)

/* A brightness profile down the picture, taken through the middle of the white
   square so that what is measured is the subject and not the black around it.
   Relight makes a line rather than a wash, and a line is a row. */
const rows = () =>
  page.evaluate((id) => {
    const el = document.querySelector(`.card[data-id="${id}"] canvas.media, .card[data-id="${id}"] img.media`)
    if (!el) return null
    const N = 80
    const c = document.createElement('canvas')
    c.width = N
    c.height = N
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.drawImage(el, 0, 0, N, N)
    const d = cx.getImageData(0, 0, N, N).data
    const out = []
    for (let y = 0; y < N; y++) {
      let s = 0
      let n = 0
      for (let x = 32; x < 48; x++) {
        const i = (y * N + x) * 4
        s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        n++
      }
      out.push(s / n)
    }
    return out
  }, PIC)

const pick = (title) => page.locator(`.fx-thumb[title="${title}"]`).first()
const setCtl = async (label, v) => {
  const row = page.locator('.panel .ctl').filter({ hasText: label }).first()
  await row.locator('.ctl-num').fill(String(v))
  await row.locator('.ctl-num').press('Enter')
  await page.waitForTimeout(1400)
}
await page.locator(`.card[data-id="${PIC}"]`).click()
await page.waitForTimeout(500)
if (!(await page.locator('.fx-thumb').count())) {
  await page.keyboard.press('e')
  await page.waitForTimeout(900)
}
const plain = await look()
const plainRows = await rows()

/* ---- Parallax ---- */
await pick('Parallax').click()
await page.waitForTimeout(2600)
await setCtl('Focus', 0)
await setCtl('Across', 120)
const moved = await look()
/* Focus at zero means the far half does not move at all and the near half
   moves the whole way, so one edge of the square travels and the other stays
   where it was. Nothing that ignored the map could do that. */
check('Parallax moves the near half of the picture and leaves the far half',
  !!moved && !!plain &&
    Math.abs(moved.top.x - plain.top.x) < 1.5 &&
    Math.abs(moved.bottom.x - plain.bottom.x) > 2.5,
  `top ${plain?.top.x.toFixed(1)}→${moved?.top.x.toFixed(1)}, bottom ${plain?.bottom.x.toFixed(1)}→${moved?.bottom.x.toFixed(1)}`)

/* ---- Depth of field ---- */
await pick('Depth of field').click()
await page.waitForTimeout(2600)
await setCtl('Focus', 0)
await setCtl('Blur', 70)
const softened = await look()
/* Focused on the far half, so the near half goes and the far half does not.
   Counted as pixels that are neither black nor white, which is what a blurred
   edge is made of and a sharp one has almost none of. */
check('Depth of field softens the half it is not focused on and keeps the other sharp',
  !!softened && softened.bottom.soft > softened.top.soft * 1.8,
  `${(softened?.top.soft * 100).toFixed(1)}% soft in the far half, ${(softened?.bottom.soft * 100).toFixed(1)}% in the near`)

/* ---- Fog ---- */
await pick('Fog').click()
await page.waitForTimeout(2600)
await setCtl('Density', 1)
const fogged = await look()
/* Air fills the distance, so the far half lifts towards the air colour — which
   is pale and blue — and the near half is left alone. */
check('Fog puts air in the distance and none of it in the foreground',
  !!fogged && fogged.top.b > fogged.bottom.b + 25 && fogged.top.b > fogged.top.r,
  `far half rgb(${fogged?.top.r},${fogged?.top.g},${fogged?.top.b}), near rgb(${fogged?.bottom.r},${fogged?.bottom.g},${fogged?.bottom.b})`)

/* ---- Relight ---- */
await pick('Relight').click()
await page.waitForTimeout(2600)
/* From the other side, so the map's one slope turns away from the light
   rather than towards it. Facing it, the slope would be brighter than a flat
   surface — and a flat surface lit from where this starts is already about as
   bright as it began, so brighter is the half of the range with less room in
   it. Turned away is unmistakable. */
await setCtl('Light from', 135)
await setCtl('Relief', 4)
/* The map's only feature is the seam across its middle, so that is the only
   place the surface has a slope — and a slope is the only thing a light can
   catch. Everywhere else the surface is flat and faces the camera, so nothing
   happens to it: which makes the claim "changed at the seam, unchanged away
   from it" rather than "brighter", since a slope can turn towards a light or
   away from one and this one does both. */
const litRows = await rows()
const shift = (y) => Math.abs((litRows?.[y] ?? 0) - (plainRows?.[y] ?? 0))
const atSeam = Math.max(...[38, 39, 40, 41, 42].map(shift))
const away = Math.max(...[10, 18, 26, 58, 66, 74].map(shift))
check('Relight reads the map as a surface and catches the light on its one slope',
  !!litRows && !!plainRows && atSeam > away + 20,
  `${atSeam.toFixed(0)} of change at the seam, ${away.toFixed(0)} away from it`)

fs.writeFileSync(path.join(OUT, 'depth-effects.png'), await page.screenshot())

/* ---------- the weights are the app's, not a card's ---------- */

/* Everything else in this browser's store belongs to a card, and the sweep
   works on exactly that rule: anything nothing points at is a file nothing
   uses any more. The depth model is the one thing the rule is wrong about.
   Nobody dropped it and no card names it or ever could — somebody pressed a
   button and waited for twenty-five megabytes, and it is kept so the next
   press works offline. Swept away, that is a download thrown out from under
   the person who asked for it.

   Stood in for here rather than fetched, because the fetch is the one thing
   this machine cannot do. What is under test is what the store does with a
   file under that name, and that does not care what is in it. */

const MODEL_KEY = 'model_depth_anything_v2_small_q8'

const seedModel = (bytes) =>
  page.evaluate(async ({ key, bytes }) => {
    const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
    await new Promise((res, rej) => {
      const t = db.transaction('blobs', 'readwrite')
      t.objectStore('blobs').put(new Blob([new Uint8Array(bytes)]), key)
      t.oncomplete = res
      t.onerror = () => rej(t.error)
    })
  }, { key: MODEL_KEY, bytes })

const modelBytes = () =>
  page.evaluate(async (key) => {
    const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
    const blob = await new Promise((res) => {
      const t = db.transaction('blobs', 'readonly')
      const q = t.objectStore('blobs').get(key)
      q.onsuccess = () => res(q.result)
      q.onerror = () => res(null)
    })
    return blob ? blob.size : 0
  }, MODEL_KEY)

const run = async (typed) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.cmd', { timeout: 5000 })
  await page.keyboard.type(typed)
  await page.waitForTimeout(600)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
}

await seedModel(9000)
check('setup: a model in the store', (await modelBytes()) === 9000, `${await modelBytes()} bytes`)

/* The whole board is thrown away first, so every picture on it really is
   unreferenced and the sweep really does have work to do. If it kept the model
   only because it kept everything, this would prove nothing. */
await page.keyboard.press('Escape')
await page.keyboard.press('Control+a')
await page.keyboard.press('Delete')
await page.waitForTimeout(1000)
await run('clear up files')
const swept = await page.evaluate(() => document.querySelector('.toast span')?.textContent || '')
check('the sweep has work to do with the board emptied', /cleared \d+ file/i.test(swept), swept)
check('and it does not take the depth model with it',
  (await modelBytes()) === 9000, `${await modelBytes()} bytes left`)

/* Which leaves asking by name as the only way to get the room back. */
await run('let go of the downloaded depth model')
const freed = await page.evaluate(() => document.querySelector('.toast span')?.textContent || '')
check('and it can be let go of by name, which says what it cost',
  /let go of the depth model/i.test(freed) && /KB|MB|bytes/.test(freed), freed)
check('and then it really is gone', (await modelBytes()) === 0, `${await modelBytes()} bytes left`)

await run('let go of the downloaded depth model')
const twice = await page.evaluate(() => document.querySelector('.toast span')?.textContent || '')
check('and asking twice says there was nothing to let go of',
  /not been downloaded/i.test(twice), twice)

/* ---------- the model, actually run ---------- */

/* Everything above about the real model is what happens when it cannot be
   reached. This is the other half, and until now no part of it had ever run:
   the fetch, the reassembly, the picture handed to the model, the tensor
   handed back, and the map made out of it. Two addresses on the open internet
   is not a thing a test may depend on, and "it has never executed" is not a
   thing to ship either.
 
   So the two addresses are served by the test. That is the only substitution —
   the runtime is a real ES module the page really imports, the weights are
   real bytes the page really streams and keeps, and everything between them is
   the app's own code. What the fake model does is give back a ramp whose
   answer is known in advance, which is what makes the map it produces
   checkable rather than merely present.
 
   The two claims worth the most are the ones a wrong version of this would get
   plausibly wrong rather than obviously: that the picture reaches the model
   normalised the way the model was trained, in planes rather than interleaved,
   and that a larger number comes back as a lighter pixel — the same way round
   as the map made in the engine, since the two have to be interchangeable on a
   wire. A map that is inside out looks exactly like a map. */

/* The palette, without the Escape `run` starts with: everything below acts on
   what is selected, and Escape on the board clears it. */
const runOn = async (typed) => {
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.cmd', { timeout: 5000 })
  await page.keyboard.type(typed)
  await page.waitForTimeout(600)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
}

await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)

/* Red down the left, blue down the right: two flat fields whose numbers after
   ImageNet normalisation are known to three decimal places, in two channels
   that cannot be confused with each other. */
const HALVES = `x.fillStyle='#ff0000';x.fillRect(0,0,w/2,h);x.fillStyle='#0000ff';x.fillRect(w/2,0,w/2,h)`
await drop(HALVES, 'halves.png', { x: 420, y: 380 })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(1500)
const [PIC_ID] = await cardIds()

await page.locator(`.card[data-id="${PIC_ID}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
await runOn('depth map')
for (let i = 0; i < 30 && (await cardIds()).length < 2; i++) await page.waitForTimeout(400)
const twoCards = await cardIds()
const MAP_ID = twoCards.find((id) => id !== PIC_ID && !!id)
check('setup: a picture and a map made the quick way', !!MAP_ID, `${twoCards.length} cards`)
const guessed = await held(MAP_ID)

/* The output the fake model gives back: a ramp down the frame, nothing at the
   top and one at the bottom, at a size that is not the input's and not the
   card's — so the stretch back out is exercised rather than skipped. */
const WEIGHT_BYTES = 300_000
const hits = { runtime: 0, weights: 0 }

const FAKE_ORT = `
export const env = { wasm: { numThreads: 4, proxy: true } }
export class Tensor {
  constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims }
}
export const InferenceSession = {
  async create(bytes) {
    window.__ort = window.__ort || {}
    window.__ort.weights = bytes.length
    /* Weighted by position, so bytes put back in the wrong order or written
       over each other are a different number rather than the same one. */
    let sum = 0
    for (let i = 0; i < bytes.length; i++) sum = (sum + bytes[i] * ((i % 7) + 1)) >>> 0
    window.__ort.sum = sum
    window.__ort.sessions = (window.__ort.sessions || 0) + 1
    return {
      inputNames: ['pixel_values'],
      outputNames: ['predicted_depth'],
      async run(feeds) {
        const t = feeds['pixel_values']
        const S = 518, plane = S * S
        const at = (x, y) => y * S + x
        const left = at(100, 259), right = at(418, 259)
        window.__ort.dims = t.dims
        window.__ort.len = t.data.length
        window.__ort.left = [t.data[left], t.data[plane + left], t.data[plane * 2 + left]]
        window.__ort.right = [t.data[right], t.data[plane + right], t.data[plane * 2 + right]]
        window.__ort.runs = (window.__ort.runs || 0) + 1
        const R = 64
        const data = new Float32Array(R * R)
        for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) data[y * R + x] = y / (R - 1)
        return { predicted_depth: { dims: [1, R, R], data } }
      },
    }
  },
}
`

const weightBody = Buffer.alloc(WEIGHT_BYTES)
for (let i = 0; i < WEIGHT_BYTES; i++) weightBody[i] = (i * 7 + 13) & 0xff

await page.route('**/*', (route) => {
  const url = route.request().url()
  if (/cdn\.jsdelivr\.net.*ort.*\.mjs$/.test(url)) {
    hits.runtime++
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' },
      body: FAKE_ORT,
    })
  }
  if (/huggingface\.co.*\.onnx$/.test(url)) {
    hits.weights++
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' },
      body: weightBody,
    })
  }
  return route.continue()
})

await page.locator(`.card[data-id="${MAP_ID}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
await runOn('depth map properly')
await page.waitForTimeout(9000)

const spokeAfter = await page.evaluate(() => document.querySelector('.toast span')?.textContent || '')
check('the model runs when its two addresses answer',
  hits.runtime === 1 && hits.weights === 1 && (await page.evaluate(() => window.__ort?.runs || 0)) === 1,
  `runtime ${hits.runtime}, weights ${hits.weights}, runs ${await page.evaluate(() => window.__ort?.runs || 0)}${spokeAfter ? ' — ' + spokeAfter.slice(0, 40) : ''}`)

/* Twenty-five megabytes has to reach the model as the file that was served, or
   it is handed a truncated or scrambled graph. A fulfilled response arrives in
   one piece however large it is, so what the joining of several pieces does is
   checked where it can be — over the arithmetic itself, in
   test/unit/depthmodel.test.ts. */
let expectSum = 0
for (let i = 0; i < WEIGHT_BYTES; i++) expectSum = (expectSum + weightBody[i] * ((i % 7) + 1)) >>> 0
const gotSum = await page.evaluate(() => window.__ort?.sum ?? -1)
check('the weights that arrive are the weights that were served, whole and in order',
  (await page.evaluate(() => window.__ort?.weights || 0)) === WEIGHT_BYTES &&
  gotSum === expectSum && (await modelBytes()) === WEIGHT_BYTES,
  `${await page.evaluate(() => window.__ort?.weights || 0)} bytes to the model, ${await modelBytes()} kept, checksum ${gotSum === expectSum ? 'matches' : gotSum + ' vs ' + expectSum}`)

const fed = await page.evaluate(() => window.__ort || {})
check('the picture is handed over at the size the model was trained at',
  JSON.stringify(fed.dims) === JSON.stringify([1, 3, 518, 518]) && fed.len === 3 * 518 * 518,
  `${JSON.stringify(fed.dims)}, ${fed.len} numbers`)

/* Red is (1 - 0.485) / 0.229 in the first plane and nothing like it in the
   other two. Interleaved rather than planar, or the wrong mean, and every one
   of these six numbers is somewhere else. */
const near = (a, b) => Math.abs(a - b) < 0.05
check('normalised the way the model was trained, in planes rather than interleaved',
  near(fed.left[0], 2.249) && near(fed.left[1], -2.036) && near(fed.left[2], -1.804) &&
  near(fed.right[0], -2.118) && near(fed.right[1], -2.036) && near(fed.right[2], 2.640),
  `left ${fed.left?.map((n) => n.toFixed(2)).join(', ')} | right ${fed.right?.map((n) => n.toFixed(2)).join(', ')}`)

const sharp = await mapPixels(MAP_ID)
const now = await held(MAP_ID)
check('the map is replaced by the one the model made',
  !!now && now.media !== guessed?.media && !!sharp, `${guessed?.media} then ${now?.media}`)
check('and it is still grey, because a distance is still not a colour',
  !!sharp && sharp.colour < 4, `${sharp?.colour.toFixed(2)} spread`)

/* The whole of the second claim: the ramp went in increasing downwards, and
   the model gives larger for nearer, so the picture has to come out dark at
   the top and light at the bottom. Inverted, this is the check that catches it
   — and nothing else would. */
const ramp = (sharp?.bands || []).map((b) => Math.round(b))
check('larger is nearer, so the ramp comes back light at the bottom',
  ramp.length === 4 && ramp[0] < ramp[1] && ramp[1] < ramp[2] && ramp[2] < ramp[3] && ramp[3] - ramp[0] > 120,
  ramp.join(' → '))

/* Sixty-four squares in, and the card's own shape out. */
const shape = await page.evaluate(async (id) => {
  const db = await new Promise((res) => { const q = indexedDB.open('ideation.board.db'); q.onsuccess = () => res(q.result) })
  const all = await new Promise((res) => {
    const t = db.transaction('boards', 'readonly')
    const q = t.objectStore('boards').getAll()
    q.onsuccess = () => res(q.result || [])
    q.onerror = () => res([])
  })
  const it = all.flatMap((b) => b.items || []).find((i) => i.id === id)
  const blob = await new Promise((res) => {
    const t = db.transaction('blobs', 'readonly')
    const q = t.objectStore('blobs').get(it.media)
    q.onsuccess = () => res(q.result)
    q.onerror = () => res(null)
  })
  const bmp = await createImageBitmap(blob)
  const out = { w: bmp.width, h: bmp.height, nw: it.nw, nh: it.nh }
  bmp.close()
  return out
}, MAP_ID)
check('and it comes back at the map’s own size rather than the model’s',
  shape.w === shape.nw && shape.h === shape.nh && shape.w > 64,
  `${shape.w}×${shape.h}, card says ${shape.nw}×${shape.nh}`)

/* The download is once. A second map on the same board must not pay for it
   again, and with the weights kept it must not even ask. */
await page.keyboard.press('Escape')
await page.locator(`.card[data-id="${PIC_ID}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
await runOn('depth map')
for (let i = 0; i < 30 && (await cardIds()).length < 3; i++) await page.waitForTimeout(400)
const three = await cardIds()
const MAP2 = three.find((id) => id !== PIC_ID && id !== MAP_ID && !!id)
await page.locator(`.card[data-id="${MAP2}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
await runOn('depth map properly')
await page.waitForTimeout(7000)
check('a second map asks the network for nothing at all',
  hits.runtime === 1 && hits.weights === 1 &&
  (await page.evaluate(() => window.__ort?.runs || 0)) === 2 &&
  (await page.evaluate(() => window.__ort?.sessions || 0)) === 1,
  `${hits.runtime} runtime, ${hits.weights} weights, ${await page.evaluate(() => window.__ort?.sessions || 0)} session`)

await page.unroute('**/*')

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
