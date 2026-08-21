import { useSyncExternalStore, useCallback } from 'react'
import type { Item, Board } from './types'
import { FX_0 } from '../engine/types'

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
    const out = new Set(ids)
    const carried = new Set<string>()
    for (const id of ids) {
      const it = this.items.get(id)
      if (!it || it.kind !== 'section') continue
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
      if (!it || it.kind !== 'section') continue
      if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it.id
    }
    return null
  }

  /* Re-tests an item against the sections and records where it landed. Called
   * when a drag finishes, never on resize. */
  reparentByPosition(ids: string[]) {
    for (const id of ids) {
      const it = this.items.get(id)
      if (!it || it.kind === 'section') continue
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
   * Undo keeps whole-board snapshots, so one Cmd+Z brings all of it back. */
  remove(ids: string[]) {
    if (!ids.length) return
    this.snapshot()
    const all = new Set(ids)
    for (const id of ids) {
      const it = this.items.get(id)
      if (it && it.kind === 'section') for (const m of this.membersOf(id)) all.add(m.id)
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
    const { ids: full } = this.dragSet(ids)
    if (!full.length) return []
    this.snapshot()
    const remap = new Map<string, string>()
    for (const id of full) remap.set(id, 'i_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36))
    const made: string[] = []
    for (const id of full) {
      const src = this.items.get(id)
      if (!src) continue
      const nid = remap.get(id)!
      const parent = src.parent && remap.has(src.parent) ? remap.get(src.parent)! : src.parent ?? null
      const copy: Item = { ...src, id: nid, x: src.x + dx, y: src.y + dy, z: ++this.topZ, parent }
      this.items.set(nid, copy)
      this.order.push(nid)
      made.push(nid)
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
      if (!cur || cur.kind === 'section') continue
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
      if (it.kind !== 'section' && !ids.includes(it.id)) min = Math.min(min, it.z)
    }
    let z = Math.max(2, (Number.isFinite(min) ? min : 20) - ids.length)
    for (const id of ids) {
      const cur = this.items.get(id)
      if (!cur || cur.kind === 'section') continue
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
    this.id = board.id
    this.name = board.name
    this.items = new Map(board.items.map((i) => [i.id, { ...i, fx: i.fx || { ...FX_0 } }]))
    this.order = board.items.map((i) => i.id)
    this.topZ = board.items.reduce((m, i) => Math.max(m, i.z || 0), 20)
    this.view = board.view || { x: 0, y: 0, z: 1 }
    this.past.length = 0
    this.future.length = 0
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
