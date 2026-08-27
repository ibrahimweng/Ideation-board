import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/* The service worker is the one file here that nothing else checks.
 *
 * It is plain JavaScript, outside the TypeScript build and outside the bundle,
 * and it is registered inside a catch — so a syntax error in it would ship,
 * fail to register, and say nothing at all. The app would go on working and
 * simply never be available offline again, which is the kind of breakage that
 * is only ever noticed on a train. */

const root = process.cwd()
const template = fs.readFileSync(path.join(root, 'sw', 'sw.js'), 'utf8')

describe('the service worker template', () => {
  it('has the two things the build fills in', () => {
    expect(template).toContain('__SHELL__')
    expect(template).toContain("'__VERSION__'")
  })

  it('is valid JavaScript once they are filled in', () => {
    const filled = template
      .replace("'__VERSION__'", '"abc123"')
      .replace('__SHELL__', JSON.stringify(['/', '/index.html']))
    /* Parsed rather than run: it wants a ServiceWorkerGlobalScope, which node
     * has no business pretending to be. A parse is what catches the mistake
     * that would otherwise ship in silence. */
    expect(() => new Function(filled)).not.toThrow()
  })

  it('leaves everything that is not this app alone', () => {
    /* The two that matter: an event stream from the relay, held open, would be
     * buffered into uselessness by a handler that tried to cache it; and a
     * picture bought from Google once would be handed back for ever. Both are
     * cross-origin, so the guard that lets them past is the one to keep. */
    expect(template).toMatch(/url\.origin === self\.location\.origin/)
    expect(template).toMatch(/if \(req\.method !== 'GET'\) return/)
  })

  it('asks the network first for the document', () => {
    /* Cache-first on the document would mean a deploy nobody ever sees. */
    const nav = template.slice(template.indexOf("req.mode === 'navigate'"))
    expect(nav.indexOf('await fetch(req)')).toBeLessThan(nav.indexOf('cache.match'))
  })

  it('never takes over on its own', () => {
    /* Swapping the scripts under somebody mid-edit. It may only happen in
     * answer to the page asking, which the page only does when a person has
     * pressed Reload. */
    const calls = [...template.matchAll(/skipWaiting/g)]
    expect(calls).toHaveLength(1)
    expect(template).toMatch(/if \(e\.data === 'take-over'\) void self\.skipWaiting\(\)/)
  })
})

describe('what the build puts in the cache', () => {
  it('names the script that will write it', () => {
    expect(fs.existsSync(path.join(root, 'scripts', 'build-sw.mjs'))).toBe(true)
  })

  it('runs as part of the build, or there would be no offline at all', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts.build).toContain('build-sw.mjs')
  })
})
