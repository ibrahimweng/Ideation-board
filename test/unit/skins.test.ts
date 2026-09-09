import { describe, expect, it } from 'vitest'
import { SLOTS, dressOf, remapSkins, skinKeys, slotName, withSkin, withoutSkin } from '../../src/state/skins'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* What a material is wearing.
 *
 * Two things make this worth testing on its own rather than through the panel.
 *
 * The first is that it reads two shapes. A board written while a material
 * could only wear its colour kept one address per material and meant the
 * colour by it, and those boards are still on people's machines. The
 * alternative to reading them was rewriting every board ever saved to add a
 * word it can only have meant, so the old shape is read rather than migrated —
 * and a reader that quietly stops understanding it loses the textures off
 * every model made before slots existed.
 *
 * The second is who else asks. `skinKeys` is what the sweep uses to know a
 * picture is still pointed at and what the export uses to know it has to carry
 * one. A key missed here is a photograph collected out from under a model, or
 * a `.board.zip` that opens with the textures gone — neither of which says
 * anything at the time.
 */

const model = (skins?: Item['skins']): Item =>
  ({
    id: 'm', kind: 'model', x: 0, y: 0, w: 10, h: 10, z: 0,
    fx: { ...FX_0 }, tag: null, name: 'lockup.glb', skins,
  } as Item)

describe('reading what is worn', () => {
  it('reads the shape with the slot named', () => {
    const it0 = model({ Shell: { colour: 'k1', roughness: 'k2' } })
    expect(dressOf(it0)).toEqual({ Shell: { colour: 'k1', roughness: 'k2' } })
  })

  /* The board that has been on somebody's disk since before there were slots. */
  it('and reads a bare address as the colour, which is what it meant', () => {
    expect(dressOf(model({ Shell: 'k1' }))).toEqual({ Shell: { colour: 'k1' } })
  })

  it('reads both shapes on one card, since a board can hold either', () => {
    const it0 = model({ Shell: 'k1', Trim: { glow: 'k2' } })
    expect(dressOf(it0)).toEqual({ Shell: { colour: 'k1' }, Trim: { glow: 'k2' } })
  })

  it('says nothing about a card with nothing on it', () => {
    expect(dressOf(model())).toEqual({})
    expect(dressOf(null)).toEqual({})
    expect(dressOf(undefined)).toEqual({})
  })

  /* The reader hands back a copy. A caller that edits what it was given must
     not be editing the card. */
  it('hands back a copy rather than the card own record', () => {
    const it0 = model({ Shell: { colour: 'k1' } })
    const read = dressOf(it0)
    read.Shell.colour = 'somewhere else'
    delete read.Shell
    expect(dressOf(it0)).toEqual({ Shell: { colour: 'k1' } })
  })
})

describe('every picture a card points at', () => {
  it('collects them across materials and across slots', () => {
    const it0 = model({
      Shell: { colour: 'k1', roughness: 'k2', relief: 'k3' },
      Trim: { glow: 'k4' },
    })
    expect(skinKeys(it0).sort()).toEqual(['k1', 'k2', 'k3', 'k4'])
  })

  /* The one that matters most: an old board's texture is still pointed at, and
     a sweep that could not see it would collect the picture. */
  it('including the ones written in the old shape', () => {
    expect(skinKeys(model({ Shell: 'k1', Trim: { colour: 'k2' } })).sort()).toEqual(['k1', 'k2'])
  })

  it('and nothing at all from a card wearing nothing', () => {
    expect(skinKeys(model())).toEqual([])
    expect(skinKeys(model({}))).toEqual([])
  })
})

describe('putting something on', () => {
  it('adds a slot without disturbing the others', () => {
    const it0 = model({ Shell: { colour: 'k1' }, Trim: { glow: 'k9' } })
    expect(withSkin(it0, 'Shell', 'roughness', 'k2')).toEqual({
      Shell: { colour: 'k1', roughness: 'k2' },
      Trim: { glow: 'k9' },
    })
  })

  it('replaces what that slot was wearing', () => {
    const it0 = model({ Shell: { colour: 'k1' } })
    expect(withSkin(it0, 'Shell', 'colour', 'k2')).toEqual({ Shell: { colour: 'k2' } })
  })

  /* Written in the named shape whatever shape it was read in, so a board
     upgrades itself the first time a material is dressed. */
  it('writes the named shape onto a card that was in the old one', () => {
    const it0 = model({ Shell: 'k1' })
    expect(withSkin(it0, 'Shell', 'glow', 'k2')).toEqual({ Shell: { colour: 'k1', glow: 'k2' } })
  })

  it('and dresses a material that was wearing nothing', () => {
    expect(withSkin(model(), 'Shell', 'colour', 'k1')).toEqual({ Shell: { colour: 'k1' } })
  })

  it('leaves the card itself alone until somebody writes it back', () => {
    const it0 = model({ Shell: { colour: 'k1' } })
    withSkin(it0, 'Shell', 'glow', 'k2')
    expect(it0.skins).toEqual({ Shell: { colour: 'k1' } })
  })
})

describe('taking something off', () => {
  it('leaves the other slots on that material', () => {
    const it0 = model({ Shell: { colour: 'k1', glow: 'k2' } })
    expect(withoutSkin(it0, 'Shell', 'glow')).toEqual({ Shell: { colour: 'k1' } })
  })

  /* A material wearing nothing is dropped rather than left as an empty row, so
     "is anything worn" stays one question rather than two. */
  it('drops a material left wearing nothing', () => {
    const it0 = model({ Shell: { colour: 'k1' }, Trim: { glow: 'k2' } })
    expect(withoutSkin(it0, 'Shell', 'colour')).toEqual({ Trim: { glow: 'k2' } })
  })

  it('and gives back nothing at all when the last one comes off', () => {
    expect(withoutSkin(model({ Shell: { colour: 'k1' } }), 'Shell', 'colour')).toBeUndefined()
  })

  it('takes the colour off a card written in the old shape', () => {
    expect(withoutSkin(model({ Shell: 'k1' }), 'Shell', 'colour')).toBeUndefined()
  })

  /* Undefined has to mean two different things to the caller — "now wearing
     nothing" and "there was nothing there" — so the caller checks which, and
     this is the half that says there was nothing there. */
  it('and says nothing when that slot was empty already', () => {
    const it0 = model({ Shell: { colour: 'k1' } })
    expect(withoutSkin(it0, 'Shell', 'glow')).toBeUndefined()
    expect(withoutSkin(it0, 'Trim', 'colour')).toBeUndefined()
    expect(withoutSkin(model(), 'Shell', 'colour')).toBeUndefined()
  })
})

describe('the trip out of this browser and back in', () => {
  it('swaps every address and keeps the shape', () => {
    const it0 = model({ Shell: { colour: 'k1', glow: 'k2' }, Trim: { colour: 'k3' } })
    expect(remapSkins(it0, (k) => k.replace('k', 'new'))).toEqual({
      Shell: { colour: 'new1', glow: 'new2' },
      Trim: { colour: 'new3' },
    })
  })

  it('and writes an old-shape card out in the named shape', () => {
    expect(remapSkins(model({ Shell: 'k1' }), (k) => k + '-in')).toEqual({ Shell: { colour: 'k1-in' } })
  })

  /* A file that did not come with the board has no new address, and an address
     pointing at nothing is worse than a material wearing nothing. */
  it('drops what the rename refuses rather than keeping a dangling address', () => {
    const it0 = model({ Shell: { colour: 'k1', glow: 'gone' }, Trim: { colour: 'gone' } })
    expect(remapSkins(it0, (k) => (k === 'gone' ? undefined : k + '-in'))).toEqual({
      Shell: { colour: 'k1-in' },
    })
  })

  it('and gives back nothing when none of it arrived', () => {
    expect(remapSkins(model({ Shell: { colour: 'gone' } }), () => undefined)).toBeUndefined()
    expect(remapSkins(model(), (k) => k)).toBeUndefined()
  })
})

describe('the slots themselves', () => {
  it('are the five where a photograph means something', () => {
    expect(SLOTS.map((s) => s.id)).toEqual(['colour', 'roughness', 'glow', 'relief', 'cutout'])
  })

  /* Relief is the odd one: glTF carries normal maps rather than heights, so it
     is a thing you put on and never a thing the file came with — which is
     exactly what having no `reads` says, and what the panel reads to know not
     to offer Treat for it. */
  it('and relief alone declares nothing it could have arrived in', () => {
    for (const s of SLOTS) {
      if (s.id === 'relief') expect(s.reads).toBeUndefined()
      else expect(typeof s.reads).toBe('string')
    }
  })

  it('every slot says what it is, and is named for the panel', () => {
    for (const s of SLOTS) {
      expect(s.what.length).toBeGreaterThan(0)
      expect(slotName(s.id)).toBe(s.name)
    }
    expect(slotName('no-such-slot')).toBe('no-such-slot')
  })
})
