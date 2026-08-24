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
import { CommandPalette } from './ui/CommandPalette'
import { TopBar } from './ui/TopBar'
import { buildCommands } from './ui/commands'
import { useShortcuts } from './app/useShortcuts'
import type { Crumb } from './state/boards'
import { Present } from './ui/Present'
import { SpaceAlarm } from './ui/SpaceAlarm'
import { describeSpace, measure, roomFor, spaceNow } from './store/space'
import {
  chooseFolder, copyNow, copySoon, describeMirror, forgetFolder, mirrorState, restoreFolder, subscribeMirror,
} from './store/mirror'
import type { MirrorState } from './store/mirror'
import { paletteOf, swatchItems } from './state/palette'
import { hasPixels } from './state/kinds'

const BOARD_ID = 'board_local'
const PATH_KEY = 'ideation.path'

/* Where you are in the tree. The last crumb is the board on screen; `card` is
 * the id of the card that opens it, on the board one step up, which is how a
 * rename made from inside a board finds its way back to the card. */
const ROOT: Crumb = { id: BOARD_ID, name: 'Untitled board', card: null }

export default function App() {
  const selection = useSelection()
  const [tab, setTab] = useState<PanelTab>('effect')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900)
  const [palette, setPalette] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const [mirror, setMirror] = useState<MirrorState>(mirrorState)
  /* Read out by anything reading the page aloud when the selection moves. */
  const [spoken, setSpoken] = useState('')
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
        /* And, a few seconds after the board is left alone, out to the folder
           on disk if one has been chosen. */
        copySoon(store.id)
      }, 700)
    }
    return () => {
      store.onDirty = null
      if (t) clearTimeout(t)
    }
  }, [])

  /* A folder chosen in an earlier session comes back if the permission is
     still granted; a browser will not grant it again without a gesture, so it
     is offered rather than reopened. */
  useEffect(() => subscribeMirror(setMirror), [])
  useEffect(() => {
    void restoreFolder()
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
    const shootable = items.filter(hasPixels)
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
    /* Asked before the drop rather than discovered half way through it. A
       browser that will not say how much room is left says yes, because
       refusing a drop on a guess is worse than letting it fail and saying so. */
    await measure()
    const bytes = list.reduce((n, f) => n + f.size, 0)
    if (!roomFor(bytes)) {
      const mb = (v: number) => `${Math.round(v / 1048576)}MB`
      say(
        `Not enough room for ${mb(bytes)}. ${describeSpace(spaceNow())}. Export this board and remove what you do not need.`,
        6000
      )
      return
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
  }, [say])


  /* The colours out of a picture, as swatches under it. One undo step for the
     lot, and they arrive selected so they can be moved somewhere else at once. */
  const pullColours = useCallback(async (ids: string[]) => {
    const from = ids
      .map((id) => store.getItem(id))
      .find(hasPixels)
    if (!from) {
      say('Select a picture or a video to read the colours out of it')
      return
    }
    say('Reading the colours…', 6000)
    const found = await paletteOf(from)
    if (!found.length) {
      say('Those pixels could not be read')
      return
    }
    const made = swatchItems(found, from)
    store.addMany(made)
    store.select(made.map((m) => m.id))
    say(`${made.length} colours from ${from.name || 'the picture'}`)
  }, [say])

  /* Pointing the board at a folder, and pushing a copy out to it. Both have to
     be reached from a click: a browser opens a folder picker only from one. */
  const keepInFolder = useCallback(async () => {
    if (!(await chooseFolder())) {
      const s = mirrorState()
      if (s.error) say(s.error, 5000)
      return
    }
    await saveNow.current()
    const n = await copyNow(store.id)
    say(n ? `Copied ${n} file${n === 1 ? '' : 's'} to ${mirrorState().folder}` : describeMirror(mirrorState()), 3600)
  }, [say])

  const copyToFolder = useCallback(async () => {
    if (!mirrorState().folder) return
    say('Copying to the folder…', 6000)
    await saveNow.current()
    const n = await copyNow(store.id)
    say(n ? `Copied ${n} file${n === 1 ? '' : 's'} to ${mirrorState().folder}` : describeMirror(mirrorState()), 3600)
  }, [say])

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
  const commands = useMemo(
    () =>
      buildCommands({
        selection,
        panelOpen,
        mirror,
        centreOfView,
        addBoard: (at) => void addBoard(at),
        askForLink: () => askForLink(),
        pickFiles: () => fileRef.current?.click(),
        importBoard: () => importRef.current?.click(),
        exportBoard: () => void exportBoard(),
        exportPictures: (ids) => void exportPictures(ids),
        pullColours: (ids) => void pullColours(ids),
        keepInFolder: () => void keepInFolder(),
        copyToFolder: () => void copyToFolder(),
        forgetFolder: () => void forgetFolder(),
        setPanelOpen,
        setTab,
        setPresenting,
        focusSearch: () => document.querySelector<HTMLInputElement>('.search input')?.focus(),
      }),
    [
      selection, panelOpen, mirror, centreOfView, addBoard, askForLink,
      exportBoard, exportPictures, pullColours, keepInFolder, copyToFolder,
    ]
  )

  /* ---------- keyboard ---------- */
  useShortcuts({
    centreOfView,
    addBoard: (at) => void addBoard(at),
    askForLink,
    pickFiles: () => fileRef.current?.click(),
    importBoard: () => importRef.current?.click(),
    exportBoard: () => void exportBoard(),
    exportPictures: (ids) => void exportPictures(ids),
    openItem,
    togglePanel: () => setPanelOpen((v) => !v),
    togglePalette: () => setPalette((v) => !v),
    present: () => setPresenting(true),
    say: setSpoken,
    closeEditor: () => setEditing(null),
  })

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
      addLink: (at: { x: number; y: number }) => askForLink(at),
      commands: () => setPalette(true),
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
      <TopBar
        path={path}
        name={name}
        onName={setName}
        onOpenBoard={(to) => void openBoard(to)}
        panelOpen={panelOpen}
        onPanel={() => setPanelOpen((v) => !v)}
        onCommands={() => setPalette(true)}
        onAddFiles={() => fileRef.current?.click()}
        onNote={() => store.add(noteItem(centreOfView()))}
        onLabel={() => store.add(labelItem(centreOfView()))}
        onSection={() => store.add(sectionItem(centreOfView()))}
        onBoard={() => void addBoard(centreOfView())}
        onLink={() => askForLink()}
        onImport={() => importRef.current?.click()}
        onExport={() => void exportBoard()}
      />

      <main className="main">
        <Board
          onDropFiles={onDropFiles}
          onOpenEditor={openItem}
          onExportPictures={exportPictures}
          onPullColours={(ids) => void pullColours(ids)}
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

      <SpaceAlarm onExport={() => void exportBoard()} onFolder={() => void keepInFolder()} />
      {presenting && <Present ids={selection} onClose={() => setPresenting(false)} />}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {editing && <NoteEditor id={editing} onClose={() => setEditing(null)} />}
      {busy && <div className="toast">{busy}</div>}
      {!engineOk && (
        <div className="toast warn">
          This browser cannot run the GPU effects engine. Images and adjustments still work.
        </div>
      )}
      <Stats count={selection.length} />
      {/* Off screen, and the only thing on the page that speaks. A selection
          moving is invisible to a screen reader otherwise: the cards are divs
          on a canvas, and nothing about a border changing colour is announced. */}
      <p className="said" role="status" aria-live="polite">
        {spoken}
      </p>
    </div>
  )
}
