import type { Item } from './types'
import { TAGS } from './types'
import { isSection, isWire } from './kinds'
import { fitToPaper, paperFor, pdfBytes, posterBounds, posterScale } from './posterPage'
import type { PaperName } from './posterPage'
import { parse } from './rich'
import type { Block, Span } from './rich'
import { inkOn } from './palette'
import { peekSummary } from './boards'
import { renderCardPicture } from './exportImage'
import type { ExportedImage } from './exportImage'
import { getBlob } from '../store/idb'
import { portPoint, sideFacing, wirePath } from '../board/wire'
import { safeName } from '../store/fs'
import { hostOf } from './urls'

/* ---------------------------------------------------------------------------
 * The whole board, as one picture.
 *
 * Everything else this app exports is a piece of a board: a card as a PNG, a
 * board as a zip that only this app can open. Neither is the thing you are
 * asked for at the end of a week of collecting, which is the board itself —
 * flat, in one file, that opens anywhere and can go in an email.
 *
 * It is painted rather than screenshotted. There is no way to photograph the
 * board: it is larger than the window, it is spread across a WebGL canvas per
 * card, a hundred DOM nodes and an iframe or two, and half of it is scrolled
 * out of sight. So this walks the items in the order the board stacks them
 * and draws each one with the same geometry, the same type and the same
 * colours the CSS uses — read out of the live custom properties, so the sheet
 * comes out in whichever theme you are working in rather than in a copy of
 * the palette that has to be kept in step by hand.
 *
 * The pictures come back through the same path a single-card export takes, so
 * a photograph that is halftoned and cropped and warmed on the board is
 * halftoned and cropped and warmed here too.
 * ------------------------------------------------------------------------- */

export interface PosterOptions {
  /* Board pixels of air around the outside. */
  pad?: number
  /* Device pixels per board pixel. Two makes type on the sheet as sharp as
   * type on a retina screen; the cap below can lower it. */
  scale?: number
  /* Paint the board's own background behind everything, rather than leaving
   * the sheet transparent. */
  background?: boolean
  /* The two lines at the top that say what the sheet is. On by default: a
   * picture of a board with nothing to say whose it is becomes an anonymous
   * file in somebody's downloads a week later. */
  head?: boolean
  /* What each card is called, along the bottom of it. On by default, for the
   * same reason: a sheet is the thing you send somebody. */
  captions?: boolean
}

/* --------------------------------------------------------------------------
 * The palette, read off the document.
 * ------------------------------------------------------------------------ */

interface Tokens {
  bg: string
  surface: string
  well: string
  sunk: string
  line: string
  lineSoft: string
  ink: string
  muted: string
  onInk: string
  hover: string
  wire: string
  sans: string
}

function tokens(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--bg', '#f6f6f7'),
    surface: v('--surface', '#ffffff'),
    well: v('--well', '#ececef'),
    sunk: v('--sunk', '#f1f1f3'),
    line: v('--line', '#e4e4e7'),
    lineSoft: v('--line-soft', '#ededf0'),
    ink: v('--ink', '#18181b'),
    muted: v('--muted', '#7c7c86'),
    onInk: v('--on-ink', '#ffffff'),
    hover: v('--hover', 'rgba(24, 24, 27, 0.05)'),
    wire: v('--wire', '#a8a8b0'),
    sans: v('--sans', "'Instrument Sans', -apple-system, sans-serif"),
  }
}

/* --------------------------------------------------------------------------
 * Small drawing helpers.
 * ------------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D

/* Rounded rectangle by hand rather than through roundRect, which is newer
 * than the rest of what this file needs. */
function rrect(cx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2))
  cx.beginPath()
  cx.moveTo(x + rad, y)
  cx.arcTo(x + w, y, x + w, y + h, rad)
  cx.arcTo(x + w, y + h, x, y + h, rad)
  cx.arcTo(x, y + h, x, y, rad)
  cx.arcTo(x, y, x + w, y, rad)
  cx.closePath()
}

/* One line, cut short with an ellipsis when it will not fit. */
function ellipsis(cx: Ctx, text: string, max: number): string {
  if (cx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? text.slice(0, lo) + '…' : ''
}

/* Wrapped lines, breaking on spaces and, for a word longer than the column,
 * inside the word — which is what `word-break: break-all` does to a URL. */
function wrap(cx: Ctx, text: string, max: number): string[] {
  const out: string[] = []
  for (const para of String(text).split('\n')) {
    if (!para) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue
      const next = line + word
      if (cx.measureText(next).width <= max || !line.trim()) {
        if (cx.measureText(next).width > max && !line) {
          /* One word wider than the whole column: cut it where it fills. */
          let rest = word
          while (rest && cx.measureText(rest).width > max) {
            let n = 1
            while (n < rest.length && cx.measureText(rest.slice(0, n + 1)).width <= max) n++
            out.push(rest.slice(0, n))
            rest = rest.slice(n)
          }
          line = rest
          continue
        }
        line = next
      } else {
        out.push(line.trimEnd())
        line = word.trimStart()
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

/* Lines from a list of them, stopping at the bottom of the box. Returns how
 * far down the pen ended up. */
function lines(cx: Ctx, list: string[], x: number, y: number, step: number, bottom: number): number {
  let at = y
  for (const line of list) {
    if (at > bottom) return at
    if (line) cx.fillText(line, x, at)
    at += step
  }
  return at
}

const plain = (spans: Span[]) => spans.map((s) => s.text).join('')

/* --------------------------------------------------------------------------
 * The pictures.
 * ------------------------------------------------------------------------ */

/* Same three steps as a single-card export, but the source is resolved here
 * so a video contributes its own still rather than needing its element to be
 * mounted and playing — a board is exported whole, including the parts of it
 * that are scrolled off screen. */
async function sourceFor(item: Item): Promise<ImageBitmap | null> {
  try {
    if (item.kind === 'video') {
      const el = document.querySelector(`.card[data-id="${item.id}"] video`) as HTMLVideoElement | null
      if (el && el.videoWidth) return await createImageBitmap(el)
      if (!item.poster) return null
      const still = await getBlob(item.poster)
      return still ? await createImageBitmap(still) : null
    }
    if (item.media) {
      const blob = await getBlob(item.media)
      if (blob) return await createImageBitmap(blob)
      return null
    }
    /* A picture dropped in from another tab and still shown from its own
     * address. It only comes back if its host allows the read. */
    if (item.kind === 'image' && item.url && item.readable !== false) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = item.url
      await img.decode()
      return await createImageBitmap(img)
    }
    return null
  } catch {
    return null
  }
}

/* --------------------------------------------------------------------------
 * One card.
 * ------------------------------------------------------------------------ */

const R_MD = 10
const R_SM = 6
const PAD = 14

function drawSection(cx: Ctx, it: Item, t: Tokens) {
  cx.save()
  rrect(cx, it.x, it.y, it.w, it.h, R_MD)
  cx.fillStyle = t.hover
  cx.fill()
  cx.strokeStyle = t.line
  cx.lineWidth = 1.5
  cx.setLineDash([6, 5])
  cx.stroke()
  cx.setLineDash([])
  cx.restore()

  cx.save()
  cx.fillStyle = t.muted
  cx.font = `500 11px ${t.sans}`
  cx.textBaseline = 'top'
  const name = (it.name || 'Section').toUpperCase()
  cx.fillText(ellipsis(cx, name, Math.max(10, it.w - 20)), it.x + 10, it.y + 8)
  cx.restore()
}

function drawLabel(cx: Ctx, it: Item, t: Tokens) {
  cx.save()
  cx.fillStyle = it.color || '#111114'
  cx.font = `600 20px ${t.sans}`
  cx.textBaseline = 'middle'
  cx.fillText(ellipsis(cx, it.text || 'Label', Math.max(10, it.w - 12)), it.x + 6, it.y + it.h / 2)
  cx.restore()
}

/* The note's own formatting, the same marks the card reads. Not every nicety
 * of it — a poster is read across a room — but the shape of the writing:
 * headings heavier, list items indented behind their marker, done boxes
 * ticked. */
function drawNote(cx: Ctx, it: Item, t: Tokens) {
  const paper = it.color || '#FBEFC4'
  const ink = inkOn(paper)
  cx.save()
  rrect(cx, it.x, it.y, it.w, it.h, R_MD)
  cx.clip()
  cx.fillStyle = paper
  cx.fillRect(it.x, it.y, it.w, it.h)

  const left = it.x + PAD
  const right = it.x + it.w - PAD
  const bottom = it.y + it.h - PAD
  let y = it.y + PAD
  cx.textBaseline = 'top'

  const blocks: Block[] = parse(it.text || '')
  for (const b of blocks) {
    if (y > bottom) break
    if (b.t === 'gap') {
      y += 7
      continue
    }
    if (b.t === 'hr') {
      cx.strokeStyle = ink
      cx.globalAlpha = 0.25
      cx.lineWidth = 1
      cx.beginPath()
      cx.moveTo(left, Math.round(y + 5) + 0.5)
      cx.lineTo(right, Math.round(y + 5) + 0.5)
      cx.stroke()
      cx.globalAlpha = 1
      y += 12
      continue
    }
    if (b.t === 'h') {
      const size = b.level === 1 ? 18 : b.level === 2 ? 16 : 14
      cx.font = `650 ${size}px ${t.sans}`
      cx.fillStyle = ink
      y = lines(cx, wrap(cx, plain(b.spans), right - left), left, y + 2, size * 1.3, bottom) + 1
      continue
    }
    if (b.t === 'quote') {
      cx.font = `italic 14px ${t.sans}`
      cx.fillStyle = ink
      cx.globalAlpha = 0.75
      cx.fillRect(left, y + 1, 2, 15)
      y = lines(cx, wrap(cx, plain(b.spans), right - left - 10), left + 10, y, 21, bottom)
      cx.globalAlpha = 1
      continue
    }
    if (b.t === 'todo') {
      cx.font = `14px ${t.sans}`
      const box = 12
      cx.strokeStyle = ink
      cx.globalAlpha = b.done ? 0.55 : 0.8
      cx.lineWidth = 1.4
      rrect(cx, left, y + 3, box, box, 3)
      cx.stroke()
      if (b.done) {
        cx.beginPath()
        cx.moveTo(left + 2.8, y + 9)
        cx.lineTo(left + 5.2, y + 11.4)
        cx.lineTo(left + 9.4, y + 5.8)
        cx.stroke()
      }
      cx.fillStyle = ink
      cx.globalAlpha = b.done ? 0.5 : 1
      y = lines(cx, wrap(cx, plain(b.spans), right - left - 20), left + 20, y, 21, bottom)
      cx.globalAlpha = 1
      continue
    }
    if (b.t === 'li') {
      cx.font = `14px ${t.sans}`
      cx.fillStyle = ink
      const marker = b.ordered ? `${b.n}.` : '•'
      cx.fillText(marker, left + 2, y)
      y = lines(cx, wrap(cx, plain(b.spans), right - left - 18), left + 18, y, 21, bottom)
      continue
    }
    cx.font = `14px ${t.sans}`
    cx.fillStyle = ink
    y = lines(cx, wrap(cx, plain(b.spans), right - left), left, y, 21, bottom)
  }
  cx.restore()
}

const extOf = (name?: string) => (name?.match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'file').toUpperCase()

function drawLink(cx: Ctx, it: Item, t: Tokens) {
  cx.fillStyle = t.well
  cx.fillRect(it.x, it.y, it.w, it.h)
  const left = it.x + PAD
  const width = it.w - PAD * 2
  cx.textBaseline = 'top'
  cx.fillStyle = t.ink
  cx.font = `600 14px ${t.sans}`
  cx.fillText(ellipsis(cx, hostOf(it.url || ''), width), left, it.y + PAD)
  cx.fillStyle = t.muted
  cx.font = `11px ${t.sans}`
  lines(cx, wrap(cx, it.url || '', width), left, it.y + PAD + 26, 16, it.y + it.h - PAD)
}

function drawFile(cx: Ctx, it: Item, t: Tokens) {
  cx.fillStyle = t.well
  cx.fillRect(it.x, it.y, it.w, it.h)
  const left = it.x + PAD
  const ext = extOf(it.name)
  cx.textBaseline = 'top'
  cx.font = `500 11px ${t.sans}`
  const chip = cx.measureText(ext).width + 14
  cx.fillStyle = t.ink
  rrect(cx, left, it.y + PAD, chip, 19, R_SM)
  cx.fill()
  cx.fillStyle = t.onInk
  cx.fillText(ext, left + 7, it.y + PAD + 4)
  cx.fillStyle = t.muted
  cx.font = `12px ${t.sans}`
  lines(cx, wrap(cx, it.name || '', it.w - PAD * 2), left, it.y + PAD + 27, 17, it.y + it.h - PAD)
}

function drawAudio(cx: Ctx, it: Item, t: Tokens) {
  cx.fillStyle = t.well
  cx.fillRect(it.x, it.y, it.w, it.h)
  const left = it.x + PAD
  const width = it.w - PAD * 2
  cx.textBaseline = 'middle'
  cx.fillStyle = t.muted
  cx.font = `12px ${t.sans}`
  cx.fillText(ellipsis(cx, it.name || 'Audio', width), left, it.y + it.h / 2 - 14)
  /* Stand-in for the player: the shape of one, so the card reads as sound. */
  cx.fillStyle = t.sunk
  rrect(cx, left, it.y + it.h / 2 + 2, width, 22, 11)
  cx.fill()
  cx.fillStyle = t.muted
  cx.beginPath()
  cx.arc(left + 13, it.y + it.h / 2 + 13, 5, 0, Math.PI * 2)
  cx.fill()
  cx.fillRect(left + 24, it.y + it.h / 2 + 12, width - 36, 2)
}

function drawBoardCard(cx: Ctx, it: Item, t: Tokens) {
  cx.fillStyle = t.sunk
  cx.fillRect(it.x, it.y, it.w, it.h)
  const summary = it.board ? peekSummary(it.board) : null
  const n = summary?.count ?? 0
  cx.textBaseline = 'middle'
  cx.textAlign = 'center'
  cx.fillStyle = t.ink
  cx.font = `600 14px ${t.sans}`
  cx.fillText(ellipsis(cx, it.name || 'Board', it.w - 24), it.x + it.w / 2, it.y + it.h / 2 - 9)
  cx.fillStyle = t.muted
  cx.font = `12px ${t.sans}`
  cx.fillText(n === 1 ? '1 item' : `${n} items`, it.x + it.w / 2, it.y + it.h / 2 + 11)
  cx.textAlign = 'left'
}

function drawEmbed(cx: Ctx, it: Item, t: Tokens) {
  cx.fillStyle = t.well
  cx.fillRect(it.x, it.y, it.w, it.h)
  const cxm = it.x + it.w / 2
  const cym = it.y + it.h / 2
  cx.fillStyle = t.muted
  cx.beginPath()
  cx.moveTo(cxm - 9, cym - 12)
  cx.lineTo(cxm + 13, cym)
  cx.lineTo(cxm - 9, cym + 12)
  cx.closePath()
  cx.fill()
  cx.textAlign = 'center'
  cx.textBaseline = 'top'
  cx.font = `12px ${t.sans}`
  cx.fillText(ellipsis(cx, it.name || 'Video', it.w - 24), cxm, cym + 20)
  cx.textAlign = 'left'
}

/* The mark, if it wears one. Same two colours the card uses. */
function drawPick(cx: Ctx, it: Item) {
  if (!it.pick) return
  const x = it.x + 7 + 8.5
  const y = it.y + 7 + 8.5
  cx.save()
  cx.fillStyle = it.pick === 'in' ? '#2f8f5b' : '#b4443f'
  cx.beginPath()
  cx.arc(x, y, 8.5, 0, Math.PI * 2)
  cx.fill()
  cx.strokeStyle = '#fff'
  cx.lineWidth = 1.8
  cx.lineCap = 'round'
  cx.lineJoin = 'round'
  cx.beginPath()
  if (it.pick === 'in') {
    cx.moveTo(x - 3.6, y + 0.2)
    cx.lineTo(x - 1.1, y + 2.7)
    cx.lineTo(x + 3.8, y - 2.8)
  } else {
    cx.moveTo(x - 3.1, y - 3.1)
    cx.lineTo(x + 3.1, y + 3.1)
    cx.moveTo(x + 3.1, y - 3.1)
    cx.lineTo(x - 3.1, y + 3.1)
  }
  cx.stroke()
  cx.restore()
}

/* What the card is called, along the bottom of it.
 *
 * The board shows this only while the pointer is on the card, which is right
 * for a board — a wall of photographs should look like a wall of photographs
 * and not like a list of filenames. A sheet is not a board. It is the thing
 * you send somebody, usually of the few you chose out of the many, and six
 * pictures with nothing written on them are six pictures and not an argument.
 *
 * Drawn the way the card draws it: a plate over a pale body, a dark screen
 * over a photograph, white letters with an outline of their own because a
 * screen leaves white between its dots however dense it gets. */
function drawCaption(cx: Ctx, it: Item, t: Tokens) {
  const said = (it.name || '').trim()
  if (!said) return
  /* A note already has its words on it. */
  if (it.kind === 'note' || it.kind === 'label') return

  const overPicture = it.kind === 'image' || it.kind === 'video' || it.kind === 'embed' || it.kind === 'board'
  const h = overPicture ? 34 : 26
  const y = it.y + it.h - h

  cx.save()
  rrect(cx, it.x, it.y, it.w, it.h, R_MD)
  cx.clip()

  if (overPicture) {
    /* A ramp of ink rather than a bar of it: the picture stays visible under
     * the words, which is what every player and every gallery does. */
    const grad = cx.createLinearGradient(0, y, 0, y + h)
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)')
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.62)')
    cx.fillStyle = grad
    cx.fillRect(it.x, y, it.w, h)
    cx.fillStyle = '#fff'
    cx.shadowColor = 'rgba(0, 0, 0, 0.85)'
    cx.shadowBlur = 3
  } else {
    cx.fillStyle = t.surface
    cx.globalAlpha = 0.88
    cx.fillRect(it.x, y, it.w, h)
    cx.globalAlpha = 1
    cx.fillStyle = t.ink
  }

  cx.font = `500 12px ${t.sans}`
  cx.textBaseline = 'alphabetic'
  cx.fillText(ellipsis(cx, said, it.w - 16), it.x + 8, it.y + it.h - (overPicture ? 10 : 8))
  cx.restore()
}

function drawTag(cx: Ctx, it: Item, t: Tokens) {
  const tag = it.tag ? TAGS.find((g) => g.id === it.tag) : null
  if (!tag) return
  const x = it.x + it.w - 7 - 4.5
  const y = it.y + 7 + 4.5
  cx.save()
  cx.fillStyle = t.surface
  cx.beginPath()
  cx.arc(x, y, 6.5, 0, Math.PI * 2)
  cx.fill()
  cx.fillStyle = tag.c
  cx.beginPath()
  cx.arc(x, y, 4.5, 0, Math.PI * 2)
  cx.fill()
  cx.restore()
}

/* Sections and wires are drawn before this, in their own passes: they are the
 * ground and the lines across it rather than things stacked by z. */
async function drawCard(cx: Ctx, it: Item, t: Tokens, scale: number, caption: boolean) {
  /* A label is words on the board with no card under them. */
  if (it.kind === 'label') {
    drawLabel(cx, it, t)
    return
  }

  cx.save()
  /* A cut card steps back on the sheet exactly as far as it does on the
   * board, so the decision survives the export. */
  if (it.pick === 'out') cx.globalAlpha = 0.4

  /* The shell: surface, hairline, soft corners, and a shadow the CSS draws
   * with two layers and this draws with one. */
  cx.save()
  cx.shadowColor = 'rgba(24, 24, 27, 0.14)'
  cx.shadowBlur = 12
  cx.shadowOffsetY = 4
  rrect(cx, it.x, it.y, it.w, it.h, R_MD)
  cx.fillStyle = t.surface
  cx.fill()
  cx.restore()

  cx.save()
  rrect(cx, it.x, it.y, it.w, it.h, R_MD)
  cx.clip()

  switch (it.kind) {
    case 'image':
    case 'video': {
      const w = Math.max(2, Math.round(it.w * scale))
      const h = Math.max(2, Math.round(it.h * scale))
      const picture = await renderCardPicture(it, w, h, await sourceFor(it))
      if (picture) cx.drawImage(picture, it.x, it.y, it.w, it.h)
      else {
        cx.fillStyle = t.well
        cx.fillRect(it.x, it.y, it.w, it.h)
      }
      break
    }
    /* The player's pixels belong to the provider, so the sheet gets the
     * shape of a video rather than a frame of one. */
    case 'embed': drawEmbed(cx, it, t); break
    case 'note': drawNote(cx, it, t); break
    case 'link': drawLink(cx, it, t); break
    case 'file': drawFile(cx, it, t); break
    case 'audio': drawAudio(cx, it, t); break
    case 'board': drawBoardCard(cx, it, t); break
    default: break
  }
  cx.restore()

  rrect(cx, it.x + 0.5, it.y + 0.5, it.w - 1, it.h - 1, R_MD)
  cx.strokeStyle = t.lineSoft
  cx.lineWidth = 1
  cx.stroke()

  if (caption) drawCaption(cx, it, t)
  drawTag(cx, it, t)
  drawPick(cx, it)
  cx.restore()
}

function drawWire(cx: Ctx, wire: Item, byId: Map<string, Item>, t: Tokens) {
  const a = wire.from ? byId.get(wire.from) : null
  const b = wire.to ? byId.get(wire.to) : null
  if (!a || !b) return
  cx.save()
  cx.strokeStyle = t.wire
  cx.lineWidth = 2
  cx.lineCap = 'round'
  cx.stroke(new Path2D(wirePath(a, b)))

  /* The head, which the board draws with an SVG marker: a triangle at the
   * far end, pointing the way the curve arrives. */
  const side = sideFacing(b, a)
  const p = portPoint(b, side)
  const angle = side === 'n' ? Math.PI / 2 : side === 's' ? -Math.PI / 2 : side === 'w' ? 0 : Math.PI
  cx.translate(p.x, p.y)
  cx.rotate(angle)
  cx.fillStyle = t.wire
  cx.beginPath()
  cx.moveTo(0, 0)
  cx.lineTo(-7, -3.5)
  cx.lineTo(-7, 3.5)
  cx.closePath()
  cx.fill()
  cx.restore()
}

/* --------------------------------------------------------------------------
 * The sheet.
 * ------------------------------------------------------------------------ */

export { posterBounds, posterScale } from './posterPage'

/* --------------------------------------------------------------------------
 * What the sheet says it is.
 *
 * A picture of a board, with nothing on it to say whose board it is or when it
 * was, is an anonymous image in somebody's downloads folder a week later. Two
 * lines at the top fix that, and they are the two lines a person would write
 * by hand: what it is called, and what is on it.
 *
 * The counts are there because the sheet is now often a decision rather than a
 * collection — twelve references, four kept, three cut — and because a sheet
 * that is only part of a board should say so rather than passing itself off as
 * the whole thing.
 * ------------------------------------------------------------------------ */

export interface SheetInfo {
  /* The board's name, which is the sheet's name. */
  name: string
  /* How many things are on the whole board, when this sheet is only some of
   * them. Left out when the sheet is the board. */
  of?: number
  /* Passed in only by the tests, which cannot have a moving date in them. */
  now?: Date
}

const HEAD_H = 78

function describe(items: Item[], info: SheetInfo): string {
  const cards = items.filter((i) => !isWire(i) && !isSection(i))
  const kept = cards.filter((i) => i.pick === 'in').length
  const cut = cards.filter((i) => i.pick === 'out').length
  const bits: string[] = []
  bits.push(info.of && info.of > cards.length ? `${cards.length} of ${info.of}` : `${cards.length} item${cards.length === 1 ? '' : 's'}`)
  if (kept) bits.push(`${kept} kept`)
  if (cut) bits.push(`${cut} cut`)
  const when = info.now ?? new Date()
  bits.push(when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))
  return bits.join(' · ')
}

function drawHead(cx: Ctx, info: SheetInfo, items: Item[], t: Tokens, x: number, y: number, w: number) {
  cx.save()
  cx.textBaseline = 'alphabetic'
  cx.fillStyle = t.ink
  cx.font = `600 26px ${t.sans}`
  cx.fillText(ellipsis(cx, info.name || 'Untitled board', w), x, y + 26)
  cx.fillStyle = t.muted
  cx.font = `13px ${t.sans}`
  cx.fillText(ellipsis(cx, describe(items, info), w), x, y + 49)
  cx.restore()
}

export interface Poster {
  canvas: HTMLCanvasElement
  /* In board pixels, which is what decides the paper size. */
  w: number
  h: number
  scale: number
  /* How many cards went onto it, for the line along the bottom of the app. */
  count: number
}

export async function renderPoster(items: Item[], info: SheetInfo, opts: PosterOptions = {}): Promise<Poster | null> {
  const pad = opts.pad ?? 48
  const box = posterBounds(items, pad)
  if (!box) return null

  /* Room above the board for the two lines that say what this is. */
  const head = opts.head === false ? 0 : HEAD_H
  const sheetW = box.w
  const sheetH = box.h + head
  const scale = posterScale(sheetW, sheetH, opts.scale ?? 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(sheetW * scale))
  canvas.height = Math.max(2, Math.round(sheetH * scale))
  const cx = canvas.getContext('2d')
  if (!cx) return null

  /* Web fonts are loaded by the page, not by the canvas, and a canvas asked
   * to draw in a family that has not arrived silently uses a fallback. */
  try {
    await document.fonts.ready
  } catch {
    /* A browser without the font API draws in whatever it has. */
  }

  const t = tokens()
  if (opts.background !== false) {
    cx.fillStyle = t.bg
    cx.fillRect(0, 0, canvas.width, canvas.height)
  }

  cx.scale(scale, scale)
  if (head) drawHead(cx, info, items, t, pad, pad * 0.72, box.w - pad * 2)
  cx.translate(-box.x, -box.y + head)
  cx.textBaseline = 'top'

  const byId = new Map(items.map((i) => [i.id, i]))
  /* The board's own order: sections are the ground, wires go over them and
   * under the cards, and the cards stack by z. */
  const sections = items.filter(isSection)
  const wires = items.filter(isWire)
  /* Sort is stable, so cards that share a z keep the order they arrived in —
   * which is what the DOM falls back to when two z-indexes are equal. */
  const cards = items.filter((i) => !isSection(i) && !isWire(i)).sort((a, b) => a.z - b.z)

  for (const s of sections) drawSection(cx, s, t)
  for (const w of wires) drawWire(cx, w, byId, t)
  for (const c of cards) await drawCard(cx, c, t, scale, opts.captions !== false)

  return { canvas, w: sheetW, h: sheetH, scale, count: cards.length + sections.length }
}

const posterName = (name: string, ext: string) => `${safeName(name || 'board') || 'board'}.${ext}`

/* The sheet at its own size, however large that is: a board four screens wide
 * comes out four screens wide, which is what you want on a monitor. */
export async function exportPoster(items: Item[], info: SheetInfo, opts?: PosterOptions): Promise<ExportedImage | null> {
  const made = await renderPoster(items, info, opts)
  if (!made) return null
  const blob = await new Promise<Blob | null>((r) => made.canvas.toBlob(r, 'image/png'))
  if (!blob) return null
  return { blob, name: posterName(info.name, 'png'), w: made.canvas.width, h: made.canvas.height }
}

/* And the same sheet on paper somebody owns. */
export async function exportPosterPdf(
  items: Item[],
  info: SheetInfo,
  opts?: PosterOptions & { paper?: PaperName }
): Promise<ExportedImage | null> {
  const made = await renderPoster(items, info, opts)
  if (!made) return null
  /* Quality high enough that type stays clean; a page of photographs at
   * lossless would be a file nobody can email. */
  const jpeg = await new Promise<Blob | null>((r) => made.canvas.toBlob(r, 'image/jpeg', 0.92))
  if (!jpeg) return null
  const bytes = new Uint8Array(await jpeg.arrayBuffer())
  const fit = fitToPaper(made.w, made.h, opts?.paper ?? paperFor())
  const blob = pdfBytes(bytes, made.canvas.width, made.canvas.height, fit.page.w, fit.page.h, fit.place)
  return {
    blob,
    name: posterName(info.name, 'pdf'),
    w: made.canvas.width,
    h: made.canvas.height,
    /* Said in the line along the bottom, because "which paper, which way
     * round" is the one thing a person wants confirmed about a PDF. */
    note: `${fit.paper === 'a4' ? 'A4' : 'Letter'} ${fit.landscape ? 'landscape' : 'portrait'}`,
  }
}
