import { describe, expect, it } from 'vitest'
import { anglesAround, anglesNear } from '../../src/state/modelVary'
import { DIST, PITCH } from '../../src/state/staging'
import { STAGE_0 } from '../../src/store/model'
import type { Stage } from '../../src/store/model'

/* Where the twelve cameras stand.
 *
 * The renders themselves are a browser question and are asked there. What is
 * here is the claim that makes this dice worth having at all: twelve angles
 * that go round the object rather than twelve angles.
 *
 * That claim is about a distribution, so it is checked the way the picture
 * dice are checked — over thousands of draws, where a fair run failing is too
 * unlikely to write down and a real change in the odds is a real failure.
 * Asserting it on one batch of twelve is how you get a check that goes red on
 * a commit that passed an hour ago.
 */

const DRAWS = 400
const HERE: Stage = { ...STAGE_0, yaw: 20, pitch: 10, dist: 1.4 }

const many = <T>(n: number, fn: () => T): T[] => Array.from({ length: n }, fn)

/* Sorted round the circle, the distance from each angle to the next. */
const gapsOf = (angles: Stage[], from: Stage): number[] => {
  const round = angles.map((a) => ((((a.yaw - from.yaw) % 360) + 360) % 360)).sort((x, y) => x - y)
  return round.map((a, i) => (i ? a - round[i - 1] : a + 360 - round[round.length - 1]))
}

describe('twelve places round it', () => {
  it('gives back as many as it was asked for', () => {
    expect(anglesAround(12, HERE)).toHaveLength(12)
    expect(anglesAround(3, HERE)).toHaveLength(3)
    expect(anglesAround(0, HERE)).toHaveLength(0)
  })

  /* The whole argument for slicing the turn rather than rolling it: twelve
     random angles leave a gap of ninety degrees or so on average, and that gap
     is the side of the object nobody got a look at. */
  it('never leaves a side of the object unseen', () => {
    for (let i = 0; i < DRAWS; i++) {
      const gaps = gapsOf(anglesAround(12, HERE), HERE)
      expect(Math.max(...gaps)).toBeLessThan(52)
    }
  })

  /* And nudged rather than placed exactly, so the set does not read as a
     turntable animation stopped twelve times. */
  it('and no two of them land on the same angle', () => {
    for (let i = 0; i < DRAWS; i++) {
      const gaps = gapsOf(anglesAround(12, HERE), HERE)
      expect(Math.min(...gaps)).toBeGreaterThan(8)
    }
    const twice = anglesAround(12, HERE).map((a) => a.yaw)
    expect(new Set(twice).size).toBe(12)
  })

  it('and asked for one, it still throws the dice', () => {
    const once = many(DRAWS, () => anglesAround(1, HERE)[0].yaw)
    expect(new Set(once).size).toBeGreaterThan(DRAWS / 2)
  })

  /* The band a thing is photographed from: mostly a little above, sometimes
     level, rarely low, and never over the top — which is a plan, and a
     different drawing. */
  it('photographs it from where things get photographed from', () => {
    const tilts = many(DRAWS, () => anglesAround(12, HERE)).flat().map((a) => a.pitch)
    expect(Math.min(...tilts)).toBeGreaterThanOrEqual(-PITCH)
    expect(Math.max(...tilts)).toBeLessThanOrEqual(PITCH)
    const above = tilts.filter((p) => p > 6).length / tilts.length
    expect(above).toBeGreaterThan(0.5)
    const under = tilts.filter((p) => p < -20).length / tilts.length
    expect(under).toBeLessThan(0.2)
  })

  /* One of the twelve being a detail is worth more than a twelfth view of the
     whole, so about one in four comes in close. */
  it('and brings a few of them in close', () => {
    const dists = many(DRAWS, () => anglesAround(12, HERE)).flat().map((a) => a.dist)
    expect(Math.min(...dists)).toBeGreaterThanOrEqual(DIST.min)
    expect(Math.max(...dists)).toBeLessThanOrEqual(DIST.max)
    const close = dists.filter((d) => d < HERE.dist * 0.8).length / dists.length
    expect(close).toBeGreaterThan(0.12)
    expect(close).toBeLessThan(0.42)
  })

  /* A model already turned to the back is varied round the back: the circuit
     starts where you were standing rather than at some absolute north. */
  it('starts the circuit from where the camera already is', () => {
    const back: Stage = { ...HERE, yaw: 170 }
    const nearest = anglesAround(12, back)
      .map((a) => Math.abs(((((a.yaw - back.yaw) % 360) + 360) % 360 + 180) % 360 - 180))
    expect(Math.min(...nearest)).toBeLessThan(12)
  })
})

describe('twelve more near the ones you kept', () => {
  const kept: Stage[] = [{ ...STAGE_0, yaw: 100, pitch: 20, dist: 1.2 }]

  it('stays near the angle it was bred from', () => {
    const kids = many(DRAWS, () => anglesNear(1, kept)[0])
    for (const k of kids) {
      expect(Math.abs(k.yaw - kept[0].yaw)).toBeLessThanOrEqual(26)
      expect(Math.abs(k.pitch - kept[0].pitch)).toBeLessThanOrEqual(14)
    }
    /* Near, not identical — otherwise pressing again would give the keeper
       back nine times. */
    expect(new Set(kids.map((k) => k.yaw)).size).toBeGreaterThan(DRAWS / 2)
  })

  it('and stays inside the tilt and the distance whatever it was bred from', () => {
    const edge: Stage[] = [{ ...STAGE_0, yaw: 0, pitch: PITCH, dist: DIST.max }]
    for (const k of anglesNear(200, edge)) {
      expect(k.pitch).toBeLessThanOrEqual(PITCH)
      expect(k.pitch).toBeGreaterThanOrEqual(-PITCH)
      expect(k.dist).toBeLessThanOrEqual(DIST.max)
      expect(k.dist).toBeGreaterThanOrEqual(DIST.min)
    }
  })

  it('and shares the round out among several keepers', () => {
    const three: Stage[] = [
      { ...STAGE_0, yaw: 0 }, { ...STAGE_0, yaw: 120 }, { ...STAGE_0, yaw: 240 },
    ]
    const kids = anglesNear(9, three)
    for (const p of three) {
      expect(kids.filter((k) => Math.abs(k.yaw - p.yaw) <= 26).length).toBe(3)
    }
  })
})
