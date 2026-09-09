/* Twelve versions of the picture.
 *
 *   npm run build && npm run test:browser -- vary
 *   node test/vary.mjs http://localhost:4173
 *
 * The panel is a thing you operate: pick an effect, push six sliders, look,
 * push them again. Fine when you know what you are after and useless when you
 * do not, which on a board whose job is working out what you are after is most
 * of the time.
 *
 * So one key puts twelve versions under the card, you mark the ones worth
 * keeping, and pressing it again replaces the rest with twelve bred from those.
 *
 * Three things have to be true or the whole loop is worse than useless. The
 * twelve have to be genuinely different from each other — twelve near-copies
 * is a worse answer than one. The card it came from has to be untouched, since
 * everything else depends on being able to go back to it. And the whole round
 * has to be one press of undo, because a grid you cannot cheaply throw away is
 * a grid nobody will risk making.
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

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
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

/* A picture with structure in it, so an effect has something to bite on and
 * two different treatments cannot come out looking the same. */
await page.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 800
  c.height = 560
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 800, 560)
  g.addColorStop(0, '#13314f')
  g.addColorStop(0.55, '#c9552e')
  g.addColorStop(1, '#f0dcae')
  x.fillStyle = g
  x.fillRect(0, 0, 800, 560)
  x.fillStyle = '#fbf7ee'
  x.beginPath()
  x.arc(300, 250, 120, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = '#0d1b26'
  x.fillRect(480, 120, 220, 320)
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'sleeve.png', { type: 'image/png' }))
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 260 })
  Object.defineProperty(ev, 'dataTransfer', { value: dt })
  document.querySelector('.viewport').dispatchEvent(ev)
})
await page.waitForSelector('.card[data-kind="image"]', { timeout: 10000 })
await page.waitForTimeout(1300)

const cards = () => page.locator('.card[data-kind="image"]').count()
const source = await page.evaluate(() => document.querySelector('.card[data-kind="image"]').dataset.id)

/* Every card's treatment, read off the board rather than out of the store: the
 * shader is a canvas in the card, the tone is a filter on its body. */
const looks = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.card[data-kind="image"]')].map((c) => ({
      id: c.dataset.id,
      filter: c.querySelector('.card-body')?.style.filter || '',
      shaded: !!c.querySelector('.card-body canvas'),
      grain: Number(c.querySelector('.grain')?.style.opacity || 0),
      frame: c.querySelector('.card-frame')?.style.transform || '',
      x: Math.round(c.getBoundingClientRect().x),
      y: Math.round(c.getBoundingClientRect().y),
      sel: c.hasAttribute('data-sel'),
    }))
  )

const one = async (id) => {
  const l = await looks()
  return l.find((c) => c.id === id)
}

const before = await one(source)
check('one picture to start with', (await cards()) === 1)
check('and nothing on it yet', !before.shaded && before.filter === '', JSON.stringify(before))

/* ---------- one press ---------- */

await page.locator(`.card[data-id="${source}"]`).click({ position: { x: 20, y: 20 } })
await page.waitForTimeout(400)
/* The line along the bottom, and the off-screen live region that says the same
   thing to a reader. textContent for both: the live region is off screen on
   purpose, and innerText answers only for what is rendered. */
const spoke = () => page.evaluate(() => document.querySelector('.toast span')?.textContent || '')
const heard = () => page.evaluate(() => document.querySelector('.said')?.textContent || '')

/* The board says how many things are on it, which is the only count that is
   not confused by the cards outside the window never being drawn.
 *
 * `settles` waits for it to arrive at a number rather than reading it once:
 * twelve cards appearing is several renders, and asking twice in one assertion
 * can catch two different answers. */
const onBoard = async () => {
  const t = await page.locator('.stats').innerText()
  return Number((t.match(/(\d+)\s+items?/) || [])[1] || 0)
}
const settles = async (want, ms = 6000) => {
  const until = Date.now() + ms
  let n = await onBoard()
  while (n !== want && Date.now() < until) {
    await page.waitForTimeout(150)
    n = await onBoard()
  }
  return n
}

await page.keyboard.press('v')
await page.waitForTimeout(900)
const said = await spoke()
await page.waitForTimeout(3000)

check('one press makes twelve more', (await settles(13)) === 13, `${await onBoard()} on the board`)
check('and a reader is told too, since twelve cards appearing is worth saying',
  /mark|keep/i.test(await heard()), await heard())
check('and says what to do with them', /mark|keep/i.test(said), said.replace(/\n/g, ' '))

const batch = (await looks()).filter((c) => c.id !== source)
check('all twelve are selected, so the next press is another round on them',
  batch.every((c) => c.sel), `${batch.filter((c) => c.sel).length} of 12`)

/* ---------- the card it came from is untouched ---------- */

const treatment = (c) => c && JSON.stringify({ filter: c.filter, shaded: c.shaded, grain: c.grain, frame: c.frame })
const after = await one(source)
check('the card it came from is exactly as it was',
  treatment(after) === treatment(before), `${treatment(before)} -> ${treatment(after)}`)

/* ---------- and the twelve are actually different ---------- */

const shaded = batch.filter((c) => c.shaded).length
check('nearly all of them have a shader on them', shaded >= 10, `${shaded} of 12`)

/* The thing that makes a gallery worth looking at. Twelve treatments that come
   out looking the same are a worse answer than one treatment. */
const distinct = new Set(batch.map((c) => `${c.filter}|${c.grain}`)).size
check('and they are not twelve of the same thing', distinct >= 7, `${distinct} distinct tones`)

/* Which effect each one is running, straight out of what the board saved. */
const effects = await page.evaluate(async (src) => {
  const read = () => new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const s = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
      s.onsuccess = () => res(s.result)
      s.onerror = () => res([])
    }
    r.onerror = () => res([])
  })
  const boards = await read()
  const items = (boards || []).flatMap((b) => b.items || []).filter((i) => i.kind === 'image' && i.id !== src)
  return {
    ids: items.map((i) => i.fx?.fxid).filter(Boolean),
    stacked: items.filter((i) => i.fx?.more?.length).length,
    /* Both effects of each stacked one, in the order they are applied. */
    stacks: items.filter((i) => i.fx?.more?.length).map((i) => [i.fx.fxid, ...i.fx.more.map((l) => l.fxid)]),
    graded: items.filter((i) => i.fx && (i.fx.sat !== 100 || i.fx.con !== 0 || i.fx.exp !== 0 || i.fx.warm !== 0)).length,
    framed: items.filter((i) => i.fx && (i.fx.zoom !== 1 || i.fx.ox !== 0 || i.fx.rot !== 0)).length,
  }
}, source)

check('twelve different effects, not one effect twelve times',
  new Set(effects.ids).size >= 9, `${new Set(effects.ids).size} different effects in ${effects.ids.length}`)
check('none of them is the effect the card already had',
  !effects.ids.includes('none'), effects.ids.join(' '))
/* How often a batch stacks a second effect is a rate, and a rate cannot be
   asserted on twelve samples. This check used to say `stacked >= 1`: at one in
   four, a fair batch stacks none of them about three times in a hundred, so it
   turned red on a run of a commit that had been green an hour before. The rate
   is checked over two thousand draws in test/unit/variations.test.ts, where a
   fair run failing is not something anyone will see.

   What is worth asking here is the part only a browser can answer — that a
   variant which did stack carries both effects all the way to the board — so
   it is asked when there is one and passed over when there is not. */
check('a variant that stacked a second effect carries both, and two different ones',
  effects.stacks.every((s) => s.length === 2 && s[0] !== s[1]),
  effects.stacked ? effects.stacks.map((s) => s.join('+')).join(' ') : 'none stacked this time')
/* Seven of twelve was also a rate, and a tighter one than it looked: one
   preset in eight leaves the tone alone. Four is the same claim with no
   arithmetic behind it. */
check('and they carry tones as well as effects', effects.graded >= 4, `${effects.graded} graded`)
/* A roll replaces the treatment. The crop belongs to the photograph it was set
   on, which is the same line a saved look draws. */
check('but none of them touched the framing', effects.framed === 0, `${effects.framed} reframed`)

fs.writeFileSync(path.join(OUT, 'vary-batch.png'), await page.screenshot())

/* ---------- laid out as a grid under the card ---------- */

const laid = (await looks()).filter((c) => c.id !== source)
const rows = new Set(laid.map((c) => c.y)).size
const cols = new Set(laid.map((c) => c.x)).size
check('they are laid out four across and three down', cols === 4 && rows === 3, `${cols} × ${rows}`)
/* Read again rather than against the reading from before the press: making a
   batch moves the view to it, so every screen position on the board changed. */
const now = await one(source)
check('and all of them below the card they came from',
  laid.every((c) => c.y > now.y), `card at ${now.y}, highest of the twelve at ${Math.min(...laid.map((c) => c.y))}`)

/* ---------- one press of undo takes the whole round ---------- */

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await page.waitForTimeout(900)
check('one undo takes the whole round away', (await settles(1)) === 1, `${await onBoard()} on the board`)
await page.keyboard.press('Control+Shift+z')
await page.waitForTimeout(2500)
check('and one redo brings it back', (await settles(13)) === 13, `${await onBoard()} on the board`)

/* ---------- the second round breeds from what was kept ---------- */

const live = (await looks()).filter((c) => c.id !== source)
const keepers = live.slice(0, 3).map((c) => c.id)
await page.locator(`.card[data-id="${keepers[0]}"]`).click({ position: { x: 18, y: 18 } })
for (const id of keepers.slice(1)) {
  await page.locator(`.card[data-id="${id}"]`).click({ position: { x: 18, y: 18 }, modifiers: ['Shift'] })
}
await page.waitForTimeout(300)
await page.keyboard.press('i')
await page.waitForTimeout(600)
const marked = await page.locator('.card[data-pick="in"]').count()
check('three of them can be marked kept', marked === 3, `${marked} marked`)

/* Back to the whole batch, which is what a second press acts on. */
await page.locator(`.card[data-id="${live[0].id}"]`).click({ position: { x: 18, y: 18 } })
for (const c of live.slice(1)) {
  await page.locator(`.card[data-id="${c.id}"]`).click({ position: { x: 18, y: 18 }, modifiers: ['Shift'] })
}
await page.waitForTimeout(400)
check('the whole batch can be selected again', (await page.locator('.card[data-sel]').count()) === 12,
  `${await page.locator('.card[data-sel]').count()} selected`)

const keptLooks = await Promise.all(keepers.map((id) => one(id)))
await page.keyboard.press('v')
await page.waitForTimeout(900)
const round2 = await spoke()
await page.waitForTimeout(2800)

check('a second round leaves the count where it was', (await settles(13)) === 13, `${await onBoard()} on the board`)
check('and says it bred from the ones that were kept', /kept/i.test(round2), round2.replace(/\n/g, ' '))

const stillThere = await Promise.all(keepers.map((id) => one(id)))
check('the three marked kept are still on the board', stillThere.every(Boolean))
check('and untouched, since keeping something has to mean keeping it',
  stillThere.every((c, i) => c && c.filter === keptLooks[i].filter && c.grain === keptLooks[i].grain))

const gone = live.filter((c) => !keepers.includes(c.id))
const survivors = new Set((await looks()).map((c) => c.id))
check('the nine that were not marked are gone', gone.every((c) => !survivors.has(c.id)),
  `${gone.filter((c) => survivors.has(c.id)).length} still there`)

/* The point of breeding rather than rolling again: the children should look
   like their parents more often than not. */
const family = await page.evaluate(async ({ src, kept }) => {
  const read = () => new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const s = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
      s.onsuccess = () => res(s.result)
      s.onerror = () => res([])
    }
    r.onerror = () => res([])
  })
  const boards = await read()
  const items = (boards || []).flatMap((b) => b.items || []).filter((i) => i.kind === 'image' && i.id !== src)
  const parents = new Set(items.filter((i) => kept.includes(i.id)).map((i) => i.fx?.fxid))
  const children = items.filter((i) => !kept.includes(i.id))
  return { parents: [...parents], shared: children.filter((c) => parents.has(c.fx?.fxid)).length, of: children.length }
}, { src: source, kept: keepers })
check('most of the new ones took an effect from a parent rather than starting over',
  family.shared >= Math.ceil(family.of * 0.5),
  `${family.shared} of ${family.of} from ${family.parents.length} parents`)

fs.writeFileSync(path.join(OUT, 'vary-bred.png'), await page.screenshot())

/* ---------- going deeper into one of them ---------- */

const pickOne = [...survivors].find((id) => id !== source && !keepers.includes(id)) || keepers[0]
/* Zoomed out to twelve cards, a click has to land on the one it is aimed at
   and not on whatever is under it. */
await page.locator(`.card[data-id="${pickOne}"]`).click({ position: { x: 8, y: 8 } })
await page.waitForTimeout(500)
check('one of them can be singled out',
  (await page.locator('.card[data-sel]').count()) === 1 &&
  (await page.locator(`.card[data-id="${pickOne}"][data-sel]`).count()) === 1,
  `${await page.locator('.card[data-sel]').count()} selected`)
await page.keyboard.press('v')
await page.waitForTimeout(3500)
check('choosing one of them and pressing again clears the other eleven away',
  (await settles(14)) === 14, `${await onBoard()} on the board`)
/* Read out of what the board saved rather than off the screen: the view has
   moved to the new twelve, and a card outside the window is never drawn. */
const left = await page.evaluate(async () => {
  const read = () => new Promise((res) => {
    const r = indexedDB.open('ideation.board.db', 1)
    r.onsuccess = () => {
      const s = r.result.transaction('boards', 'readonly').objectStore('boards').getAll()
      s.onsuccess = () => res(s.result)
      s.onerror = () => res([])
    }
    r.onerror = () => res([])
  })
  return ((await read()) || []).flatMap((b) => b.items || []).map((i) => i.id)
})
check('leaving the card it all came from and the one that won',
  left.includes(source) && left.includes(pickOne),
  `${left.length} items saved`)

/* ---------- and it says no when there is nothing to do ---------- */

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.keyboard.press('v')
await page.waitForTimeout(800)
const nothing = await spoke()
check('with nothing selected it asks for a picture rather than doing nothing',
  /pick a picture/i.test(nothing), nothing.replace(/\n/g, ' '))
check('and made nothing', (await settles(14)) === 14, `${await onBoard()} on the board`)

await page.keyboard.press('n')
await page.waitForSelector('.card[data-kind="note"]', { timeout: 8000 })
await page.waitForTimeout(700)
await page.locator('.card[data-kind="note"]').first().click({ position: { x: 12, y: 12 } })
await page.waitForTimeout(400)
await page.keyboard.press('v')
await page.waitForTimeout(700)
const note = await spoke()
check('a note has no versions, and it says so', /only a picture/i.test(note), note.replace(/\n/g, ' '))

/* ---------- it survives a reload, because they are only cards ---------- */

const total = await onBoard()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.card[data-kind="image"]', { timeout: 15000 })
await page.waitForTimeout(2500)
check('the whole grid is there after a reload', (await settles(total)) === total, `${await onBoard()} of ${total}`)
const back = (await looks()).filter((c) => c.id !== source)
check('with the treatments it had', back.filter((c) => c.shaded).length >= 10,
  `${back.filter((c) => c.shaded).length} shaded`)

/* ---------- the same dice, thrown in place ---------- */

/* The grid is for deciding between twelve. Shuffle is for when you do not want
   to decide anything: you want the picture to be something else, now. */
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
/* The whole board on screen first: a card outside the window is never drawn,
   and by now the view is sitting on the newest grid. */
await page.keyboard.press('1')
await page.waitForTimeout(1200)
await page.locator(`.card[data-id="${source}"]`).click({ position: { x: 6, y: 6 } })
await page.waitForTimeout(400)
check('the card it all came from can be got back to',
  (await page.locator(`.card[data-id="${source}"][data-sel]`).count()) === 1)
const plain = await one(source)
const held = await onBoard()
await page.keyboard.press('r')
await page.waitForTimeout(2500)
const rolled = await one(source)
check('shuffle puts something on the card it was pressed on',
  rolled.shaded && !plain.shaded, JSON.stringify(rolled))
check('and makes nothing new, because it is not a grid',
  (await settles(held)) === held, `${await onBoard()} of ${held}`)

/* What the card is actually showing, rather than the CSS around it.
 *
 * This used to compare the tone and the framing, which is not what a shuffle
 * mostly changes: a throw rolls a tone that does nothing about as often as it
 * rolls any other, so two throws could leave the same empty filter behind and
 * the check would call that a failure while the picture in front of it was
 * plainly different. The picture is the claim, so the picture is what is
 * read. */
const shown = () =>
  page.evaluate((cid) => {
    const el = document.querySelector(`.card[data-id="${cid}"] .card-body canvas`)
    if (!el) return null
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 32
    const cx = c.getContext('2d', { willReadFrequently: true })
    cx.drawImage(el, 0, 0, 32, 32)
    const d = cx.getImageData(0, 0, 32, 32).data
    let h = 0
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0
    return h
  }, source)

/* Five throws rather than one. A shuffle picks from sixty-nine effects and can
   land on the one it just landed on — that is a fair throw rather than a bug —
   so the claim worth checking is that pressing it again keeps giving you
   something else, not that any single press is guaranteed to. */
const seen = [await shown()]
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('r')
  await page.waitForTimeout(2400)
  seen.push(await shown())
}
check('pressing it again gives something else', new Set(seen).size >= 4, JSON.stringify(seen))
check('and every throw drew something', seen.every((h) => h !== null && h !== 0), JSON.stringify(seen))

await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('Control+z')
await page.waitForTimeout(2400)
check('and each throw is one press of undo', (await shown()) === seen[seen.length - 2],
  `${await shown()} want ${seen[seen.length - 2]}`)

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('r')
await page.waitForTimeout(600)
check('with nothing selected it asks for a picture', /pick a picture/i.test(await spoke()), await spoke())

check('no page errors', errors.length === 0, errors.join(' | '))

console.log(`\n${pass}/${pass + fail} checks passed`)
console.log(fail ? 'FAIL' : 'PASS')
await browser.close()
process.exit(fail ? 1 : 0)
