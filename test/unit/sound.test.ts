import { describe, expect, it } from 'vitest'
import { MAX_CHAIN, SOUNDS, SOUND_BY_ID, soundDefaults, soundGroups } from '../../src/store/sound'
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
