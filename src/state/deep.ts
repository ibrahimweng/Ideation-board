import type { Item } from './types'
import type { Crumb } from './boards'
import { onSummary } from './boards'
import { getBoard } from '../store/idb'
import { parseQuery, passes } from './search'

/* ---------------------------------------------------------------------------
 * Finding what is inside the boards you are not looking at.
 *
 * A board card holds a whole board, and opening one loads only that record —
 * which is the point, and is why a board of a thousand cards costs the board
 * it sits on nothing. But it also meant the search box could only ever see the
 * board you were standing on. Put a note one level down and search for a word
 * in it, and the answer was "none".
 *
 * Nesting is supposed to be how you put work away. Without this it is how you
 * lose it: everything filed is everything hidden, and the only way back to a
 * card was to remember which board you had put it in.
 *
 * The tree is read once and kept, because the records are small — items and
 * their text, never the pictures themselves — and because searching has to
 * answer on every keystroke. It is dropped whenever any board is written, so
 * what comes back is never stale.
 * ------------------------------------------------------------------------- */

/* One board somewhere below the one you are on, with the way back to it. */
interface Node {
  /* The boards to descend through, ending with the one holding these items. */
  path: Crumb[]
  items: Item[]
}

/* A card found in one of them. */
export interface Found {
  item: Item
  /* Where it is, ending with the board the card is on. */
  path: Crumb[]
  /* What to say: the name of the board it is in. */
  where: string
}

/* Depth enough for any tree anybody keeps by hand, and a stop for one that
 * points at itself — a board card whose target is an ancestor would otherwise
 * walk for ever. */
const MAX_DEPTH = 8
/* Past this the list is not a list any more, it is a second board. */
export const MAX_FOUND = 40

let tree: Node[] | null = null
let treeFor: string | null = null
let loading: Promise<Node[]> | null = null

/* Any board being written can change what is inside any other, so the whole
 * walk is thrown away rather than being patched. It is cheap to redo. */
onSummary(() => {
  tree = null
  treeFor = null
  loading = null
})

async function walk(rootItems: Item[], base: Crumb[]): Promise<Node[]> {
  const out: Node[] = []
  const seen = new Set(base.map((c) => c.id))
  const queue: { card: Item; path: Crumb[] }[] = []

  const enqueue = (items: Item[], path: Crumb[]) => {
    if (path.length - base.length >= MAX_DEPTH) return
    for (const it of items) {
      if (it.kind === 'board' && it.board && !seen.has(it.board)) queue.push({ card: it, path })
    }
  }
  enqueue(rootItems, base)

  while (queue.length) {
    const { card, path } = queue.shift()!
    const id = card.board!
    if (seen.has(id)) continue
    seen.add(id)
    const rec = await getBoard(id)
    if (!rec) continue
    const items = (rec.items || []) as Item[]
    const here = [...path, { id, name: rec.name || card.name || 'Board', card: card.id }]
    out.push({ path: here, items })
    enqueue(items, here)
  }
  return out
}

/* Everything below the board you are on, read once and kept. */
export function loadTree(rootItems: Item[], base: Crumb[]): Promise<Node[]> {
  const key = base.map((c) => c.id).join('/')
  if (tree && treeFor === key) return Promise.resolve(tree)
  if (loading && treeFor === key) return loading
  treeFor = key
  loading = walk(rootItems, base).then((found) => {
    tree = found
    loading = null
    return found
  })
  return loading
}

/* What the tree holds without going to disk, for the render that happens
 * before the walk has finished. */
export const peekTree = () => tree

export function findInTree(nodes: Node[], q: string, tag: string | null): Found[] {
  const words = parseQuery(q)
  if (!words.length && !tag) return []
  const out: Found[] = []
  for (const node of nodes) {
    const where = node.path[node.path.length - 1]?.name || 'Board'
    for (const item of node.items) {
      if (!passes(item, words, tag)) continue
      out.push({ item, path: node.path, where })
      if (out.length >= MAX_FOUND) return out
    }
  }
  return out
}

/* What to call a card in a list where you cannot see it.
 *
 * What it says comes before what it is called, for the two kinds that are made
 * of words: every note is called "Note", so a list of them named that way is a
 * list of the same word repeated. A picture is the other way round — its name
 * is its filename, which is the only thing about it that is text at all. */
export function labelOf(it: Item): string {
  const said = (it.text || '').trim().split('\n')[0].replace(/^#+\s*/, '')
  const first = it.kind === 'note' || it.kind === 'label' ? said || it.name : it.name || said
  return (first || it.url || it.kind).slice(0, 60) || it.kind
}
