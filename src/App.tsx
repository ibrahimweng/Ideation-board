import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from './board/Board'
import { EffectsPanel } from './ui/EffectsPanel'
import type { PanelTab } from './ui/EffectsPanel'
import { store, useSelection } from './state/store'
import { ingest, noteItem, labelItem, sectionItem, boardItem, addUrl } from './state/ingest'
import { createBoard, renameCardIn, invalidateSummary } from './state/boards'
import { getEngine } from './engine/client'
import { getBoard, putBoard } from './store/idb'
import type { Board as BoardModel, Item } from './state/types'
import { download, safeName } from './store/fs'
import { exportTree, importTree, looksLikeBoardFile } from './state/transfer'
import { exportCards } from './state/exportImage'
import { zip } from './store/zip'
import { NoteEditor } from './ui/NoteEditor'
import { Stats } from './ui/Stats'
import { KEYS, titleFor } from './ui/shortcuts'
import { nameFor } from './ui/shortcuts'
import type { ShortcutName } from './ui/shortcuts'
import { CommandPalette } from './ui/CommandPalette'
import type { Command } from './ui/CommandPalette'
import { setTheme, themeWant } from './ui/theme'
import {
  IconBoard, IconCommand, IconEffects, IconExport, IconFiles, IconImport, IconLabel, IconLink,
  IconNote, IconSection, IconUndo, IconRedo,
} from './ui/icons'
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
  const [tab, setTab] = useState<PanelTab>('effect')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900)
  const [palette, setPalette] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('Untitled board')
  const [engineOk, setEngineOk] = useState(true)
  const [path, setPath] = useState<Crumb[]>([ROOT])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const importRef = useRef<HTMLInputElement | null>(null)
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

  /* A line along the bottom that takes itself away again. */
  const say = useCallback((msg: string, ms = 2200) => {
    setBusy(msg)
    window.setTimeout(() => setBusy(null), ms)
  }, [])

  /* The board you are on and everything nested inside it, with its media, as
   * one file. The pending save is forced out first so what leaves is what is
   * on screen rather than what was there a moment ago. */
  const exportBoard = useCallback(async () => {
    setBusy('Packing the board…')
    try {
      await saveNow.current()
      const out = await exportTree(store.id)
      download(out.blob, out.name)
      const bits = [out.boards === 1 ? '1 board' : `${out.boards} boards`]
      if (out.media) bits.push(out.media === 1 ? '1 file' : `${out.media} files`)
      setBusy(`Exported ${bits.join(' and ')}`)
      window.setTimeout(() => setBusy(null), 2200)
    } catch (err) {
      setBusy(err instanceof Error ? err.message : 'The board could not be exported')
      window.setTimeout(() => setBusy(null), 3200)
    }
  }, [])

  /* The picture, as a picture. One card comes out as a PNG; several come out
   * as a zip of them, which is the only sensible thing a browser can hand over
   * in one gesture. */
  const exportPictures = useCallback(async (ids: string[]) => {
    const items = ids.map((id) => store.getItem(id)).filter((i): i is Item => !!i)
    const shootable = items.filter((i) => i.kind === 'image' || i.kind === 'video')
    if (!shootable.length) {
      setBusy('Select a picture or a video to export')
      window.setTimeout(() => setBusy(null), 2200)
      return
    }
    setBusy(shootable.length > 1 ? `Rendering ${shootable.length} pictures…` : 'Rendering…')
    try {
      const made = await exportCards(shootable)
      if (!made.length) {
        setBusy('Nothing there could be exported')
        window.setTimeout(() => setBusy(null), 2600)
        return
      }
      if (made.length === 1) {
        download(made[0].blob, made[0].name)
        setBusy(`Exported ${made[0].name} at ${made[0].w}×${made[0].h}`)
      } else {
        const bundle = await zip(made.map((m) => ({ name: m.name, blob: m.blob })))
        download(bundle, `${safeName(store.name || 'board')}-pictures.zip`)
        setBusy(`Exported ${made.length} pictures`)
      }
      const missed = shootable.length - made.length
      if (missed > 0) setBusy(`Exported ${made.length}, ${missed} could not be read`)
      window.setTimeout(() => setBusy(null), 2600)
    } catch (err) {
      setBusy(err instanceof Error ? err.message : 'That could not be exported')
      window.setTimeout(() => setBusy(null), 3200)
    }
  }, [])

  /* An imported board arrives as a board card on the board you are on, rather
   * than replacing anything: nothing is lost, and the same file can be brought
   * in twice as two separate boards. */
  const importBoard = useCallback(async (file: Blob, at: { x: number; y: number }) => {
    setBusy('Reading the board…')
    try {
      const out = await importTree(file, at)
      store.add(out.card)
      store.select([out.card.id])
      const bits = [out.boards === 1 ? '1 board' : `${out.boards} boards`]
      if (out.media) bits.push(out.media === 1 ? '1 file' : `${out.media} files`)
      setBusy(`Imported ${bits.join(' and ')}`)
      window.setTimeout(() => setBusy(null), 2200)
      return true
    } catch (err) {
      setBusy(err instanceof Error ? err.message : 'That file could not be read')
      window.setTimeout(() => setBusy(null), 3200)
      return false
    }
  }, [])

  const onDropFiles = useCallback(async (files: FileList | File[], at: { x: number; y: number }) => {
    let list = Array.from(files)
    if (!list.length) return
    /* A board file dropped on the board is a board, not an attachment. One
     * that turns out not to be is added as a file like anything else. */
    const bundles = list.filter((f) => looksLikeBoardFile(f.name))
    if (bundles.length) {
      const rest: File[] = list.filter((f) => !bundles.includes(f))
      for (const f of bundles) {
        if (!(await importBoard(f, at))) rest.push(f)
      }
      list = rest
      if (!list.length) return
    }
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


  /* One prompt, reached from the toolbar, from K, and from the command list. */
  const askForLink = useCallback(
    (at?: { x: number; y: number }) => {
      const u = window.prompt('Paste a link. A video URL becomes a playable card.')
      if (u) addUrl(at || centreOfView(), u)
    },
    [centreOfView]
  )

  /* Everything the board can do, as a list. Built here because this is where
     the actions are; the palette only searches it and runs what you pick. */
  const commands = useMemo<Command[]>(() => {
    const sel = () => store.getSelection()
    const some = selection.length > 0
    const at = () => centreOfView()
    const cmd = (id: string, name: string, group: string, run: () => void, extra: Partial<Command> = {}): Command => ({
      id, name, group, run, ...extra,
    })
    return [
      cmd('add.files', 'Add files', 'Add', () => fileRef.current?.click(), { hint: KEYS.addFiles.hint, keywords: 'image photo picture video upload import' }),
      cmd('add.note', 'Note', 'Add', () => store.add(noteItem(at())), { hint: KEYS.note.hint, keywords: 'text write checklist' }),
      cmd('add.label', 'Label', 'Add', () => store.add(labelItem(at())), { hint: KEYS.label.hint, keywords: 'title heading caption' }),
      cmd('add.section', 'Section', 'Add', () => store.add(sectionItem(at())), { hint: KEYS.section.hint, keywords: 'group area frame' }),
      cmd('add.board', 'Board inside this one', 'Add', () => void addBoard(at()), { hint: KEYS.board.hint, keywords: 'nested folder' }),
      cmd('add.link', 'Link or video URL', 'Add', () => askForLink(), { hint: KEYS.link.hint, keywords: 'url youtube vimeo paste' }),

      cmd('edit.undo', 'Undo', 'Edit', () => store.undo(), { hint: KEYS.undo.hint }),
      cmd('edit.redo', 'Redo', 'Edit', () => store.redo(), { hint: KEYS.redo.hint }),
      cmd('edit.all', 'Select everything', 'Edit', () => store.select(store.all().filter((i) => i.kind !== 'section').map((i) => i.id))),
      cmd('edit.dup', 'Duplicate the selection', 'Edit', () => { const made = store.duplicate(sel()); if (made.length) store.select(made) }, { disabled: !some }),
      cmd('edit.del', 'Delete the selection', 'Edit', () => store.remove(sel()), { disabled: !some, keywords: 'remove' }),

      cmd('arrange.tidy', 'Tidy up the whole board', 'Arrange', () => store.tidy(store.all().filter((i) => i.kind !== 'edge').map((i) => i.id)), { keywords: 'grid align layout sort' }),
      cmd('arrange.left', 'Line the selection up on the left', 'Arrange', () => store.align(sel(), 'left'), { disabled: selection.length < 2 }),
      cmd('arrange.top', 'Line the selection up on the top', 'Arrange', () => store.align(sel(), 'top'), { disabled: selection.length < 2 }),
      cmd('arrange.spreadx', 'Space the selection out across', 'Arrange', () => store.distribute(sel(), 'x'), { disabled: selection.length < 3 }),
      cmd('arrange.spready', 'Space the selection out down', 'Arrange', () => store.distribute(sel(), 'y'), { disabled: selection.length < 3 }),

      cmd('out.picture', 'Export the selected pictures as PNG', 'Take out', () => void exportPictures(sel()), { hint: KEYS.picture.hint, disabled: !some, keywords: 'png save download image' }),
      cmd('out.board', 'Export this board and everything in it', 'Take out', () => void exportBoard(), { hint: KEYS.export.hint, keywords: 'zip backup save download' }),
      cmd('in.board', 'Import a board file', 'Take out', () => importRef.current?.click(), { hint: KEYS.import.hint, keywords: 'zip open restore' }),

      cmd('view.effects', panelOpen ? 'Hide the effects panel' : 'Show the effects panel', 'View', () => setPanelOpen((v) => !v), { hint: KEYS.effects.hint }),
      cmd('view.looks', 'Saved looks', 'View', () => { setPanelOpen(true); setTab('looks') }, { keywords: 'preset grade style' }),
      cmd('view.search', 'Search this board', 'View', () => document.querySelector<HTMLInputElement>('.search input')?.focus(), { hint: KEYS.search.hint, keywords: 'find filter' }),
      cmd('view.light', 'Light theme', 'View', () => setTheme('light'), { disabled: themeWant() === 'light', keywords: 'bright day appearance' }),
      cmd('view.dark', 'Dark theme', 'View', () => setTheme('dark'), { disabled: themeWant() === 'dark', keywords: 'night appearance' }),
      cmd('view.system', 'Follow the system theme', 'View', () => setTheme('system'), { disabled: themeWant() === 'system', keywords: 'auto appearance' }),
    ]
  }, [selection, panelOpen, centreOfView, addBoard, askForLink, exportBoard, exportPictures])

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      /* The command list opens from anywhere, a half typed note included: it
         is how you get out of whatever you are in and do something else. */
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === KEYS.commands.key) {
        e.preventDefault()
        setPalette((v) => !v)
        return
      }
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
        void exportBoard()
        return
      }
      if (cmd && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void exportPictures(store.getSelection())
        return
      }
      if (cmd && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        importRef.current?.click()
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
        if (k === KEYS.link.key) { e.preventDefault(); askForLink(at); return }
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
  }, [centreOfView, exportBoard, addBoard, exportPictures])

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
      importBoard: (at: { x: number; y: number }) => {
        pendingAt.current = at
        importRef.current?.click()
      },
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

        {/* Icons in three groups rather than eleven grey words in a row.
            The words told you nothing the icon does not — they were all the
            same size, weight and colour, so nothing in the row stood out and
            the row itself was as wide as the window would allow. What each one
            is, and the key that runs it, is on its tooltip and in the command
            list. Effects keeps its name because it is the only thing here that
            is a mode rather than an action. */}
        <div className="tools">
          <div className="tool-group">
            <ToolButton name="addFiles" onClick={() => fileRef.current?.click()}>
              <IconFiles />
            </ToolButton>
            <ToolButton name="note" onClick={() => store.add(noteItem(centreOfView()))}>
              <IconNote />
            </ToolButton>
            <ToolButton name="label" onClick={() => store.add(labelItem(centreOfView()))}>
              <IconLabel />
            </ToolButton>
            <ToolButton name="section" onClick={() => store.add(sectionItem(centreOfView()))}>
              <IconSection />
            </ToolButton>
            <ToolButton name="board" onClick={() => void addBoard(centreOfView())}>
              <IconBoard />
            </ToolButton>
            <ToolButton name="link" onClick={() => askForLink()}>
              <IconLink />
            </ToolButton>
          </div>

          <div className="tool-group">
            <ToolButton name="undo" onClick={() => store.undo()}>
              <IconUndo />
            </ToolButton>
            <ToolButton name="redo" onClick={() => store.redo()}>
              <IconRedo />
            </ToolButton>
          </div>

          {/* First to go when the row runs short: both are also a drop, a menu
              entry, a shortcut and a line in the command list, while nothing
              else here has a second way in. */}
          <div className="tool-group tools-wide">
            <ToolButton name="import" onClick={() => importRef.current?.click()}>
              <IconImport />
            </ToolButton>
            <ToolButton name="export" onClick={() => void exportBoard()}>
              <IconExport />
            </ToolButton>
          </div>

          <ToolButton name="commands" onClick={() => setPalette(true)}>
            <IconCommand />
          </ToolButton>

          <button
            className="tool-mode"
            data-on={panelOpen || undefined}
            onClick={() => setPanelOpen((v) => !v)}
            title={titleFor('effects')}
            aria-label="Effects"
          >
            <IconEffects />
            <span>Effects</span>
          </button>
        </div>
      </header>

      <main className="main">
        <Board
          onDropFiles={onDropFiles}
          onOpenEditor={openItem}
          onExportPictures={exportPictures}
          canvasActions={canvasActions}
        />
        {panelOpen && <EffectsPanel tab={tab} onTab={setTab} say={say} />}
      </main>

      <input
        ref={importRef}
        type="file"
        accept=".zip,.board,application/zip"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          const at = pendingAt.current || centreOfView()
          pendingAt.current = null
          if (f) void importBoard(f, at)
          e.target.value = ''
        }}
      />

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

      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
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

/* A button in the top row: an icon, and the name and key it runs on its
   tooltip and for anything reading the page aloud. */
function ToolButton({
  name, onClick, children,
}: {
  name: ShortcutName
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button className="tool" onClick={onClick} title={titleFor(name)} aria-label={nameFor(name)}>
      {children}
    </button>
  )
}
