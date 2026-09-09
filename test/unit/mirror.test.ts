import { describe, expect, it } from 'vitest'
import { describeMirror } from '../../src/store/mirror'
import type { MirrorState } from '../../src/store/mirror'

/* The sentence that says whether the work is safe.
 *
 * Everything here lives in one browser, and the folder copy is the only thing
 * that gets it out — so this line is where a person finds out whether that is
 * happening. Every branch of it is a different answer to "is my work backed
 * up", and the two that matter most are the ones that admit it is not: no
 * folder at all, and a permission that has lapsed.
 *
 * Kept as a unit test because it is a pure function of the state, and the
 * state it reads is set by paths a browser drives — which is where the rest of
 * this is checked, in test/mirror.mjs.
 */

const state = (over: Partial<MirrorState> = {}): MirrorState => ({
  supported: true, folder: 'Boards', at: 0, busy: false, error: null, wrote: 0, ...over,
})

describe('what the folder readout says', () => {
  it('says so plainly where the browser cannot do it at all', () => {
    expect(describeMirror(state({ supported: false }))).toBe('This browser cannot keep a copy in a folder')
  })

  /* The one that has to be uncomfortable to read, because it is the default
     state of every board and the thing this feature exists to fix. */
  it('and names the risk when no folder has been chosen', () => {
    expect(describeMirror(state({ folder: null }))).toBe(
      'No folder chosen — the only copy of this work is in this browser'
    )
  })

  it('says a copy is on its way before the first one lands', () => {
    expect(describeMirror(state())).toBe('Copying to Boards when the board settles')
  })

  it('and that one is happening while it happens', () => {
    expect(describeMirror(state({ busy: true }))).toBe('Copying to Boards…')
  })

  /* An error outranks "busy" and "copied": a folder that stopped working must
     not go on reading like one that is working. */
  it('shows what went wrong ahead of anything reassuring', () => {
    const lapsed = 'Permission to write to that folder has lapsed. Choose it again.'
    expect(describeMirror(state({ error: lapsed, busy: true, at: Date.now() }))).toBe(lapsed)
  })

  it('and says when the last copy was, in words rather than a timestamp', () => {
    const now = Date.now()
    expect(describeMirror(state({ at: now }))).toBe('Copied to Boards just now')
    expect(describeMirror(state({ at: now - 60_000 }))).toBe('Copied to Boards a minute ago')
    expect(describeMirror(state({ at: now - 7 * 60_000 }))).toBe('Copied to Boards 7 minutes ago')
  })

  /* The case this whole readout exists for, and the one it used to get wrong.
     A permission that lapses mid-copy blanks the folder as well as setting the
     error — so with the no-folder line checked first, the one sentence written
     for it could never be shown, and a backup that had just stopped working
     reported itself as one that was never set up. */
  it('says why the folder went away, rather than that there never was one', () => {
    const lapsed = 'Permission to write to that folder has lapsed. Choose it again.'
    expect(describeMirror(state({ folder: null, error: lapsed }))).toBe(lapsed)
  })

  it('and never names a folder it is no longer writing to', () => {
    const said = describeMirror(state({ folder: null, error: 'That folder could not be opened' }))
    expect(said).not.toContain('Boards')
  })
})
