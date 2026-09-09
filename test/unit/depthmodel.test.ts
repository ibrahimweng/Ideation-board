import { describe, expect, it } from 'vitest'
import { join } from '../../src/state/depthModel'

/* Twenty-five megabytes, arriving in pieces.
 *
 * The model is fetched rather than bundled, and a fetch of that size arrives
 * as a run of chunks that have to be put back together in order. Everything
 * else about that path can be driven in a browser — and is, in test/depth.mjs,
 * against a runtime and a set of weights the test serves — but not this: a
 * response served by a test arrives whole however large it is, so the joining
 * is the one part a browser cannot be made to exercise.
 *
 * It is worth its own test because of what a mistake here produces. Wrong
 * length or wrong order both give a file that is still twenty-five megabytes
 * of plausible-looking bytes, and what happens next is either a graph that
 * will not load or, worse, one that loads and answers nonsense — and it is
 * kept, so every later depth map is made from the same broken copy.
 */

const run = (n: number, from: number) => {
  const a = new Uint8Array(n)
  for (let i = 0; i < n; i++) a[i] = (from + i) & 0xff
  return a
}

describe('putting a download back together', () => {
  it('lays the pieces end to end, in the order they arrived', () => {
    const out = join([run(3, 0), run(4, 3), run(2, 7)], 9)
    expect([...out]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('gives back exactly the length it was told to expect', () => {
    expect(join([run(64, 0), run(64, 64)], 128).length).toBe(128)
  })

  it('handles the whole thing arriving in one piece, which is the common case', () => {
    const one = run(256, 0)
    expect([...join([one], 256)]).toEqual([...one])
  })

  it('and nothing arriving at all', () => {
    expect(join([], 0).length).toBe(0)
  })

  /* Chunks are whatever size the network hands over, so a run of them is
     uneven and the last one is usually short. */
  it('does not mind the pieces being different sizes', () => {
    const out = join([run(1, 0), run(100, 1), run(27, 101)], 128)
    expect(out.length).toBe(128)
    expect(out[0]).toBe(0)
    expect(out[100]).toBe(100)
    expect(out[127]).toBe(127)
  })

  /* A megabyte in pieces of an awkward size: the arithmetic has to hold over
     a run long enough that an off-by-one accumulates into something the model
     would choke on rather than something that happens to still work. */
  it('holds over a long run of pieces', () => {
    const parts: Uint8Array[] = []
    let at = 0
    while (at < 1_000_000) {
      const n = Math.min(7919, 1_000_000 - at)
      parts.push(run(n, at))
      at += n
    }
    const out = join(parts, 1_000_000)
    expect(out.length).toBe(1_000_000)
    let same = true
    for (let i = 0; i < 1_000_000 && same; i++) if (out[i] !== (i & 0xff)) same = false
    expect(same).toBe(true)
  })
})
