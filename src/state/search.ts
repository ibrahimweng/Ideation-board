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

/* The tag filter. null means every tag is allowed, and UNTAGGED picks out the
 * cards that carry none. */
export const UNTAGGED = '__untagged'

export function matchesTag(it: Item, tag: string | null): boolean {
  if (!tag) return true
  if (tag === UNTAGGED) return !it.tag
  return it.tag === tag
}

/* A card has to satisfy the text and the tag together, so the two controls
 * narrow the board rather than fighting each other. */
export const passes = (it: Item, words: string[], tag: string | null) =>
  matchesTag(it, tag) && matches(it, words)

export const filtering = (words: string[], tag: string | null) => words.length > 0 || !!tag

/* Matching items in reading order, top to bottom then left to right, so
 * stepping through results follows the board rather than the order things
 * happened to be added. */
export function findMatches(items: Item[], q: string, tag: string | null = null): Item[] {
  const words = parseQuery(q)
  if (!filtering(words, tag)) return []
  return items
    .filter((i) => passes(i, words, tag))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}
