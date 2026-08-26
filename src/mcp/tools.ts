import type { Item, Kind } from '../state/types'
import { store } from '../state/store'
import { labelItem, noteItem, sectionItem, addUrl } from '../state/ingest'
import { wordsField } from '../state/kinds'
import { drawMany } from '../state/generate'
import { fitToBoard, viewportSize } from '../state/walk'
import { allBoards } from '../store/idb'
import type { AlignMode } from '../state/arrange'

/* ---------------------------------------------------------------------------
 * What an agent is allowed to do to the board.
 *
 * One function per tool the relay names, and nothing else in the app knows the
 * relay exists. Everything here goes through the same store the interface goes
 * through, so an arrow drawn by Claude and an arrow drawn by hand are the same
 * arrow, one press of undo takes either back, and the board is saved by the
 * machinery that was already saving it.
 *
 * The rule the whole surface rests on: an agent may only touch a card by an id
 * it was given. There is no "the last one", no "the red one", nothing that has
 * to be resolved against a board that may have moved under it since. If a card
 * is gone, the tool says so rather than guessing at which one was meant.
 * ------------------------------------------------------------------------- */

/* Where the person is looking, in board coordinates. */
function centre() {
  const v = store.peekView()
  const { w, h } = viewportSize()
  if (!w || !h) return { x: 0, y: 0 }
  return { x: Math.round((-v.x + w / 2) / v.z - 150), y: Math.round((-v.y + h / 2) / v.z - 100) }
}

/* A card, as something worth reading. Empty fields are left out rather than
 * sent as nulls: a board of two hundred cards is a lot of JSON, and an agent
 * reads `{"id":"i_3","kind":"note","text":"warm"}` faster than the same thing
 * padded with eleven nothings. */
function describe(it: Item) {
  const out: Record<string, unknown> = {
    id: it.id, kind: it.kind,
    x: Math.round(it.x), y: Math.round(it.y), w: Math.round(it.w), h: Math.round(it.h),
  }
  if (it.name) out.name = it.name
  if (it.text) out.text = it.text
  if (it.url) out.url = it.url
  if (it.color) out.colour = it.color
  if (it.tag) out.tag = it.tag
  if (it.pick) out.pick = it.pick
  if (it.parent) out.inside = it.parent
  if (it.board) out.opens = it.board
  if (it.from && it.to) {
    out.from = it.from
    out.to = it.to
  }
  /* Whether there is a picture, not what it is. An agent cannot see it, and
   * saying so plainly is better than it inferring from a media key. */
  if (it.media || it.url) out.hasPicture = it.kind === 'image' || it.kind === 'video'
  return out
}

/* Every tool that names a card fails the same way when it is not there. */
function must(id: unknown): Item {
  if (typeof id !== 'string' || !id) throw new Error('That needs a card id. get_board lists them.')
  const it = store.getItem(id)
  if (!it) throw new Error(`There is no card ${id} on this board. It may have been deleted, or be on another board.`)
  return it
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) throw new Error('That needs a list of card ids.')
  return v.filter((x): x is string => typeof x === 'string' && !!x)
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const numOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/* Where the agent is in the tree, so it can say "inside Textures" rather than
 * naming a board id nobody recognises. Set by the app, which owns the path. */
let path: { id: string; name: string }[] = []
export const notePath = (p: { id: string; name: string }[]) => {
  path = p
}

export type ToolName =
  | 'get_board' | 'list_boards' | 'add_card' | 'draw_image' | 'update_card' | 'move_card'
  | 'delete_cards' | 'connect_cards' | 'arrange' | 'select_cards' | 'fit_view'

type Args = Record<string, unknown>

const TOOLS: Record<ToolName, (a: Args) => unknown | Promise<unknown>> = {
  get_board(a) {
    const want = Array.isArray(a.kinds) ? new Set((a.kinds as unknown[]).map(String)) : null
    const limit = Math.max(1, Math.min(1000, numOr(a.limit, 300)))
    const all = store.all()
    const kept = want ? all.filter((i) => want.has(i.kind as Kind)) : all
    return {
      board: { id: store.id, name: store.name, cards: all.length },
      /* The last crumb is the board on screen. */
      path: path.map((c) => c.name),
      selected: store.getSelection(),
      cards: kept.slice(0, limit).map(describe),
      ...(kept.length > limit ? { more: kept.length - limit } : {}),
    }
  },

  async list_boards() {
    const all = await allBoards()
    return all
      .map((b) => ({ id: b.id, name: b.name, cards: (b.items || []).length, open: b.id === store.id }))
      .sort((x, y) => y.cards - x.cards)
  },

  add_card(a) {
    const kind = str(a.kind)
    const at = { x: numOr(a.x, centre().x), y: numOr(a.y, centre().y) }
    const text = str(a.text)

    if (kind === 'link') {
      const url = str(a.url)
      if (!url) throw new Error('A link needs a url.')
      /* The same path a pasted address takes, so a picture address becomes a
       * picture and a video address becomes a player, exactly as it would. */
      return describe(addUrl(at, url))
    }

    let it: Item
    if (kind === 'note') it = noteItem(at, text)
    else if (kind === 'label') it = labelItem(at)
    else if (kind === 'section') it = sectionItem(at)
    else throw new Error(`No card kind called "${kind}". Try note, label, section or link.`)

    /* A label carries its words the way a note does; a section is named. The
     * app already has one answer to which is which, and this uses it rather
     * than keeping a second list that could drift from the first. */
    /* A note and a label keep their words in `text`; a section is named. One
     * place answers that, so this cannot drift from what the editor does. */
    if (text) it[wordsField(it)] = text
    const colour = str(a.colour)
    if (colour) it.color = colour
    store.add(it)
    return describe(it)
  },

  async draw_image(a) {
    const prompt = str(a.prompt).trim()
    if (!prompt) throw new Error('Say what to draw.')
    const count = Math.max(1, Math.min(4, Math.round(numOr(a.count, 1))))
    const at = { x: numOr(a.x, centre().x), y: numOr(a.y, centre().y) }
    const made = await drawMany(at, prompt, count, { aspect: str(a.aspect) })
    const drew = made.filter((m) => m.ok)
    if (!drew.length) {
      /* One sentence about the key or the model, not four copies of it. */
      throw new Error(made.find((m) => m.error)?.error || 'Nothing came back.')
    }
    return {
      drew: drew.length,
      of: made.length,
      cards: drew.map((m) => store.getItem(m.id)).filter((i): i is Item => !!i).map(describe),
      ...(drew.length < made.length ? { note: made.find((m) => m.error)?.error } : {}),
    }
  },

  update_card(a) {
    const it = must(a.id)
    const patch: Partial<Item> = {}
    if (typeof a.text === 'string') patch[wordsField(it)] = a.text
    if (typeof a.colour === 'string' && a.colour) patch.color = a.colour
    if (typeof a.tag === 'string') patch.tag = a.tag === 'none' ? null : a.tag
    if (typeof a.pick === 'string') patch.pick = a.pick === 'none' ? null : (a.pick as 'in' | 'out')
    if (!Object.keys(patch).length) throw new Error('Nothing to change. Pass text, colour, tag or pick.')
    store.update(it.id, patch)
    return describe(store.getItem(it.id)!)
  },

  move_card(a) {
    const it = must(a.id)
    const patch: Partial<Item> = { x: Math.round(numOr(a.x, it.x)), y: Math.round(numOr(a.y, it.y)) }
    if (typeof a.w === 'number') patch.w = Math.max(40, Math.round(a.w))
    if (typeof a.h === 'number') patch.h = Math.max(40, Math.round(a.h))
    store.update(it.id, patch)
    return describe(store.getItem(it.id)!)
  },

  delete_cards(a) {
    const list = ids(a.ids).filter((id) => store.getItem(id))
    if (!list.length) throw new Error('None of those are on this board.')
    store.remove(list)
    return { removed: list.length }
  },

  connect_cards(a) {
    const from = must(a.from)
    const to = must(a.to)
    const id = store.connect(from.id, to.id)
    if (!id) throw new Error('Those two cannot be joined — a card cannot point at itself, and an arrow is not a card.')
    return { id, from: from.id, to: to.id }
  },

  arrange(a) {
    const how = str(a.how)
    const list = Array.isArray(a.ids) && a.ids.length ? ids(a.ids) : store.all().map((i) => i.id)
    if (list.length < 2) throw new Error('Arranging needs two or more cards.')
    if (how === 'tidy') store.tidy(list)
    else if (how === 'spread-x') store.distribute(list, 'x')
    else if (how === 'spread-y') store.distribute(list, 'y')
    else if (['left', 'hcentre', 'right', 'top', 'vmiddle', 'bottom'].includes(how)) store.align(list, how as AlignMode)
    else throw new Error(`No arrangement called "${how}".`)
    return { arranged: list.length, how }
  },

  select_cards(a) {
    const list = ids(a.ids).filter((id) => store.getItem(id))
    store.select(list)
    return { selected: list.length }
  },

  fit_view(a) {
    const only = a.selection === true
    const moved = fitToBoard(only)
    if (!moved) throw new Error(only ? 'Nothing is selected.' : 'There is nothing on this board yet.')
    return { fitted: only ? 'the selection' : 'the whole board' }
  },
}

export const toolNames = Object.keys(TOOLS) as ToolName[]

/* Run one, and never throw: the relay wants an answer either way, and a
 * message the model can read beats a stack trace it cannot. */
export async function runTool(name: string, args: Args): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const fn = TOOLS[name as ToolName]
  if (!fn) return { ok: false, error: `No tool called ${name}.` }
  try {
    return { ok: true, result: await fn(args || {}) }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'It did not work.' }
  }
}
