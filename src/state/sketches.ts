import { store } from './store'
import { putBlob, getBlob } from '../store/idb'
import { ensureSource } from '../board/sources'
import { decodeCapped, newKey } from '../store/media'
import { drawSketch, refused, sizeFor } from '../store/sketch'
import { feederKey, refreshFeeds } from './feeds'
import type { Item } from './types'
import { FX_0 } from '../engine/types'

/* ---------------------------------------------------------------------------
 * The shelf, and running what is on it.
 *
 * A blank editor is a worse offer than no editor. Nobody opens one and writes
 * a flow field; they open one, look at it, and close it. So the card starts
 * with something on it and the shelf holds seven more, each short enough to
 * read in one go and built so that the first thing you would change is
 * obvious — a count, a colour, a power.
 *
 * These are curated rather than open: nothing reads a sketch from anywhere but
 * this file and the card it is written on, and there is no gallery to browse
 * or fetch from. Growing the shelf is a commit, which is the same arrangement
 * the effects have.
 * ------------------------------------------------------------------------- */

export interface Starter {
  id: string
  name: string
  code: string
}

export const SHELF: Starter[] = [
  {
    id: 'grid',
    name: 'Grid',
    code: `/* A modular grid with some of its cells filled. Change n first. */
const n = 6
const cell = Math.min(w, h) / n
const ox = (w - cell * n) / 2
const oy = (h - cell * n) / 2

ctx.fillStyle = '#f4f2ec'
ctx.fillRect(0, 0, w, h)

for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    const r = rand()
    if (r > 0.62) continue
    ctx.fillStyle = r > 0.5 ? '#ff4d2e' : '#14141a'
    const px = ox + x * cell
    const py = oy + y * cell
    if (r < 0.18) {
      ctx.beginPath()
      ctx.arc(px + cell / 2, py + cell / 2, cell * 0.42, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(px + cell * 0.08, py + cell * 0.08, cell * 0.84, cell * 0.84)
    }
  }
}`,
  },
  {
    id: 'flow',
    name: 'Flow',
    code: `/* A field of angles, and four hundred short walks through it. */
ctx.fillStyle = '#0e0f13'
ctx.fillRect(0, 0, w, h)

const k = 0.0022 + rand() * 0.0026
ctx.lineWidth = Math.max(1.2, w / 620)

for (let i = 0; i < 400; i++) {
  let x = rand(w)
  let y = rand(h)
  ctx.strokeStyle = 'hsla(' + Math.round(rand(18, 58)) + ', 92%, ' + Math.round(rand(48, 78)) + '%, 0.55)'
  ctx.beginPath()
  ctx.moveTo(x, y)
  for (let s = 0; s < 110; s++) {
    const a = Math.sin(x * k) * Math.cos(y * k) * Math.PI * 2 + Math.sin((x + y) * k * 0.5) * 2
    x += Math.cos(a) * 4
    y += Math.sin(a) * 4
    if (x < 0 || y < 0 || x > w || y > h) break
    ctx.lineTo(x, y)
  }
  ctx.stroke()
}`,
  },
  {
    id: 'truchet',
    name: 'Tiles',
    code: `/* Two quarter circles a tile, turned at random. The oldest trick there is,
   and it still makes a pattern nobody would have drawn by hand. */
const n = 12
const s = Math.ceil(Math.max(w, h) / n)

ctx.fillStyle = '#fdfaf3'
ctx.fillRect(0, 0, w, h)
ctx.strokeStyle = '#1b1b22'
ctx.lineWidth = s * 0.16

for (let y = 0; y < h; y += s) {
  for (let x = 0; x < w; x += s) {
    const flip = rand() < 0.5
    ctx.beginPath()
    if (flip) ctx.arc(x, y, s / 2, 0, Math.PI / 2)
    else ctx.arc(x + s, y, s / 2, Math.PI / 2, Math.PI)
    ctx.stroke()
    ctx.beginPath()
    if (flip) ctx.arc(x + s, y + s, s / 2, Math.PI, Math.PI * 1.5)
    else ctx.arc(x, y + s, s / 2, Math.PI * 1.5, Math.PI * 2)
    ctx.stroke()
  }
}`,
  },
  {
    id: 'rings',
    name: 'Rings',
    code: `/* Circles with a bite out of each, all turned differently. */
ctx.fillStyle = '#101014'
ctx.fillRect(0, 0, w, h)

const cx = w / 2
const cy = h / 2
const max = Math.min(w, h) * 0.46

for (let r = max; r > max * 0.06; r -= max / 26) {
  const from = rand(Math.PI * 2)
  const gap = rand(0.15, 1.1)
  ctx.beginPath()
  ctx.arc(cx, cy, r, from, from + Math.PI * 2 - gap)
  ctx.strokeStyle = r > max * 0.5 ? '#f2efe6' : '#ffb03a'
  ctx.lineWidth = (max / 60) * rand(0.5, 1.6)
  ctx.stroke()
}`,
  },
  {
    id: 'bars',
    name: 'Bars',
    code: `/* The shape of a chart with the data taken out. */
ctx.fillStyle = '#efece4'
ctx.fillRect(0, 0, w, h)

const n = 9 + Math.floor(rand(8))
const m = w * 0.1
const step = (w - m * 2) / n
const base = h * 0.86

for (let i = 0; i < n; i++) {
  const tall = (0.14 + Math.pow(rand(), 1.6) * 0.62) * h
  ctx.fillStyle = rand() < 0.25 ? '#e2341d' : '#16161c'
  ctx.fillRect(m + i * step, base - tall, step * 0.62, tall)
}

ctx.fillStyle = '#16161c'
ctx.fillRect(m, base + h * 0.012, w - m * 2, Math.max(2, h / 300))`,
  },
  {
    id: 'split',
    name: 'Field',
    code: `/* Two colours and a horizon. Move the numbers, not the code. */
const hue = rand(360)
const sky = 'hsl(' + Math.round(hue) + ', 68%, 56%)'
const ground = 'hsl(' + Math.round((hue + rand(140, 220)) % 360) + ', 40%, 22%)'

ctx.fillStyle = ground
ctx.fillRect(0, 0, w, h)
const y = h * rand(0.28, 0.72)
ctx.fillStyle = sky
ctx.fillRect(0, 0, w, y)

/* A disc on the line, half in each. */
ctx.beginPath()
ctx.arc(w * rand(0.3, 0.7), y, Math.min(w, h) * rand(0.1, 0.26), 0, Math.PI * 2)
ctx.fillStyle = 'hsl(' + Math.round((hue + 40) % 360) + ', 92%, 70%)'
ctx.fill()`,
  },
  {
    id: 'scatter',
    name: 'Scatter',
    code: `/* Density instead of size: dots crowding towards one point. */
ctx.fillStyle = '#fbf9f4'
ctx.fillRect(0, 0, w, h)

const px = w * rand(0.3, 0.7)
const py = h * rand(0.3, 0.7)
const far = Math.hypot(w, h) * 0.5
ctx.fillStyle = '#15151b'

for (let i = 0; i < 9000; i++) {
  const x = rand(w)
  const y = rand(h)
  const d = Math.hypot(x - px, y - py) / far
  if (rand() < d * d) continue
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.6, (1 - d) * (w / 220)), 0, Math.PI * 2)
  ctx.fill()
}`,
  },
  {
    id: 'sampled',
    name: 'Rebuilt',
    code: `/* Reads the card wired into this one and rebuilds it out of its own
   colours. With nothing wired it draws the grid empty, which is honest. */
const n = 34
const cw = w / n
const ch = h / n

ctx.fillStyle = '#101013'
ctx.fillRect(0, 0, w, h)

if (!img) {
  ctx.strokeStyle = '#26262f'
  ctx.lineWidth = 1
  for (let i = 0; i <= n; i++) {
    ctx.beginPath()
    ctx.moveTo(i * cw, 0)
    ctx.lineTo(i * cw, h)
    ctx.moveTo(0, i * ch)
    ctx.lineTo(w, i * ch)
    ctx.stroke()
  }
} else {
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  ctx.fillStyle = '#101013'
  ctx.fillRect(0, 0, w, h)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) * cw))
      const sy = Math.min(h - 1, Math.floor((y + 0.5) * ch))
      const i = (sy * w + sx) * 4
      const lum = (d[i] * 0.21 + d[i + 1] * 0.72 + d[i + 2] * 0.07) / 255
      ctx.fillStyle = 'rgb(' + d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ')'
      ctx.beginPath()
      ctx.arc(x * cw + cw / 2, y * ch + ch / 2, Math.max(1, lum * cw * 0.62), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}`,
  },
]

export const starter = (id: string): Starter => SHELF.find((s) => s.id === id) || SHELF[0]

/* ---------------------------------------------------------------------------
 * The card.
 * ------------------------------------------------------------------------- */

let n = 0
const freshId = () => 'i' + Date.now().toString(36) + (n++).toString(36) + Math.random().toString(36).slice(2, 6)

export function sketchItem(at: { x: number; y: number }, code = SHELF[0].code): Item {
  return {
    id: freshId(), kind: 'sketch', x: Math.round(at.x), y: Math.round(at.y), z: 0,
    w: 380, h: 380, code, roll: Math.floor(Math.random() * 1e6),
    name: 'Sketch', fx: { ...FX_0 }, tag: null,
  }
}

/* ---------------------------------------------------------------------------
 * Running one.
 * ------------------------------------------------------------------------- */

const busy = new Set<string>()
export const running = (id: string) => busy.has(id)

/* The last thing a run said, for the editor to show. Kept here rather than on
 * the card because a card is a picture and an error is not one — a board that
 * saved its error messages would restore them a week later next to a picture
 * that is perfectly fine. */
const trouble = new Map<string, string>()
export const troubleWith = (id: string) => trouble.get(id) || null

/* Draws a sketch card and points it at what came out. Returns the reason it
 * did not, or null if it did.
 *
 * `record` is for the callers that have already opened a step of undo before
 * asking: throwing the dice again is one press to undo rather than two, and a
 * card that has just been put down should be removed by the first press rather
 * than losing only the picture it arrived with. */
export async function runSketch(id: string, code?: string, record = true): Promise<string | null> {
  const it = store.getItem(id)
  if (!it || it.kind !== 'sketch') return 'that card is not a sketch'
  if (busy.has(id)) return null
  busy.add(id)
  try {
    const src = code ?? it.code ?? ''
    const size = sizeFor(it.w, it.h)
    /* The card wired into this one, as a picture the sketch can read. Decoded
     * here rather than in the worker so that a sketch never touches storage.
     *
     * The map of what feeds what is built when a card asks React for it, and
     * this runs outside React — from a right click, from the editor, from a
     * board that has only just opened. So it is rebuilt first, which is what
     * `refreshFeeds` is for: without it a sketch rolled from the menu on a
     * board nothing else has looked at would be handed nothing, and would draw
     * the picture it draws when there is no card wired in. */
    refreshFeeds()
    let bmp: ImageBitmap | null = null
    const feed = feederKey(id)
    if (feed) {
      const blob = await getBlob(feed)
      if (blob) bmp = await decodeCapped(blob)
    }
    const out = await drawSketch(src, { w: size.w, h: size.h, seed: it.roll ?? 1, src: bmp })
    if (refused(out)) {
      trouble.set(id, out.error)
      return out.error
    }
    trouble.delete(id)

    const key = newKey('sk')
    await putBlob(key, out.blob)
    await ensureSource(key, out.blob)
    const still = store.getItem(id)
    if (!still || still.kind !== 'sketch') return null
    /* One step of undo for the whole run, and the card keeps its size: the
     * picture is drawn to the card's shape rather than the other way round. */
    store.update(id, { poster: key, code: src, nw: out.w, nh: out.h }, record)
    return null
  } catch (e) {
    const why = e instanceof Error ? e.message : 'that sketch would not run'
    trouble.set(id, why)
    return why
  } finally {
    busy.delete(id)
  }
}

/* Another throw of the dice, same code. The one press that makes this worth
 * having on a board: a sketch is not a picture, it is a way of making
 * hundreds, and this is the button that does it. */
export async function rollSketch(id: string): Promise<string | null> {
  const it = store.getItem(id)
  if (!it || it.kind !== 'sketch') return null
  store.beginGesture(0)
  store.update(id, { roll: Math.floor(Math.random() * 1e6) }, false)
  return runSketch(id, undefined, false)
}
