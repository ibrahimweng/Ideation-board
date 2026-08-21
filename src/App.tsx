import { useCallback, useEffect, useRef, useState } from 'react'
import { Board } from './board/Board'
import { EffectsPanel } from './ui/EffectsPanel'
import { store, useSelection } from './state/store'
import { ingest, noteItem, labelItem, sectionItem, linkItem, newId } from './state/ingest'
import { getEngine } from './engine/client'
import { getBoard, putBoard } from './store/idb'
import type { Board as BoardModel, Item } from './state/types'
import { download } from './store/fs'
import { NoteEditor } from './ui/NoteEditor'
import { Stats } from './ui/Stats'

const BOARD_ID = 'board_local'

export default function App() {
  const selection = useSelection()
  const [tab, setTab] = useState<'effect' | 'adjust'>('effect')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('Untitled board')
  const [engineOk, setEngineOk] = useState(true)
  const fileRef = useRef<HTMLInputElement | null>(null)

  /* ---------- boot ---------- */
  useEffect(() => {
    void (async () => {
      const ok = await getEngine().start()
      setEngineOk(ok)
      const saved = await getBoard(BOARD_ID)
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
    })()
    return () => getEngine().stop()
  }, [])

  /* ---------- autosave ---------- */
  useEffect(() => {
    let t: number | null = null
    store.onDirty = () => {
      if (t) clearTimeout(t)
      t = window.setTimeout(() => {
        const b: BoardModel = store.toBoard()
        void putBoard({ id: b.id, name: b.name, updated: b.updated, items: b.items, view: b.view })
      }, 700)
    }
    return () => {
      store.onDirty = null
      if (t) clearTimeout(t)
    }
  }, [])

  /* ---------- adding things ---------- */
  const centreOfView = useCallback(() => {
    const v = store.peekView()
    return { x: (-v.x + window.innerWidth / 2) / v.z - 150, y: (-v.y + window.innerHeight / 2) / v.z - 100 }
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
        const copies = store
          .getSelection()
          .map((id) => store.getItem(id))
          .filter(Boolean)
          .map((i) => ({ ...i!, id: newId(), x: i!.x + 28, y: i!.y + 28 }))
        if (copies.length) {
          store.addMany(copies)
          store.select(copies.map((c) => c.id))
        }
        return
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
        store.moveMany(sel, dx, dy, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      store.add(/^https?:\/\//i.test(text) ? linkItem(at, text) : noteItem(at, text))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onDropFiles, centreOfView])

  const exportBoard = useCallback(() => {
    const b = store.toBoard()
    download(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }), `${b.name || 'board'}.json`)
  }, [])

  return (
    <div className="app" data-panel={panelOpen || undefined}>
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          <input
            className="board-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              store.name = e.target.value
            }}
            spellCheck={false}
          />
        </div>

        <div className="tools">
          <button onClick={() => fileRef.current?.click()}>Add files</button>
          <button onClick={() => store.add(noteItem(centreOfView()))}>Note</button>
          <button onClick={() => store.add(labelItem(centreOfView()))}>Label</button>
          <button onClick={() => store.add(sectionItem(centreOfView()))}>Section</button>
          <button
            onClick={() => {
              const u = window.prompt('Link URL')
              if (u) store.add(linkItem(centreOfView(), u))
            }}
          >
            Link
          </button>
          <span className="sep" />
          <button onClick={() => store.undo()} title="Undo (Cmd+Z)">
            Undo
          </button>
          <button onClick={() => store.redo()} title="Redo (Shift+Cmd+Z)">
            Redo
          </button>
          <span className="sep" />
          <button onClick={exportBoard}>Export</button>
          <button data-on={panelOpen || undefined} onClick={() => setPanelOpen((v) => !v)}>
            Effects
          </button>
        </div>
      </header>

      <main className="main">
        <Board onDropFiles={onDropFiles} onOpenEditor={setEditing} />
        {panelOpen && <EffectsPanel tab={tab} onTab={setTab} />}
      </main>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void onDropFiles(e.target.files, centreOfView())
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
