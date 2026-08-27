#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * The board, as something Claude can hold.
 *
 *   Claude  --JSON-RPC over stdio-->  this  --HTTP on 127.0.0.1-->  the browser
 *
 * The board has no server and never will: everything it knows lives in one
 * browser's IndexedDB. So an agent cannot be handed a database to read. What
 * it can be handed is a way to ask the tab that has the board open, which is
 * what this is — the same shape Figma uses, where the local process is a relay
 * and the application is the thing that actually holds the document.
 *
 * Nothing is installed to run it. MCP over stdio is JSON-RPC in newline
 * delimited JSON, and the bridge is an event stream out and a POST back, so
 * the whole thing is Node's own http and nothing else. A tool for looking at
 * pictures should not drag a dependency tree behind it.
 *
 * WHO IS ALLOWED TO CONNECT
 *
 * This listens on the loopback address, and every page in the browser can
 * reach loopback. Without a check, any site you happened to be visiting could
 * open the stream and read — or rewrite — your board.
 *
 * The check is the Origin header. A browser sets it on every cross-origin
 * request and a page cannot forge it, so an allowed list of origins is a real
 * boundary rather than a polite one. Loopback origins are allowed by default,
 * because that is the app you are developing against; the address you deployed
 * to has to be named with --origin, once. A missing or null Origin is refused
 * outright: it means a sandboxed frame or something that is not a browser.
 *
 * --token adds a shared secret on top. It is off by default and it is not the
 * boundary — Origin is — but it is there for a machine where something else
 * untrusted is already running.
 * ------------------------------------------------------------------------- */

import http from 'node:http'
import { createInterface } from 'node:readline'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return fallback
}

const PORT = Number(flag('port', process.env.IDEATION_PORT || 4319))
const TOKEN = flag('token', process.env.IDEATION_TOKEN || '')
const EXTRA = (flag('origin', process.env.IDEATION_ORIGIN || '') || '')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
/* How long to wait for the tab before giving up on one call. Generous, because
 * drawing four pictures really does take two minutes — and the usual reason a
 * call never comes back is the tab going away, which is noticed at once rather
 * than waited out. */
const PATIENCE = Number(flag('timeout', process.env.IDEATION_TIMEOUT || 180_000))

/* stdout is the JSON-RPC channel and must carry nothing else. */
const log = (...a) => console.error('[ideation]', ...a)

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

function allowed(origin) {
  if (!origin || origin === 'null') return false
  const o = origin.replace(/\/+$/, '')
  if (LOOPBACK.test(o)) return true
  return EXTRA.includes(o)
}

/* ---------------------------------------------------------------------------
 * The tools, which are the whole vocabulary an agent gets for this board.
 *
 * Every one of them is carried out by the tab, not here. This file knows their
 * names and the shape of their arguments and nothing whatever about what a
 * card is, which is why adding a card kind does not mean editing two programs.
 * ------------------------------------------------------------------------- */

const num = (d) => ({ type: 'number', description: d })
const str = (d) => ({ type: 'string', description: d })

const TOOLS = [
  {
    name: 'get_board',
    description:
      'Read the board that is open: its name, where it sits in the tree, and every card on it with ' +
      'position, size, kind, words, colour, tag and whether it has been kept or cut. Start here — ' +
      'nothing else can refer to a card without an id from this.',
    inputSchema: {
      type: 'object',
      properties: {
        kinds: { type: 'array', items: { type: 'string' }, description: 'Only these kinds, e.g. ["image","note"]. Omit for all.' },
        limit: num('At most this many cards, in board order. Default 300.'),
      },
    },
  },
  {
    name: 'list_boards',
    description: 'Every board this browser holds, with how many cards are on each. Boards nest, so this is the tree.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_card',
    description:
      'Put a card down. A note holds words, a label is a line of text on the board itself, a section is ' +
      'a titled area that carries what is inside it when moved, and a link becomes a real card for what ' +
      'is at the other end.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['note', 'label', 'section', 'link'], description: 'What sort of card.' },
        text: str('The words, for a note. The name, for a label or section. Ignored for a link.'),
        url: str('The address, for a link.'),
        x: num('Board coordinates. Omitted, it goes in the middle of the view.'),
        y: num('Board coordinates.'),
        colour: str('Hex, e.g. "#F2C14E". Notes and labels only.'),
      },
      required: ['kind'],
    },
  },
  {
    name: 'draw_image',
    description:
      'Make a picture and put it on the board. Uses the key the person saved in their own browser — this ' +
      'asks their browser to ask Google, and it is billed to them, so do not draw things nobody asked for. ' +
      'Slow: ten seconds or more each. Pass `from` with card ids to work from pictures already on the ' +
      'board — "the same pot, at night" said about a card beats describing that pot from scratch, and it ' +
      'is what a board full of references is for.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: str('What to draw. A description of a picture; with `from`, what to do to the ones given.'),
        from: {
          type: 'array',
          items: { type: 'string' },
          description: 'Card ids, from get_board, whose pictures the model should work from. Image cards only.',
        },
        count: num('How many, 1 to 4. Several answers to one prompt arrive side by side. Default 1.'),
        aspect: str('Shape, e.g. "1:1", "3:2", "16:9", "9:16". Omit to let the model choose.'),
        x: num('Board coordinates. Omitted, they go in the middle of the view.'),
        y: num('Board coordinates.'),
      },
      required: ['prompt'],
    },
  },
  {
    name: 'update_card',
    description: 'Change a card that is already there: its words, its colour, its tag, or whether it is kept or cut.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('The card, from get_board.'),
        text: str('New words for a note, or a new name for anything else.'),
        colour: str('Hex.'),
        tag: { type: 'string', enum: ['red', 'amber', 'green', 'blue', 'violet', 'none'], description: 'A category colour, or "none".' },
        pick: { type: 'string', enum: ['in', 'out', 'none'], description: 'Kept, cut, or undecided. This is the decision the board is for.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'move_card',
    description: 'Put a card somewhere else, and optionally give it a different size.',
    inputSchema: {
      type: 'object',
      properties: { id: str('The card.'), x: num('New left edge.'), y: num('New top edge.'), w: num('New width.'), h: num('New height.') },
      required: ['id', 'x', 'y'],
    },
  },
  {
    name: 'delete_cards',
    description: 'Take cards off the board. One press of undo brings them back, but ask before removing anything you did not put there.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, description: 'The cards.' } },
      required: ['ids'],
    },
  },
  {
    name: 'connect_cards',
    description: 'Draw an arrow from one card to another. The arrow follows them both when either is moved.',
    inputSchema: {
      type: 'object',
      properties: { from: str('The card it leaves.'), to: str('The card it arrives at.') },
      required: ['from', 'to'],
    },
  },
  {
    name: 'arrange',
    description: 'Tidy a set of cards into a grid, line them up along an edge, or space them out evenly.',
    inputSchema: {
      type: 'object',
      properties: {
        how: { type: 'string', enum: ['tidy', 'left', 'hcentre', 'right', 'top', 'vmiddle', 'bottom', 'spread-x', 'spread-y'] },
        ids: { type: 'array', items: { type: 'string' }, description: 'Which cards. Omit for everything on the board.' },
      },
      required: ['how'],
    },
  },
  {
    name: 'select_cards',
    description:
      'Pick cards out on screen. Use it to show which ones you mean before saying anything about them — ' +
      'the person is looking at the board, and pointing beats describing.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, description: 'The cards. An empty list clears it.' } },
      required: ['ids'],
    },
  },
  {
    name: 'fit_view',
    description: 'Move the view so the whole board, or just what is selected, is on screen.',
    inputSchema: { type: 'object', properties: { selection: { type: 'boolean', description: 'True for the selection only.' } } },
  },
]

/* ---------------------------------------------------------------------------
 * The bridge: one browser tab at a time, an event stream out, a POST back.
 * ------------------------------------------------------------------------- */

let tab = null
let seq = 0
const waiting = new Map()

function send(res, code, body, origin) {
  const head = { 'Content-Type': 'application/json' }
  if (origin) {
    head['Access-Control-Allow-Origin'] = origin
    head['Vary'] = 'Origin'
  }
  res.writeHead(code, head).end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const origin = req.headers.origin

  /* Asked before offering to connect, and answered in three ways rather than
   * two, because "no relay" and "a relay that has not been told about this
   * page" are different problems with different fixes — and the second is what
   * anybody using a deployed address hits first.
   *
   * A refusal here carries the headers that let the page read it. Strangers
   * therefore learn that something is listening, which they could time a fetch
   * to work out anyway; what they do not learn is whether a board is attached,
   * which is the only part worth keeping from them. */
  if (url.pathname === '/health') {
    if (!allowed(origin)) {
      return send(res, 403, { up: true, allowed: false, tell: origin || null }, origin || '*')
    }
    return send(res, 200, { ok: true, allowed: true, connected: !!tab, needsToken: !!TOKEN }, origin)
  }

  if (!allowed(origin)) {
    log('refused a request from', origin || '(no origin)')
    return send(res, 403, { error: 'This origin is not allowed. Start the relay with --origin ' + (origin || '<your site>') }, null)
  }

  if (req.method === 'OPTIONS') {
    const head = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    }
    /* Chrome asks before letting a public page reach a private address. */
    if (req.headers['access-control-request-private-network']) {
      head['Access-Control-Allow-Private-Network'] = 'true'
    }
    return res.writeHead(204, head).end()
  }

  if (TOKEN && url.searchParams.get('token') !== TOKEN) {
    return send(res, 403, { error: 'Wrong token.' }, origin)
  }

  /* ---------- the tab attaches ---------- */
  if (url.pathname === '/events') {
    if (tab) {
      /* A second tab would mean two boards answering the same question. The
       * newest one wins, which is what happens when somebody reloads. */
      try { tab.end() } catch { /* already gone */ }
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    })
    res.write(': open\n\n')
    tab = res
    log('a board attached from', origin)
    const beat = setInterval(() => {
      try { res.write(': beat\n\n') } catch { /* closing */ }
    }, 20_000)
    req.on('close', () => {
      clearInterval(beat)
      if (tab === res) {
        tab = null
        log('the board went away')
        /* Anything still waiting is waiting on a tab that has closed. Saying so
         * now is the difference between an answer and three minutes of
         * nothing. */
        for (const [id, w] of waiting) {
          clearTimeout(w.timer)
          waiting.delete(id)
          w.done({ ok: false, error: 'The board was closed before it could answer.' })
        }
      }
    })
    return
  }

  /* ---------- the tab answers ---------- */
  if (url.pathname === '/reply' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => {
      body += c
      /* A reply carries a board, not a video. */
      if (body.length > 8_000_000) req.destroy()
    })
    req.on('end', () => {
      let msg
      try {
        msg = JSON.parse(body)
      } catch {
        return send(res, 400, { error: 'bad json' }, origin)
      }
      const w = waiting.get(msg.id)
      if (w) {
        waiting.delete(msg.id)
        clearTimeout(w.timer)
        w.done(msg)
      }
      return send(res, 200, { ok: true }, origin)
    })
    return
  }

  return send(res, 404, { error: 'no such thing' }, origin)
})

/* Ask the tab to do something, and wait for it to say what happened. */
function ask(tool, args) {
  return new Promise((resolve) => {
    if (!tab) {
      return resolve({
        ok: false,
        error:
          'No board is attached. Open the board in a browser, then Commands (⌘K) → "Connect to Claude". ' +
          'The relay is listening on http://127.0.0.1:' + PORT + '.',
      })
    }
    const id = ++seq
    const timer = setTimeout(() => {
      waiting.delete(id)
      resolve({ ok: false, error: `The board did not answer within ${Math.round(PATIENCE / 1000)}s.` })
    }, PATIENCE)
    waiting.set(id, { done: resolve, timer })
    try {
      tab.write(`data: ${JSON.stringify({ id, tool, args })}\n\n`)
    } catch {
      waiting.delete(id)
      clearTimeout(timer)
      resolve({ ok: false, error: 'The board went away mid-question.' })
    }
  })
}

/* ---------------------------------------------------------------------------
 * MCP, over stdin and stdout.
 * ------------------------------------------------------------------------- */

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')
const reply = (id, result) => write({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } })

/* Every revision so far speaks the same core, and tools are all this uses, so
 * the client's own version is echoed rather than argued with. */
const KNOWN = ['2025-06-18', '2025-03-26', '2024-11-05']

async function handle(msg) {
  const { id, method, params } = msg

  if (method === 'initialize') {
    const want = params?.protocolVersion
    return reply(id, {
      protocolVersion: KNOWN.includes(want) ? want : KNOWN[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'ideation-board', version: '1.0.0' },
      instructions:
        'A moodboard held in someone\'s browser. Read it with get_board before touching anything: card ids ' +
        'come from there and from nowhere else. Coordinates are the board\'s own, y downwards, and a card ' +
        'is roughly 300 to 420 across, so leave 24 between them. Prefer select_cards to pointing in words. ' +
        'draw_image spends the person\'s own money and takes about ten seconds a picture.',
    })
  }

  /* Notifications carry no id and are not answered. */
  if (id === undefined) return

  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: TOOLS })

  if (method === 'tools/call') {
    const name = params?.name
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) return fail(id, -32602, `No tool called ${name}.`)
    const out = await ask(name, params?.arguments || {})
    /* A tool that failed is reported as a result rather than as a protocol
     * error, because the model is meant to read it and try something else. */
    return reply(id, {
      content: [{ type: 'text', text: out.ok ? JSON.stringify(out.result ?? null, null, 1) : String(out.error || 'It did not work.') }],
      isError: !out.ok,
    })
  }

  /* Declared as neither, so an over-eager client asking is told plainly. */
  if (method === 'resources/list' || method === 'prompts/list') {
    return reply(id, method === 'resources/list' ? { resources: [] } : { prompts: [] })
  }

  return fail(id, -32601, `No method called ${method}.`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const s = line.trim()
  if (!s) return
  let msg
  try {
    msg = JSON.parse(s)
  } catch {
    return log('could not read a line from the client')
  }
  /* A batch is a list. Each is answered on its own. */
  const list = Array.isArray(msg) ? msg : [msg]
  for (const m of list) {
    Promise.resolve(handle(m)).catch((e) => {
      log('a call went wrong:', e?.message || e)
      if (m?.id !== undefined) fail(m.id, -32603, String(e?.message || e))
    })
  }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`port ${PORT} is already taken — is another relay running? Use --port to pick a different one.`)
  } else {
    log('the relay could not start:', e.message)
  }
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  log(`relay on http://127.0.0.1:${PORT}`)
  log('allowed origins:', ['loopback', ...EXTRA].join(', '))
  if (TOKEN) log('a token is required')
})

/* Closing stdin is the client going away. */
process.stdin.on('end', () => {
  try { server.close() } catch { /* nothing to close */ }
  process.exit(0)
})
