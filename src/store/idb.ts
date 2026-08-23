import { reportWriteFailure, reportWriteOk } from './space'

/* IndexedDB persistence. Boards hold metadata; media blobs live in their own
 * store so a board can be read without pulling every image into memory. */

const DB = 'ideation.board.db'
const VER = 1

export interface StoredBoard {
  id: string
  name: string
  updated: number
  items: unknown[]
  view?: { x: number; y: number; z: number }
}

let dbp: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp
  dbp = new Promise((res) => {
    let r: IDBOpenDBRequest
    try {
      r = indexedDB.open(DB, VER)
    } catch {
      return res(null)
    }
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('boards')) d.createObjectStore('boards', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs')
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => res(null)
    r.onblocked = () => res(null)
  })
  return dbp
}

/* Falls back to memory when IndexedDB is unavailable (private windows, some
 * embedded webviews) so the board still works for the session. */
const mem = { boards: new Map<string, StoredBoard>(), blobs: new Map<string, Blob>() }

async function tx<T>(store: 'boards' | 'blobs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open()
  if (!db) return undefined
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => res(req ? req.result : undefined)
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error)
  })
}

/* The memory copy is a fallback for reading back within this session, not a
 * save. A write that fails has to be reported, or a board that is not being
 * saved looks exactly like one that is until the tab is reloaded. */
export async function putBoard(b: StoredBoard) {
  mem.boards.set(b.id, b)
  try {
    await tx('boards', 'readwrite', (s) => s.put(b))
    reportWriteOk()
  } catch (err) {
    reportWriteFailure(err)
  }
}
export async function getBoard(id: string): Promise<StoredBoard | undefined> {
  try {
    const v = await tx<StoredBoard>('boards', 'readonly', (s) => s.get(id))
    if (v) return v
  } catch { /* fall through */ }
  return mem.boards.get(id)
}
export async function allBoards(): Promise<StoredBoard[]> {
  try {
    const v = await tx<StoredBoard[]>('boards', 'readonly', (s) => s.getAll())
    if (v) return v
  } catch { /* fall through */ }
  return [...mem.boards.values()]
}
export async function delBoard(id: string) {
  mem.boards.delete(id)
  try { await tx('boards', 'readwrite', (s) => s.delete(id)) } catch { /* ignore */ }
}
export async function putBlob(k: string, b: Blob) {
  mem.blobs.set(k, b)
  try {
    await tx('blobs', 'readwrite', (s) => s.put(b, k))
    reportWriteOk(b.size)
  } catch (err) {
    reportWriteFailure(err)
  }
}
export async function getBlob(k: string): Promise<Blob | undefined> {
  try {
    const v = await tx<Blob>('blobs', 'readonly', (s) => s.get(k))
    if (v) return v
  } catch { /* fall through */ }
  return mem.blobs.get(k)
}
export async function delBlob(k: string) {
  mem.blobs.delete(k)
  try { await tx('blobs', 'readwrite', (s) => s.delete(k)) } catch { /* ignore */ }
}
