/* Claude, holding the board.
 *
 *   npm run build && node scripts/browser-tests.mjs mcp
 *
 * The real relay is started as a real subprocess and spoken to the way Claude
 * speaks to it — JSON-RPC on its stdin and stdout — while a real browser holds
 * the board at the other end. Nothing here stands in for anything: if this
 * passes, an agent can read and work on a board that exists only inside one
 * browser's IndexedDB, which is the whole claim.
 *
 * The half that matters most is the last one. The relay listens on loopback,
 * and every page in the browser can reach loopback, so the only thing between
 * a stranger's website and your board is the relay checking who is asking. A
 * second origin is conjured with Chrome's host resolver and made to try, from
 * inside a real browser, exactly as a hostile page would.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const BASE = process.argv[2] || 'http://localhost:5173'
const RELAY_PORT = Number(process.env.RELAY_PORT || 4320)
const RELAY = `http://127.0.0.1:${RELAY_PORT}`
const AI_PORT = Number(process.env.MCP_AI_PORT || 5201)
const EVIL_PORT = Number(process.env.EVIL_PORT || 5202)
const KEY = 'AIzaSyFAKEKEY_ForTheRelayTest_00099'
const OUT = process.env.OUT_DIR || path.join(process.cwd(), '.smoke')
fs.mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

/* ---------- a picture, for the drawing tool ---------- */
const png = (w, h, rgb) => {
  function crc32(buf) {
    let c = ~0
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
    return ~c >>> 0
  }
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
    for (let x = 0; x < w; x++) { raw[row + 1 + x * 3] = rgb[0]; raw[row + 2 + x * 3] = rgb[1]; raw[row + 3 + x * 3] = rgb[2] }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}
const PICTURE = png(240, 160, [0xd0, 0x50, 0x20]).toString('base64')

/* ---------- a stand-in for Google, so draw_image has something to ask ------ */
const sent = []
const ai = http.createServer((req, res) => {
  const head = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'x-goog-api-key, content-type',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') return res.writeHead(204, head).end()
  const url = new URL(req.url, `http://127.0.0.1:${AI_PORT}`)
  if (url.pathname === '/v1beta/models') {
    return res.writeHead(200, head).end(JSON.stringify({
      models: [{ name: 'models/fake-image-generate', displayName: 'Fake', description: 'Generates images.', supportedGenerationMethods: ['generateContent'] }],
    }))
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    /* Kept so the test can check what was asked, not only what came back. */
    try {
      sent.push({ path: url.pathname, body: JSON.parse(body || '{}') })
    } catch {
      sent.push({ path: url.pathname, body: null })
    }
    setTimeout(() => res.writeHead(200, head).end(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PICTURE } }] }, finishReason: 'STOP' }],
    })), 300)
  })
})
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r))

/* ---------- a page on somebody else's origin ---------- */
const evil = http.createServer((req, res) =>
  res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>not your board</h1>'))
await new Promise((r) => evil.listen(EVIL_PORT, '127.0.0.1', r))

/* ---------- the relay, as a real subprocess ---------- */
const relay = spawn('node', [path.join(process.cwd(), 'mcp', 'server.mjs'), '--port', String(RELAY_PORT)], {
  stdio: ['pipe', 'pipe', 'pipe'],
})
const relayLog = []
relay.stderr.on('data', (d) => relayLog.push(String(d).trim()))

let buf = ''
let rpcId = 0
const pending = new Map()
relay.stdout.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let m
    try { m = JSON.parse(line) } catch { continue }
    const p = pending.get(m.id)
    if (p) { pending.delete(m.id); p(m) }
  }
})
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++rpcId
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} never came back`)) }, 60_000)
    pending.set(id, (m) => { clearTimeout(t); resolve(m) })
    relay.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
const call = async (name, args = {}) => {
  const m = await rpc('tools/call', { name, arguments: args })
  const text = m.result?.content?.[0]?.text ?? ''
  let json = null
  try { json = JSON.parse(text) } catch { /* an error is a sentence, not JSON */ }
  return { isError: !!m.result?.isError, text, json }
}

await new Promise((r) => setTimeout(r, 700))

/* ---------- the handshake ---------- */
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
ok('the relay speaks MCP', init.result?.serverInfo?.name === 'ideation-board', JSON.stringify(init.result?.serverInfo))
ok('and agrees on a protocol version', init.result?.protocolVersion === '2025-06-18', init.result?.protocolVersion)
ok('and tells the model how to hold the board', /get_board/.test(init.result?.instructions || ''))
relay.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const list = await rpc('tools/list')
const names = (list.result?.tools || []).map((t) => t.name)
ok('and offers the board as tools', names.length === 11 && names.includes('get_board') && names.includes('draw_image'), names.join(', '))
ok('every tool says what its arguments are',
   (list.result?.tools || []).every((t) => t.inputSchema?.type === 'object' && t.description?.length > 40))

/* ---------- with nothing attached ---------- */
const cold = await call('get_board')
ok('with no board open it says so, rather than failing silently',
   cold.isError && /Connect to Claude/.test(cold.text), cold.text.slice(0, 80))

/* ---------- the board ---------- */
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    /* Conjures a second origin that is not loopback, so the Origin check has
       something real to refuse. */
    `--host-resolver-rules=MAP evil.test 127.0.0.1`,
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.evaluate(({ relay, key, ai }) => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
  localStorage.setItem('ideation.mcp.url', relay)
  /* So draw_image has a key and somewhere to send it. */
  localStorage.setItem('ideation.ai.key', key)
  localStorage.setItem('ideation.ai.base', ai)
  localStorage.setItem('ideation.ai.model', 'fake-image-generate')
}, { relay: RELAY, key: KEY, ai: `http://127.0.0.1:${AI_PORT}/v1beta` })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

/* ---------- attaching, through the interface a person would use ---------- */
await page.locator('.viewport').click({ position: { x: 90, y: 800 } })
await page.keyboard.press('Meta+k')
await page.waitForTimeout(300)
if (!(await page.locator('.cmd-input').count())) {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
}
await page.keyboard.type('Connect to Claude')
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.sheet h3', { timeout: 4000 })
ok('the command list can reach it', /Connect to Claude/.test(await page.locator('.sheet h3').innerText()))

await page.waitForTimeout(1200)
await page.locator('.sheet-actions button', { hasText: /^Connect$/ }).click()
await page.waitForTimeout(1200)
ok('and says when it is attached', /attached/i.test(await page.locator('.relay-state').innerText()),
   await page.locator('.relay-state').innerText())
await page.locator('.sheet-actions button', { hasText: 'Close' }).click()
await page.waitForTimeout(400)
ok('the corner says so too, for as long as it is true',
   (await page.locator('.stats-relay[data-on]').count()) === 1)
fs.writeFileSync(path.join(OUT, 'mcp-attached.png'), await page.screenshot())

const cards = () => page.evaluate(() =>
  [...document.querySelectorAll('.card')].map((c) => ({
    id: c.dataset.id, kind: c.dataset.kind, sel: c.dataset.sel === 'true',
    x: Math.round(c.getBoundingClientRect().x),
  })))

/* ---------- reading ---------- */
let r = await call('get_board')
ok('an empty board reads as empty', !r.isError && r.json?.cards?.length === 0 && r.json?.board?.name?.length > 0,
   JSON.stringify(r.json?.board))

/* ---------- writing ---------- */
r = await call('add_card', { kind: 'note', text: 'warm terracotta, hard light', x: 200, y: 200 })
const noteId = r.json?.id
await page.waitForTimeout(600)
ok('a note put down by Claude is really on the board',
   !r.isError && (await cards()).some((c) => c.id === noteId && c.kind === 'note'), JSON.stringify(r.json))
ok('and the person can see its words',
   /terracotta/.test(await page.locator(`.card[data-id="${noteId}"]`).innerText()))

r = await call('get_board')
ok('and reading the board back finds it', r.json?.cards?.some((c) => c.id === noteId && /terracotta/.test(c.text || '')))

r = await call('add_card', { kind: 'section', text: 'Palette', x: 700, y: 200 })
const sectionId = r.json?.id
await page.waitForTimeout(400)
ok('a section is named rather than filled with words', !r.isError && r.json?.name === 'Palette', JSON.stringify(r.json))

r = await call('connect_cards', { from: noteId, to: sectionId })
await page.waitForTimeout(500)
ok('two cards can be joined up', !r.isError && (await page.locator('.wires path, .wires line').count()) > 0, r.text.slice(0, 60))

r = await call('update_card', { id: noteId, pick: 'in', tag: 'green' })
await page.waitForTimeout(400)
ok('and the decision the board is for can be made from outside',
   !r.isError && r.json?.pick === 'in' && r.json?.tag === 'green', JSON.stringify(r.json))
ok('which shows on the card', (await page.locator(`.card[data-id="${noteId}"][data-pick="in"]`).count()) === 1)

const wasX = (await cards()).find((c) => c.id === noteId)?.x
r = await call('move_card', { id: noteId, x: 420, y: 260 })
await page.waitForTimeout(500)
ok('a card can be moved', !r.isError && (await cards()).find((c) => c.id === noteId)?.x !== wasX,
   `${wasX} -> ${(await cards()).find((c) => c.id === noteId)?.x}`)

r = await call('select_cards', { ids: [noteId] })
await page.waitForTimeout(400)
ok('and pointed at, so the person can see which one is meant',
   !r.isError && (await cards()).find((c) => c.id === noteId)?.sel === true)

/* ---------- drawing, through the relay ---------- */
r = await call('draw_image', { prompt: 'a cracked pot on a windowsill', count: 2, aspect: '3:2' })
await page.waitForTimeout(800)
ok('Claude can ask for a picture that does not exist yet',
   !r.isError && r.json?.drew === 2, r.text.slice(0, 120))
ok('and both are real pictures on the board',
   (await page.locator('.card[data-kind="image"] img.media').count()) === 2)
fs.writeFileSync(path.join(OUT, 'mcp-drawn.png'), await page.screenshot())

/* ---------- and can work from what is already there ---------- */
/* The reason this matters on a moodboard: the reference is on the board
   already, so "the same one, at night" said about a card beats describing it
   from scratch. Checked at the request, not at the card: a picture that landed
   while nothing was sent would look exactly like it worked. */
const shown = r.json?.cards?.[0]?.id
r = await call('draw_image', { prompt: 'the same pot, at night', from: [shown] })
await page.waitForTimeout(600)
ok('Claude can ask for a picture made from one already on the board',
   !r.isError && r.json?.workedFrom === 1, r.text.slice(0, 120))
const asked = sent.filter((s) => s.path.endsWith('fake-image-generate:generateContent')).slice(-1)[0]
const parts = asked?.body?.contents?.[0]?.parts || []
ok('and the picture really goes with it',
   parts.some((p) => p.inlineData?.data?.length > 100) && parts[parts.length - 1]?.text === 'the same pot, at night',
   JSON.stringify(parts.map((p) => (p.inlineData ? `a picture, ${p.inlineData.data.length}b` : p.text))))

r = await call('draw_image', { prompt: 'x', from: ['i_nosuchcard'] })
ok('and a card that is not there is said plainly rather than quietly ignored',
   r.isError && /no card/i.test(r.text), r.text.slice(0, 80))

/* ---------- arranging and looking ---------- */
r = await call('arrange', { how: 'tidy' })
await page.waitForTimeout(600)
ok('the whole board can be tidied', !r.isError && r.json?.arranged >= 4, r.text.slice(0, 60))
r = await call('fit_view')
await page.waitForTimeout(600)
ok('and the view moved so a person can see the result', !r.isError, r.text.slice(0, 60))

/* ---------- boards are records of their own ---------- */
r = await call('list_boards')
ok('every board this browser holds can be listed',
   !r.isError && Array.isArray(r.json) && r.json.some((b) => b.open), r.text.slice(0, 80))

/* ---------- what it refuses ---------- */
r = await call('move_card', { id: 'i_nosuchcard', x: 0, y: 0 })
ok('a card that is not there is said plainly, not guessed at',
   r.isError && /no card/i.test(r.text), r.text.slice(0, 80))
r = await call('add_card', { kind: 'sculpture' })
ok('and so is a kind of card that does not exist', r.isError && /note, label, section or link/.test(r.text), r.text.slice(0, 80))

/* ---------- deleting is one step of undo ---------- */
const before = (await cards()).length
r = await call('delete_cards', { ids: [noteId] })
await page.waitForTimeout(500)
ok('Claude can take a card off the board', !r.isError && (await cards()).length < before)
await page.locator('.viewport').click({ position: { x: 90, y: 800 } })
await page.keyboard.press('Control+z')
await page.waitForTimeout(600)
ok('and one press of undo brings it back, because it went through the same store',
   (await cards()).some((c) => c.id === noteId), `${(await cards()).length} cards`)

/* ---------- the part that keeps everyone else out ---------- */
const evilPage = await browser.newPage()
await evilPage.goto(`http://evil.test:${EVIL_PORT}/`, { waitUntil: 'domcontentloaded' })
const stranger = await evilPage.evaluate(async (relay) => {
  const out = {}
  try {
    const res = await fetch(`${relay}/events`)
    out.status = res.status
    out.body = (await res.text()).slice(0, 80)
  } catch (e) {
    out.threw = String(e).slice(0, 80)
  }
  /* The one thing it is allowed to read is that something is listening — which
     it could work out from timing anyway. Not whether a board is attached. */
  try {
    const res = await fetch(`${relay}/health`)
    const j = await res.json()
    out.health = { status: res.status, allowed: j.allowed, connected: j.connected }
  } catch (e) {
    out.health = { threw: String(e).slice(0, 60) }
  }
  /* And the one that would do the damage: writing. */
  try {
    const res = await fetch(`${relay}/reply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":1,"ok":true}',
    })
    out.writeStatus = res.status
  } catch (e) {
    out.writeThrew = String(e).slice(0, 80)
  }
  return out
}, RELAY)
ok('another site cannot open the stream, in a real browser, from a real other origin',
   stranger.status === 403 || !!stranger.threw, JSON.stringify(stranger))
ok('and is told nothing about the board when it asks how things are',
   stranger.health?.status === 403 && stranger.health?.connected === undefined && stranger.health?.allowed === false,
   JSON.stringify(stranger.health))
ok('and cannot write to it either', stranger.writeStatus !== 200, JSON.stringify(stranger))
ok('the relay wrote down who it turned away', relayLog.some((l) => /refused a request from .*evil\.test/.test(l)),
   relayLog.filter((l) => /refused/.test(l)).join(' | ') || 'nothing logged')
await evilPage.close()

/* And the board is untouched by any of that. */
r = await call('get_board')
ok('and the board carried on regardless', !r.isError && r.json?.cards?.length > 0)

/* ---------- the tab going away is noticed at once ---------- */
await page.close()
await new Promise((res) => setTimeout(res, 600))
const t0 = Date.now()
r = await call('get_board')
ok('a closed board is reported at once rather than waited out',
   r.isError && Date.now() - t0 < 5000, `${Date.now() - t0}ms — ${r.text.slice(0, 60)}`)

/* ---------- and a relay that is not there is called what it is ---------- */
relay.kill()
await new Promise((res) => setTimeout(res, 400))
const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page2.on('pageerror', (e) => errors.push(e.message))
await page2.goto(BASE, { waitUntil: 'domcontentloaded' })
/* A fresh page is a fresh browser context, so it remembers nothing. Left as a
   tab that had been attached would have been. */
await page2.evaluate((relay) => {
  localStorage.setItem('ideation.mcp.url', relay)
  localStorage.setItem('ideation.mcp.on', '1')
}, RELAY)
await page2.reload({ waitUntil: 'domcontentloaded' })
/* It was left attached, so it tries again on load — against nothing. A browser
   answers a refused connection by quietly retrying for ever, so the corner
   would sit on "attaching" looking like it was about to work. */
await page2.waitForTimeout(11_000)
const corner = await page2.locator('.stats-relay').innerText().catch(() => '')
ok('a relay that is not running is said to be gone, not left looking imminent',
   /lost/i.test(corner), corner || 'nothing in the corner')
await page2.close()

console.log('\npage errors:', errors.length ? errors.slice(0, 5) : 'none')
const failed = results.filter((x) => !x.p)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
console.log(failed.length || errors.length ? 'FAIL' : 'PASS')
await browser.close()
ai.close()
evil.close()
process.exit(failed.length || errors.length ? 1 : 0)
