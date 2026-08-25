import { describe, it, expect } from 'vitest'
import { fitToPaper, PAPER, paperFor, pdfBytes, posterBounds, posterScale, PT } from '../../src/state/posterPage'
import type { Item } from '../../src/state/types'
import { dropColumns } from '../../src/state/ingest'

/* ---------------------------------------------------------------------------
 * The board as one sheet: where it sits, how big it can be, and whether the
 * PDF it is wrapped in is a PDF.
 * ------------------------------------------------------------------------- */

const FX = { fxid: 'none', ep: {}, grain: 0, zoom: 1, ox: 0, oy: 0, rot: 0, fh: false, fv: false } as Item['fx']

const card = (over: Partial<Item>): Item => ({
  id: 'i' + Math.random().toString(36).slice(2),
  kind: 'image', x: 0, y: 0, w: 100, h: 100, z: 0, fx: { ...FX }, tag: null,
  ...over,
})

describe('where the sheet sits', () => {
  it('is nothing at all when there is nothing on the board', () => {
    expect(posterBounds([], 10)).toBe(null)
  })

  it('wraps everything, with air around the outside', () => {
    const box = posterBounds([card({ x: 10, y: 20, w: 100, h: 50 })], 8)!
    expect(box).toEqual({ x: 2, y: 12, w: 116, h: 66 })
  })

  it('reaches the far corners of a spread out board', () => {
    const box = posterBounds(
      [card({ x: -300, y: 40, w: 100, h: 100 }), card({ x: 500, y: -80, w: 200, h: 60 })],
      0
    )!
    expect(box).toEqual({ x: -300, y: -80, w: 1000, h: 220 })
  })

  it('ignores wires, which have no box of their own', () => {
    const wire = card({ kind: 'edge', x: -9000, y: -9000, w: 0, h: 0, from: 'a', to: 'b' })
    const box = posterBounds([card({ x: 0, y: 0, w: 100, h: 100 }), wire], 0)!
    expect(box).toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })

  it('takes sections in, since they are part of the picture', () => {
    const box = posterBounds([card({ kind: 'section', x: -40, y: -40, w: 400, h: 400 })], 0)!
    expect(box.w).toBe(400)
  })
})

describe('how many pixels the sheet can afford', () => {
  it('gives a small board what it asked for', () => {
    expect(posterScale(800, 600, 2)).toBe(2)
  })

  it('never goes past what was asked for, however small the board', () => {
    expect(posterScale(10, 10, 2)).toBe(2)
  })

  it('backs off on a board too wide to allocate', () => {
    const s = posterScale(20000, 400, 2)
    expect(s).toBeLessThan(2)
    expect(20000 * s).toBeLessThanOrEqual(12000)
  })

  it('backs off on a board with too much area, whatever its edges', () => {
    const s = posterScale(6000, 6000, 2)
    expect(6000 * s * 6000 * s).toBeLessThanOrEqual(40e6 + 1)
  })

  it('still draws something rather than nothing when the board is enormous', () => {
    expect(posterScale(200000, 200000, 2)).toBeGreaterThan(0)
  })
})

/* A JPEG is only along for the ride here — none of it is decoded — so a few
 * bytes that start the right way stand in for one. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])

const text = async (blob: Blob) =>
  /* latin1, because the bytes are a mix of ASCII structure and binary. */
  Array.from(new Uint8Array(await blob.arrayBuffer()), (b) => String.fromCharCode(b)).join('')

describe('the sheet as paper', () => {
  it('starts and ends the way a PDF does', async () => {
    const s = await text(pdfBytes(JPEG, 100, 50, 75, 37.5))
    expect(s.startsWith('%PDF-1.4')).toBe(true)
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('says it is one page, at the size it was given', async () => {
    const s = await text(pdfBytes(JPEG, 100, 50, 75, 37.5))
    expect(s).toContain('/Type /Pages /Kids [3 0 R] /Count 1')
    expect(s).toContain('/MediaBox [0 0 75.00 37.50]')
  })

  it('carries the picture through untouched, as JPEG bytes', async () => {
    const s = await text(pdfBytes(JPEG, 100, 50, 75, 37.5))
    expect(s).toContain('/Filter /DCTDecode')
    expect(s).toContain(`/Width 100 /Height 50`)
    expect(s).toContain(`/Length ${JPEG.length}`)
    expect(s).toContain(Array.from(JPEG, (b) => String.fromCharCode(b)).join(''))
  })

  /* The part nothing on screen would catch: every offset in the table has to
   * land exactly on the "N 0 obj" it claims to point at, or a reader opens an
   * empty page. */
  it('points every offset in the table at the object it names', async () => {
    const s = await text(pdfBytes(JPEG, 640, 480, 480, 360))
    /* lastIndexOf('xref') would find the startxref line below the table. */
    const table = s.slice(s.indexOf('\nxref\n') + 1)
    const rows = table.split('\n').slice(2, 8)
    expect(rows).toHaveLength(6)
    rows.slice(1).forEach((row, i) => {
      const at = Number(row.slice(0, 10))
      expect(s.slice(at, at + 7)).toBe(`${i + 1} 0 obj`)
    })
  })

  it('points startxref at the table itself', async () => {
    const s = await text(pdfBytes(JPEG, 640, 480, 480, 360))
    const at = Number(s.slice(s.lastIndexOf('startxref') + 10).split('\n')[0])
    expect(s.slice(at, at + 4)).toBe('xref')
  })

  it('writes table rows exactly twenty bytes long, as the format demands', async () => {
    const s = await text(pdfBytes(JPEG, 640, 480, 480, 360))
    const table = s.slice(s.indexOf('\nxref\n') + 1)
    /* Past the 'xref' line and the '0 6' line to the twenty byte rows. */
    const body = table.split('\n').slice(2).join('\n')
    for (let n = 0; n < 6; n++) expect(body.slice(n * 20, n * 20 + 20)).toHaveLength(20)
    expect(body.slice(0, 20)).toBe('0000000000 65535 f \n')
  })

  /* With no placement given the picture is the page, which is what the PNG
     path wants; the paper path passes one, and that is checked below. */
  it('draws the image over the whole page when told nothing else', async () => {
    const s = await text(pdfBytes(JPEG, 100, 50, 75, 37.5))
    expect(s).toContain('75.00 0 0 37.50 0.00 0.00 cm')
    expect(s).toContain('/Im0 Do')
  })

  it('measures a board pixel as three quarters of a point, which is 96 dpi', () => {
    expect(PT * 96).toBeCloseTo(72)
  })
})

describe('the paper it prints on', () => {
  it('uses Letter where Letter comes out of the printer', () => {
    expect(paperFor('en-US')).toBe('letter')
    expect(paperFor('en-CA')).toBe('letter')
    expect(paperFor('es-MX')).toBe('letter')
  })

  it('and A4 everywhere else', () => {
    expect(paperFor('en-GB')).toBe('a4')
    expect(paperFor('de-DE')).toBe('a4')
    expect(paperFor('ja-JP')).toBe('a4')
    expect(paperFor('fr-FR')).toBe('a4')
  })

  /* The bug this replaced: a page 1386 by 972 points, which is a fine thing
   * to email and a paper size nobody owns. */
  it('turns the page to match the board rather than squeezing it', () => {
    const wide = fitToPaper(1600, 900, 'a4')
    expect(wide.landscape).toBe(true)
    expect(Math.round(wide.page.w)).toBe(Math.round(PAPER.a4.h))
    const tall = fitToPaper(900, 1600, 'a4')
    expect(tall.landscape).toBe(false)
    expect(Math.round(tall.page.w)).toBe(Math.round(PAPER.a4.w))
  })

  it('keeps the board its own shape inside the margin', () => {
    const fit = fitToPaper(1600, 900, 'letter', 28)
    expect(fit.place.w / fit.place.h).toBeCloseTo(1600 / 900, 2)
    expect(fit.place.x).toBeGreaterThanOrEqual(28 - 0.01)
    expect(fit.place.y).toBeGreaterThanOrEqual(28 - 0.01)
    expect(fit.place.x + fit.place.w).toBeLessThanOrEqual(fit.page.w - 28 + 0.01)
    expect(fit.place.y + fit.place.h).toBeLessThanOrEqual(fit.page.h - 28 + 0.01)
  })

  it('centres it on the page', () => {
    const fit = fitToPaper(1600, 900, 'letter')
    expect(fit.place.x * 2 + fit.place.w).toBeCloseTo(fit.page.w, 1)
    expect(fit.place.y * 2 + fit.place.h).toBeCloseTo(fit.page.h, 1)
  })

  it('still fits a board far wider than any sheet', () => {
    const fit = fitToPaper(12000, 400, 'a4')
    expect(fit.place.w).toBeLessThanOrEqual(fit.page.w)
    expect(fit.place.h).toBeGreaterThan(0)
  })

  it('writes that placement into the page, not the whole of it', async () => {
    const fit = fitToPaper(1600, 900, 'letter')
    const s = await text(pdfBytes(JPEG, 1600, 900, fit.page.w, fit.page.h, fit.place))
    expect(s).toContain(`/MediaBox [0 0 ${fit.page.w.toFixed(2)} ${fit.page.h.toFixed(2)}]`)
    expect(s).toContain(`${fit.place.w.toFixed(2)} 0 0 ${fit.place.h.toFixed(2)} ${fit.place.x.toFixed(2)} ${fit.place.y.toFixed(2)} cm`)
  })
})

describe('how wide a drop is laid out', () => {
  /* Four across, always, put twelve of twenty photographs below the fold with
   * nothing to say they were there. */
  it('is one column for one file', () => {
    expect(dropColumns(1, 1440, 900)).toBe(1)
  })

  it('never asks for more columns than there are files', () => {
    expect(dropColumns(3, 4000, 300)).toBeLessThanOrEqual(3)
  })

  it('makes a block shaped like the window', () => {
    const cols = dropColumns(20, 1440, 900)
    const rows = Math.ceil(20 / cols)
    expect(cols).toBeGreaterThan(rows)
  })

  it('and a taller one in a taller window', () => {
    const wide = dropColumns(20, 1600, 600)
    const tall = dropColumns(20, 600, 1600)
    expect(wide).toBeGreaterThan(tall)
  })

  it('falls back to a square block when the window is unknown', () => {
    const cols = dropColumns(16)
    expect(cols).toBeGreaterThanOrEqual(3)
    expect(cols).toBeLessThanOrEqual(5)
  })
})
