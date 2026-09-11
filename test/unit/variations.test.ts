import { describe, expect, it } from 'vitest'
import {
  VARIANTS, batchOfLooks, breedLook, breedParams, rollColour, rollLook, rollParams, spreadOfEffects,
} from '../../src/state/variations'
import { BY_ID, EFFECTS } from '../../src/engine/effects'
import { FX_0, isColor, isEnum } from '../../src/engine/types'
import type { FxState } from '../../src/engine/types'

/* The dice behind the twelve.
 *
 * A roll is random by design, so the things worth checking about it are rates
 * and invariants — and a rate cannot be checked by looking at one batch. The
 * browser suite tried: it asserted that some of twelve stack a second effect,
 * which is true one time in thirty-two only in the sense that it is false one
 * time in thirty-two. That check went red on a run of a commit that had passed
 * an hour earlier, which is exactly what a rate asserted on twelve samples
 * does.
 *
 * Here the same claims are made over thousands of draws, where the chance of a
 * fair run failing is too small to write down, and where a real change to the
 * odds shows up as a real failure.
 */

const CHOOSABLE = EFFECTS.filter((e) => e.id !== 'none')
const DRAWS = 300

/* A card that has been framed and layered, so a roll can be checked for
 * leaving both alone. */
const framed: FxState = {
  ...FX_0,
  fxid: 'halftone',
  zoom: 1.7, ox: -12, oy: 9, rot: 30, fh: true, fv: false,
  op: 62, mix: 'multiply',
}

const many = (n: number, fn: () => FxState): FxState[] => Array.from({ length: n }, fn)

describe('breadth', () => {
  it('gives back as many as it was asked for', () => {
    expect(spreadOfEffects(VARIANTS)).toHaveLength(VARIANTS)
    expect(spreadOfEffects(0)).toHaveLength(0)
  })

  /* Twelve drawn straight from the hat come up five kinds of blur about as
     often as not, which is the one thing a gallery of twelve must not do. */
  it('and spreads them across the groups rather than drawing from the hat', () => {
    const groups = new Set(EFFECTS.map((e) => e.group))
    for (let i = 0; i < DRAWS; i++) {
      const got = spreadOfEffects(VARIANTS).map((id) => BY_ID[id].group)
      expect(new Set(got).size).toBeGreaterThanOrEqual(Math.min(groups.size, VARIANTS) - 1)
    }
  })

  it('and never comes up short when asked for more than there are', () => {
    const asked = CHOOSABLE.length + 7
    expect(spreadOfEffects(asked)).toHaveLength(asked)
  })

  it('and never offers the effect that is no effect', () => {
    for (let i = 0; i < DRAWS; i++) expect(spreadOfEffects(VARIANTS)).not.toContain('none')
  })
})

describe('what a roll changes', () => {
  /* The stated split, and the one a saved look draws too: a crop belongs to
     the particular photograph and how a card sits belongs to where it is. */
  it('leaves the framing and the layering exactly as they were', () => {
    for (let i = 0; i < DRAWS; i++) {
      const got = rollLook(framed, 'invert')
      expect(got.zoom).toBe(framed.zoom)
      expect(got.ox).toBe(framed.ox)
      expect(got.oy).toBe(framed.oy)
      expect(got.rot).toBe(framed.rot)
      expect(got.fh).toBe(framed.fh)
      expect(got.fv).toBe(framed.fv)
      expect(got.op).toBe(framed.op)
      expect(got.mix).toBe(framed.mix)
    }
  })

  it('and puts the effect it was told to on', () => {
    for (const id of ['halftone', 'invert', 'bloom']) {
      if (!BY_ID[id]) continue
      expect(rollLook(framed, id).fxid).toBe(id)
    }
  })

  /* "Noir" is a lie the panel would keep telling once an effect and a stack
     are sitting on top of it. */
  it('and never claims to be a preset afterwards', () => {
    for (let i = 0; i < DRAWS; i++) expect(rollLook(framed, 'invert').preset).toBe('custom')
  })
})

/* How often a thing happens, over enough draws that a fair run failing is not
 * something anyone will see. Each bound below is many standard errors wide. */
const rateOf = (n: number, fn: (look: FxState) => boolean) => {
  let hits = 0
  for (const look of many(n, () => rollLook(FX_0, spreadOfEffects(1)[0]))) if (fn(look)) hits++
  return hits / n
}

describe('the rates a batch is built on', () => {
  const N = 2000

  /* One in four. This is the claim the browser suite could not carry: with
     twelve samples, a fair run shows none of them a little over three per cent
     of the time. With two thousand it is beyond arithmetic. */
  it('about one variant in four stacks a second effect', () => {
    const rate = rateOf(N, (l) => !!l.more?.length)
    expect(rate).toBeGreaterThan(0.18)
    expect(rate).toBeLessThan(0.32)
  })

  it('about one in five runs its effect more than once', () => {
    const rate = rateOf(N, (l) => (l.n || 1) > 1)
    expect(rate).toBeGreaterThan(0.13)
    expect(rate).toBeLessThan(0.28)
  })

  it('and a third of them carry grain they did not ask for', () => {
    const rate = rateOf(N, (l) => l.grain >= 15)
    expect(rate).toBeGreaterThan(0.2)
    expect(rate).toBeLessThan(0.55)
  })

  /* A second effect that is the first one again is a wasted pass and reads as
     a bug in the grid. */
  it('and a stacked second effect is never the first one over again', () => {
    for (let i = 0; i < DRAWS; i++) {
      const l = rollLook(FX_0, 'halftone')
      if (l.more?.length) expect(l.more[0].fxid).not.toBe('halftone')
    }
  })
})

describe('the settings it rolls', () => {
  it('stay inside every control, whatever the effect', () => {
    for (const spec of CHOOSABLE) {
      for (let i = 0; i < 25; i++) {
        const ep = rollParams(spec.id)
        for (const c of spec.controls) {
          const v = ep[c.k]
          if (isColor(c)) expect(String(v), `${spec.id}.${c.k}`).toMatch(/^#[0-9a-f]{6}$/)
          else if (isEnum(c)) {
            expect(Number.isInteger(v), `${spec.id}.${c.k}`).toBe(true)
            expect(v as number).toBeGreaterThanOrEqual(0)
            expect(v as number).toBeLessThan(c.options.length)
          } else {
            expect(v as number, `${spec.id}.${c.k}`).toBeGreaterThanOrEqual(c.min)
            expect(v as number, `${spec.id}.${c.k}`).toBeLessThanOrEqual(c.max)
          }
        }
      }
    }
  })

  /* A colour slot has a job — an ink, a paper, a tint — and rolling free RGB
     into it loses the job and produces mud. Only the register is kept. */
  it('and a colour keeps the register the effect wrote it in', () => {
    const light = (hex: string) => {
      const v = parseInt(hex.slice(1), 16)
      return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255
    }
    for (let i = 0; i < DRAWS; i++) {
      expect(light(rollColour('#ffffff'))).toBeGreaterThan(0.6)
      expect(light(rollColour('#0b0b0b'))).toBeLessThan(0.45)
    }
  })

  it('and an unknown effect rolls nothing rather than throwing', () => {
    expect(rollParams('no-such-effect')).toEqual({})
    expect(breedParams('no-such-effect', null)).toEqual({})
  })
})

describe('breeding', () => {
  const parent = rollLook(framed, 'halftone')

  /* Breeding that only ever narrows finds a local best and stops; one that
     strays too often is not breeding at all. */
  it('mostly keeps the parent effect, and now and then takes another', () => {
    const kept = many(1500, () => breedLook(parent)).filter((l) => l.fxid === parent.fxid).length / 1500
    expect(kept).toBeGreaterThan(0.68)
    expect(kept).toBeLessThan(0.92)
  })

  it('and keeps the framing and the layering the parent had', () => {
    for (let i = 0; i < DRAWS; i++) {
      const child = breedLook(parent)
      expect(child.zoom).toBe(framed.zoom)
      expect(child.ox).toBe(framed.ox)
      expect(child.op).toBe(framed.op)
      expect(child.mix).toBe(framed.mix)
    }
  })

  it('and stays inside the controls while nudging them', () => {
    const spec = BY_ID[parent.fxid]
    for (let i = 0; i < DRAWS; i++) {
      const ep = breedParams(parent.fxid, parent.ep)
      for (const c of spec.controls) {
        if (isColor(c) || isEnum(c)) continue
        expect(ep[c.k] as number).toBeGreaterThanOrEqual(c.min)
        expect(ep[c.k] as number).toBeLessThanOrEqual(c.max)
      }
    }
  })

  /* A card with nothing on it has no parent to resemble, so a child of one is
     a fresh roll rather than twelve copies of nothing. */
  it('and a parent with no effect breeds fresh rolls', () => {
    for (let i = 0; i < 50; i++) expect(breedLook(FX_0).fxid).not.toBe('none')
  })
})

describe('a whole batch', () => {
  it('is twelve, and twelve different effects', () => {
    for (let i = 0; i < 50; i++) {
      const batch = batchOfLooks(FX_0, VARIANTS)
      expect(batch).toHaveLength(VARIANTS)
      expect(new Set(batch.map((l) => l.fxid)).size).toBe(VARIANTS)
    }
  })

  /* This one asserted the rate on a single batch of nine and wanted five of
     them from a parent — which is the mistake the top of this file is about,
     made inside the file that says so. Measured over two thousand batches, the
     share bred from a parent is 0.79, and 2.3% of batches of nine come back
     with four or fewer. So it went red about one run in forty, on nothing.
 
     The claim is the same one; it is the sample that was wrong. Over the same
     draws as everything else here, the worst batch seen was 0.44 and the best
     was 1.00, while the share held at 0.79 — so a band either side of that
     catches a real change to the odds and never catches a fair run. Both ends
     are worth having: breeding from nobody means the keepers were ignored, and
     breeding from nothing else means the grid has stopped offering
     alternatives and only repeats what it was given. */
  it('and with keepers, it breeds from them instead', () => {
    const parents = [rollLook(FX_0, 'halftone'), rollLook(FX_0, 'dither')]
    let bred = 0
    let made = 0
    for (let i = 0; i < DRAWS; i++) {
      const batch = batchOfLooks(FX_0, 9, parents)
      expect(batch).toHaveLength(9)
      made += batch.length
      bred += batch.filter((l) => parents.some((p) => p.fxid === l.fxid)).length
    }
    expect(bred / made).toBeGreaterThan(0.6)
    expect(bred / made).toBeLessThan(0.95)
  })

  it('and asking for none makes none', () => {
    expect(batchOfLooks(FX_0, 0)).toHaveLength(0)
  })
})

/* The spread of tones across one batch.
 *
 * Twelve treatments that come out looking the same are a worse answer than one
 * treatment, so a batch has to be a spread. But how wide a spread twelve draws
 * from nine presets happens to land on is a throw of the dice: measured over
 * four thousand batches, fewer than seven distinct tones comes up 2.4% of the
 * time — one run in forty-two. The browser suite asserted seven, and went red
 * on a commit that had passed an hour earlier.
 *
 * So the browser asks only what one batch can answer — that the twelve are not
 * all one thing — and the spread itself is measured here, where it is a rate
 * over thousands of batches rather than a guess about one. */
describe('how wide a batch spreads', () => {
  const spread = (runs: number) => {
    const sizes: number[] = []
    for (let i = 0; i < runs; i++) {
      const looks = batchOfLooks({ ...FX_0 }, VARIANTS)
      /* The same key the board sees: the tone as CSS, and the grain over it. */
      sizes.push(new Set(looks.map((l) => `${l.preset}|${l.con}|${l.sat}|${l.bri}|${l.warm}|${l.grain}`)).size)
    }
    return sizes
  }

  it('is wide, on average, and nothing like twelve of one thing', () => {
    const sizes = spread(2000)
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
    /* Measured at 9.3. Eight leaves room for the dice and still catches a
       change that collapsed the tones — one preset for the whole batch would
       land near one. */
    expect(mean).toBeGreaterThan(8)
  })

  it('and is nearly never narrow', () => {
    const sizes = spread(2000)
    const wide = sizes.filter((n) => n >= 6).length / sizes.length
    /* Measured at 99.5%. */
    expect(wide).toBeGreaterThan(0.97)
  })

  it('and is never one thing twelve times', () => {
    /* The claim the browser makes, over enough draws to mean it: no batch is
       ever a single tone repeated. */
    expect(Math.min(...spread(2000))).toBeGreaterThan(1)
  })
})
