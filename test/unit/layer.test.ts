import { describe, expect, it } from 'vitest'
import { ADJUST_0, BLENDS, blendOf } from '../../src/engine/types'
import type { FxState } from '../../src/engine/types'
import { describe as nameLook, isPlain, lookFrom } from '../../src/state/looks'

/* How a card sits with the cards under it, and what happens to that when the
 * board it is written in is older or newer than the build reading it.
 *
 * A blend mode is the first thing this app has stored as a name rather than as
 * a number, and a name is the thing that can arrive wrong. A board saved by a
 * build that had never heard of blending has no mode on it at all; one saved
 * by a build with a mode this one does not know has a mode that cannot be
 * used. Both have to come out as "normal" rather than as `undefined` reaching
 * a stylesheet, and both come through the same door so there is one place to
 * be sure of.
 */

const fx = (over: Partial<FxState> = {}): FxState =>
  ({ ...ADJUST_0, preset: 'none', fxid: 'none', ep: null, ...over }) as FxState

describe('the blend modes on offer', () => {
  it('starts at normal, so a card that says nothing sits on top as it always did', () => {
    expect(ADJUST_0.mix).toBe('normal')
    expect(ADJUST_0.op).toBe(100)
  })

  it('offers eight, each with a name a person could say', () => {
    expect(BLENDS).toHaveLength(8)
    expect(BLENDS.map((b) => b.id)).toContain('normal')
    for (const b of BLENDS) expect(b.name).toMatch(/^[A-Z]/)
  })

  /* Every one of them has to be a mode both CSS and a canvas already agree on,
     because the board draws with one and the exported sheet draws with the
     other, and a mode only one of them knows would make the two disagree. */
  it('names them the way both the stylesheet and the canvas do', () => {
    const known = new Set([
      'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
      'color-dodge', 'color-burn', 'hard-light', 'soft-light',
      'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
    ])
    for (const b of BLENDS) expect(known.has(b.id)).toBe(true)
  })
})

describe('reading a mode off a board', () => {
  it('takes one it knows', () => {
    expect(blendOf('multiply')).toBe('multiply')
    expect(blendOf('luminosity')).toBe('luminosity')
  })

  /* A board written before any of this existed. */
  it('reads nothing at all as normal', () => {
    expect(blendOf(undefined)).toBe('normal')
    expect(blendOf('')).toBe('normal')
  })

  /* And one written by a build that offers more than this one does. */
  it('reads a mode it has never heard of as normal rather than passing it on', () => {
    expect(blendOf('color-dodge')).toBe('normal')
    expect(blendOf('plaid')).toBe('normal')
  })
})

describe('what a saved look carries', () => {
  it('takes the opacity and the mode, because both are treatment', () => {
    const look = lookFrom(fx({ op: 40, mix: 'multiply' }))
    expect(look.op).toBe(40)
    expect(look.mix).toBe('multiply')
  })

  /* The crop is the one thing it never takes: it belongs to the particular
     photograph it was set on, and carrying it across would wreck eleven
     framings to copy one. */
  it('and still leaves the framing behind', () => {
    const look = lookFrom(fx({ zoom: 2, ox: 30, oy: -20, rot: 15 })) as Record<string, unknown>
    expect(look.zoom).toBeUndefined()
    expect(look.ox).toBeUndefined()
    expect(look.rot).toBeUndefined()
  })

  it('cleans up a mode it does not know on the way in', () => {
    expect(lookFrom(fx({ mix: 'plaid' })).mix).toBe('normal')
  })
})

describe('whether there is anything worth saving', () => {
  it('a card with nothing on it has nothing to save', () => {
    expect(isPlain(lookFrom(fx()))).toBe(true)
  })

  /* Before this, a card whose only treatment was an opacity or a blend mode
     read as plain, and the panel offered nothing to save. */
  it('a card that is only faded has something', () => {
    expect(isPlain(lookFrom(fx({ op: 30 })))).toBe(false)
  })

  it('and so does one that is only a blend mode', () => {
    expect(isPlain(lookFrom(fx({ mix: 'screen' })))).toBe(false)
  })

  it('but a mode nobody knows is not something', () => {
    expect(isPlain(lookFrom(fx({ mix: 'plaid' })))).toBe(true)
  })
})

describe('what a look is called before it is named', () => {
  it('says the mode, since that is what it does', () => {
    expect(nameLook(lookFrom(fx({ mix: 'multiply' })), 'None')).toBe('multiply')
  })

  it('says faded when that is all it is', () => {
    expect(nameLook(lookFrom(fx({ op: 25 })), 'None')).toBe('faded')
  })

  it('and puts the mode after the effect when there is one', () => {
    expect(nameLook(lookFrom(fx({ fxid: 'halftone', mix: 'screen' })), 'Halftone')).toBe('Halftone screen')
  })
})
