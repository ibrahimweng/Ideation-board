/* A board somebody else can open.
 *
 *   npm run build && node scripts/browser-tests.mjs sendable
 *
 * There was no way to hand a board to a person. The zip is a backup — it holds
 * everything, and it is also useless to anyone who does not have this app,
 * because it is a format rather than a document. The poster is one flat sheet
 * with nothing to walk into. So "can you send me that board" had no answer.
 *
 * The test is the only one that matters for a claim like this: take the file
 * the app produces, open it in a browser that has never seen this app, with
 * the network switched off, and see whether the board is there. Everything
 * below happens in that second page — the cards, the pictures, the note text,
 * the boards inside, the panning — because a page that only works next to the
 * thing that made it is not a page anybody can be sent.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = process.argv[2] || 'http://localhost:5173'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const png = (w, h, hue) => {
  const crc32 = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const head = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(head))
    return Buffer.concat([len, head, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      const on = ((x >> 5) + (y >> 5)) % 2
      raw[row + 1 + x * 3] = on ? hue : 255 - hue
      raw[row + 2 + x * 3] = on ? 90 : 200
      raw[row + 3 + x * 3] = on ? 200 : 60
    }
  }
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('app: ' + e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.clear() })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.app[data-ready]', { timeout: 20000 })
await page.waitForTimeout(600)

/* ---------- a board worth sending ---------- */
const drop = async (buf, name, x, y) => {
  await page.evaluate(({ b64, name, x, y }) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length)
    for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j)
    const dt = new DataTransfer()
    dt.items.add(new File([u8], name, { type: 'image/png' }))
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperty(ev, 'dataTransfer', { value: dt })
    document.querySelector('.viewport').dispatchEvent(ev)
  }, { b64: buf.toString('base64'), name, x, y })
  await page.waitForTimeout(2400)
}
/* Take a card by a corner nothing else is over, and put it somewhere else. */
const dragCard = async (kind, dx, dy) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  const box = await page.locator(`.card[data-kind="${kind}"]`).last().boundingBox()
  const x = box.x + 12
  const y = box.y + 6
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1400)
}
const writeNote = async (text) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.keyboard.press('n')
  await page.waitForTimeout(500)
  await page.locator('.card[data-kind="note"]').last().dblclick()
  await page.waitForTimeout(500)
  await page.locator('.sheet textarea').fill(text)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(1400)
}

await page.locator('.board-name').click()
await page.keyboard.press('Control+a')
await page.keyboard.type('Sending this on')
await page.keyboard.press('Tab')
await page.waitForTimeout(1200)

await drop(png(400, 300, 40), 'first.png', 420, 340)
await drop(png(400, 300, 200), 'second.png', 760, 340)
/* Apart, rather than overlapping by sixty pixels. Cards that overlap are a
   fine thing for a board to have and a poor thing to check: a line between two
   of them starts and ends underneath the other one. */
await dragCard('image', 280, 0)

/* An effect on one of them, so the page has to carry a baked picture rather
   than the file that was dropped.
 *
 * Done before anything else is put on the board: a note or a label is made at
 * the middle of the view, which is on top of these, and then the picture
 * cannot be clicked at all. */
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('1')
await page.waitForTimeout(600)
await page.locator('.card[data-kind="image"]').first().click()
await page.waitForTimeout(400)
if (!(await page.locator('.fx-thumb').count())) { await page.keyboard.press('e'); await page.waitForTimeout(700) }
await page.locator('.fx-thumb[title="ASCII"]').click()
await page.waitForTimeout(2200)

/* A line between the two pictures, so the page has a wire to draw. Started
   from the card's own port, which is the only place a wire starts. */
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const shots = await page.locator('.card[data-kind="image"]').all()
const shotA = await shots[0].boundingBox()
const shotB = await shots[1].boundingBox()
await page.mouse.move(shotA.x + shotA.width / 2, shotA.y + shotA.height / 2)
await page.waitForTimeout(500)
const port = await page.evaluate(() => document.querySelector('.port-e')?.getBoundingClientRect().toJSON() || null)
if (port) {
  await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2)
  await page.mouse.down()
  await page.mouse.move(shotB.x + shotB.width / 2, shotB.y + shotB.height / 2, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(1600)
}
ok('setup: a line joins two of the cards',
   (await page.locator('.wire-line').count()) === 1,
   `${await page.locator('.wire-line').count()} wires`)

await writeNote('# Heading\nzellige tiles, **the blue ones**\n\n- one\n- two')
/* And out from under the pictures. A note is made in the middle of the view,
   which is where the pictures are — and a board whose cards sit on top of each
   other cannot be checked by clicking them, here or in the page it becomes. */
await dragCard('note', 0, 360)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('l')
await page.waitForTimeout(700)
await dragCard('label', -360, 360)

/* And a board inside it, with something in that. */
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
await page.keyboard.press('b')
await page.waitForTimeout(1200)
await page.locator('.card[data-kind="board"]').last().dblclick()
await page.waitForTimeout(1800)
await writeNote('foil stamp, one board down')
await page.locator('.crumbs button').first().click()
await page.waitForTimeout(1800)
/* And clear of the pictures, like everything else made at the middle of the
   view. A board whose cards sit on top of one another cannot be checked by
   clicking them, here or in the page it becomes. */
await dragCard('board', 0, -330)

/* ---------- take it out ---------- */
/* The real gesture, through the command list, and the real file the browser
   would have written to disk. */
const wait = page.waitForEvent('download', { timeout: 120000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('page anyone')
await page.waitForTimeout(600)
await page.keyboard.press('Enter')
const dl = await wait
const file = path.join(OUT, 'sent.html')
await dl.saveAs(file)
const bytes = fs.statSync(file).size
ok('the command list offers it and it produces a file', bytes > 0, dl.suggestedFilename())
ok('named after the board', /sending-this-on|sending_this_on|sending this on/i.test(dl.suggestedFilename()),
   dl.suggestedFilename())
ok('and it is one file, with the pictures inside it rather than beside it',
   bytes > 20000 && fs.readFileSync(file, 'utf8').includes('data:image/'), `${Math.round(bytes / 1024)} KB`)
/* Small enough to send. Four cards should be well under a megabyte. */
ok('and small enough to actually send', bytes < 3 * 1024 * 1024, `${Math.round(bytes / 1024)} KB`)

const html = fs.readFileSync(file, 'utf8')
ok('nothing in it is fetched from anywhere',
   !/<(script|img|link)[^>]+(src|href)=["'](?!data:|#)[a-z]+:/i.test(html) && !/https?:\/\/[^"']*\.(js|css|png|jpe?g|woff)/i.test(html))

/* ---------- open it as a stranger would ---------- */
/* A browser that has never seen the app, with nothing to talk to: no server,
   no store, no network. If the board is not in the file, it is not there. */
const away = await browser.newContext({ offline: true })
const reader = await away.newPage()
const readerErrors = []
reader.on('pageerror', (e) => readerErrors.push('page: ' + e.message))
let asked = 0
await reader.route('**/*', (route) => {
  if (route.request().url().startsWith('file:')) return route.continue()
  asked++
  return route.abort()
})
await reader.goto('file://' + file, { waitUntil: 'load' })
await reader.waitForTimeout(1500)

ok('it opens with the network off, from the file itself', (await reader.locator('#world').count()) === 1)
ok('and asks the network for nothing at all', asked === 0, `${asked} requests`)
ok('the board is named at the top', (await reader.locator('#top h1').innerText()) === 'Sending this on',
   await reader.locator('#top h1').innerText())
ok('and is not named twice', (await reader.locator('#crumbs button').count()) === 0)

const cards = await reader.locator('#world .c').count()
ok('every card is there', cards === 5, `${cards} cards`)
ok('and the line drawn between two of them came too',
   (await reader.locator('#wires path').count()) === 1,
   `${await reader.locator('#wires path').count()} wires`)
ok('which is really drawn, not a path of nothing',
   await reader.locator('#wires path').first().evaluate((p) => p.getTotalLength() > 40))
/* Wires are drawn behind the cards, so one running centre to centre between
   two adjacent cards is a line nobody can see. It has to leave each card at
   its edge. */
ok('and it leaves the cards rather than hiding underneath them',
   await reader.evaluate(() => {
     const p = document.querySelector('#wires path')
     const a = p.getPointAtLength(0)
     const b = p.getPointAtLength(p.getTotalLength())
     const boxes = [...document.querySelectorAll('#world .c')].map((n) => ({
       x: parseFloat(n.style.left), y: parseFloat(n.style.top),
       w: parseFloat(n.style.width), h: parseFloat(n.style.height),
     }))
     const inside = (pt) => boxes.some((r) =>
       pt.x > r.x + 1 && pt.x < r.x + r.w - 1 && pt.y > r.y + 1 && pt.y < r.y + r.h - 1)
     return !inside(a) && !inside(b)
   }))
const imgs = await reader.locator('#world img').count()
ok('with the pictures drawn', imgs === 2, `${imgs} pictures`)
ok('and each picture really has pixels in it', await reader.evaluate(async () => {
  const list = [...document.querySelectorAll('#world img')]
  for (const im of list) { await im.decode(); if (!im.naturalWidth) return false }
  return list.length > 0
}))
const words = await reader.locator('#world').innerText()
ok('the note is text you can read and select, not a picture of text',
   words.includes('zellige tiles') && words.includes('the blue ones'), words.replace(/\n/g, ' | ').slice(0, 120))
ok('and its formatting survived', (await reader.locator('#world .note h1').count()) === 1 &&
   (await reader.locator('#world .note li').count()) === 2)
fs.writeFileSync(path.join(OUT, 'sendable.png'), await reader.screenshot())

/* ---------- the effect came with it ---------- */
/* The picture in the page has to be the picture that was on the card, effect
   and all — not the file that was dropped. Compared by ink: an ASCII card is
   mostly dark with light marks on it, and the original is neither. */
const inks = await reader.evaluate(async () => {
  const out = []
  for (const im of document.querySelectorAll('#world img')) {
    await im.decode()
    const c = document.createElement('canvas')
    c.width = 60; c.height = 60
    const x = c.getContext('2d')
    x.drawImage(im, 0, 0, 60, 60)
    const d = x.getImageData(0, 0, 60, 60).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    out.push(Math.round(sum / (60 * 60)))
  }
  return out.sort((a, b) => a - b)
})
ok('the effect is baked into the picture rather than lost on the way out',
   inks.length === 2 && inks[0] < 70 && inks[1] > 90, JSON.stringify(inks))

/* ---------- the boards inside ---------- */
const boardCard = reader.locator('#world .board')
ok('a board inside it is a card you can press', (await boardCard.count()) === 1)
await boardCard.click()
await reader.waitForTimeout(700)
const inside = await reader.locator('#world').innerText()
ok('and pressing it goes in', inside.includes('foil stamp'), inside.replace(/\n/g, ' | ').slice(0, 100))
ok('with a way back', (await reader.locator('#crumbs button').count()) === 2)
await reader.locator('#crumbs button').first().click()
await reader.waitForTimeout(700)
ok('which comes back, and puts the trail away again',
   (await reader.locator('#world').innerText()).includes('zellige') &&
   (await reader.locator('#crumbs button').count()) === 0)

/* ---------- and it behaves like a board ---------- */
const at = () => reader.locator('#world').evaluate((e) => e.style.transform)
const before = await at()
await reader.mouse.move(640, 500)
await reader.mouse.down()
await reader.mouse.move(760, 560, { steps: 8 })
await reader.mouse.up()
await reader.waitForTimeout(300)
ok('it can be dragged about', (await at()) !== before, await at())

await reader.locator('#all').click()
await reader.waitForTimeout(400)
const fitted = await at()
await reader.locator('#in').click()
await reader.waitForTimeout(300)
ok('and zoomed', (await at()) !== fitted)

await reader.locator('#world img').first().click()
await reader.waitForTimeout(500)
ok('a picture opens at full size', await reader.locator('#big[data-on]').count() === 1)
await reader.keyboard.press('Escape')
await reader.waitForTimeout(300)
ok('and closes again', (await reader.locator('#big[data-on]').count()) === 0)

/* ---------- a note cannot break the page it is in ---------- */
/* The board's own text ends up inside a script tag, so anything a person can
   type has to survive being put there. This is the string that would end it. */
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await writeNote('careful: </script><script>window.__broke=1</script> and <b>tags</b>')
const wait2 = page.waitForEvent('download', { timeout: 120000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmd', { timeout: 5000 })
await page.keyboard.type('page anyone')
await page.waitForTimeout(600)
await page.keyboard.press('Enter')
const dl2 = await wait2
const file2 = path.join(OUT, 'sent-tricky.html')
await dl2.saveAs(file2)
const reader2 = await away.newPage()
reader2.on('pageerror', (e) => readerErrors.push('tricky: ' + e.message))
await reader2.goto('file://' + file2, { waitUntil: 'load' })
await reader2.waitForTimeout(1200)
ok('a note that looks like markup does not break the page or run',
   (await reader2.evaluate(() => window.__broke)) === undefined &&
   (await reader2.locator('#world .c').count()) === 6,
   `${await reader2.locator('#world .c').count()} cards`)
ok('and it is shown as the words somebody typed',
   (await reader2.locator('#world').innerText()).includes('</script>'),
   (await reader2.locator('#world').innerText()).replace(/\n/g, ' | ').slice(0, 120))

await away.close()

const bad = [...errors, ...readerErrors]
console.log('\npage errors:', bad.length ? bad.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || bad.length ? 'FAIL' : 'PASS')
await browser.close()
process.exit(failed.length || bad.length ? 1 : 0)
