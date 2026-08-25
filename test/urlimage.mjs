/* A picture dragged out of another tab.
 *
 *   npm run dev &
 *   node test/urlimage.mjs http://localhost:5173
 *
 * Half of how a moodboard gets made is somebody finding a photograph on the
 * web and dragging it across, and until now every one of those arrived as a
 * link: a grey box with an address in it. What has to be true instead:
 *
 *   an image address whose host allows the read -> a picture, held here,
 *                                                  and shaders work on it
 *   an image address whose host refuses         -> still a picture, shown
 *                                                  from its own address
 *   anything else                               -> still a link
 *
 * The pictures are served from a second origin on this machine, one path with
 * the cross-origin header and one without, so both halves are real rather than
 * simulated and nothing here touches the internet.
 */
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = process.argv[2] || 'http://localhost:5173'
const PORT = Number(process.env.MEDIA_PORT || 5198)
const HOST = `http://127.0.0.1:${PORT}`
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

/* ---------- a PNG, written here rather than checked in ---------- */
const png = (w, h, rgb) => {
  const chunk = (type, body) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    const head = Buffer.concat([Buffer.from(type, 'latin1'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(head) >>> 0 : crc32(head))
    return Buffer.concat([len, head, crc])
  }
  /* Node has had zlib.crc32 only since 22.2, so it is written out here too. */
  function crc32(buf) {
    let c = ~0
    for (const b of buf) {
      c ^= b
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1)
    raw[row] = 0
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

const PICTURE = png(160, 110, [0xe0, 0x30, 0x20])

const server = http.createServer((req, res) => {
  const url = new URL(req.url, HOST)
  const head = {}
  if (url.pathname.startsWith('/open/')) {
    head['Access-Control-Allow-Origin'] = '*'
    head['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
  }
  if (req.method === 'OPTIONS') return res.writeHead(204, head).end()
  if (url.pathname === '/article') {
    return res.writeHead(200, { ...head, 'Content-Type': 'text/html' }).end('<h1>a page, not a picture</h1>')
  }
  if (url.pathname.endsWith('.png')) {
    head['Content-Type'] = 'image/png'
    head['Content-Length'] = String(PICTURE.length)
    return res.writeHead(200, head).end(req.method === 'HEAD' ? undefined : PICTURE)
  }
  res.writeHead(404, head).end('no')
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const OPEN = `${HOST}/open/shot.png`
const CLOSED = `${HOST}/closed/shot.png`
const PAGE = `${HOST}/article`

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.evaluate(() => { indexedDB.deleteDatabase('ideation.board.db'); localStorage.removeItem('ideation.path') })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* What a browser really puts on the clipboard when you drag a picture out of
 * a page: the markup of the <img>, its address, and the address again as
 * plain text. The markup wins, because it is the only flavour that survives a
 * picture wrapped in a link to somewhere else. */
const dragUrl = async (url, at, flavours = 'html') => {
  await page.evaluate(
    ({ url, at, flavours }) => {
      const dt = new DataTransfer()
      if (flavours === 'html') dt.setData('text/html', `<a href="https://example.com/gallery"><img src="${url}" alt="shot"></a>`)
      if (flavours !== 'plain') dt.setData('text/uri-list', url)
      dt.setData('text/plain', url)
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { url, at, flavours }
  )
  await page.waitForTimeout(2200)
}

const pasteUrl = async (url) => {
  await page.evaluate((url) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', url)
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', { value: dt })
    window.dispatchEvent(ev)
  }, url)
  await page.waitForTimeout(2200)
}

const cards = () => page.evaluate(() =>
  [...document.querySelectorAll('.card')].map((c) => {
    const img = c.querySelector('img.media')
    return {
      kind: c.dataset.kind,
      id: c.dataset.id,
      src: img ? (img.src.startsWith('blob:') ? 'blob' : img.src) : null,
      w: Math.round(c.getBoundingClientRect().width),
      h: Math.round(c.getBoundingClientRect().height),
    }
  })
)

/* ---------- a picture whose host allows the read ---------- */
await dragUrl(OPEN, { x: 380, y: 320 })
let list = await cards()
ok('an image address dragged in becomes a picture, not a link',
   list.length === 1 && list[0].kind === 'image', JSON.stringify(list))
ok('and the picture is really shown', list[0] && !!list[0].src, list[0]?.src || 'nothing')
ok('the card takes the shape of the picture behind it',
   list[0] && Math.abs(list[0].w / list[0].h - 160 / 110) < 0.06,
   list[0] ? `${list[0].w}x${list[0].h} for a 160x110 picture` : 'no card')
ok('a host that allows the read has its picture kept here',
   list[0] && list[0].src === 'blob', list[0]?.src || 'nothing')

/* Kept here means shaders can run on it: the whole point of holding the file
 * rather than pointing at it. */
await page.locator(`.card[data-id="${list[0].id}"]`).click({ position: { x: 10, y: 10 } })
await page.waitForTimeout(400)
const thumb = page.locator('.fx-thumb[title="Halftone"]')
if (await thumb.count()) await thumb.click()
await page.waitForTimeout(2000)
ok('and an effect runs on it', (await page.locator(`.card[data-id="${list[0].id}"] canvas`).count()) === 1)
fs.writeFileSync(path.join(OUT, 'urlimage-open.png'), await page.screenshot())

/* ---------- a picture whose host refuses ---------- */
await page.keyboard.press('Escape')
await pasteUrl(CLOSED)
list = await cards()
const closed = list.find((c) => c.src && c.src !== 'blob')
ok('an address pasted in becomes a picture too', list.length === 2 && list.every((c) => c.kind === 'image'),
   JSON.stringify(list.map((c) => c.kind)))
ok('a host that refuses the read still shows its picture, from its own address',
   !!closed && closed.src === CLOSED, closed?.src || 'nothing')

/* ---------- anything else is still a link ---------- */
await pasteUrl(PAGE)
list = await cards()
ok('a page is still a link', list.filter((c) => c.kind === 'link').length === 1,
   JSON.stringify(list.map((c) => c.kind)))

/* ---------- and it all survives a reload ---------- */
await page.waitForTimeout(1200)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2200)
list = await cards()
ok('the pictures are still pictures after a reload',
   list.filter((c) => c.kind === 'image').length === 2 && list.filter((c) => c.kind === 'link').length === 1,
   JSON.stringify(list.map((c) => c.kind)))
fs.writeFileSync(path.join(OUT, 'urlimage-board.png'), await page.screenshot())

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
server.close()
process.exit(failed.length || errors.length ? 1 : 0)
