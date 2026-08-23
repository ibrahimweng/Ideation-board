import { describe, expect, it } from 'vitest'
import { hasMarkup, inline, parse, todoCount, toggleTodo } from '../../src/state/rich'

/* What a note's text turns into. The browser suite checks that each block is
 * drawn as the right thing; this checks that the right thing is what came out
 * of the text in the first place. */

const text = (b: { spans?: { text: string }[] }) => (b.spans || []).map((s) => s.text).join('')

describe('parse', () => {
  it('reads a heading at each of its three depths', () => {
    const out = parse('# One\n## Two\n### Three')
    expect(out.map((b) => (b.t === 'h' ? b.level : b.t))).toEqual([1, 2, 3])
    expect(out.map((b) => text(b as never))).toEqual(['One', 'Two', 'Three'])
  })

  it('does not read a fourth', () => {
    const out = parse('#### Four')
    expect(out[0].t).toBe('p')
    expect(text(out[0] as never)).toBe('#### Four')
  })

  it('reads bullets and numbers as lists, and keeps the number', () => {
    const out = parse('- one\n* two\n1. three\n4) four')
    expect(out.map((b) => b.t)).toEqual(['li', 'li', 'li', 'li'])
    expect(out.map((b) => (b as { ordered: boolean }).ordered)).toEqual([false, false, true, true])
    expect((out[3] as { n: number }).n).toBe(4)
  })

  it('reads a tick box, ticked or not, and remembers which line it came from', () => {
    const out = parse('[ ] open\n[x] done\nplain')
    expect(out.map((b) => b.t)).toEqual(['todo', 'todo', 'p'])
    expect(out.map((b) => (b as { done?: boolean }).done)).toEqual([false, true, undefined])
    expect((out[1] as { line: number }).line).toBe(1)
  })

  it('reads a quote and a rule', () => {
    expect(parse('> said').map((b) => b.t)).toEqual(['quote'])
    for (const r of ['---', '***', '___', '-----']) expect(parse(r)[0].t).toBe('hr')
  })

  it('keeps a blank line as a gap rather than dropping it', () => {
    expect(parse('a\n\nb').map((b) => b.t)).toEqual(['p', 'gap', 'p'])
  })

  it('says when a note is plain prose', () => {
    expect(hasMarkup('just some words\nand more')).toBe(false)
    expect(hasMarkup('- a list')).toBe(true)
  })
})

describe('inline', () => {
  it('finds bold, italic and code', () => {
    const spans = inline('a **b** c *d* e `f`')
    expect(spans.find((s) => s.b)?.text).toBe('b')
    expect(spans.find((s) => s.i)?.text).toBe('d')
    expect(spans.find((s) => s.code)?.text).toBe('f')
  })

  it('finds a bare link and keeps the text of it', () => {
    const spans = inline('see https://example.com/x now')
    const link = spans.find((s) => s.href)
    expect(link?.href).toBe('https://example.com/x')
    expect(link?.text).toBe('https://example.com/x')
  })

  it('leaves a lone star alone', () => {
    expect(inline('2 * 3 = 6').map((s) => s.text).join('')).toBe('2 * 3 = 6')
  })
})

describe('the tick boxes', () => {
  it('counts what is done out of what there is', () => {
    expect(todoCount('[ ] a\n[x] b\n[X] c\nnot a box')).toEqual({ done: 2, total: 3 })
    expect(todoCount('nothing here')).toEqual({ done: 0, total: 0 })
  })

  it('writes a tick back into the text it came from', () => {
    const before = '[ ] a\n[ ] b'
    const after = toggleTodo(before, 1)
    expect(after).toBe('[ ] a\n[x] b')
    expect(toggleTodo(after, 1)).toBe(before)
  })

  it('leaves the text alone when the line is not a box', () => {
    expect(toggleTodo('plain\n[ ] a', 0)).toBe('plain\n[ ] a')
    expect(toggleTodo('[ ] a', 9)).toBe('[ ] a')
  })
})
