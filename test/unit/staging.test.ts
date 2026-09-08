import { describe, expect, it } from 'vitest'
import { DIST, PITCH, dollied, sameStage, stageOf, turned, wrapYaw } from '../../src/state/staging'
import { STAGE_0 } from '../../src/store/model'
import type { Item } from '../../src/state/types'
import { FX_0 } from '../../src/engine/types'

/* Where the camera stands, as arithmetic.
 *
 * The rest of this is a render and has to be checked in a browser. These three
 * are the numbers behind the gesture, and they are the ones with edges: an
 * angle that has to come back round to where it started, a tilt that must
 * never go over the top, and a distance that means the same thing on a ring as
 * on a building.
 */

const model = (extra: Partial<Item> = {}): Item =>
  ({ id: 'm', kind: 'model', x: 0, y: 0, z: 0, w: 10, h: 10, fx: { ...FX_0 }, tag: null, ...extra } as Item)

describe('turning', () => {
  it('comes back round to where it started', () => {
    expect(wrapYaw(0)).toBe(0)
    expect(wrapYaw(360)).toBe(0)
    expect(wrapYaw(370)).toBe(10)
    expect(wrapYaw(-370)).toBe(-10)
    /* Half a turn is the same view from either side, and the answer has to be
       one of them rather than both. */
    expect(Math.abs(wrapYaw(180))).toBe(180)
  })

  it('keeps the number one a person can read', () => {
    for (let i = -8; i <= 8; i++) {
      const y = wrapYaw(37 + i * 360)
      expect(y).toBeGreaterThan(-181)
      expect(y).toBeLessThanOrEqual(180)
    }
  })

  it('turns and tilts together, because a drag is one gesture', () => {
    const s = turned(STAGE_0, 90, -10)
    expect(s.yaw).toBe(wrapYaw(STAGE_0.yaw + 90))
    expect(s.pitch).toBe(STAGE_0.pitch - 10)
    expect(s.dist).toBe(STAGE_0.dist)
  })

  /* Straight down is ninety degrees and going past it rolls the picture upside
     down on the way, so the tilt stops just short at both ends — which is the
     one limit a drag will actually reach. */
  it('stops just short of straight up and straight down', () => {
    expect(turned(STAGE_0, 0, 1000).pitch).toBe(PITCH)
    expect(turned(STAGE_0, 0, -1000).pitch).toBe(-PITCH)
    expect(PITCH).toBeLessThan(90)
  })
})

describe('going in and out', () => {
  it('multiplies rather than adds, so a step is the same size at any distance', () => {
    expect(dollied({ ...STAGE_0, dist: 1 }, 2).dist).toBe(2)
    expect(dollied({ ...STAGE_0, dist: 2 }, 0.5).dist).toBe(1)
  })

  it('and stops before the camera is inside the model', () => {
    expect(dollied(STAGE_0, 0.001).dist).toBe(DIST.min)
    expect(dollied(STAGE_0, 1000).dist).toBe(DIST.max)
    expect(DIST.min).toBeGreaterThan(0)
  })

  /* One is the model exactly filling the frame, so the view a card opens on
     has to be a little over that or the model is cropped by its own card. */
  it('opens on a view with air around it', () => {
    expect(STAGE_0.dist).toBeGreaterThan(1)
    expect(STAGE_0.dist).toBeLessThan(DIST.max)
  })
})

describe('what a card is showing', () => {
  it('reads the stage off it', () => {
    expect(stageOf(model({ stage: { yaw: 10, pitch: 20, dist: 2 } }))).toEqual({ yaw: 10, pitch: 20, dist: 2 })
  })

  /* A board saved before any of this existed has a model card with no stage on
     it at all, and it has to open on something rather than on NaN. */
  it('and falls back to the view it would have opened on', () => {
    expect(stageOf(model())).toEqual(STAGE_0)
    expect(stageOf(null)).toEqual(STAGE_0)
    expect(stageOf(model({ stage: { yaw: 12 } as never }))).toEqual({ ...STAGE_0, yaw: 12 })
  })

  it('knows when two views are the same view', () => {
    expect(sameStage(STAGE_0, { ...STAGE_0 })).toBe(true)
    expect(sameStage(STAGE_0, { ...STAGE_0, yaw: STAGE_0.yaw + 1 })).toBe(false)
    /* Fractions of a degree are the renderer's rounding, not a turn. */
    expect(sameStage(STAGE_0, { ...STAGE_0, yaw: STAGE_0.yaw + 0.001 })).toBe(true)
  })
})
