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

const HISTORY_LIMIT = 60

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

  private past: string[] = []
  private future: string[] = []
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
    this.past.push(this.serialize())
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future.length = 0
  }
  undo() {
    const prev = this.past.pop()
    if (prev === undefined) return
    this.future.push(this.serialize())
    this.restore(prev)
  }
  redo() {
    const next = this.future.pop()
    if (next === undefined) return
    this.past.push(this.serialize())
    this.restore(next)
  }
  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
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
    this.past.length = 0
    this.future.length = 0
    /* Selection first: ids from the board that has just been left are not ids
     * on this one, and a card cannot be told it is still selected. */
    this.sel.clear()
    for (const id of touched) this.pingItem(id)
    this.pingOrder()
    this.pingView()
    this.pingSel()
  }

  toBoard(): Board {
    return {
      id: this.id,
      name: this.name,
      items: this.all().map((i) => ({ ...i, src: undefined })),
      view: this.view,
      updated: Date.now(),
    }
  }
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
