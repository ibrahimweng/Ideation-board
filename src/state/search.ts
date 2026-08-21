import type { Item } from './types'
import { TYPE_LABEL } from './types'

/* ---------------------------------------------------------------------------
 * Matching cards against what was typed.
 *
 * Every word has to match somewhere on the card, in any order, so "blue note"
 * finds a note tagged blue without needing the words next to each other.
 * ------------------------------------------------------------------------- */

/* Everything about a card that is worth searching, lowercased once. */
function haystack(it: Item): string {
  return [
    it.name,
    it.text,
    it.url,
    it.tag,
    it.kind,
    TYPE_LABEL[it.kind],
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function parseQuery(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function matches(it: Item, words: string[]): boolean {
  if (!words.length) return true
  const hay = haystack(it)
  return words.every((w) => hay.includes(w))
}

/* Matching items in reading order, top to bottom then left to right, so
 * stepping through results follows the board rather than the order things
 * happened to be added. */
export function findMatches(items: Item[], q: string): Item[] {
  const words = parseQuery(q)
  if (!words.length) return []
  return items
    .filter((i) => matches(i, words))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}
