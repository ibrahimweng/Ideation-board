import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  askToPersist, describeSpace, measure, reportWriteFailure, reportWriteOk, roomFor, spaceNow, subscribeSpace, TIGHT,
} from '../../src/store/space'

/* What happens when the disk runs out. Every write used to swallow its own
 * error, so a board that would not save looked exactly like a board that had:
 * the pictures were still on screen because they were still in memory, and you
 * found out on the next reload. */

const fakeStorage = (usage: number, quota: number, persisted = true) => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      storage: {
        estimate: async () => ({ usage, quota }),
        persisted: async () => persisted,
        persist: async () => persisted,
      },
    },
  })
}

const quotaError = () => Object.assign(new Error('nope'), { name: 'QuotaExceededError' })

beforeEach(async () => {
  fakeStorage(0, 1000)
  reportWriteOk(1e9)
  await measure()
})

describe('measuring', () => {
  it('reads usage and quota, and works out how full that is', async () => {
    fakeStorage(750, 1000)
    const s = await measure()
    expect(s).toMatchObject({ usage: 750, quota: 1000, known: true })
    expect(s.ratio).toBeCloseTo(0.75, 3)
  })

  it('leaves the gauge blank rather than wrong when the browser will not say', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    const s = await measure()
    expect(s.known).toBe(false)
    expect(describeSpace(s)).toMatch(/will not say/)
  })

  it('says whether the data is kept or treated as a cache', async () => {
    fakeStorage(1048576, 10485760, true)
    expect(describeSpace(await measure())).toMatch(/kept/)
    fakeStorage(1048576, 10485760, false)
    expect(describeSpace(await measure())).toMatch(/cache/)
  })
})

describe('roomFor', () => {
  it('says no when what is being added would not fit', async () => {
    fakeStorage(0, 20 * 1048576)
    await measure()
    expect(roomFor(1 * 1048576)).toBe(true)
    expect(roomFor(19 * 1048576)).toBe(false)
  })

  it('keeps a reserve, so the board record can be written even when a picture cannot', async () => {
    fakeStorage(0, 20 * 1048576)
    await measure()
    /* Exactly the whole quota is not enough: something has to be left. */
    expect(roomFor(20 * 1048576)).toBe(false)
  })

  it('says yes when the browser will not say how much room there is', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    await measure()
    expect(roomFor(500 * 1048576)).toBe(true)
  })
})

describe('a write that fails', () => {
  it('is remembered, and named for what it was', () => {
    reportWriteFailure(quotaError())
    expect(spaceNow().trouble).toBe('full')
    reportWriteOk(1e9)
    reportWriteFailure(new Error('database is closed'))
    expect(spaceNow().trouble).toBe('blocked')
  })

  it('tells whoever is watching, at once', () => {
    const seen: (string | null)[] = []
    const off = subscribeSpace((s) => seen.push(s.trouble))
    reportWriteFailure(quotaError())
    off()
    expect(seen).toContain('full')
  })

  it('stays until something big gets through, not until anything does', () => {
    reportWriteFailure(quotaError())
    reportWriteOk(10)
    expect(spaceNow().trouble).toBe('full')
    reportWriteOk(50 * 1048576)
    expect(spaceNow().trouble).toBeNull()
  })

  it('clears on any write at all when the trouble was that nothing could be written', () => {
    reportWriteFailure(new Error('closed'))
    reportWriteOk(0)
    expect(spaceNow().trouble).toBeNull()
  })

  it('carries a time, so a message dismissed once does not come back for the same thing', () => {
    reportWriteFailure(quotaError())
    const first = spaceNow().troubleAt
    expect(first).toBeGreaterThan(0)
    reportWriteFailure(quotaError())
    expect(spaceNow().troubleAt).toBeGreaterThanOrEqual(first)
  })
})

describe('asking to be kept', () => {
  it('takes yes for an answer', async () => {
    fakeStorage(0, 1000, true)
    expect(await askToPersist()).toBe(true)
    expect(spaceNow().persisted).toBe(true)
  })

  it('treats no as an answer rather than an error', async () => {
    fakeStorage(0, 1000, false)
    expect(await askToPersist()).toBe(false)
  })

  it('does not throw in a browser that has never heard of it', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    expect(await askToPersist()).toBe(false)
  })
})

describe('the threshold', () => {
  it('is high enough not to nag and low enough to be a warning', () => {
    expect(TIGHT).toBeGreaterThan(0.6)
    expect(TIGHT).toBeLessThan(0.95)
  })
})

vi.restoreAllMocks()
