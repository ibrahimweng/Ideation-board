import { describe, expect, it } from 'vitest'
import {
  VARY_MAX_SECS, batchOfChains, breedChain, breedSoundParams, rollChain, rollSoundParams, spreadOfSounds,
} from '../../src/state/soundVary'
import { SOUNDS, SOUND_BY_ID } from '../../src/store/sound'
import { isColor, isEnum } from '../../src/engine/types'
import { VARIANTS } from '../../src/state/variations'

/* The dice behind twelve of a sound.
 *
 * The same lesson the picture side learned the hard way: a rate cannot be
 * asserted on twelve samples, so the rates are checked here over thousands of
 * draws and the browser suite asks only what a browser can answer.
 */

const DRAWS = 300

describe('breadth', () => {
  it('gives back as many as it was asked for', () => {
    expect(spreadOfSounds(VARIANTS)).toHaveLength(VARIANTS)
    expect(spreadOfSounds(0)).toHaveLength(0)
  })

  /* Four groups and thirteen effects: a straight draw comes up three kinds of
     space about as often as not, and twelve versions that are all reverb is a
     worse answer than one. */
  it('and spreads them across the groups rather than drawing from the hat', () => {
    const groups = new Set(SOUNDS.map((s) => s.group))
    for (let i = 0; i < DRAWS; i++) {
      const got = spreadOfSounds(VARIANTS).map((id) => SOUND_BY_ID[id].group)
      expect(new Set(got).size).toBe(groups.size)
    }
  })

  it('and never comes up short when asked for more than there are', () => {
    const asked = SOUNDS.length + 5
    expect(spreadOfSounds(asked)).toHaveLength(asked)
  })

  it('and only ever offers an effect that exists', () => {
    for (const id of spreadOfSounds(40)) expect(SOUND_BY_ID[id]).toBeTruthy()
  })
})

describe('the settings it rolls', () => {
  it('stay inside every control, whatever the effect', () => {
    for (const spec of SOUNDS) {
      for (let i = 0; i < 30; i++) {
        const ep = rollSoundParams(spec.id)
        for (const c of spec.controls) {
          const v = ep[c.k]
          if (isColor(c)) continue
          if (isEnum(c)) {
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

  /* Two free ends land close together often enough to matter: a first batch
     came back with a card reading nought seconds, which is a square of the
     grid spent on nothing. */
  it('and a trim is rolled as a place and a length, never as a sliver', () => {
    for (let i = 0; i < 2000; i++) {
      const ep = rollSoundParams('trim')
      const from = ep.p0 as number
      const to = ep.p1 as number
      expect(to).toBeGreaterThan(from)
      expect(to - from).toBeGreaterThanOrEqual(0.29)
      expect(from).toBeGreaterThanOrEqual(0)
      expect(to).toBeLessThanOrEqual(1)
    }
  })

  it('and an unknown effect rolls nothing rather than throwing', () => {
    expect(rollSoundParams('no-such-effect')).toEqual({})
    expect(breedSoundParams('no-such-effect', null)).toEqual({})
  })

  it('and a nudged setting stays inside its control too', () => {
    for (const spec of SOUNDS) {
      const from = rollSoundParams(spec.id)
      for (let i = 0; i < 20; i++) {
        const ep = breedSoundParams(spec.id, from)
        for (const c of spec.controls) {
          if (isColor(c) || isEnum(c)) continue
          expect(ep[c.k] as number, `${spec.id}.${c.k}`).toBeGreaterThanOrEqual(c.min)
          expect(ep[c.k] as number, `${spec.id}.${c.k}`).toBeLessThanOrEqual(c.max)
        }
      }
    }
  })

  /* A menu is a decision rather than a dial. Jittering it would turn a low
     pass into a notch halfway through refining a low pass. */
  it('and a menu is kept rather than nudged', () => {
    const withMenu = SOUNDS.find((s) => s.controls.some((c) => isEnum(c)))!
    const key = withMenu.controls.find((c) => isEnum(c))!.k
    const from = { ...rollSoundParams(withMenu.id), [key]: 1 }
    for (let i = 0; i < 50; i++) expect(breedSoundParams(withMenu.id, from)[key]).toBe(1)
  })
})

describe('a chain', () => {
  it('is one effect, sometimes two', () => {
    for (let i = 0; i < DRAWS; i++) {
      const chain = rollChain()
      expect(chain.length).toBeGreaterThanOrEqual(1)
      expect(chain.length).toBeLessThanOrEqual(2)
      for (const l of chain) expect(SOUND_BY_ID[l.fxid]).toBeTruthy()
    }
  })

  /* Two is where the surprises are — a gate into a reverb is a different
     instrument from either — so it has to happen often enough to be worth
     looking at and rarely enough that the grid is not all mud. */
  it('and about a third of them are two', () => {
    const pairs = Array.from({ length: 3000 }, () => rollChain()).filter((c) => c.length === 2).length / 3000
    expect(pairs).toBeGreaterThan(0.25)
    expect(pairs).toBeLessThan(0.46)
  })

  it('and a pair is never the same effect twice', () => {
    for (let i = 0; i < DRAWS * 4; i++) {
      const chain = rollChain()
      if (chain.length === 2) expect(chain[0].fxid).not.toBe(chain[1].fxid)
    }
  })

  it('and the effect it was told to start with is the one it starts with', () => {
    for (const s of SOUNDS) expect(rollChain(s.id)[0].fxid).toBe(s.id)
  })
})

describe('breeding', () => {
  const parent = rollChain('reverb')

  it('mostly keeps the parent chain, and now and then takes another', () => {
    const kept = Array.from({ length: 2000 }, () => breedChain(parent))
      .filter((c) => c[0].fxid === parent[0].fxid).length / 2000
    expect(kept).toBeGreaterThan(0.68)
    expect(kept).toBeLessThan(0.92)
  })

  it('and a parent with nothing on it breeds a fresh roll', () => {
    for (let i = 0; i < 50; i++) expect(breedChain([]).length).toBeGreaterThanOrEqual(1)
  })
})

describe('a whole batch', () => {
  it('is twelve, spread across the groups', () => {
    for (let i = 0; i < 50; i++) {
      const batch = batchOfChains(VARIANTS)
      expect(batch).toHaveLength(VARIANTS)
      expect(new Set(batch.map((c) => c[0].fxid)).size).toBe(VARIANTS)
    }
  })

  it('and with keepers, it breeds from them instead', () => {
    const parents = [rollChain('gate'), rollChain('delay')]
    const batch = batchOfChains(9, parents)
    expect(batch).toHaveLength(9)
    const fromParents = batch.filter((c) => parents.some((p) => p[0].fxid === c[0].fxid)).length
    expect(fromParents).toBeGreaterThan(4)
  })

  it('and asking for none makes none', () => {
    expect(batchOfChains(0)).toHaveLength(0)
  })
})

describe('what it will not do', () => {
  /* Twelve renders of a long track is half a gigabyte in a browser that keeps
     everything you own inside one quota. The cap is the feature. */
  it('has a length past which twelve copies is more than anyone meant to spend', () => {
    expect(VARY_MAX_SECS).toBeGreaterThan(5)
    expect(VARY_MAX_SECS).toBeLessThanOrEqual(60)
  })
})
