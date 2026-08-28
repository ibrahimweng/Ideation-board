import type { Item } from './types'
import type { Crumb } from './boards'
import { onSummary } from './boards'
import { getBoard } from '../store/idb'
import { listRoots } from './roots'
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
 * THE OTHER PROJECTS
 *
 * The same argument, one level up. This used to walk down from the board you
 * were standing on and stop there, which was the whole world back when there
 * was one project and everything lived inside it. With a row of tabs it is
 * half the world: "which project did I put that in" was a question you
 * answered by opening each tab and searching it again.
 *
 * So the walk covers every project, and a result says which one it is in. The
 * project you are in comes first, because that is nearly always the answer and
 * because there is a cap on how many results are worth showing.
 *
 * The tree is read once and kept, because the records are small — items and
 * their text, never the pictures themselves — and because searching has to
 * answer on every keystroke. It is dropped whenever any board is written, so
 * what comes back is never stale.
 * ------------------------------------------------------------------------- */

/* One board you are not looking at, with the way back to it. */
interface Node {
  /* The boards to descend through, ending with the one holding these items.
   * It starts at a project, so following it is enough to get there from
   * wherever you are — including from a different project. */
  path: Crumb[]
  items: Item[]
  /* The project this board is in, when that is not the one you are in. */
  project?: string
}

/* A card found in one of them. */
export interface Found {
  item: Item
  /* Where it is, ending with the board the card is on. */
  path: Crumb[]
  /* What to say: the name of the board it is in. */
  where: string
  /* And which project that board is in, when it is not this one. */
  project?: string
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

/* Everything below one board, breadth first.
 *
 * `seen` is not tidiness: a board card can point at a board already above it,
 * and without it this walks for ever. It is seeded with the trail so that
 * walking down from where you are cannot climb back up into it, and it is
 * carried across projects so a board reached from two of them is read once. */
async function walk(rootItems: Item[], base: Crumb[], seen: Set<string>, project?: string): Promise<Node[]> {
  const out: Node[] = []
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
    out.push({ path: here, items, project })
    enqueue(items, here)
  }
  return out
}

/* Every board that is not the one on screen: the rest of this project first,
 * then all of every other one. */
async function walkAll(rootItems: Item[], base: Crumb[]): Promise<Node[]> {
  /* Shared across both walks. The board you are standing on is already
   * searched by the box itself, and every crumb above it is on the way back
   * rather than somewhere to go. */
  const seen = new Set(base.map((c) => c.id))
  const out = await walk(rootItems, base, seen)

  /* The other projects, oldest first, which is the order their tabs are in —
   * so the list reads in the same order as the row above it. */
  const here = base[0]?.id
  const roots = (await listRoots())
    .filter((r) => r.id !== here)
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))

  for (const root of roots) {
    if (seen.has(root.id)) continue
    seen.add(root.id)
    const rec = await getBoard(root.id)
    if (!rec) continue
    const items = (rec.items || []) as Item[]
    /* A trail of its own, starting at that project rather than at this one, so
     * that opening a result switches projects the same way a tab does. */
    const path: Crumb[] = [{ id: root.id, name: rec.name || root.name, card: null }]
    out.push({ path, items, project: rec.name || root.name })
    out.push(...(await walk(items, path, seen, rec.name || root.name)))
  }
  return out
}

/* Everywhere you are not, read once and kept. */
export function loadTree(rootItems: Item[], base: Crumb[]): Promise<Node[]> {
  const key = base.map((c) => c.id).join('/')
  if (tree && treeFor === key) return Promise.resolve(tree)
  if (loading && treeFor === key) return loading
  treeFor = key
  loading = walkAll(rootItems, base).then((found) => {
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
      out.push({ item, path: node.path, where, project: node.project })
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
