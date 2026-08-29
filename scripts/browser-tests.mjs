/* Every browser suite, in one command.
 *
 *   npm run build && npm run test:browser
 *   npm run test:browser -- ui menu        # just these two
 *
 * Each suite in test/ drives a real browser and needs a server to point at.
 * Starting that server by hand, remembering the port, and then running sixteen
 * commands in order is exactly the sort of thing nobody does twice — which is
 * how a suite quietly rots. This starts the server, runs them all against it,
 * and puts the server away afterwards whatever happens.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/* Slowest last, so a quick mistake is reported quickly. urlvideo reaches the
 * open internet, so it is kept apart from the rest. */
const SUITES = [
  'ui', 'menu', 'search', 'sections', 'notes', 'boards', 'wires', 'transfer',
  'arrange', 'touch', 'access', 'looks', 'palette', 'present', 'decide', 'fit', 'drop', 'tabs', 'curate', 'compare',
  'help', 'findall', 'sendable', 'undoboards', 'undelete', 'nospace', 'draw', 'mcp', 'moving', 'embed', 'offline', 'reclaim', 'manyboards', 'stacked',
  'png', 'poster', 'urlimage', 'aspect', 'video', 'effects', 'ascii',
]
const NETWORK = ['urlvideo']

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const withNetwork = process.argv.includes('--network')
const list = wanted.length ? wanted : withNetwork ? [...SUITES, ...NETWORK] : SUITES

const PORT = Number(process.env.PORT || 4173)
const BASE = `http://localhost:${PORT}`

if (!existsSync(path.join(process.cwd(), 'dist', 'index.html'))) {
  console.error('No dist/ to serve. Run `npm run build` first.')
  process.exit(2)
}

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts })
    p.on('exit', (code) => resolve(code ?? 1))
  })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
const stop = () => {
  try {
    server.kill('SIGTERM')
  } catch {
    /* already gone */
  }
}
process.on('exit', stop)
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})

/* Wait for it to answer rather than guessing at a delay. */
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(1000) })
      if (r.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

if (!(await ready())) {
  console.error(`The preview server never answered on ${BASE}.`)
  stop()
  process.exit(2)
}

/* Playwright launches its own chromium unless CHROME_PATH names another. CI
 * installs one; a container that already has a browser somewhere else can say
 * where rather than downloading a second copy. */
if (!process.env.CHROME_PATH) {
  const { chromium } = await import('playwright')
  try {
    const browser = await chromium.launch()
    await browser.close()
  } catch {
    console.error(
      'No browser to drive. Either `npx playwright install chromium`,\n' +
        'or set CHROME_PATH to one you already have.'
    )
    stop()
    process.exit(2)
  }
}

const failed = []
const started = Date.now()
for (const suite of list) {
  const file = path.join('test', `${suite}.mjs`)
  if (!existsSync(file)) {
    console.error(`\n### ${suite}: no such suite`)
    failed.push(suite)
    continue
  }
  console.log(`\n### ${suite}`)
  const code = await run(process.execPath, [file, BASE])
  if (code !== 0) failed.push(suite)
}

stop()
const mins = ((Date.now() - started) / 60000).toFixed(1)
console.log(`\n${list.length - failed.length}/${list.length} suites passed in ${mins} min`)
if (failed.length) console.log(`failed: ${failed.join(' ')}`)
process.exit(failed.length ? 1 : 0)
