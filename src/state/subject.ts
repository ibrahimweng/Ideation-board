import type { Item } from './types'
import { store } from './store'
import { findMatches, filtering, parseQuery } from './search'
import { endsOf, isWire } from './kinds'

/* ---------------------------------------------------------------------------
 * What "this board" means at the moment you ask.
 *
 * Present, the poster and the PDF all act on the board, and all three had the
 * same half-answer: the selection when there was more than one thing in it,
 * and everything otherwise. Which left the search box and the tag filter
 * pointing at nothing. You could narrow a board of thirty down to the four you
 * had kept, watch the other twenty-six fade, and then find that presenting it
 * showed all thirty and exporting it exported all thirty — so the marks you
 * had just spent ten minutes making could not be acted on at all.
 *
 * One answer, in one place, in the order a person would give it: what you have
 * picked out, then what you have narrowed to, then the board.
 * ------------------------------------------------------------------------- */

export type Why = 'selection' | 'filter' | 'board'

export interface Subject {
  items: Item[]
  why: Why
  /* How much of the board this is, for the line that says so. */
  total: number
}

/* Whether a search or a tag filter is narrowing the board right now. */
export const narrowed = () => filtering(parseQuery(store.getQuery()), store.getTagFilter())

/* The cards a filter is currently letting through, in the board's own reading
 * order. Empty when nothing is filtering — ask `narrowed()` first. */
export const matches = (): Item[] => findMatches(store.all(), store.getQuery(), store.getTagFilter())

/* A wire belongs with a set when both of the cards it joins are in it: an
 * arrow to something that is not on the sheet is a line into nowhere. */
export function withWires(items: Item[]): Item[] {
  const ids = new Set(items.map((i) => i.id))
  const wires = store.all().filter((i) => {
    if (!isWire(i) || ids.has(i.id)) return false
    const ends = endsOf(i)
    return !!ends && ids.has(ends[0]) && ids.has(ends[1])
  })
  return wires.length ? [...items, ...wires] : items
}

export function subject(): Subject {
  const total = store.all().length
  const sel = store.getSelection()
  /* One card is a card, not a board: every one of these actions already has a
   * single-card equivalent, and "present this board" meaning "present this one
   * photograph" is never what was wanted. */
  if (sel.length > 1) {
    const items = sel.map((id) => store.getItem(id)).filter((i): i is Item => !!i)
    if (items.length > 1) return { items: withWires(items), why: 'selection', total }
  }
  if (narrowed()) {
    const found = matches()
    if (found.length) return { items: withWires(found), why: 'filter', total }
  }
  return { items: store.all(), why: 'board', total }
}

/* The words that go on the end of a command name, so the list says what it is
 * about to act on rather than making you guess. */
export function subjectLabel(s: Subject): string {
  if (s.why === 'selection') return `the ${s.items.filter((i) => !isWire(i)).length} selected`
  if (s.why === 'filter') return `the ${s.items.filter((i) => !isWire(i)).length} shown`
  return 'this board'
}
