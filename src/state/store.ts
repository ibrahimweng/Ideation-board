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

  remove(ids: string[]) {
    if (!ids.length) return
    this.snapshot()
    for (const id of ids) {
      this.items.delete(id)
      this.sel.delete(id)
    }
    this.order = this.order.filter((id) => !ids.includes(id))
    this.pingOrder()
    this.pingSel()
    this.touch()
  }

  raise(id: string) {
    const cur = this.items.get(id)
    if (!cur) return
    this.items.set(id, { ...cur, z: ++this.topZ })
    this.pingItem(id)
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
