import { describe, expect, it } from 'vitest'
import { guidesFrom, snap } from '../../src/board/snap'
import { matchesTag, parseQuery, passes, UNTAGGED } from '../../src/state/search'
import { classifyUrl, hostOf } from '../../src/state/urls'
import { describe as describeLook, isPlain, lookFrom } from '../../src/state/looks'
import type { Item } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'
import type { FxState } from '../../src/engine/types'

const item = (p: Partial<Item>): Item => ({
  id: p.id || 'i', kind: p.kind || 'image', x: 0, y: 0, z: 0, w: 100, h: 100,
  fx: { ...FX_0 }, tag: null, ...p,
} as Item)

describe('snapping to a neighbour', () => {
  const neighbours = [item({ id: 'a', x: 200, y: 100, w: 100, h: 100 })]

  it('offers a line at each edge and each middle', () => {
    const g = guidesFrom(neighbours)
    expect(g.v.map((l) => l.at).sort((x, y) => x - y)).toEqual([200, 250, 300])
    expect(g.h.map((l) => l.at).sort((x, y) => x - y)).toEqual([100, 150, 200])
  })

  it('pulls a card that is nearly lined up exactly onto the line', () => {
    const g = guidesFrom(neighbours)
    const s = snap({ x: 196, y: 400, w: 100, h: 100 }, g, 6)
    expect(s.dx).toBe(4)
    expect(s.vLine?.at).toBe(200)
  })

  it('leaves a card that is not close to anything alone', () => {
    const g = guidesFrom(neighbours)
    const s = snap({ x: 20, y: 700, w: 100, h: 100 }, g, 6)
    expect(s).toMatchObject({ dx: 0, dy: 0, vLine: null, hLine: null })
  })

  it('takes the nearest line when two are in reach', () => {
    const g = guidesFrom([item({ x: 200, y: 0, w: 100, h: 100 }), item({ x: 203, y: 0, w: 100, h: 100 })])
    const s = snap({ x: 202, y: 400, w: 50, h: 50 }, g, 6)
    expect(s.dx).toBe(1)
  })

  it('draws the guide long enough to reach both cards', () => {
    const g = guidesFrom(neighbours)
    const s = snap({ x: 196, y: 400, w: 100, h: 100 }, g, 6)
    expect(s.vLine!.from).toBeLessThanOrEqual(100)
    expect(s.vLine!.to).toBeGreaterThanOrEqual(500)
  })

  it('has nothing to offer on an empty board', () => {
    const g = guidesFrom([])
    expect(g.v).toEqual([])
    expect(snap({ x: 0, y: 0, w: 10, h: 10 }, g, 6).dx).toBe(0)
  })
})

describe('search', () => {
  const cards = [
    item({ id: 'a', name: 'Autumn light.jpg', tag: 'red' }),
    item({ id: 'b', kind: 'note', name: 'Note', text: 'call the printer about paper', tag: null }),
    item({ id: 'c', kind: 'link', name: 'example.com', url: 'https://example.com/deck', tag: 'blue' }),
  ]

  it('splits a query into words and drops the empties', () => {
    expect(parseQuery('  autumn   light ')).toEqual(['autumn', 'light'])
    expect(parseQuery('   ')).toEqual([])
  })

  it('wants every word, not any of them', () => {
    expect(passes(cards[0], parseQuery('autumn light'), null)).toBe(true)
    expect(passes(cards[0], parseQuery('autumn printer'), null)).toBe(false)
  })

  it('looks inside a note and inside a link', () => {
    expect(passes(cards[1], parseQuery('printer'), null)).toBe(true)
    expect(passes(cards[2], parseQuery('deck'), null)).toBe(true)
  })

  it('finds a card by what kind of card it is', () => {
    expect(passes(cards[1], parseQuery('txt'), null)).toBe(true)
  })

  it('filters by tag, and by having no tag', () => {
    expect(matchesTag(cards[0], 'red')).toBe(true)
    expect(matchesTag(cards[0], 'blue')).toBe(false)
    expect(matchesTag(cards[1], UNTAGGED)).toBe(true)
    expect(matchesTag(cards[0], UNTAGGED)).toBe(false)
    expect(matchesTag(cards[0], null)).toBe(true)
  })

  it('asks for the words and the tag together', () => {
    expect(passes(cards[0], parseQuery('autumn'), 'red')).toBe(true)
    expect(passes(cards[0], parseQuery('autumn'), 'blue')).toBe(false)
  })
})

describe('what a pasted address turns into', () => {
  it('reads a YouTube link, however it is written', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      const c = classifyUrl(u)
      expect(c.kind).toBe('embed')
      expect((c as { embed: string }).embed).toContain('dQw4w9WgXcQ')
    }
  })

  it('reads a Vimeo link', () => {
    const c = classifyUrl('https://vimeo.com/123456789')
    expect(c.kind).toBe('embed')
    expect((c as { embed: string }).embed).toContain('123456789')
  })

  it('reads a file that is plainly a video', () => {
    expect(classifyUrl('https://example.com/clip.mp4').kind).toBe('video')
    expect(classifyUrl('https://example.com/clip.webm').kind).toBe('video')
  })

  it('leaves an ordinary page as a link', () => {
    expect(classifyUrl('https://example.com/about').kind).toBe('link')
  })

  /* Deliberately forgiving: everything that is pasted becomes something, and a
   * link card holding a line of text is easier to notice and delete than a
   * paste that silently did nothing. */
  it('makes a link out of text that is not an address', () => {
    expect(classifyUrl('not a url')).toMatchObject({ kind: 'link', url: 'not a url' })
    expect(classifyUrl('').kind).toBe('link')
  })

  it('names the host without the www, and says "link" when there is no host', () => {
    expect(hostOf('https://www.example.com/x')).toBe('example.com')
    expect(hostOf('nonsense')).toBe('link')
  })
})

describe('looks', () => {
  const fx = (p: Partial<FxState>): FxState => ({ ...FX_0, ...p })

  it('carries the treatment and leaves the framing behind', () => {
    const look = lookFrom(fx({ fxid: 'halftone', sat: 0, grain: 40, zoom: 1.6, ox: 12, rot: 90, fh: true }))
    expect(look).toMatchObject({ fxid: 'halftone', sat: 0, grain: 40 })
    expect(look).not.toHaveProperty('zoom')
    expect(look).not.toHaveProperty('ox')
    expect(look).not.toHaveProperty('rot')
  })

  it('copies the effect settings rather than pointing at them', () => {
    const ep = { cell: 8 }
    const look = lookFrom(fx({ fxid: 'halftone', ep }))
    ep.cell = 99
    expect(look.ep).toEqual({ cell: 8 })
  })

  it('knows when there is nothing worth saving', () => {
    expect(isPlain(lookFrom(fx({})))).toBe(true)
    expect(isPlain(lookFrom(fx({ zoom: 2, rot: 45 })))).toBe(true)
    expect(isPlain(lookFrom(fx({ grain: 1 })))).toBe(false)
    expect(isPlain(lookFrom(fx({ fxid: 'halftone' })))).toBe(false)
  })

  it('names a look after what it actually is', () => {
    expect(describeLook(lookFrom(fx({ fxid: 'halftone', sat: 0, grain: 40 })), 'Halftone')).toBe('Halftone mono grain')
    expect(describeLook(lookFrom(fx({ warm: 40 })), 'Original')).toBe('warm')
    expect(describeLook(lookFrom(fx({ warm: -40 })), 'Original')).toBe('cool')
    expect(describeLook(lookFrom(fx({})), 'Original')).toBe('Look')
  })
})
