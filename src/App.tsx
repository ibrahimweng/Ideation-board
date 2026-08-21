import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from './board/Board'
import { EffectsPanel } from './ui/EffectsPanel'
import { store, useSelection } from './state/store'
import { ingest, noteItem, labelItem, sectionItem, boardItem, addUrl } from './state/ingest'
import { createBoard, renameCardIn, invalidateSummary } from './state/boards'
import { getEngine } from './engine/client'
import { getBoard, putBoard } from './store/idb'
import type { Board as BoardModel, Item } from './state/types'
import { download } from './store/fs'
import { NoteEditor } from './ui/NoteEditor'
import { Stats } from './ui/Stats'
import { KEYS, titleFor } from './ui/shortcuts'
import { SearchBar } from './ui/SearchBar'
import { TagFilter } from './ui/TagFilter'

const BOARD_ID = 'board_local'
const PATH_KEY = 'ideation.path'

/* Where you are in the tree. The last crumb is the board on screen; `card` is
 * the id of the card that opens it, on the board one step up, which is how a
 * rename made from inside a board finds its way back to the card. */
interface Crumb {
  id: string
  name: string
  card: string | null
}
const ROOT: Crumb = { id: BOARD_ID, name: 'Untitled board', card: null }

export default function App() {
  const selection = useSelection()
  const [tab, setTab] = useState<'effect' | 'adjust'>('effect')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('Untitled board')
  const [engineOk, setEngineOk] = useState(true)
  const [path, setPath] = useState<Crumb[]>([ROOT])
  const fileRef = useRef<HTMLInputElement | null>(null)
  /* Read by callbacks that must not be rebuilt every time the path changes. */
  const pathRef = useRef(path)
  pathRef.current = path

  /* ---------- autosave ---------- */
  /* Set up before boot so that leaving a board can force the pending write out
   * first. Switching boards replaces everything in the store, so a debounced
   * save that fired afterwards would write the new board's items under the old
   * board's name. */
  const saveNow = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let t: number | null = null
    const write = () => {
      const b: BoardModel = store.toBoard()
      invalidateSummary(b.id)
      return putBoard({ id: b.id, name: b.name, updated: b.updated, items: b.items, view: b.view })
    }
    saveNow.current = async () => {
      if (t) {
        clearTimeout(t)
        t = null
      }
      await write()
    }
    store.onDirty = () => {
      if (t) clearTimeout(t)
      t = window.setTimeout(() => {
        t = null
        void write()
      }, 700)
    }
    return () => {
      store.onDirty = null
      if (t) clearTimeout(t)
    }
  }, [])

  /* ---------- boot ---------- */
  useEffect(() => {
    void (async () => {
      const ok = await getEngine().start()
      setEngineOk(ok)
      /* Come back to the board that was open, however deep it was. Any crumb
       * whose board has since gone takes everything below it with it. */
      let trail: Crumb[] = [ROOT]
      try {
        const raw = JSON.parse(localStorage.getItem(PATH_KEY) || 'null')
        if (Array.isArray(raw) && raw[0]?.id === BOARD_ID) {
          const checked: Crumb[] = [ROOT]
          for (const c of raw.slice(1)) {
            if (!c?.id || !(await getBoard(c.id))) break
            checked.push({ id: c.id, name: c.name || 'Board', card: c.card || null })
          }
          trail = checked
        }
      } catch { /* a corrupt trail is just the root board */ }

      const saved = await getBoard(trail[trail.length - 1].id)
      if (saved) {
        store.load({
          id: saved.id,
          name: saved.name,
          items: saved.items as Item[],
          view: saved.view || { x: 0, y: 0, z: 1 },
          updated: saved.updated,
        })
        setName(saved.name)
      }
      setPath(trail)
    })()
    return () => getEngine().stop()
  }, [])

  /* ---------- moving between boards ---------- */
  const openBoard = useCallback(async (next: Crumb[]) => {
    const prev = pathRef.current
    const leaving = prev[prev.length - 1]
    const target = next[next.length - 1]
    if (!target || target.id === leaving.id) return

    await saveNow.current()
    /* The name shown on a board card and the name inside the board are the
     * same name, so a rename made in the top bar has to reach the card. The
     * card may be on a board that is not loaded, so it is written through the
     * record rather than through the store. */
    const parent = prev[prev.length - 2]
    if (leaving.card && parent) await renameCardIn(parent.id, leaving.card, store.name)
    invalidateSummary(leaving.id)

    const rec = await getBoard(target.id)
    store.load(
      rec
        ? { id: rec.id, name: rec.name, items: rec.items as Item[], view: rec.view || { x: 0, y: 0, z: 1 }, updated: rec.updated }
        : { id: target.id, name: target.name, items: [], view: { x: 0, y: 0, z: 1 }, updated: Date.now() }
    )
    setName(store.name)
    setEditing(null)
    setPath(next)
    try {
      localStorage.setItem(PATH_KEY, JSON.stringify(next))
    } catch { /* a session without storage still navigates, it just forgets */ }
  }, [])

  /* Double clicking a card, and the first entry in its menu. A board card
   * opens its board; everything else opens the editor. */
  const openItem = useCallback(
    (id: string, mode: 'open' | 'edit' = 'open') => {
      const it = store.getItem(id)
      if (mode === 'open' && it?.kind === 'board' && it.board) {
        void openBoard([...pathRef.current, { id: it.board, name: it.name || 'Board', card: it.id }])
        return
      }
      setEditing(id)
    },
    [openBoard]
  )

  const addBoard = useCallback(async (at: { x: number; y: number }) => {
    /* The record is written first so that opening the card straight away
     * finds a board rather than making one. */
    const id = await createBoard('Board')
    store.add(boardItem(at, id))
  }, [])

  /* ---------- adding things ---------- */
  /* Successive additions step down and across instead of landing on the exact
   * same point. Without the step, adding a note then a label then a link
   * stacked all three on top of each other and only the last was visible. */
  const cascade = useRef(0)
  const centreOfView = useCallback(() => {
    const v = store.peekView()
    /* Measured from the board area, not the window, so the top bar and the
     * effects panel do not push new items off centre. */
    const el = document.querySelector('.viewport')
    const r = el ? el.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight }
    const step = (cascade.current++ % 6) * 26
    return {
      x: (-v.x + r.width / 2) / v.z - 150 + step,
      y: (-v.y + r.height / 2) / v.z - 100 + step,
    }
  }, [])

  const onDropFiles = useCallback(async (files: FileList | File[], at: { x: number; y: number }) => {
    const list = Array.from(files)
    if (!list.length) return
    setBusy(`Adding ${list.length} file${list.length > 1 ? 's' : ''}…`)
    let n = 0
    /* Items appear one at a time as they become ready rather than all at the
     * end, so a large drop feels immediate. */
    for await (const item of ingest(list, at)) {
      store.add(item)
      n++
      setBusy(n < list.length ? `Adding ${n + 1} of ${list.length}…` : null)
    }
    setBusy(null)
  }, [])

  const exportBoard = useCallback(() => {
    const b = store.toBoard()
    download(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }), `${b.name || 'board'}.json`)
  }, [])

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const cmd = e.metaKey || e.ctrlKey

      if (cmd && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (cmd && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        store.select(store.all().filter((i) => i.kind !== 'section').map((i) => i.id))
        return
      }
      if (cmd && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const made = store.duplicate(store.getSelection())
        if (made.length) store.select(made)
        return
      }
      if (cmd && e.key.toLowerCase() === 's') {
        /* The browser's own save dialog is not useful here. */
        e.preventDefault()
        exportBoard()
        return
      }

      /* Single key shortcuts only when no modifier is held, so they cannot
       * swallow a browser or system combination. */
      if (!cmd && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        const at = centreOfView()
        if (k === KEYS.note.key) { e.preventDefault(); store.add(noteItem(at)); return }
        if (k === KEYS.label.key) { e.preventDefault(); store.add(labelItem(at)); return }
        if (k === KEYS.section.key) { e.preventDefault(); store.add(sectionItem(at)); return }
        if (k === KEYS.board.key) { e.preventDefault(); void addBoard(at); return }
        if (k === KEYS.link.key) {
          e.preventDefault()
          const u = window.prompt('Paste a link. A video URL becomes a playable card.')
          if (u) addUrl(at, u)
          return
        }
        if (k === KEYS.addFiles.key) { e.preventDefault(); fileRef.current?.click(); return }
        if (k === KEYS.effects.key) { e.preventDefault(); setPanelOpen((v) => !v); return }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        store.remove(store.getSelection())
        return
      }
      if (e.key === 'Escape') {
        store.clearSel()
        setEditing(null)
        return
      }
      /* Nudge with arrows; shift for a bigger step. */
      if (e.key.startsWith('Arrow')) {
        const sel = store.getSelection()
        if (!sel.length) return
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        /* A burst of nudges collapses into one undo step. */
        store.beginGesture(700)
        store.moveMany(store.dragSet(sel).ids, dx, dy, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [centreOfView, exportBoard, addBoard])

  /* ---------- paste ---------- */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData
      if (!dt) return
      const files = Array.from(dt.files || [])
      if (files.length) {
        void onDropFiles(files, centreOfView())
        return
      }
      const text = dt.getData('text/plain')?.trim()
      if (!text) return
      const at = centreOfView()
      if (/^https?:\/\//i.test(text)) addUrl(at, text)
      else store.add(noteItem(at, text))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onDropFiles, centreOfView])

  /* Actions for the right click menu on empty board. Everything is placed
   * where the pointer was, which is the point of having the menu there. */
  const pendingAt = useRef<{ x: number; y: number } | null>(null)
  const canvasActions = useMemo(
    () => ({
      addNote: (at: { x: number; y: number }) => store.add(noteItem(at)),
      addLabel: (at: { x: number; y: number }) => store.add(labelItem(at)),
      addSection: (at: { x: number; y: number }) => store.add(sectionItem(at)),
      addBoard: (at: { x: number; y: number }) => void addBoard(at),
      addLink: (at: { x: number; y: number }) => {
        const u = window.prompt('Paste a link. A video URL becomes a playable card.')
        if (u) addUrl(at, u)
      },
      pickFiles: (at: { x: number; y: number }) => {
        /* Remembered so the chosen files land where the menu was opened. */
        pendingAt.current = at
        fileRef.current?.click()
      },
      paste: async (at: { x: number; y: number }) => {
        /* Reading the clipboard needs permission the browser may refuse, and
         * there may be nothing in it, so this quietly does nothing rather
         * than reporting a failure the person cannot act on. */
        try {
          const entries = await navigator.clipboard.read()
          const files: File[] = []
          for (const item of entries) {
            const type = item.types.find((t) => t.startsWith('image/') || t.startsWith('video/'))
            if (!type) continue
            const blob = await item.getType(type)
            files.push(new File([blob], `pasted.${type.split('/')[1] || 'bin'}`, { type }))
          }
          if (files.length) {
            void onDropFiles(files, at)
            return
          }
        } catch {
          /* fall through to text */
        }
        try {
          const text = (await navigator.clipboard.readText())?.trim()
          if (!text) return
          if (/^https?:\/\//i.test(text)) addUrl(at, text)
          else store.add(noteItem(at, text))
        } catch {
          /* nothing readable, and nothing useful to say about it */
        }
      },
    }),
    [onDropFiles, addBoard]
  )

  return (
    <div className="app" data-panel={panelOpen || undefined}>
      {/* The trail is one more thing in a row that is already full, so the
          narrow-width rules that make room for it only apply while it is
          there. */}
      <header className="topbar" data-nested={path.length > 1 || undefined}>
        <div className="brand">
          <span className="dot" />
          {path.length > 1 && (
            <nav className="crumbs">
              {path.length > 3 && (
                <span className="crumb">
                  <button onClick={() => void openBoard([path[0]])} title={path[0].name}>
                    …
                  </button>
                  <i>/</i>
                </span>
              )}
              {path.slice(0, -1).slice(-2).map((c) => (
                <span key={c.id} className="crumb">
                  <button
                    title={c.name}
                    onClick={() => void openBoard(path.slice(0, path.findIndex((p) => p.id === c.id) + 1))}
                  >
                    {c.name}
                  </button>
                  <i>/</i>
                </span>
              ))}
            </nav>
          )}
          <input
            className="board-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              store.setName(e.target.value)
            }}
            spellCheck={false}
          />
        </div>

        <SearchBar />
        <TagFilter />

        <div className="tools">
          <button onClick={() => fileRef.current?.click()} title={titleFor('addFiles')}>
            Add files <kbd aria-hidden="true">{KEYS.addFiles.hint}</kbd>
          </button>
          <button onClick={() => store.add(noteItem(centreOfView()))} title={titleFor('note')}>
            Note <kbd aria-hidden="true">{KEYS.note.hint}</kbd>
          </button>
          <button onClick={() => store.add(labelItem(centreOfView()))} title={titleFor('label')}>
            Label <kbd aria-hidden="true">{KEYS.label.hint}</kbd>
          </button>
          <button onClick={() => store.add(sectionItem(centreOfView()))} title={titleFor('section')}>
            Section <kbd aria-hidden="true">{KEYS.section.hint}</kbd>
          </button>
          <button onClick={() => void addBoard(centreOfView())} title={titleFor('board')}>
            Board <kbd aria-hidden="true">{KEYS.board.hint}</kbd>
          </button>
          <button
            title={titleFor('link')}
            onClick={() => {
              const u = window.prompt('Paste a link. A video URL becomes a playable card.')
              if (u) addUrl(centreOfView(), u)
            }}
          >
            Link <kbd aria-hidden="true">{KEYS.link.hint}</kbd>
          </button>
          <span className="sep" />
          <button onClick={() => store.undo()} title={titleFor('undo')}>
            Undo <kbd aria-hidden="true">{KEYS.undo.hint}</kbd>
          </button>
          <button onClick={() => store.redo()} title={titleFor('redo')}>
            Redo <kbd aria-hidden="true">{KEYS.redo.hint}</kbd>
          </button>
          <span className="sep" />
          <button onClick={exportBoard} title={titleFor('export')}>
            Export <kbd aria-hidden="true">{KEYS.export.hint}</kbd>
          </button>
          <button
            data-on={panelOpen || undefined}
            onClick={() => setPanelOpen((v) => !v)}
            title={titleFor('effects')}
          >
            Effects <kbd aria-hidden="true">{KEYS.effects.hint}</kbd>
          </button>
        </div>
      </header>

      <main className="main">
        <Board onDropFiles={onDropFiles} onOpenEditor={openItem} canvasActions={canvasActions} />
        {panelOpen && <EffectsPanel tab={tab} onTab={setTab} />}
      </main>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const at = pendingAt.current || centreOfView()
          pendingAt.current = null
          if (e.target.files?.length) void onDropFiles(e.target.files, at)
          e.target.value = ''
        }}
      />

      {editing && <NoteEditor id={editing} onClose={() => setEditing(null)} />}
      {busy && <div className="toast">{busy}</div>}
      {!engineOk && (
        <div className="toast warn">
          This browser cannot run the GPU effects engine. Images and adjustments still work.
        </div>
      )}
      <Stats count={selection.length} />
    </div>
  )
}
