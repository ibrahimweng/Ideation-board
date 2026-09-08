/* ---------------------------------------------------------------------------
 * A card you write.
 *
 * Every other picture on this board arrived from somewhere: dropped, pasted,
 * fetched, rendered out of a file. This one is written. A dozen lines of
 * drawing code become a card, and from that moment the card is a picture like
 * any other — it takes the effects, exports, gives up its colours, and can be
 * varied twelve ways.
 *
 * That is the whole of the idea, and it is worth being clear about why it
 * earns its place on a moodboard rather than being a programming toy. A
 * moodboard is a place for things that are nearly right. Code is the only
 * material here that can be asked to produce a hundred nearly-right things and
 * be edited between each one — and generative work has always been a design
 * practice rather than a programming one: a grid you can shake, a pattern with
 * a dial on it, a hundred versions of a mark. What was missing was somewhere
 * to put the output next to the photographs.
 *
 * ## In a worker, always
 *
 * The code runs in a worker made for the run and thrown away after it, for one
 * reason above all others: a loop that never ends can only be stopped by
 * killing the thing running it. On the main thread a missing increment locks
 * the tab and the board goes with it. In a worker it is a card that says it
 * took too long, and the board never notices.
 *
 * The worker is also the smallest place to stand. Everything that reaches out
 * of it — fetch, sockets, storage, other workers — is taken off the global
 * before a line of the sketch is read. The person writing the code is the
 * person who owns the board, so this is not a wall against an attacker; it is
 * the same courtesy the rest of the app extends, which is that nothing here
 * goes anywhere, and code somebody pasted in from a forum should not be the
 * exception that quietly does.
 *
 * ## What the sketch is handed
 *
 * A 2D context, the size, a seeded random, and — if a card is wired into it —
 * that card's picture. The last one is what makes this part of the board
 * rather than a canvas beside it: a sketch can read a photograph, and code
 * becomes another way to treat a picture, alongside the sixty-four effects.
 * ------------------------------------------------------------------------- */

/* Long enough to draw something with a hundred thousand strokes in it, short
 * enough that a runaway loop is over before anyone reaches for the tab. */
export const TIMEOUT_MS = 4000

/* The long side of the render, matching everything else the board decodes to.
 * The card's own shape decides the other one. */
export const SIZE = 1024

export interface Drawn {
  blob: Blob
  /* How long the code itself took, which is the number a person tuning a
   * sketch actually wants and cannot otherwise see. */
  ms: number
  w: number
  h: number
}

export interface Refused {
  error: string
}

export const refused = (r: Drawn | Refused): r is Refused => 'error' in r

/* The harness, as the source of the worker that runs it.
 *
 * Written as a string rather than as a file so that what the sketch can see is
 * one readable page rather than a build artefact — and so the list of things
 * taken away sits directly above the line that runs the code. */
const HARNESS = `
self.onmessage = async (e) => {
  /* Kept before anything is taken away, because replying is done through it. */
  const reply = self.postMessage.bind(self)
  const say = (o) => { try { reply(o) } catch (err) { reply({ error: 'that drawing could not be sent back' }) } }

  /* Everything that leaves this worker, or outlives it. A sketch draws; it
     does not fetch, store, listen or start anything. */
  const GONE = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
    'indexedDB', 'caches', 'localStorage', 'sessionStorage',
    'Worker', 'SharedWorker', 'BroadcastChannel', 'Notification', 'navigator',
  ]
  for (const k of GONE) {
    try { Object.defineProperty(self, k, { value: undefined, configurable: true, writable: true }) } catch (err) { /* frozen already */ }
  }

  const { code, w, h, seed, src } = e.data
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  /* A sketch starts on paper. A transparent start looks identical until it is
     exported or laid on a dark board, and then it is a hole. */
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  /* Seeded, so a sketch that is worth keeping comes back the same next time
     the board is opened — and so rolling again is a decision rather than an
     accident. */
  let s = (seed >>> 0) || 1
  const rand = (a, b) => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
    if (a === undefined) return r
    if (b === undefined) return r * a
    return a + r * (b - a)
  }

  const started = self.performance ? performance.now() : 0
  try {
    /* The sketch is a function body, not a module: no imports to resolve, no
       exports to name, and the arguments below are the whole API. */
    const fn = new Function('ctx', 'w', 'h', 'rand', 'img', 'seed', code)
    fn(ctx, w, h, rand, src || null, seed)
  } catch (err) {
    say({ error: (err && err.message) ? String(err.message) : String(err) })
    return
  }
  const ms = Math.round((self.performance ? performance.now() : 0) - started)

  try {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    say({ blob, ms, w, h })
  } catch (err) {
    say({ error: 'that drawing could not be turned into a picture' })
  }
}
`

let url: string | null = null
const harnessUrl = () => {
  if (!url) url = URL.createObjectURL(new Blob([HARNESS], { type: 'text/javascript' }))
  return url
}

/* Runs one sketch and hands back a picture, or the reason there is not one.
 *
 * Never throws and never leaves a worker behind: the timeout is the only thing
 * that can stop a loop with no end in it, so it is the one path that has to be
 * right whatever else happens. */
export function drawSketch(
  code: string,
  opts: { w: number; h: number; seed: number; src?: ImageBitmap | null }
): Promise<Drawn | Refused> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(harnessUrl())
    } catch {
      resolve({ error: 'this browser will not run a sketch' })
      return
    }
    let done = false
    const finish = (out: Drawn | Refused) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      worker.terminate()
      resolve(out)
    }
    const timer = window.setTimeout(
      () => finish({ error: `that took longer than ${Math.round(TIMEOUT_MS / 1000)} seconds, so it was stopped` }),
      TIMEOUT_MS
    )
    worker.onmessage = (e: MessageEvent) => finish(e.data as Drawn | Refused)
    worker.onerror = (e: ErrorEvent) => finish({ error: e.message || 'that sketch would not run' })
    try {
      worker.postMessage(
        { code, w: opts.w, h: opts.h, seed: opts.seed, src: opts.src || null },
        opts.src ? [opts.src] : []
      )
    } catch {
      finish({ error: 'that sketch could not be started' })
    }
  })
}

/* The shape to render at: the card's own, with the long side at SIZE, so a
 * sketch written for a wide card is drawn wide rather than drawn square and
 * cropped. */
export function sizeFor(w: number, h: number): { w: number; h: number } {
  const long = Math.max(1, Math.max(w, h))
  const k = SIZE / long
  return { w: Math.max(16, Math.round(w * k)), h: Math.max(16, Math.round(h * k)) }
}
