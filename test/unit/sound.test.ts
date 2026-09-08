import { describe, expect, it } from 'vitest'
import {
  MAX_CHAIN, SOUNDS, SOUND_BUDGET, SOUND_BY_ID, SOUND_MAX, clock, roomForSound, soundDefaults, soundGroups,
} from '../../src/store/sound'
import { isColor, isEnum } from '../../src/engine/types'

/* The list, and the numbers on it.
 *
 * Rendering needs a browser — there is no OfflineAudioContext here — so the
 * render itself is checked in test/sound.mjs, by measuring what came out. What
 * can be checked in a second is the part that would be wrong in a way nobody
 * would notice: a control whose default is outside its own range, two effects
 * sharing an id, a slot number used twice in one effect so that moving one
 * slider moves another.
 */

describe('the effects a sound can take', () => {
  it('are a list with something on it', () => {
    expect(SOUNDS.length).toBeGreaterThanOrEqual(12)
  })

  it('each with an id of its own', () => {
    expect(new Set(SOUNDS.map((s) => s.id)).size).toBe(SOUNDS.length)
  })

  it('and a name and a line saying what it does', () => {
    for (const s of SOUNDS) {
      expect(s.name.length, s.id).toBeGreaterThan(2)
      expect(s.about.length, s.id).toBeGreaterThan(4)
      /* The line is the whole offer: there is no thumbnail for a sound, so a
         list of names alone would be a list of guesses. */
      expect(s.about.endsWith('.'), s.id).toBe(false)
    }
  })

  it('with every control in a slot of its own', () => {
    for (const s of SOUNDS) {
      const keys = s.controls.map((c) => c.k)
      expect(new Set(keys).size, s.id).toBe(keys.length)
      /* Six numbered slots, the same as the picture side. */
      for (const k of keys) expect(k, s.id).toMatch(/^p[0-5]$/)
    }
  })

  /* A default outside its own range is a slider that jumps the first time it
     is touched, which reads as the app having lost the setting. */
  it('and every default inside its own range', () => {
    for (const s of SOUNDS) {
      for (const c of s.controls) {
        if (isColor(c)) continue
        if (isEnum(c)) {
          expect(c.def, `${s.id}.${c.k}`).toBeGreaterThanOrEqual(0)
          expect(c.def, `${s.id}.${c.k}`).toBeLessThan(c.options.length)
        } else {
          expect(c.def, `${s.id}.${c.k}`).toBeGreaterThanOrEqual(c.min)
          expect(c.def, `${s.id}.${c.k}`).toBeLessThanOrEqual(c.max)
          expect(c.step, `${s.id}.${c.k}`).toBeGreaterThan(0)
          expect(c.max, `${s.id}.${c.k}`).toBeGreaterThan(c.min)
        }
      }
    }
  })

  it('and defaults that can be read back by id', () => {
    for (const s of SOUNDS) {
      const ep = soundDefaults(s.id)
      expect(Object.keys(ep).sort()).toEqual(s.controls.map((c) => c.k).sort())
    }
    expect(soundDefaults('no-such-effect')).toEqual({})
  })

  it('and every one of them reachable from the id it is listed under', () => {
    for (const s of SOUNDS) expect(SOUND_BY_ID[s.id]).toBe(s)
  })
})

describe('how the panel groups them', () => {
  it('keeps every effect, once', () => {
    const flat = soundGroups().flatMap((g) => g.items)
    expect(flat.length).toBe(SOUNDS.length)
    expect(new Set(flat.map((s) => s.id)).size).toBe(SOUNDS.length)
  })

  it('and puts each group together rather than scattering it', () => {
    const names = soundGroups().map((g) => g.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(1)
  })
})

describe('the length of a chain', () => {
  /* Past four nobody can hear which one is doing what, and every one of them
     is another full render of the sound. */
  it('is capped at the same four the pictures allow', () => {
    expect(MAX_CHAIN).toBe(4)
  })
})

/* ---------------------------------------------------------------------------
 * What a page will carry.
 *
 * The encoding is a browser job and is checked in test/sendable.mjs, by taking
 * the file the app makes into a browser that has never seen the app and
 * decoding the sound back out of it. What is here is the rule that decides
 * which sounds go in at all — arithmetic, and the sentence a card shows when
 * the answer is no.
 * ------------------------------------------------------------------------- */

describe('what a page will carry', () => {
  const MB = 1024 * 1024

  it('takes a sound that fits', () => {
    expect(roomForSound(200 * 1024, 0, 4)).toBeNull()
    expect(roomForSound(SOUND_MAX, 0, 60)).toBeNull()
  })

  it('and refuses one that is most of the page on its own', () => {
    expect(roomForSound(SOUND_MAX + 1, 0, 200)).toMatch(/too long/)
  })

  /* The reason is written for whoever opens the page. They cannot go and trim
     it, so it says what is true about the card rather than what went wrong. */
  it('saying how long the one it would not carry was', () => {
    expect(roomForSound(9 * MB, 0, 185)).toContain('3:05')
    expect(roomForSound(9 * MB, 0, 45)).toContain('0:45')
  })

  it('and stops once the page has had its share', () => {
    expect(roomForSound(1 * MB, SOUND_BUDGET - 2 * MB, 20)).toBeNull()
    expect(roomForSound(1 * MB, SOUND_BUDGET, 20)).toMatch(/small/)
  })

  /* Half a dozen short treatments is the case this exists for: twelve
     variations of a moment should all be in there. */
  it('so a grid of short ones all fit and a wall of long ones does not', () => {
    let spent = 0
    let carried = 0
    for (let i = 0; i < 12; i++) {
      const bytes = 400 * 1024
      if (!roomForSound(bytes, spent, 9)) { spent += bytes; carried++ }
    }
    expect(carried).toBe(12)
    expect(SOUND_BUDGET).toBeGreaterThan(spent)
  })

  it('and the clock reads as a clock', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(9)).toBe('0:09')
    expect(clock(60)).toBe('1:00')
    expect(clock(614)).toBe('10:14')
    /* Whatever it is handed, because it is handed a card's own number. */
    expect(clock(-4)).toBe('0:00')
    expect(clock(NaN)).toBe('0:00')
  })
})
