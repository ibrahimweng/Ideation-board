import { useSyncExternalStore, useCallback } from 'react'
import type { Item, Board } from './types'
import { FX_0 } from '../engine/types'
import { cloneBoard } from './boards'
import { endsOf, isGradeable, isSection, isThing, isWire } from './kinds'
import { alignTo, clearGround, distributeAlong, gatherInto, tidyOnto } from './arrange'
import type { AlignMode, Moves } from './arrange'
import type { LookFx } from './looks'

/* Ids are made here and never taken from a caller, so nothing outside can
 * hand the board two cards with the same one. */
const freshId = () => 'i_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/* Cards taken off one board and not yet put on another. Module level on
 * purpose: it has to outlive the store being loaded with a different board,
 * which is the entire point of cutting one. */
let clipboard: Item[] = []

/* ---------------------------------------------------------------------------
 * Board store.
 *
 * The previous version kept every item in one React component's state, so
 * nudging a single card re-rendered the whole board — every card, every
 * panel — and the effects thumbnail strip called setState on every frame while
 * it was open.
 *
 * Here each card subscribes to its own item. Moving one card notifies exactly
 * one subscriber. Selection, viewport and item list are separate channels, so
 * a pan does not re-render card contents at all.
 * ------------------------------------------------------------------------- */

type Listener = () => void

export interface Viewport {
  x: number
  y: number
  z: number
}

/* How many steps back one board keeps. */
const HISTORY_LIMIT = 60
/* And how much all of them together may hold, counted in characters of
 * serialised board. A snapshot is the whole board, so a big board's history is
 * megabytes and keeping one per board could quietly become hundreds of them.
 * Past this the least recently visited board's history goes first, because the
 * board you are on is the one whose undo you are about to press. */
const HISTORY_CHARS = 12_000_000

/* What one board remembers. */
interface History {
  past: string[]
  future: string[]
  /* Total characters in both, kept as it goes rather than measured: adding up
   * sixty strings on every keystroke to decide whether to trim is more work
   * than the trimming. */
  size: number
  /* The `updated` stamp this history sits on top of.
   *
   * A board can be written by another tab while you are away from it, and the
   * snapshots here describe the board as it was before that happened. Undoing
   * onto somebody else's work is not undo, it is a quiet overwrite — so when
   * the board that comes back is not the one this history was built on, the
   * history goes. */
  base: number
  /* When this board was last loaded or edited, for deciding what to evict. */
  used: number
}

export class BoardStore {
  private items = new Map<string, Item>()
  private order: string[] = []
  private orderSnapshot: string[] = []
  private sel = new Set<string>()
  private selSnapshot: string[] = []
  private view: Viewport = { x: 0, y: 0, z: 1 }
  private viewSnapshot: Viewport = { x: 0, y: 0, z: 1 }

  private itemListeners = new Map<string, Set<Listener>>()
  private orderListeners = new Set<Listener>()
  private selListeners = new Set<Listener>()
  private viewListeners = new Set<Listener>()

  /* Undo, per board.
   *
   * It used to be two arrays cleared on every load, which is correct — an
   * undo that reached across a board switch would put one board's cards onto
   * another — and also meant that stepping into a nested board and back cost
   * you your undo, silently, with the keystroke doing nothing. Kept per board,
   * both are true at once. */
  private history = new Map<string, History>()
  private hist: History = freshHistory(0)
  private clock = 0
  private topZ = 20

  name = 'Untitled board'
  id = 'board_local'

  /* Renaming has to go through here rather than assigning to `name`, or the
   * change never marks the board dirty and the autosave never runs. */
  setName(next: string) {
    if (this.name === next) return
    this.name = next
    this.touch()
  }

  /* ---------- reads ---------- */

  getItem = (id: string): Item | undefined => this.items.get(id)
  getOrder = (): string[] => this.orderSnapshot
  getSelection = (): string[] => this.selSnapshot
  getView = (): Viewport => this.viewSnapshot
  all = (): Item[] => this.order.map((id) => this.items.get(id)!).filter(Boolean)
  count = () => this.order.length
  isSelected = (id: string) => this.sel.has(id)

  /* ---------- subscriptions ---------- */

  subscribeItem = (id: string, fn: Listener) => {
    let s = this.itemListeners.get(id)
    if (!s) this.itemListeners.set(id, (s = new Set()))
    s.add(fn)
    return () => {
      s!.delete(fn)
      if (!s!.size) this.itemListeners.delete(id)
    }
  }
  subscribeOrder = (fn: Listener) => {
    this.orderListeners.add(fn)
    return () => void this.orderListeners.delete(fn)
  }
  subscribeSel = (fn: Listener) => {
    this.selListeners.add(fn)
    return () => void this.selListeners.delete(fn)
  }
  subscribeView = (fn: Listener) => {
    this.viewListeners.add(fn)
    return () => void this.viewListeners.delete(fn)
  }

  private pingItem(id: string) {
    const s = this.itemListeners.get(id)
    if (s) for (const fn of s) fn()
  }
  private pingOrder() {
    this.orderSnapshot = this.order.slice()
    for (const fn of this.orderListeners) fn()
  }
  private pingSel() {
    this.selSnapshot = [...this.sel]
    for (const fn of this.selListeners) fn()
  }
  private pingView() {
    this.viewSnapshot = { ...this.view }
    for (const fn of this.viewListeners) fn()
  }

  /* ---------- gestures ---------- */

  /* One undo step for a whole drag, resize or slider sweep.
   *
   * Those all write with recording turned off so they do not push a snapshot
   * per pointer move, but nothing was pushing a snapshot at the start either.
   * The result was that they left no undo entry at all, and one Cmd+Z after a
   * drag jumped back past it to whatever was recorded before, which could
   * delete a card the drag had nothing to do with.
   *
   * `coalesceMs` merges a rapid series into one step, so holding an arrow key
   * or sweeping a slider does not fill the history. */
  private lastGesture = 0
  beginGesture(coalesceMs = 0) {
    const now = Date.now()
    if (coalesceMs && now - this.lastGesture < coalesceMs) {
      this.lastGesture = now
      return
    }
    this.lastGesture = now
    this.snapshot()
  }

  /* ---------- sections ---------- */

  membersOf(sectionId: string): Item[] {
    return this.all().filter((i) => i.parent === sectionId)
  }

  /* Everything that should move when `ids` move: the items themselves plus
   * anything sitting inside a section being dragged. `carried` names the ones
   * that came along because their section moved, which must keep their
   * section rather than being re-tested against wherever they land. */
  dragSet(ids: string[]): { ids: string[]; carried: Set<string> } {
    /* Wires are drawn from their two ends, so there is nothing about one to
     * move. Selecting everything and dragging must not try. */
    const out = new Set(ids.filter((id) => !isWire(this.items.get(id))))
    const carried = new Set<string>()
    for (const id of ids) {
      const it = this.items.get(id)
      if (!isSection(it)) continue
      for (const m of this.membersOf(id)) {
        out.add(m.id)
        carried.add(m.id)
      }
    }
    return { ids: [...out], carried }
  }

  /* The section a point falls in, topmost first. Sections never nest, so a
   * section itself is never a candidate. */
  sectionAt(x: number, y: number): string | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const it = this.items.get(this.order[i])
      if (!it || !isSection(it)) continue
      if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it.id
    }
    return null
  }

  /* Re-tests an item against the sections and records where it landed. Called
   * when a drag finishes, never on resize. */
  reparentByPosition(ids: string[]) {
    for (const id of ids) {
      const it = this.items.get(id)
      if (!isThing(it)) continue
      const parent = this.sectionAt(it.x + it.w / 2, it.y + it.h / 2)
      if ((it.parent || null) === parent) continue
      this.items.set(id, { ...it, parent })
      this.pingItem(id)
    }
    this.touch()
  }

  /* ---------- writes ---------- */

  /* Every mutation replaces the item object, so a subscriber comparing by
   * reference sees the change and nothing else does. */
  update(id: string, patch: Partial<Item>, record = true) {
    const cur = this.items.get(id)
    if (!cur) return
    if (record) this.snapshot()
    this.items.set(id, { ...cur, ...patch })
    this.pingItem(id)
    this.touch()
  }

  /* Bulk move during a drag: one snapshot, one notify per moved card. */
  moveMany(ids: string[], dx: number, dy: number, record = true) {
    if (record) this.snapshot()
    for (const id of ids) {
      const cur = this.items.get(id)
      if (!cur) continue
      this.items.set(id, { ...cur, x: cur.x + dx, y: cur.y + dy })
      this.pingItem(id)
    }
    this.touch()
  }

  /* Stacking order is assigned here, never taken from the caller. The item
   * factories fill in a placeholder z to satisfy the type, and `item.z ?? ...`
   * kept that placeholder, because 0 is not null. Every card was created at
   * z 0, so a new card could land behind one already on the board. */
  /* Joins two cards, once. Asking twice for the same pair, in either
   * direction, is treated as asking for what is already there. */
  connect(from: string, to: string): string | null {
    if (from === to) return null
    const a = this.items.get(from)
    const b = this.items.get(to)
    if (!a || !b || isWire(a) || isWire(b)) return null
    for (const it of this.items.values()) {
      if (!isWire(it)) continue
      if ((it.from === from && it.to === to) || (it.from === to && it.to === from)) return it.id
    }
    /* Built here rather than pulled from the item factories: those import the
     * store, and a cycle between the two is not worth five lines. The zeros
     * are honest — a wire is drawn from its ends and has no box of its own. */
    const id = freshId()
    this.add({ id, kind: 'edge', x: 0, y: 0, w: 0, h: 0, from, to, fx: { ...FX_0 }, tag: null })
    return id
  }

  add(item: Omit<Item, 'z'> & { z?: number }) {
    this.snapshot()
    const it: Item = { ...item, z: ++this.topZ, fx: item.fx || { ...FX_0 } }
    this.items.set(it.id, it)
    this.order.push(it.id)
    this.pingOrder()
    this.touch()
    return it
  }

  addMany(list: (Omit<Item, 'z'> & { z?: number })[]) {
    this.snapshot()
    for (const item of list) {
      const it: Item = { ...item, z: ++this.topZ, fx: item.fx || { ...FX_0 } }
      this.items.set(it.id, it)
      this.order.push(it.id)
    }
    this.pingOrder()
    this.touch()
  }

  /* Removing a section removes what is inside it, which is what Figma does.
   * Undo keeps whole-board snapshots, so one Cmd+Z brings all of it back.
   *
   * `record` is false when the removal is undoing something the person never
   * asked for in the first place — a card put down for a picture that then
   * failed to arrive. Recording that would leave two steps in the history
   * which cancel each other out, and pressing undo afterwards would bring the
   * empty card back from the dead. */
  remove(ids: string[], record = true) {
    if (!ids.length) return
    if (record) this.snapshot()
    const all = new Set(ids)
    for (const id of ids) {
      const it = this.items.get(id)
      if (isSection(it)) for (const m of this.membersOf(id)) all.add(m.id)
    }
    /* A wire to a card that is no longer there is not a wire. Undo brings the
     * card and its connections back together, since both are in the snapshot
     * taken above. */
    for (const it of this.items.values()) {
      const ends = endsOf(it)
      if (ends && (all.has(ends[0]) || all.has(ends[1]))) all.add(it.id)
    }
    ids = [...all]
    for (const id of ids) {
      this.items.delete(id)
      this.sel.delete(id)
    }
    this.order = this.order.filter((id) => !ids.includes(id))
    this.pingOrder()
    this.pingSel()
    this.touch()
  }

  /* Copies items, taking the contents of any copied section along and
   * pointing the copies at the copied section rather than the original. */
  duplicate(ids: string[], dx = 28, dy = 28): string[] {
    const { ids: moved } = this.dragSet(ids)
    if (!moved.length) return []
    /* dragSet drops the wires, because a wire is drawn from its two ends and
     * there is nothing about one to move. A copy is not a move: a pair of
     * connected cards copied together should come out still connected, and
     * without this the code below that joins the copies never saw an edge to
     * join. */
    const inSet = new Set(moved)
    const full = [
      ...moved,
      ...this.all()
        .filter((i) => { const e = endsOf(i); return !!e && inSet.has(e[0]) && inSet.has(e[1]) })
        .map((i) => i.id),
    ]
    this.snapshot()
    const remap = new Map<string, string>()
    for (const id of full) remap.set(id, freshId())
    const made: string[] = []
    for (const id of full) {
      const src = this.items.get(id)
      if (!src) continue
      /* A copied wire joins the copies. With only one end in the selection
       * there is nothing sensible to join, so it is left out rather than
       * quietly drawn back to the original. */
      const ends = endsOf(src)
      if (ends && !(remap.has(ends[0]) && remap.has(ends[1]))) continue
      const nid = remap.get(id)!
      const parent = src.parent && remap.has(src.parent) ? remap.get(src.parent)! : src.parent ?? null
      const copy: Item = { ...src, id: nid, x: src.x + dx, y: src.y + dy, z: ++this.topZ, parent }
      if (ends) {
        copy.from = remap.get(ends[0])!
        copy.to = remap.get(ends[1])!
      }
      this.items.set(nid, copy)
      this.order.push(nid)
      made.push(nid)
      /* A copy of a board card has to open a copy of the board, or editing
       * one would edit the other. Copying the record is a read and a write to
       * storage, so the card points at the original until that finishes; the
       * only thing you could do in between is open a board that is about to
       * be replaced by an identical one. */
      if (copy.kind === 'board' && copy.board) {
        void cloneBoard(copy.board).then((into) => {
          const cur = this.items.get(nid)
          if (cur && cur.kind === 'board') this.update(nid, { board: into }, false)
        })
      }
    }
    this.pingOrder()
    this.touch()
    return made
  }

  raise(id: string) {
    const cur = this.items.get(id)
    if (!cur) return
    this.items.set(id, { ...cur, z: ++this.topZ })
    this.pingItem(id)
  }

  /* Explicit ordering from the context menu, which is recorded so it can be
   * undone, unlike the implicit raise that happens on every click. */
  bringToFront(ids: string[]) {
    if (!ids.length) return
    this.snapshot()
    for (const id of ids) {
      const cur = this.items.get(id)
      if (!cur || isSection(cur)) continue
      this.items.set(id, { ...cur, z: ++this.topZ })
      this.pingItem(id)
    }
    this.touch()
  }

  /* Kept above 1, which is where sections sit, so sending a card back never
   * hides it behind the section it belongs to. */
  sendToBack(ids: string[]) {
    if (!ids.length) return
    this.snapshot()
    let min = Infinity
    for (const it of this.items.values()) {
      if (!isSection(it) && !ids.includes(it.id)) min = Math.min(min, it.z)
    }
    let z = Math.max(2, (Number.isFinite(min) ? min : 20) - ids.length)
    for (const id of ids) {
      const cur = this.items.get(id)
      if (!cur || isSection(cur)) continue
      this.items.set(id, { ...cur, z: z++ })
      this.pingItem(id)
    }
    this.touch()
  }

  /* Takes items out of whatever section they are in, without moving them. */
  clearParent(ids: string[]) {
    const inSection = ids.filter((id) => this.items.get(id)?.parent)
    if (!inSection.length) return
    this.snapshot()
    for (const id of inSection) {
      const cur = this.items.get(id)!
      this.items.set(id, { ...cur, parent: null })
      this.pingItem(id)
    }
    this.touch()
  }

  /* Applies one tag to everything given, or clears it. */
  /* ---------- arranging ---------- */

  /* Sections are the ground other cards sit on and wires have no box, so
   * neither takes part in being lined up. */
  private arrangeable(ids: string[]): Item[] {
    return ids
      .map((id) => this.items.get(id))
      .filter(isThing)
  }

  /* The three arrangements. The arithmetic is in state/arrange.ts, where it
   * can be checked without a board in front of it; what is left here is what
   * only the store can do — decide what is arrangeable, record one undo step,
   * and tell the cards that moved. */
  private applyMoves(moves: Moves) {
    if (!moves.size) return
    this.snapshot()
    for (const [id, at] of moves) {
      const cur = this.items.get(id)
      if (!cur) continue
      this.items.set(id, { ...cur, x: at.x, y: at.y })
      this.pingItem(id)
    }
    this.touch()
  }

  align(ids: string[], mode: AlignMode) {
    this.applyMoves(alignTo(this.arrangeable(ids), mode))
  }

  distribute(ids: string[], axis: 'x' | 'y') {
    this.applyMoves(distributeAlong(this.arrangeable(ids), axis))
  }

  tidy(ids: string[], gap = 24) {
    this.applyMoves(tidyOnto(this.arrangeable(ids), gap))
  }

  /* ---------- moving cards between boards ----------
   *
   * A board card holds a whole board, and until now nothing could travel
   * between them. You could nest boards, and search inside them, and never
   * bring anything up or send anything down: the only way to move a
   * photograph one level was to find the original file and drop it again.
   * For an app whose whole subject is gathering the best of something into one
   * place, that was the missing verb.
   *
   * Cut and paste rather than a "move to…" list of boards, because the boards
   * are a tree and a picker for it is a second way of navigating something you
   * can already navigate. Cut, walk to where it belongs, paste.
   *
   * The pictures themselves need no moving: a card names a blob in a store
   * shared by every board in this browser, so what travels is the record.
   * ------------------------------------------------------------------------ */

  /* Takes them off this board and holds them. One step of undo, so a cut with
   * no paste after it costs nothing. */
  cut(ids: string[]): number {
    const list = ids.map((id) => this.items.get(id)).filter((i): i is Item => !!i && !isWire(i))
    if (!list.length) return 0
    /* Wires between two cards that are both leaving travel with them; one with
     * an end staying behind is a line to nowhere and is left to be removed
     * along with everything else the removal takes. */
    const going = new Set(list.map((i) => i.id))
    const wires = this.all().filter((i) => {
      const ends = endsOf(i)
      return !!ends && going.has(ends[0]) && going.has(ends[1])
    })
    clipboard = [...list, ...wires].map((i) => ({ ...i, src: undefined }))
    this.remove([...going, ...wires.map((w) => w.id)])
    return list.length
  }

  /* Puts what was cut onto this board, around a point, keeping the shape they
   * were in. New ids every time, so pasting twice makes two sets rather than
   * two cards claiming to be one. */
  paste(at: { x: number; y: number }): string[] {
    if (!clipboard.length) return []
    const boxes = clipboard.filter((i) => !isWire(i))
    if (!boxes.length) return []
    const x0 = Math.min(...boxes.map((i) => i.x))
    const y0 = Math.min(...boxes.map((i) => i.y))
    const remap = new Map(clipboard.map((i) => [i.id, freshId()]))

    this.snapshot()
    const made: string[] = []
    for (const src of clipboard) {
      const id = remap.get(src.id)!
      const copy: Item = {
        ...src,
        id,
        z: ++this.topZ,
        /* Sections it used to sit in are not on this board. */
        parent: null,
        x: Math.round(at.x + (src.x - x0)),
        y: Math.round(at.y + (src.y - y0)),
      }
      if (src.from) copy.from = remap.get(src.from) || src.from
      if (src.to) copy.to = remap.get(src.to) || src.to
      this.items.set(id, copy)
      this.order.push(id)
      made.push(id)
    }
    this.pingOrder()
    this.touch()
    /* Taking away and putting down is a move, so it happens once. Pasting a
     * second time would make copies of cards that now exist somewhere else,
     * which is not what taking them off a board implied. */
    clipboard = []
    return made
  }

  /* What is waiting to be pasted, so a menu can say so and a board can refuse
   * to be put inside itself. */
  clipped = (): Item[] => clipboard

  /* Put a set of things in one place.
   *
   * The last step of curating, and the one that had no verb. You can mark six
   * of forty as kept and then find them exactly where they were: scattered
   * over four screens, in among the thirty-four you did not keep. This makes
   * somewhere for them — a section, on clear ground below the board — lays
   * them out as a block and moves them into it, in one step of undo.
   *
   * The name is the whole point of it being a section rather than a heap: what
   * comes out is a group with a title on it that can be selected, presented,
   * exported and handed over as one thing. */
  gather(ids: string[], name = 'Shortlist'): string | null {
    const list = this.arrangeable(ids).filter((i) => !isSection(i))
    if (!list.length) return null
    const at = clearGround(this.all())
    const plan = gatherInto(list, at)
    if (!plan) return null

    this.snapshot()
    const section: Item = {
      id: freshId(), kind: 'section', z: ++this.topZ, name,
      x: plan.frame.x, y: plan.frame.y, w: plan.frame.w, h: plan.frame.h,
      fx: { ...FX_0 }, tag: null,
    }
    this.items.set(section.id, section)
    this.order.push(section.id)
    for (const [id, at2] of plan.moves) {
      const cur = this.items.get(id)
      if (!cur) continue
      this.items.set(id, { ...cur, x: at2.x, y: at2.y, parent: section.id })
      this.pingItem(id)
    }
    this.pingOrder()
    this.touch()
    return section.id
  }

  /* In, out, or undecided. Pressing the same one twice takes the mark off,
   * because a decision you can only make and never unmake is a trap. */
  setPick(ids: string[], pick: 'in' | 'out') {
    const targets = ids.map((id) => this.items.get(id)).filter((i): i is Item => isThing(i))
    if (!targets.length) return null
    /* All of them get the same mark, and the mark only comes off when every
     * one of them already wears it, so a mixed selection resolves one way
     * rather than each card flipping its own. */
    const next = targets.every((t) => t.pick === pick) ? null : pick
    this.snapshot()
    for (const it of targets) {
      this.items.set(it.id, { ...it, pick: next })
      this.pingItem(it.id)
    }
    this.touch()
    return { pick: next, count: targets.length }
  }

  /* Puts one look on every card that can wear it. The framing each card has
   * is left alone: a look is the treatment, not the crop. */
  applyLook(ids: string[], look: LookFx) {
    const targets = ids
      .map((id) => this.items.get(id))
      .filter((i): i is Item => isGradeable(i))
    if (!targets.length) return 0
    this.snapshot()
    for (const it of targets) {
      this.items.set(it.id, { ...it, fx: { ...it.fx, ...look, ep: look.ep ? { ...look.ep } : null } })
      this.pingItem(it.id)
    }
    this.touch()
    return targets.length
  }

  setTag(ids: string[], tag: string | null) {
    if (!ids.length) return
    this.snapshot()
    for (const id of ids) {
      const cur = this.items.get(id)
      if (!cur) continue
      this.items.set(id, { ...cur, tag })
      this.pingItem(id)
    }
    this.touch()
  }

  /* ---------- selection ---------- */

  select(ids: string[], additive = false) {
    const next = additive ? new Set([...this.sel, ...ids]) : new Set(ids)
    if (next.size === this.sel.size && [...next].every((i) => this.sel.has(i))) return
    this.sel = next
    this.pingSel()
  }
  toggle(id: string) {
    if (this.sel.has(id)) this.sel.delete(id)
    else this.sel.add(id)
    this.pingSel()
  }
  clearSel() {
    if (!this.sel.size) return
    this.sel.clear()
    this.pingSel()
  }

  /* ---------- search ---------- */

  private query = ''
  private queryListeners = new Set<Listener>()

  getQuery = (): string => this.query
  subscribeQuery = (fn: Listener) => {
    this.queryListeners.add(fn)
    return () => void this.queryListeners.delete(fn)
  }
  setQuery(q: string) {
    if (this.query === q) return
    this.query = q
    for (const fn of this.queryListeners) fn()
  }

  private tagFilter: string | null = null
  private tagListeners = new Set<Listener>()

  getTagFilter = (): string | null => this.tagFilter
  subscribeTagFilter = (fn: Listener) => {
    this.tagListeners.add(fn)
    return () => void this.tagListeners.delete(fn)
  }
  setTagFilter(tag: string | null) {
    if (this.tagFilter === tag) return
    this.tagFilter = tag
    for (const fn of this.tagListeners) fn()
  }

  /* ---------- viewport ---------- */

  setView(v: Partial<Viewport>) {
    this.view = { ...this.view, ...v }
    this.pingView()
  }
  /* Pan and zoom during a gesture bypass React entirely — the transform is
   * written straight to the DOM — and only settle into state at the end. */
  peekView(): Viewport {
    return this.view
  }
  setViewSilent(v: Partial<Viewport>) {
    this.view = { ...this.view, ...v }
  }
  commitView() {
    this.pingView()
  }

  /* ---------- history ---------- */

  private serialize(): string {
    return JSON.stringify(this.order.map((id) => this.items.get(id)))
  }
  private restore(json: string) {
    const list: Item[] = JSON.parse(json)
    this.items = new Map(list.map((i) => [i.id, i]))
    this.order = list.map((i) => i.id)
    for (const id of this.order) this.pingItem(id)
    this.pingOrder()
    this.touch()
  }
  private snapshot() {
    const h = this.hist
    h.used = ++this.clock
    const shot = this.serialize()
    h.past.push(shot)
    h.size += shot.length
    while (h.past.length > HISTORY_LIMIT) h.size -= h.past.shift()!.length
    for (const s of h.future) h.size -= s.length
    h.future.length = 0
    this.trimHistory()
  }
  undo() {
    const h = this.hist
    const prev = h.past.pop()
    if (prev === undefined) return
    h.size -= prev.length
    const now = this.serialize()
    h.future.push(now)
    h.size += now.length
    h.used = ++this.clock
    this.restore(prev)
  }
  redo() {
    const h = this.hist
    const next = h.future.pop()
    if (next === undefined) return
    h.size -= next.length
    const now = this.serialize()
    h.past.push(now)
    h.size += now.length
    h.used = ++this.clock
    this.restore(next)
  }
  get canUndo() {
    return this.hist.past.length > 0
  }
  get canRedo() {
    return this.hist.future.length > 0
  }

  /* Back under the budget, oldest board first.
   *
   * Whole boards rather than odd steps, because half a history is worse than
   * none: undo would work three times and then stop somewhere arbitrary. The
   * board on screen is never the one evicted — it is the one whose undo is
   * about to be pressed. */
  private trimHistory() {
    let total = 0
    for (const h of this.history.values()) total += h.size
    if (total <= HISTORY_CHARS) return
    const others = [...this.history.entries()]
      .filter(([, h]) => h !== this.hist)
      .sort((a, b) => a[1].used - b[1].used)
    for (const [id, h] of others) {
      if (total <= HISTORY_CHARS) break
      total -= h.size
      this.history.delete(id)
    }
    /* One board over the budget on its own. Its oldest steps go, which is what
     * the step limit above does anyway — this is the case where sixty steps of
     * an enormous board is itself too much. */
    const h = this.hist
    while (total > HISTORY_CHARS && h.past.length > 1) {
      const gone = h.past.shift()!.length
      h.size -= gone
      total -= gone
    }
  }

  /* A board that no longer exists has no undo worth holding. */
  forgetHistory(id: string) {
    this.history.delete(id)
  }

  /* ---------- persistence ---------- */

  onDirty: (() => void) | null = null
  private touch() {
    this.onDirty?.()
  }

  load(board: Board) {
    /* Everything that was here, so a card still on screen under the same id is
     * told its contents were replaced.
     *
     * Loading used to mean switching boards, where every card unmounts and the
     * new ones read the store fresh, so telling the old subscribers was work
     * with nobody to hear it. Then a second tab started sending its changes
     * over and a board began being loaded while it was still on screen — and a
     * card whose id had not changed went on showing the item object it read
     * when it mounted. A note written in the other tab arrived as a blank one,
     * permanently, because nothing ever told that card to look again. */
    const touched = new Set([...this.items.keys(), ...board.items.map((i) => i.id)])
    this.id = board.id
    this.name = board.name
    this.items = new Map(board.items.map((i) => [i.id, { ...i, fx: i.fx || { ...FX_0 } }]))
    this.order = board.items.map((i) => i.id)
    this.topZ = board.items.reduce((m, i) => Math.max(m, i.z || 0), 20)
    this.view = board.view || { x: 0, y: 0, z: 1 }

    /* The history this board left behind, unless it is not this board's any
     * more: somebody else wrote it while we were away, and these snapshots
     * describe what it looked like before they did. */
    const stamp = board.updated || 0
    const kept = this.history.get(board.id)
    if (kept && kept.base !== stamp) this.history.delete(board.id)
    this.hist = this.history.get(board.id) || freshHistory(stamp)
    this.history.set(board.id, this.hist)
    this.hist.used = ++this.clock
    this.trimHistory()
    /* Selection first: ids from the board that has just been left are not ids
     * on this one, and a card cannot be told it is still selected. */
    this.sel.clear()
    for (const id of touched) this.pingItem(id)
    this.pingOrder()
    this.pingView()
    this.pingSel()
  }

  /* The board as it is now, ready to be written.
   *
   * The stamp it is given is also written down as what this board's history
   * now sits on top of. Every caller of this writes the record straight
   * afterwards, so the two agree — and coming back to a board this tab saved
   * itself finds its undo intact, while coming back to one another tab saved
   * finds it gone. */
  toBoard(): Board {
    const updated = Date.now()
    const h = this.history.get(this.id)
    if (h) h.base = updated
    return {
      id: this.id,
      name: this.name,
      items: this.all().map((i) => ({ ...i, src: undefined })),
      view: this.view,
      updated,
    }
  }
}

function freshHistory(base: number): History {
  return { past: [], future: [], size: 0, base, used: 0 }
}

export const store = new BoardStore()

/* ---------- React bindings ---------- */

export function useItem(id: string): Item | undefined {
  const sub = useCallback((fn: () => void) => store.subscribeItem(id, fn), [id])
  const get = useCallback(() => store.getItem(id), [id])
  return useSyncExternalStore(sub, get, get)
}

export function useOrder(): string[] {
  return useSyncExternalStore(store.subscribeOrder, store.getOrder, store.getOrder)
}

export function useSelection(): string[] {
  return useSyncExternalStore(store.subscribeSel, store.getSelection, store.getSelection)
}

export function useViewport(): Viewport {
  return useSyncExternalStore(store.subscribeView, store.getView, store.getView)
}

export function useQuery(): string {
  return useSyncExternalStore(store.subscribeQuery, store.getQuery, store.getQuery)
}

export function useTagFilter(): string | null {
  return useSyncExternalStore(store.subscribeTagFilter, store.getTagFilter, store.getTagFilter)
}
