import { describe, expect, it, beforeEach } from 'vitest'
import {
  BY_FAMILY, DEFAULTS, FAMILIES, GOOGLE, WAS_BAKED_IN, familyOf, inkChosen, inkOf, isText, typeStyle,
} from '../../src/state/type'
import { cssUrl, forgetFonts, needsFetch, wanted, GOOGLE_CSS } from '../../src/state/fonts'
import { labelItem, textItem } from '../../src/state/ingest'
import type { Item, Kind } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'

const of = (kind: Kind, extra: Partial<Item> = {}): Item =>
  ({ id: 'i', kind, x: 0, y: 0, z: 0, w: 10, h: 10, fx: { ...FX_0 }, tag: null, ...extra } as Item)

/* The bug this file exists for: a label was made with a near-black written
 * into the record, so on a dark board it was drawn in near-black on near-black
 * and could not be found. The rule is that the one value every label was made
 * with means "nobody chose this" rather than "somebody chose black". */
describe('ink', () => {
  it('treats the colour every label was made with as no choice at all', () => {
    expect(inkOf(WAS_BAKED_IN)).toBeUndefined()
    expect(inkOf(WAS_BAKED_IN.toUpperCase())).toBeUndefined()
    expect(inkChosen(WAS_BAKED_IN)).toBe(false)
  })

  it('treats nothing as no choice', () => {
    expect(inkOf(undefined)).toBeUndefined()
    expect(inkOf(null)).toBeUndefined()
    expect(inkOf('')).toBeUndefined()
  })

  it('keeps a colour somebody picked, exactly', () => {
    expect(inkOf('#E5484D')).toBe('#E5484D')
    expect(inkChosen('#E5484D')).toBe(true)
    /* Including a black that is not *that* black, which is how somebody who
       really wants near-black says so. */
    expect(inkOf('#0a0a0c')).toBe('#0a0a0c')
  })

  it('is what a new label is made with, so a new one reads on either ground', () => {
    expect(labelItem({ x: 0, y: 0 }).color).toBeUndefined()
  })
})

describe('which cards have words set', () => {
  it('is the two that are words and nothing else', () => {
    expect(isText(of('note'))).toBe(true)
    expect(isText(of('label'))).toBe(true)
    expect(isText(of('image'))).toBe(false)
    expect(isText(of('section'))).toBe(false)
    expect(isText(null)).toBe(false)
    expect(isText(undefined)).toBe(false)
  })
})

describe('families', () => {
  it('has no two with the same id', () => {
    expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length)
  })

  it('gives every family a fallback after its own name, so an unfetched one still reads', () => {
    for (const f of FAMILIES) {
      expect(f.stack.split(',').length, `${f.id} names only itself`).toBeGreaterThan(1)
      expect(f.weights.length, `${f.id} offers no weights`).toBeGreaterThan(0)
    }
  })

  it('answers for one it knows', () => {
    expect(familyOf('playfair').name).toBe('Playfair Display')
    expect(BY_FAMILY.playfair.google).toBe(true)
  })

  it('takes anything else as the name of a Google family somebody typed', () => {
    const f = familyOf('Zilla Slab')
    expect(f.google).toBe(true)
    expect(f.name).toBe('Zilla Slab')
    expect(f.stack).toContain("'Zilla Slab'")
  })

  it('falls back to a family the app carries when nothing is set', () => {
    expect(familyOf(undefined).google).toBeUndefined()
  })
})

describe('the CSS a card is drawn with', () => {
  it('is the kind default when nothing has been chosen', () => {
    const s = typeStyle('label')
    expect(s.fontSize).toBe(`${DEFAULTS.label.size}px`)
    expect(s.fontWeight).toBe(String(DEFAULTS.label.weight))
  })

  it('sets a note and a label at different sizes, because they are different things', () => {
    expect(typeStyle('note').fontSize).not.toBe(typeStyle('label').fontSize)
  })

  it('takes every setting somebody made', () => {
    const s = typeStyle('note', { font: 'lora', size: 42, weight: 700, align: 'center', leading: 1.9, tracking: -0.03 })
    expect(s.fontFamily).toContain('Lora')
    expect(s.fontSize).toBe('42px')
    expect(s.fontWeight).toBe('700')
    expect(s.textAlign).toBe('center')
    expect(s.lineHeight).toBe('1.9')
    expect(s.letterSpacing).toBe('-0.03em')
  })

  it('leaves italic, underline and caps off until they are asked for', () => {
    const s = typeStyle('note')
    expect(s.fontStyle).toBeUndefined()
    expect(s.textDecoration).toBeUndefined()
    expect(s.textTransform).toBeUndefined()
  })

  /* Uppercase set at the tracking of lowercase reads as a jam, which is why
     every typesetter opens the letterspacing when they set caps. */
  it('opens the letterspacing for caps, unless a tracking was set', () => {
    expect(typeStyle('note', { caps: true }).letterSpacing).toBe('0.06em')
    expect(typeStyle('note', { caps: true, tracking: 0.2 }).letterSpacing).toBe('0.2em')
  })

  it('reads back the same for a kind it has never heard of', () => {
    expect(typeStyle('nonsense')).toEqual(typeStyle('note'))
  })
})

describe('text drawn on the board', () => {
  it('arrives at the size it was drawn, and empty so it can be typed into', () => {
    const it = textItem({ x: 5, y: 6 }, { w: 400, h: 90 })
    expect(it.kind).toBe('label')
    expect(it.w).toBe(400)
    expect(it.h).toBe(90)
    expect(it.text).toBe('')
    expect(it.color).toBeUndefined()
  })

  it('refuses to be drawn too small to get hold of again', () => {
    const it = textItem({ x: 0, y: 0 }, { w: 1, h: 1 })
    expect(it.w).toBeGreaterThanOrEqual(40)
    expect(it.h).toBeGreaterThanOrEqual(24)
  })

  it('is set as something to read rather than as a heading', () => {
    expect(textItem({ x: 0, y: 0 }).type?.weight).toBe(400)
  })
})

describe('fetching a family', () => {
  beforeEach(() => forgetFonts())

  it('asks for the weights the family offers, and for swap so nothing is invisible while it flies', () => {
    const url = cssUrl(GOOGLE.find((f) => f.id === 'inter')!)
    expect(url.startsWith(`${GOOGLE_CSS}?family=Inter:`)).toBe(true)
    expect(url).toContain('display=swap')
    /* Both slopes, so italic is a setting rather than a fake. */
    expect(url).toContain('0,400')
    expect(url).toContain('1,400')
  })

  it('spells a two-word family the way the endpoint wants it', () => {
    expect(cssUrl(GOOGLE.find((f) => f.id === 'playfair')!)).toContain('family=Playfair+Display:')
  })

  /* The promise the rest of this app makes is that nothing goes anywhere. A
     board on the families the app carries has to keep it. */
  it('would ask for nothing at all for a family the app carries', () => {
    expect(needsFetch('sans')).toBe(false)
    expect(needsFetch('mono')).toBe(false)
    expect(needsFetch('system')).toBe(false)
    expect(needsFetch('serif')).toBe(false)
    expect(needsFetch(undefined)).toBe(false)
  })

  it('would ask for a Google family, whether it is on the shelf or typed in', () => {
    expect(needsFetch('lora')).toBe(true)
    expect(needsFetch('Zilla Slab')).toBe(true)
  })

  it('asks for what a board is written in, once each, and for nothing it is not', () => {
    expect(wanted([
      { type: { font: 'oswald' } },
      { type: { font: 'oswald' } },
      { type: { font: 'sans' } },
      { type: { font: 'caveat' } },
      {},
      { type: null },
    ])).toEqual(['oswald', 'caveat'])
  })

  it('asks for nothing at all for a board that never chose one', () => {
    expect(wanted([{}, { type: { size: 40 } }, { type: { font: 'mono' } }])).toEqual([])
  })
})
