import { beforeEach, describe, expect, it } from 'vitest'
import { changedElsewhere, markSynced, syncedAt, TAB_ID, tabsTalk } from '../../src/store/tabs'

/* Two tabs, one board.
 *
 * The rule the whole thing rests on: a write may only replace a record no
 * newer than the one this tab last read or wrote. Get it wrong in the
 * permissive direction and a second tab silently destroys the first one's
 * afternoon, which is what used to happen. */

const BOARD = 'board_local'

beforeEach(() => {
  markSynced(BOARD, 0)
})

describe('the watermark', () => {
  it('starts at nothing for a board never seen', () => {
    expect(syncedAt('never_opened')).toBe(0)
  })

  it('remembers what this tab last read or wrote', () => {
    markSynced(BOARD, 1200)
    expect(syncedAt(BOARD)).toBe(1200)
  })

  it('keeps boards apart', () => {
    markSynced(BOARD, 1200)
    markSynced('other', 99)
    expect(syncedAt(BOARD)).toBe(1200)
    expect(syncedAt('other')).toBe(99)
  })
})

describe('whether somebody else has been at it', () => {
  it('says no when the record is the one we last saw', () => {
    markSynced(BOARD, 1200)
    expect(changedElsewhere(BOARD, 1200)).toBe(false)
  })

  it('says no when the record is older, which is our own write not yet read back', () => {
    markSynced(BOARD, 1200)
    expect(changedElsewhere(BOARD, 900)).toBe(false)
  })

  /* The one that matters. */
  it('says yes when the record is newer than anything we have seen', () => {
    markSynced(BOARD, 1200)
    expect(changedElsewhere(BOARD, 1201)).toBe(true)
  })

  it('says yes for a board this tab has never read, if something is there', () => {
    expect(changedElsewhere('never_opened', 5)).toBe(true)
  })

  it('says no when there is no record at all', () => {
    expect(changedElsewhere(BOARD, undefined)).toBe(false)
  })

  /* Local edits move the board's own `updated` forward on every keystroke, so
   * comparing against that instead of a watermark would answer "no" to every
   * question after the first edit — which is exactly the bug. */
  it('is not fooled by our own edits being newer than their write', () => {
    markSynced(BOARD, 1000)
    /* They wrote at 1100. We have been typing since, and our board says 1200.
     * The question is still whether 1100 is newer than 1000, and it is. */
    expect(changedElsewhere(BOARD, 1100)).toBe(true)
  })
})

describe('the tab itself', () => {
  it('has an id of its own', () => {
    expect(TAB_ID).toMatch(/^t[a-z0-9]+$/)
  })

  /* Outside a page there is nothing to talk to, and opening a channel would
   * hold the process open for a conversation that cannot happen. */
  it('opens no channel outside a browser', () => {
    expect(tabsTalk()).toBe(false)
  })
})
