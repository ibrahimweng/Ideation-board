/* ---------------------------------------------------------------------------
 * The little bit of formatting a note understands.
 *
 * A note is still a string. Headings, lists, checkboxes, emphasis and links
 * are written into that string the way people already write them in plain
 * text, and read back out when the card is drawn.
 *
 * Keeping the text as text is the whole point: search still works on it, the
 * board file stays readable, a note pasted in from somewhere else arrives with
 * its shape intact, and none of it needs a migration. What the editor's
 * buttons do is write the same marks a person would have typed.
 * ------------------------------------------------------------------------- */

export interface Span {
  text: string
  b?: boolean
  i?: boolean
  code?: boolean
  href?: string
}

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; spans: Span[] }
  | { t: 'p'; spans: Span[] }
  | { t: 'li'; spans: Span[]; ordered: boolean; n: number }
  | { t: 'todo'; done: boolean; spans: Span[]; line: number }
  | { t: 'quote'; spans: Span[] }
  | { t: 'hr' }
  | { t: 'gap' }

const TODO = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s?(.*)$/
const HEAD = /^(#{1,3})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

export function parse(text: string): Block[] {
  const out: Block[] = []
  const lines = (text || '').split('\n')
  lines.forEach((raw, i) => {
    const todo = TODO.exec(raw)
    if (todo) {
      out.push({ t: 'todo', done: todo[1] !== ' ', spans: inline(todo[2]), line: i })
      return
    }
    if (RULE.test(raw)) {
      out.push({ t: 'hr' })
      return
    }
    const head = HEAD.exec(raw)
    if (head) {
      out.push({ t: 'h', level: head[1].length as 1 | 2 | 3, spans: inline(head[2]) })
      return
    }
    const quote = QUOTE.exec(raw)
    if (quote) {
      out.push({ t: 'quote', spans: inline(quote[1]) })
      return
    }
    const num = NUMBER.exec(raw)
    if (num) {
      out.push({ t: 'li', ordered: true, n: Number(num[1]), spans: inline(num[2]) })
      return
    }
    const bullet = BULLET.exec(raw)
    if (bullet) {
      out.push({ t: 'li', ordered: false, n: 0, spans: inline(bullet[1]) })
      return
    }
    if (!raw.trim()) {
      out.push({ t: 'gap' })
      return
    }
    out.push({ t: 'p', spans: inline(raw) })
  })
  return out
}

/* Emphasis, code, links, and addresses written out in full. Deliberately
 * small: the marks people actually use in a note, and nothing that needs a
 * parser to understand. */
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g

export function inline(src: string): Span[] {
  const spans: Span[] = []
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) spans.push({ text: src.slice(last, at) })
    const tok = m[0]
    if (tok.startsWith('**') || tok.startsWith('__')) spans.push({ text: tok.slice(2, -2), b: true })
    else if (tok.startsWith('`')) spans.push({ text: tok.slice(1, -1), code: true })
    else if (tok.startsWith('[')) {
      const cut = tok.indexOf('](')
      spans.push({ text: tok.slice(1, cut), href: tok.slice(cut + 2, -1) })
    } else if (tok.startsWith('http')) spans.push({ text: tok, href: tok })
    else spans.push({ text: tok.slice(1, -1), i: true })
    last = at + tok.length
  }
  if (last < src.length) spans.push({ text: src.slice(last) })
  return spans.length ? spans : [{ text: '' }]
}

/* Ticking a box on the card writes the tick back into the text, which is the
 * only place it is kept. */
export function toggleTodo(text: string, line: number): string {
  const lines = (text || '').split('\n')
  const raw = lines[line]
  if (raw === undefined) return text
  const m = TODO.exec(raw)
  if (!m) return text
  lines[line] = m[1] === ' ' ? raw.replace(/\[ \]/, '[x]') : raw.replace(/\[[xX]\]/, '[ ]')
  return lines.join('\n')
}

export function todoCount(text: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const raw of (text || '').split('\n')) {
    const m = TODO.exec(raw)
    if (!m) continue
    total++
    if (m[1] !== ' ') done++
  }
  return { done, total }
}

export const hasMarkup = (text: string) => parse(text).some((b) => b.t !== 'p' && b.t !== 'gap')
