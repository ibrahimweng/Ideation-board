import { gather } from '../state/transfer'
import { ensurePerm, pickFolder, safeName, supportsFS, writeJSON } from './fs'

/* ---------------------------------------------------------------------------
 * A copy of the board, kept in a folder you chose.
 *
 * Everything here lives in one browser on one machine, and that is the ceiling
 * on the whole thing: wrong browser, cleared site data, dead laptop, and the
 * work is gone. Fixing that properly needs a server, an account and a sync
 * protocol, which is a different product.
 *
 * This is what can be done without any of that. Point the board at a folder
 * and it writes itself there — a board.json and a media folder, the same
 * shape the exported zip has — and keeps writing every time the board settles.
 * Put that folder in Dropbox, iCloud, a network drive or a git repository and
 * the work is on more than one machine, backed up, and outside the browser
 * that made it. Nothing here talks to a server, and nothing here is clever.
 *
 * It is a copy, not a synchronisation. Nothing is ever read back. Two browsers
 * pointed at one folder will overwrite each other, and pretending otherwise
 * would be worse than saying so: conflict resolution is the hard part of sync,
 * and this deliberately does not attempt it.
 * ------------------------------------------------------------------------- */

type Dir = FileSystemDirectoryHandle

export interface MirrorState {
  /* Whether the browser can do this at all. Safari and Firefox cannot yet. */
  supported: boolean
  /* The folder's name, or null when there is none. */
  folder: string | null
  /* When the last copy finished, and whether one is in flight. */
  at: number
  busy: boolean
  /* What went wrong last time, if anything did. */
  error: string | null
  /* How many files the last copy wrote. */
  wrote: number
}

const state: MirrorState = { supported: false, folder: null, at: 0, busy: false, error: null, wrote: 0 }
const listeners = new Set<(s: MirrorState) => void>()
let dir: Dir | null = null

const tell = () => {
  for (const fn of listeners) fn({ ...state })
}

export function subscribeMirror(fn: (s: MirrorState) => void) {
  listeners.add(fn)
  fn({ ...state })
  return () => void listeners.delete(fn)
}

export const mirrorState = (): MirrorState => ({ ...state })

/* ---------- remembering the folder between sessions ----------
 *
 * A directory handle can be stored in IndexedDB and handed back later, which
 * is the only way to keep a folder across reloads without asking again. It
 * goes in a database of its own rather than into the board database, so
 * nothing about the boards has to change to make room for it. */

const HANDLE_DB = 'ideation.mirror'
const STORE = 'handle'

function withHandleStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((res) => {
    let db: IDBDatabase | null = null
    const open = indexedDB.open(HANDLE_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => res(null)
    open.onsuccess = () => {
      db = open.result
      try {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        t.oncomplete = () => res(req.result ?? null)
        t.onerror = () => res(null)
        t.onabort = () => res(null)
      } catch {
        res(null)
      }
    }
  })
}

const rememberHandle = (h: Dir | null) =>
  h ? withHandleStore('readwrite', (s) => s.put(h, 'dir')) : withHandleStore('readwrite', (s) => s.delete('dir'))

const recallHandle = () => withHandleStore<Dir>('readonly', (s) => s.get('dir') as IDBRequest<Dir>)

/* ---------- the folder ---------- */

/* Called once on the way in. A handle remembered from last time only becomes
 * live again if the permission is still granted: asking for it without a
 * gesture would be refused, so the folder is offered rather than reopened. */
export async function restoreFolder(): Promise<boolean> {
  state.supported = supportsFS()
  if (!state.supported) {
    tell()
    return false
  }
  const h = await recallHandle()
  if (!h) {
    tell()
    return false
  }
  const q = (h as Dir & { queryPermission?: (o: unknown) => Promise<string> }).queryPermission
  const granted = q ? (await q.call(h, { mode: 'readwrite' })) === 'granted' : false
  if (granted) {
    dir = h
    state.folder = h.name
  } else {
    /* Kept, not forgotten: the next explicit "keep a copy" can ask for it back
     * without making the person find the folder again. */
    state.folder = null
  }
  tell()
  return granted
}

/* Asked for from a click, because a browser will only open a folder picker
 * from a gesture. */
export async function chooseFolder(): Promise<boolean> {
  state.supported = supportsFS()
  if (!state.supported) {
    state.error = 'This browser cannot write to a folder. Chrome and Edge can; Safari and Firefox cannot yet.'
    tell()
    return false
  }
  try {
    /* If there is a remembered folder that only needs permission back, take
     * that rather than making the person choose it a second time. */
    const known = await recallHandle()
    const h = known && (await ensurePerm(known)) ? known : await pickFolder()
    if (!(await ensurePerm(h))) {
      state.error = 'Without permission to write, nothing can be kept there.'
      tell()
      return false
    }
    dir = h
    state.folder = h.name
    state.error = null
    await rememberHandle(h)
    tell()
    return true
  } catch (err) {
    /* Cancelling the picker is not an error. */
    if ((err as { name?: string })?.name === 'AbortError') return false
    state.error = err instanceof Error ? err.message : 'That folder could not be opened'
    tell()
    return false
  }
}

export async function forgetFolder() {
  dir = null
  state.folder = null
  state.at = 0
  state.wrote = 0
  state.error = null
  await rememberHandle(null)
  tell()
}

export const mirroring = () => !!dir

/* ---------- writing ---------- */

/* Media already written is left alone. The names come from the media key,
 * which never changes for the life of a picture, so a file that is there is
 * the right file — and a board of two hundred photographs would otherwise
 * rewrite every one of them every time a card moved. */
async function alreadyThere(media: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await media.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

let queued: number | null = null
let running = false

export async function copyNow(rootId: string): Promise<number> {
  if (!dir) return 0
  if (running) return 0
  running = true
  state.busy = true
  state.error = null
  tell()
  try {
    const got = await gather(rootId)
    await writeJSON(dir, 'board.json', got.bundle)
    let wrote = 1
    if (got.files.length) {
      const media = await dir.getDirectoryHandle('media', { create: true })
      for (const f of got.files) {
        const name = f.path.replace(/^media\//, '')
        if (await alreadyThere(media, name)) continue
        const fh = await media.getFileHandle(name, { create: true })
        const w = await fh.createWritable()
        await w.write(f.blob)
        await w.close()
        wrote++
      }
    }
    /* A note for whoever opens the folder without this app in front of them. */
    await writeJSON(dir, 'README.json', {
      what: 'A copy of an ideation board, written by the board itself.',
      board: got.rootName,
      written: new Date().toISOString(),
      howToOpen: 'Zip this folder and drop it on a board, or use Import.',
      note: 'This is a copy, not a sync. Nothing here is ever read back into the app.',
    })
    state.at = Date.now()
    state.wrote = wrote
    return wrote
  } catch (err) {
    const name = (err as { name?: string })?.name
    state.error =
      name === 'NotAllowedError'
        ? 'Permission to write to that folder has lapsed. Choose it again.'
        : err instanceof Error
          ? err.message
          : 'The copy could not be written'
    if (name === 'NotAllowedError') {
      dir = null
      state.folder = null
    }
    return 0
  } finally {
    running = false
    state.busy = false
    tell()
  }
}

/* Called after every save. Writing a folder is slower and noisier than writing
 * IndexedDB, so it waits for the board to be left alone for a few seconds
 * rather than following every keystroke. */
export function copySoon(rootId: string, delay = 4000) {
  if (!dir) return
  if (queued) clearTimeout(queued)
  queued = window.setTimeout(() => {
    queued = null
    void copyNow(rootId)
  }, delay)
}

export function describeMirror(s: MirrorState): string {
  if (!s.supported) return 'This browser cannot keep a copy in a folder'
  if (!s.folder) return 'No folder chosen — the only copy of this work is in this browser'
  if (s.error) return s.error
  if (s.busy) return `Copying to ${s.folder}…`
  if (!s.at) return `Copying to ${s.folder} when the board settles`
  const mins = Math.round((Date.now() - s.at) / 60000)
  const when = mins < 1 ? 'just now' : mins === 1 ? 'a minute ago' : `${mins} minutes ago`
  return `Copied to ${s.folder} ${when}`
}

export { safeName }
