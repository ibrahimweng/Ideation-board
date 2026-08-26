import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE, apiBase, apiKey, hasKey, maskKey, modelId } from '../../src/ai/key'
import { boxFor, bytesFrom, placeholderItem, titleFrom } from '../../src/state/generate'

/* The key is a credential and the board is data about pictures. The two never
 * touch. What can be checked without a browser is checked here; that the key
 * never reaches an export or a folder is checked against real storage, in
 * `test/aikey.mjs`, because that is the only place the claim means anything. */

describe('with nowhere to store anything', () => {
  it('reads as no key rather than throwing', () => {
    /* No localStorage in node at all, which stands in for the browser set to
     * block site data and for Safari's private mode. A missing key is a state
     * the sheet already handles; a thrown one would take it down. */
    expect(apiKey()).toBe('')
    expect(hasKey()).toBe(false)
    expect(modelId()).toBe('')
  })

  it('still knows where to send a request', () => {
    expect(apiBase()).toBe(DEFAULT_BASE)
    expect(DEFAULT_BASE).toMatch(/^https:\/\//)
  })
})

describe('showing a key without showing it', () => {
  it('keeps the ends and eats the middle', () => {
    const out = maskKey('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
    expect(out.startsWith('AIza')).toBe(true)
    expect(out.endsWith('2345')).toBe(true)
    expect(out).not.toContain('MNOPQRST')
    /* Short enough to recognise the key by, nowhere near enough to use it. */
    expect(out.replace(/[^A-Za-z0-9]/g, '').length).toBe(8)
  })

  it('shows nothing at all for a short one', () => {
    expect(maskKey('abc')).toBe('••••')
    expect(maskKey('')).toBe('')
  })
})

describe('the card a prompt puts down', () => {
  it('is square when no shape was asked for', () => {
    expect(boxFor('')).toEqual({ w: 420, h: 420 })
    expect(boxFor('nonsense')).toEqual({ w: 420, h: 420 })
    expect(boxFor('0:0')).toEqual({ w: 420, h: 420 })
  })

  it('is the shape that was asked for', () => {
    const wide = boxFor('16:9')
    expect(wide.w).toBe(420)
    expect(wide.h).toBe(236)
    const tall = boxFor('9:16')
    expect(tall.h).toBe(420)
    expect(tall.w).toBe(236)
  })

  it('keeps the whole prompt and titles itself with the start of it', () => {
    const long = 'a cracked terracotta pot on a windowsill in hard afternoon light, shot on film'
    const it = placeholderItem({ x: 10, y: 20 }, long, '1:1')
    /* The prompt stays on the card, so a board of generated pictures still
     * says what each was asked for, and the search box can find one by a word
     * from its prompt. */
    expect(it.text).toBe(long)
    expect(it.name!.length).toBeLessThanOrEqual(41)
    expect(it.name!.endsWith('…')).toBe(true)
    /* Cut at a word, not through one. */
    expect(long.startsWith(it.name!.replace('…', ''))).toBe(true)
  })

  it('leaves a short prompt alone', () => {
    expect(titleFrom('a red door')).toBe('a red door')
    expect(titleFrom('  a   red   door  ')).toBe('a red door')
  })

  it('has no media yet and no effect on it', () => {
    const it = placeholderItem({ x: 0, y: 0 }, 'anything', '')
    expect(it.kind).toBe('image')
    expect(it.media).toBeUndefined()
    expect(it.url).toBeUndefined()
  })
})

describe('base64 to bytes', () => {
  it('reads a real PNG header back', () => {
    const bytes = bytesFrom('iVBORw0KGgoAAAANSUhEUg==')
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('copes with the URL-safe alphabet and missing padding', () => {
    /* Some encoders hand back `-` and `_` with the padding stripped. Decoded
     * as-is that is either an exception or the wrong bytes, and the wrong
     * bytes are worse: a card holding a file no decoder can open. */
    const plain = bytesFrom('+/+/')
    const safe = bytesFrom('-_-_')
    expect([...safe]).toEqual([...plain])
    expect([...bytesFrom('QUJD')]).toEqual([...bytesFrom('QUJD')])
    expect([...bytesFrom('QUJDRA')]).toEqual([65, 66, 67, 68])
  })

  it('ignores the line breaks a wrapped encoder puts in', () => {
    expect([...bytesFrom('QUJD\nRA==')]).toEqual([65, 66, 67, 68])
  })
})
