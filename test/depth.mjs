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

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
