import type { Item } from './types'
import { TYPE_LABEL } from './types'
import { BY_ID } from '../engine/effects'
import { SOUND_BY_ID } from '../store/sound'

/* ---------------------------------------------------------------------------
 * Matching cards against what was typed.
 *
 * Every word has to match somewhere on the card, in any order, so "blue note"
 * finds a note tagged blue without needing the words next to each other.
 * ------------------------------------------------------------------------- */

/* What a card is made of, as words.
 *
 * A board fills up with cards whose name is the same as eleven other cards'
 * name. Twelve variations of one sound are all called the same thing and
 * differ only in what they were run through; a sketch is called Sketch and is
 * a hundred lines of the only thing that makes it that sketch; a model's
 * materials are the vocabulary a designer actually has for it. Searching the
 * label and not the making means "the one with the gate" has no answer on a
 * board where every card is a variation of one other card — which is the board
 * this app is for.
 *
 * So the effect names go in — the card's own and every one stacked after it —
 * and with them the chain a sound runs through, the code a sketch draws with,
 * and the materials a model declares. All of it is already on the card; none
 * of it was being read. */
function madeOf(it: Item): string[] {
  const out: string[] = []
  const fx = it.fx
  if (fx && fx.fxid && fx.fxid !== 'none') out.push(BY_ID[fx.fxid]?.name || fx.fxid)
  for (const l of fx?.more || []) {
    if (l.fxid && l.fxid !== 'none') out.push(BY_ID[l.fxid]?.name || l.fxid)
  }
  if (fx?.preset && fx.preset !== 'none') out.push(fx.preset)
  for (const l of it.chain || []) {
    if (l.fxid && l.fxid !== 'none') out.push(SOUND_BY_ID[l.fxid]?.name || l.fxid)
  }
  /* The code itself, which is the whole of what a sketch is. Searching it is
   * how you find the flow field on a board of forty drawings. */
  if (it.code) out.push(it.code)
  for (const p of it.parts || []) {
    out.push(p.name)
    /* And what each is textured with, because "the one with no normal map" is
     * a question a person working in 3D asks out loud. */
    out.push(...p.maps)
  }
  return out
}

/* Everything about a card that is worth searching, lowercased once — and once
 * per card rather than once per render.
 *
 * While the search box has anything in it the board asks `passes` about every
 * card on every render, and building a haystack is a dozen reads, a join and a
 * lowercase. That was already more work than a render wants; since a sketch's
 * whole source went into it, it has no upper bound at all — a board of forty
 * drawings rebuilt forty bodies of code on every frame of a pan.
 *
 * Keyed on the item itself, which is only sound because of the rule the store
 * is built on: every change replaces the item object rather than editing it. A
 * card that has changed is therefore a different key, so nothing here can go
 * stale, and the entry for the old object goes when the object does. */
const built = new WeakMap<Item, string>()

function haystack(it: Item): string {
  const had = built.get(it)
  if (had !== undefined) return had
  const hay = [
    it.name,
    it.text,
    it.url,
    it.tag,
    it.kind,
    TYPE_LABEL[it.kind],
    /* So the marks can be searched for by the words on them: "kept" brings
     * back the shortlist, "cut" what was thrown out. */
    it.pick === 'in' ? 'kept keep in' : it.pick === 'out' ? 'cut out' : '',
    ...madeOf(it),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  built.set(it, hay)
  return hay
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
