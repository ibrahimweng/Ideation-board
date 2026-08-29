import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from './board/Board'
import { EffectsPanel } from './ui/EffectsPanel'
import type { PanelTab } from './ui/EffectsPanel'
import { store, useQuery, useSelection, useTagFilter } from './state/store'
import { dropColumns, ingest, noteItem, labelItem, sectionItem, boardItem, addUrl } from './state/ingest'
import { createBoard, emptyBoard, renameCardIn, invalidateSummary } from './state/boards'
import { getEngine } from './engine/client'
import { getBoard, putBoard } from './store/idb'
import { announceSaved, changedElsewhere, markSynced, onBoardSaved } from './store/tabs'
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
import { Compare } from './ui/Compare'
import { GenerateSheet } from './ui/GenerateSheet'
import { RelaySheet } from './ui/RelaySheet'
import { UpdateBar } from './ui/UpdateBar'
import { BoardTabs, BOARD_PANEL } from './ui/BoardTabs'
import { exportPage, saySize } from './state/exportPage'
import { Help } from './ui/Help'
import { resumeRelay } from './mcp/bridge'
import { notePath } from './mcp/tools'
import { drawMany, picturesFrom } from './state/generate'
import { describeSweep, sweep } from './store/reclaim'
import { boardTree, deleteBoardTree, renameBoard, weighBoard } from './state/boards'
import { heldItems, holdDeleted, takeBack } from './state/undelete'
import { FIRST_BOARD, boardExists, boardFromUrl, listRoots, newRoot, pointTabAt, tabOrder, trailKey, urlForBoard } from './state/roots'
import { SpaceAlarm } from './ui/SpaceAlarm'
import { TabClash } from './ui/TabClash'
import { describeSpace, measure, roomFor, spaceNow } from './store/space'
import {
  chooseFolder, copyNow, copySoon, describeMirror, forgetFolder, mirrorState, restoreFolder, subscribeMirror,
} from './store/mirror'
import type { MirrorState } from './store/mirror'
import { paletteOf, swatchItems } from './state/palette'
import { urlFromPaste } from './state/dragged'
import { exportPoster, exportPosterPdf } from './state/poster'
import { subject } from './state/subject'
import { fitToBoard, goToItem, markPick, revealItems } from './state/walk'
import { hasPixels, isGradeable } from './state/kinds'

/* Which board this tab is pointed at, read from the address once on the way
 * in. Two tabs on two boards is the whole point of putting it there, and the
 * value cannot change under a running tab without a reload — so it is read
 * here rather than watched. */
/* Which project this tab of the app opened on. After that the project is
 * whatever the trail's first crumb says, because switching happens in place
 * rather than by reloading. */
const BOARD_ID = boardFromUrl() || FIRST_BOARD

/* Where you are in the tree. The last crumb is the board on screen; `card` is
 * the id of the card that opens it, on the board one step up, which is how a
 * rename made from inside a board finds its way back to the card. */
const ROOT: Crumb = { id: BOARD_ID, name: 'Untitled board', card: null }

/* How long the offer to put a deleted project back stands.
 *
 * Long enough to read the line, notice it says the wrong name and reach for
 * it; short enough that the pictures of a project you meant to delete are not
 * being held onto while you work. Ten seconds is what the file sweep already
 * waits before touching anything freshly written, and one number for "long
 * enough to change your mind" is easier to hold than two. */
const UNDO_MS = 10_000

export default function App() {
  const selection = useSelection()
  /* The command names say what they are about to act on, and what that is
     changes with the search box and the tag filter as well as the selection. */
  const query = useQuery()
  const tagFilter = useTagFilter()
  const [tab, setTab] = useState<PanelTab>('effect')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900)
  const [palette, setPalette] = useState(false)
  const [presenting, setPresenting] = useState(false)
  /* Two, three or four things held up against each other. */
  const [comparing, setComparing] = useState(false)
  /* Asking for a picture that does not exist yet. */
  const [drawSheet, setDrawSheet] = useState(false)
  const [drawBusy, setDrawBusy] = useState(false)
  /* Letting Claude at the board. */
  const [relaySheet, setRelaySheet] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  /* Bumped whenever the list of projects could have changed under the strip:
     a rename, a board made from a card, an import, a deletion. */
  const [boardRev, setBoardRev] = useState(0)
  const [presentAt, setPresentAt] = useState<string | undefined>(undefined)
  const [mirror, setMirror] = useState<MirrorState>(mirrorState)
  /* Read out by anything reading the page aloud when the selection moves. */
  const [spoken, setSpoken] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  /* The line along the bottom. */
  const [busy, setBusy] = useState<{ text: string } | null>(null)
  /* And a way back out of something that has just been done, which outlives
   * the sentence announcing it.
   *
   * Kept apart from the message on purpose. The two are on the same line, but
   * a message is a thing said once and an offer is a thing that stands for a
   * few seconds — and the first version folded them together, so the next
   * message along took the Undo away while the undo itself was still perfectly
   * possible. Anything else the app has to say is more urgent than the offer's
   * own wording, and none of it is a reason to withdraw the offer. */
  const [openOffer, setOpenOffer] = useState<{ text: string; label: string; run: () => void } | null>(null)
  const [name, setName] = useState('Untitled board')
  const [engineOk, setEngineOk] = useState(true)
  /* Whether the board on screen is the board on disk yet.
   *
   * The shell draws before the record has been read, so for a few hundred
   * milliseconds there is an empty board you can type into — and the read
   * finishes with store.load(), which replaces everything. Anything put down
   * in that window was silently wiped a moment later. Ignoring a keystroke is
   * a poor thing to do; losing a card is a worse one. */
  const [booted, setBooted] = useState(false)
  /* Read by callbacks that are built once and must not be rebuilt on boot. */
  const bootedRef = useRef(false)
  const [path, setPath] = useState<Crumb[]>([ROOT])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const importRef = useRef<HTMLInputElement | null>(null)
  /* Read by callbacks that must not be rebuilt every time the path changes. */
  const pathRef = useRef(path)
  pathRef.current = path
  /* The same, for the name in the bar: closing the project you are in has to
   * be able to say which one it is about to destroy. */
  const nameRef = useRef(name)
  nameRef.current = name
  /* How many projects there are, reported by the row rather than counted
   * again here — it has just read the list to draw itself. Only the command
   * list asks, and only to know whether switching is worth offering. */
  const [projectCount, setProjectCount] = useState(1)

  /* ---------- autosave ---------- */
  /* Set up before boot so that leaving a board can force the pending write out
   * first. Switching boards replaces everything in the store, so a debounced
   * save that fired afterwards would write the new board's items under the old
   * board's name. */
  const saveNow = useRef<() => Promise<void>>(async () => {})
  /* Set while there are edits the debounce has not written yet, so a message
     from another tab knows whether reloading would cost anything. */
  const unsaved = useRef(false)
  /* While this stands, nothing is written: another tab has a newer version of
     this board and overwriting it would be the very thing this is here to
     prevent. It is the person's decision which one wins. */
  /* How many cards are waiting to be put on a board, so the command list can
     say so rather than offering an empty paste. */
  const [clippedCount, setClippedCount] = useState(0)
  const [clash, setClash] = useState(false)
  const clashRef = useRef(false)
  clashRef.current = clash

  useEffect(() => {
    let t: number | null = null
    const write = async () => {
      if (clashRef.current) return
      const b: BoardModel = store.toBoard()
      /* Somebody else wrote this board while we had it open. Writing now would
         throw their work away, so it does not happen. */
      const stored = await getBoard(b.id)
      if (changedElsewhere(b.id, stored?.updated)) {
        setClash(true)
        return
      }
      invalidateSummary(b.id)
      await putBoard({ id: b.id, name: b.name, updated: b.updated, items: b.items, view: b.view })
      unsaved.current = false
      /* And tell the other tabs, so the one that is only looking picks this up
         rather than sitting on a stale copy it will later write back. */
      announceSaved(b.id, b.updated)
    }
    saveNow.current = async () => {
      if (t) {
        clearTimeout(t)
        t = null
      }
      await write()
    }
    store.onDirty = () => {
      unsaved.current = true
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
      /* An address kept from a project since deleted, or typed by hand — and
       * the bare address too, now that the first board can be closed like any
       * other. Landing on a project that is really there beats opening an
       * empty board under a name nobody recognises, and beats a tab row in
       * which none of the tabs is the one you are looking at.
       *
       * On a genuine first visit nothing exists yet and the list stands the
       * original board in for the empty case, so this finds it already pointed
       * where it is and carries on rather than bouncing. */
      if (!(await boardExists(BOARD_ID))) {
        const first = (await listRoots())[0]
        if (first && first.id !== BOARD_ID) {
          window.location.replace(urlForBoard(first.id))
          return
        }
        /* A first visit, then. The board is written out now, empty, so that
         * the project you are standing in is a record like every other one.
         * Left unwritten it is missing from the row until the first thing is
         * put on it — and making a second project would look exactly like the
         * first one being closed. */
        await putBoard(emptyBoard(BOARD_ID, 'Untitled board'))
      }

      let trail: Crumb[] = [ROOT]
      try {
        /* Trails used to be kept under one name, because there was one board
         * to have a trail in. Read the old one once, for anybody upgrading
         * mid-session, so they come back where they left off rather than at
         * the top of the board wondering what happened. */
        const stored =
          localStorage.getItem(trailKey(BOARD_ID)) ||
          (BOARD_ID === FIRST_BOARD ? localStorage.getItem('ideation.path') : null)
        const raw = JSON.parse(stored || 'null')
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
        markSynced(saved.id, saved.updated)
        setName(saved.name)
      }
      setPath(trail)
      bootedRef.current = true
      setBooted(true)
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
    /* The version this tab has now seen of the board it is moving to, so a
       later write knows whether anyone else has been at it since. */
    markSynced(target.id, rec?.updated ?? 0)
    store.load(
      rec
        ? { id: rec.id, name: rec.name, items: rec.items as Item[], view: rec.view || { x: 0, y: 0, z: 1 }, updated: rec.updated }
        : { id: target.id, name: target.name, items: [], view: { x: 0, y: 0, z: 1 }, updated: Date.now() }
    )
    setName(store.name)
    setEditing(null)
    setPath(next)
    try {
      localStorage.setItem(trailKey(next[0].id), JSON.stringify(next))
    } catch { /* a session without storage still navigates, it just forgets */ }
    /* The address names the project, so a reload comes back to the tab you
     * were on. It names the project rather than the board on screen because
     * that is what a tab is — how deep you were inside it is remembered above,
     * and restored with it. */
    if (next[0].id !== prev[0].id) pointTabAt(next[0].id)
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
      /* Double clicking a picture is the whole world's way of saying "bigger",
         and on the one card where that matters most it used to do nothing at
         all: only a note, a label or a section had an editor to open. It shows
         it full screen instead, with the rest of the board an arrow away. */
      if (mode === 'open' && it && isGradeable(it)) {
        setPresentAt(id)
        setPresenting(true)
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
    setBusy({ text: msg })
    window.setTimeout(() => setBusy((b) => (b?.text === msg ? null : b)), ms)
  }, [])

  /* Something done, and a few seconds in which to take it back. */
  const offer = useCallback((msg: string, label: string, run: () => void, ms = 10000) => {
    const made = {
      text: msg,
      label,
      run: () => {
        setOpenOffer(null)
        setBusy(null)
        run()
      },
    }
    setBusy(null)
    setOpenOffer(made)
    window.setTimeout(() => setOpenOffer((o) => (o === made ? null : o)), ms)
  }, [])

  /* An agent asking what is on this board should be able to say "inside
     Textures" rather than naming a board id nobody recognises, and the path is
     kept here. */
  useEffect(() => {
    notePath(path.map((c) => ({ id: c.id, name: c.name })))
  }, [path])

  /* Attached again after a reload, if that is how it was left — so refreshing
     the page does not silently drop Claude out of a conversation. */
  useEffect(resumeRelay, [])

  /* Another tab wrote the board we are on.
   *
   * With nothing of our own waiting to be written, take theirs: it is strictly
   * newer, and a tab that is only looking should be looking at what is there.
   * The view is put back afterwards, because being scrolled somewhere else
   * because a second window saved is not something anybody asked for.
   *
   * With edits of our own not yet written, there is no answer that is not
   * somebody's loss, so nothing is decided here. Saving stops, both versions
   * still exist — theirs on disk, ours on screen — and the bar below asks. */
  useEffect(
    () =>
      onBoardSaved((n) => {
        if (n.board !== store.id) return
        if (unsaved.current) {
          setClash(true)
          return
        }
        void (async () => {
          const rec = await getBoard(n.board)
          if (!rec || rec.id !== store.id) return
          const view = store.peekView()
          store.load({
            id: rec.id,
            name: rec.name,
            items: rec.items as Item[],
            view,
            updated: rec.updated,
          })
          markSynced(rec.id, rec.updated)
          setName(rec.name)
          say('Brought in a change from another tab', 2600)
        })()
      }),
    [say]
  )

  /* Taking one version or the other. Reloading drops what is on screen for
     what is on disk; keeping drops the other tab's work for ours. Either way
     the person chose it, which is the whole difference. */
  const takeTheirs = useCallback(async () => {
    const rec = await getBoard(store.id)
    if (rec) {
      store.load({
        id: rec.id,
        name: rec.name,
        items: rec.items as Item[],
        view: store.peekView(),
        updated: rec.updated,
      })
      markSynced(rec.id, rec.updated)
      setName(rec.name)
    }
    unsaved.current = false
    setClash(false)
    say('This board is now the version from the other tab')
  }, [say])

  const keepMine = useCallback(async () => {
    /* Marking it seen is what lets the next write through: it is no longer
       an accident, it is the answer to the question that was asked. */
    const rec = await getBoard(store.id)
    if (rec) markSynced(rec.id, rec.updated)
    setClash(false)
    const b: BoardModel = store.toBoard()
    invalidateSummary(b.id)
    await putBoard({ id: b.id, name: b.name, updated: b.updated, items: b.items, view: b.view })
    unsaved.current = false
    announceSaved(b.id, b.updated)
    say('Kept this version, and the other tab has it now')
  }, [say])

  /* The deciding itself. Two is the usual number and four is the most that can
     be looked at honestly at once; past that what you want is the board. */
  const compare = useCallback(() => {
    if (store.getSelection().length < 2) {
      say('Pick out two or more things to hold up against each other')
      return
    }
    setComparing(true)
  }, [say])

  /* Curating ends in gathering: what survived, in a place of its own with a
     name on it, so it can be looked at, presented and handed over as a set
     rather than as six cards scattered among thirty-four. */
  const gather = useCallback(() => {
    const sel = store.getSelection()
    if (sel.length < 2) {
      say('Pick out more than one thing to put together')
      return
    }
    const made = store.gather(sel, 'Shortlist')
    if (!made) {
      say('Nothing there can be gathered')
      return
    }
    store.select([made])
    if (!fitToBoard(true)) say(`Put ${sel.length} together`)
    else say(`Put ${sel.length} together, below the board`, 2600)
  }, [say])

  /* Taking cards off this board to put on another. The pictures do not move:
     a card names a blob in a store every board here shares, so what travels
     is the record. */
  const takeAway = useCallback(() => {
    const n = store.cut(store.getSelection())
    if (!n) {
      say('Pick out something to take away first')
      return
    }
    setClippedCount(n)
    say(n === 1 ? 'Taken off this board — open another and paste it' : `Took ${n} off this board — open another and paste them`, 3200)
  }, [say])

  const putHere = useCallback((at: { x: number; y: number }) => {
    const waiting = store.clipped()
    if (!waiting.length) return false
    /* A board cannot be put inside itself, and the trail is what says which
       boards this one is already inside. */
    const inside = waiting.find((i) => i.kind === 'board' && i.board && pathRef.current.some((c) => c.id === i.board))
    if (inside) {
      say(`${inside.name || 'That board'} is one of the boards you are inside — it cannot go in itself`, 4000)
      return true
    }
    const made = store.paste(at)
    if (!made.length) return false
    store.select(made)
    setClippedCount(0)
    say(made.length === 1 ? 'Put it here' : `Put ${made.length} here`)
    return true
  }, [say])

  /* A search found something inside a board you are not on: open that board,
     then put the view on the card rather than leaving it wherever that board
     was last left. The board has to finish loading and the card has to have
     been laid out before the view can be worked out from it, so the move waits
     a frame. */
  const goTo = useCallback(async (to: Crumb[], itemId: string) => {
    await openBoard(to)
    requestAnimationFrame(() => {
      if (!goToItem(itemId)) store.select([itemId])
      say(`Found in ${to[to.length - 1]?.name || 'that board'}`)
    })
  }, [openBoard, say])

  /* The board you are on and everything nested inside it, with its media, as
   * one file. The pending save is forced out first so what leaves is what is
   * on screen rather than what was there a moment ago. */
  const exportBoard = useCallback(async () => {
    setBusy({ text: 'Packing the board…' })
    try {
      await saveNow.current()
      const out = await exportTree(store.id)
      download(out.blob, out.name)
      const bits = [out.boards === 1 ? '1 board' : `${out.boards} boards`]
      if (out.media) bits.push(out.media === 1 ? '1 file' : `${out.media} files`)
      setBusy({ text: `Exported ${bits.join(' and ')}` })
      window.setTimeout(() => setBusy(null), 2200)
    } catch (err) {
      setBusy({ text: err instanceof Error ? err.message : 'The board could not be exported' })
      window.setTimeout(() => setBusy(null), 3200)
    }
  }, [])

  /* The board as something you can send somebody.
   *
   * The zip above is a backup: it holds everything and it is also useless to
   * anyone without this app. This is one HTML file that opens in any browser,
   * with every picture inside it and the boards inside it reachable — which is
   * the difference between keeping a board and handing one over. */
  const exportHtml = useCallback(async () => {
    setBusy({ text: 'Baking the pictures…' })
    try {
      await saveNow.current()
      const out = await exportPage(store.id, {
        onProgress: (done, total) => {
          if (total > 1) setBusy({ text: `Baking board ${done} of ${total}…` })
        },
      })
      download(out.blob, out.name)
      const bits = [out.cards === 1 ? '1 card' : `${out.cards} cards`]
      if (out.boards > 1) bits.push(`${out.boards} boards`)
      setBusy({ text: `Exported ${out.name} — ${bits.join(', ')}, ${saySize(out.bytes)}` })
      window.setTimeout(() => setBusy(null), 4200)
    } catch (err) {
      setBusy({ text: err instanceof Error ? err.message : 'The page could not be made' })
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
      setBusy({ text: 'Select a picture or a video to export' })
      window.setTimeout(() => setBusy(null), 2200)
      return
    }
    setBusy({ text: shootable.length > 1 ? `Rendering ${shootable.length} pictures…` : 'Rendering…' })
    try {
      const made = await exportCards(shootable)
      if (!made.length) {
        setBusy({ text: 'Nothing there could be exported' })
        window.setTimeout(() => setBusy(null), 2600)
        return
      }
      if (made.length === 1) {
        download(made[0].blob, made[0].name)
        setBusy({ text: `Exported ${made[0].name} at ${made[0].w}×${made[0].h}` })
      } else {
        const bundle = await zip(made.map((m) => ({ name: m.name, blob: m.blob })))
        download(bundle, `${safeName(store.name || 'board')}-pictures.zip`)
        setBusy({ text: `Exported ${made.length} pictures` })
      }
      const missed = shootable.length - made.length
      if (missed > 0) setBusy({ text: `Exported ${made.length}, ${missed} could not be read` })
      window.setTimeout(() => setBusy(null), 2600)
    } catch (err) {
      setBusy({ text: err instanceof Error ? err.message : 'That could not be exported' })
      window.setTimeout(() => setBusy(null), 3200)
    }
  }, [])

  /* The board itself, flat, in one file that opens anywhere. What counts as
   * "the board" is one question answered in one place — see state/subject.ts —
   * so this and Present and the command names never disagree about it. */
  const exportSheet = useCallback(async (as: 'png' | 'pdf') => {
    const what = subject()
    const items = what.items
    if (!items.length) {
      setBusy({ text: 'Nothing on this board yet' })
      window.setTimeout(() => setBusy(null), 2200)
      return
    }
    setBusy({ text: as === 'pdf' ? 'Laying out the page…' : 'Painting the board…' })
    try {
      const info = { name: store.name, of: what.why === 'board' ? undefined : what.total }
      const made = as === 'pdf' ? await exportPosterPdf(items, info) : await exportPoster(items, info)
      if (!made) {
        setBusy({ text: 'That could not be exported' })
        window.setTimeout(() => setBusy(null), 2600)
        return
      }
      download(made.blob, made.name)
      setBusy({ text: `Exported ${made.name}${made.note ? `, ${made.note}` : ` at ${made.w}×${made.h}`}` })
      window.setTimeout(() => setBusy(null), 2800)
    } catch (err) {
      setBusy({ text: err instanceof Error ? err.message : 'That could not be exported' })
      window.setTimeout(() => setBusy(null), 3200)
    }
  }, [])

  /* An imported board arrives as a board card on the board you are on, rather
   * than replacing anything: nothing is lost, and the same file can be brought
   * in twice as two separate boards. */
  const importBoard = useCallback(async (file: Blob, at: { x: number; y: number }) => {
    setBusy({ text: 'Reading the board…' })
    try {
      const out = await importTree(file, at)
      store.add(out.card)
      store.select([out.card.id])
      const bits = [out.boards === 1 ? '1 board' : `${out.boards} boards`]
      if (out.media) bits.push(out.media === 1 ? '1 file' : `${out.media} files`)
      setBusy({ text: `Imported ${bits.join(' and ')}` })
      window.setTimeout(() => setBusy(null), 2200)
      return true
    } catch (err) {
      setBusy({ text: err instanceof Error ? err.message : 'That file could not be read' })
      window.setTimeout(() => setBusy(null), 3200)
      return false
    }
  }, [])

  const onDropFiles = useCallback(async (files: FileList | File[], at: { x: number; y: number }) => {
    let list = Array.from(files)
    if (!list.length) return
    /* Dropped onto a board that has not finished opening. The read that is
     * still in flight ends by replacing everything in the store, so these
     * would arrive, be seen, and be gone a moment later — twenty photographs
     * and no sign they were ever there. Refusing and saying so is the only
     * honest answer while that is true. */
    if (!bootedRef.current) {
      say('One moment — still opening this board. Drop them again.', 3000)
      return
    }
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

    setBusy({ text: `Adding ${list.length} file${list.length > 1 ? 's' : ''}…` })
    let n = 0
    const made: Item[] = []
    const r = document.querySelector('.viewport')?.getBoundingClientRect()
    /* Items appear one at a time as they become ready rather than all at the
     * end, so a large drop feels immediate. */
    for await (const item of ingest(list, at, dropColumns(list.length, r?.width, r?.height))) {
      store.add(item)
      made.push(item)
      n++
      setBusy(n < list.length ? { text: `Adding ${n + 1} of ${list.length}…` } : null)
    }
    /* And then the view goes to them. A drop of twenty laid eight on screen
       and twelve below the fold with nothing to say they were there, which is
       indistinguishable from a drop that half failed — I took it for a bug in
       my own code before finding they had all arrived. Nothing moves when the
       drop landed in front of you. */
    /* Not "more than one file": a card is capped at 420 across, which is wider
       than a phone, so a single photograph can land half off the edge too. The
       question is only ever whether what arrived is on screen, and that is the
       question revealItems asks — it moves nothing when the drop landed in
       front of you, whatever its size. */
    if (revealItems(made)) {
      say(made.length > 1 ? `Added ${made.length} — the board moved to show them` : 'The board moved to show it', 2400)
    } else {
      setBusy(null)
    }
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

  /* Switching projects: a new trail one crumb long, which is what a project
   * is — the top of its own tree. Everything else openBoard already does. */
  const openRoot = useCallback(
    async (id: string) => {
      if (pathRef.current[0]?.id === id && pathRef.current.length === 1) return
      const rec = await getBoard(id)
      await openBoard([{ id, name: rec?.name || 'Untitled board', card: null }])
    },
    [openBoard]
  )

  /* Renaming a project from its own tab.
   *
   * The name field in the bar does the same job for the project you are in,
   * and cannot do it for the others or on a window too narrow to hold it. This
   * goes through the record rather than the store, because the tab being
   * renamed is very often not the board that is loaded. */
  const renameRoot = useCallback(
    async (id: string, next: string) => {
      if (id === store.id) {
        store.setName(next)
        setName(next)
      } else {
        await renameBoard(id, next)
      }
      setBoardRev((n) => n + 1)
    },
    []
  )

  /* Putting a project back, while the offer to do so still stands.
   *
   * The records go back under their own ids, so the tab returns to its own
   * place in the row rather than to the end of it, and any link anybody kept
   * to it still works. The summaries have to be told, or search would go on
   * answering with the board as it was before it was deleted. */
  const undoDelete = useCallback(async () => {
    const back = takeBack()
    if (!back) return
    for (const b of back.boards) {
      await putBoard(b)
      invalidateSummary(b.id)
    }
    setBoardRev((n) => n + 1)
    await measure()
    await openRoot(back.root)
    say(`Put "${back.name}" back`)
  }, [openRoot, say])

  /* Closing a project is deleting it. There is no file behind a board and no
   * undo across boards, so this is the one place in the app that destroys work
   * outright — which is why it says what it is about to take, and why the
   * files behind it are swept immediately afterwards rather than left. */
  const closeRoot = useCallback(
    async (id: string, name: string) => {
      const { boards, cards } = await weighBoard(id)
      const what = `${cards} card${cards === 1 ? '' : 's'}${boards > 1 ? `, and ${boards - 1} board${boards === 2 ? '' : 's'} inside it` : ''}`
      if (!window.confirm(`Delete "${name}" and everything in it?\n\n${what}. This cannot be undone.`)) return

      const leaving = pathRef.current[0]?.id === id
      /* Somewhere to land before the ground goes. A project you are not in can
       * be deleted without moving; the one you are in cannot. */
      let landOn = ''
      if (leaving) {
        const others = (await listRoots()).filter((r) => r.id !== id)
        landOn = others[0]?.id || (await newRoot())
        await openBoard([{ id: landOn, name: 'Untitled board', card: null }])
      }
      /* The records, before they go, so the offer below has something to put
       * back. They are the same objects that were on disk, ids and all, so an
       * undo restores the project rather than making a copy of it. */
      const held = await boardTree(id)

      for (const gone of await deleteBoardTree(id)) store.forgetHistory(gone)
      try {
        localStorage.removeItem(trailKey(id))
      } catch { /* nothing to forget */ }
      setBoardRev((n) => n + 1)

      /* The sweep waits. Deleting the boards left their pictures referenced by
       * nothing, which is exactly what a sweep collects — and collecting them
       * now would mean undo brought back a project of empty frames. */
      holdDeleted(held, id, name, UNDO_MS, () => {
        void (async () => {
          const got = await sweep({ live: store.all(), held: [...store.clipped(), ...heldItems()] })
          await measure()
          if (got.files) say(describeSweep(got), 3000)
        })()
      })

      offer(`Deleted "${name}"`, 'Undo', () => void undoDelete(), UNDO_MS)
    },
    [openBoard, offer, say, undoDelete]
  )

  /* Round the row, wrapping. With two projects — which is most of the time —
   * one key gets you to the other and the same key gets you back. */
  const stepProject = useCallback(
    async (by: number) => {
      const row = tabOrder(await listRoots())
      if (row.length < 2) return
      const i = row.findIndex((r) => r.id === pathRef.current[0]?.id)
      await openRoot(row[(((i < 0 ? 0 : i) + by) % row.length + row.length) % row.length].id)
    },
    [openRoot]
  )

  /* Making one from the command list, which unlike the + in the row has no
   * button to disable while it is being made. */
  const newProject = useCallback(async () => {
    await openRoot(await newRoot())
  }, [openRoot])

  const closeProject = useCallback(async () => {
    const id = pathRef.current[0]?.id
    if (id) await closeRoot(id, nameRef.current || 'this board')
  }, [closeRoot])

  /* Ask for a picture, and report what came back.
   *
   * The sheet closes first, so that the cards it puts down are visible while
   * they fill in rather than hidden behind the thing that asked for them. */
  const onDraw = useCallback(
    (prompt: string, count: number, aspect: string, from: string[] = []) => {
      setDrawSheet(false)
      setDrawBusy(true)
      const at = centreOfView()
      const n = from.length
      say(n ? `Working from ${n === 1 ? 'that picture' : `${n} pictures`}…` : count > 1 ? `Drawing ${count}…` : 'Drawing…', 120000)
      /* Read once, not once per picture asked for: four variations of one
         reference should send that reference four times, not encode it four
         times. */
      void picturesFrom(from)
        .then((refs) => drawMany(at, prompt, count, { aspect, refs }))
        .then((made) => {
        setDrawBusy(false)
        const ok = made.filter((m) => m.ok).length
        /* Every one of them failed the same way, nearly always: one sentence
           about the key or the model, not four copies of it. */
        const bad = made.find((m) => m.error)
        if (ok) say(ok === made.length ? (ok === 1 ? 'Drew it' : `Drew ${ok}`) : `Drew ${ok} of ${made.length}`)
        else say(bad?.error || 'Nothing came back', 6000)
      })
    },
    [centreOfView, say]
  )

  /* Getting the room back.
   *
   * The live board and the cut clipboard are handed over because neither is on
   * disk: the board on screen may hold cards not yet written, and cards taken
   * away with Cut are on no board at all until they are put down. Sweeping
   * without them would delete pictures somebody is still using.
   *
   * A project deleted a moment ago is the third of those. Its boards are off
   * disk and its pictures are referenced by nothing, and for as long as the
   * offer to put it back stands they are spoken for — otherwise asking for the
   * room back during those few seconds would quietly turn the undo into a
   * project of empty frames. */
  const reclaim = useCallback(async () => {
    say('Looking for files nothing uses…', 30000)
    const got = await sweep({ live: store.all(), held: [...store.clipped(), ...heldItems()] })
    await measure()
    say(describeSweep(got), got.files ? 4000 : 2600)
  }, [say])

  /* Deleting a board is not the same as deleting the card that stands for one:
     a board card can be cut from here and put down somewhere else, and the
     board has to survive that. So this is its own thing, and it says what it
     is about to destroy before it does. */
  const deleteBoard = useCallback(async () => {
    const sel = store.getSelection().map((id) => store.getItem(id)).filter((it) => it?.kind === 'board' && it.board)
    const card = sel[0]
    if (!card?.board) {
      say('Pick out a board card first — this deletes the board it opens')
      return
    }
    const { boards, cards } = await weighBoard(card.board)
    const what = `${cards} card${cards === 1 ? '' : 's'}${boards > 1 ? `, and ${boards - 1} board${boards === 2 ? '' : 's'} inside it` : ''}`
    if (!window.confirm(`Delete "${card.name || 'that board'}" and everything in it?\n\n${what}. This cannot be undone.`)) return
    for (const gone of await deleteBoardTree(card.board)) store.forgetHistory(gone)
    store.remove([card.id])
    const got = await sweep({ live: store.all(), held: [...store.clipped(), ...heldItems()] })
    await measure()
    say(got.files ? `Deleted the board. ${describeSweep(got)}` : 'Deleted the board', 4000)
  }, [say])

  /* The pictures picked out on the board, offered to the sheet as things it
     could work from. Only ones that have a picture: a note has nothing to
     show a model. */
  const working = useMemo(
    () =>
      selection
        .map((id) => store.getItem(id))
        .filter((it): it is Item => !!it && it.kind === 'image' && !!it.media)
        .map((it) => ({ id: it.id, media: it.media, name: it.name || 'Picture' })),
    [selection]
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
        draw: () => setDrawSheet(true),
        connectClaude: () => setRelaySheet(true),
        reclaim: () => void reclaim(),
        deleteBoard: () => void deleteBoard(),
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
        fit: (onlySelection) => {
          if (!fitToBoard(onlySelection)) say(onlySelection ? 'Nothing selected to fit' : 'Nothing on this board yet')
        },
        say,
        exportPoster: (as) => void exportSheet(as),
        gather,
        compare,
        takeAway,
        putHere: () => void putHere(centreOfView()),
        clipped: clippedCount,
        help: () => setHelpOpen(true),
        exportHtml: () => void exportHtml(),
        newProject: () => void newProject(),
        stepProject: (by) => void stepProject(by),
        closeProject: () => void closeProject(),
        projects: projectCount,
      }),
    [
      selection, query, tagFilter, panelOpen, mirror, centreOfView, addBoard, askForLink,
      exportBoard, exportPictures, exportSheet, pullColours, keepInFolder, copyToFolder,
      gather, compare, takeAway, putHere, clippedCount, reclaim, deleteBoard,
      newProject, stepProject, closeProject, projectCount, exportHtml,
    ]
  )

  /* ---------- keyboard ---------- */
  useShortcuts({
    ready: booted,
    centreOfView,
    addBoard: (at) => void addBoard(at),
    askForLink,
    draw: () => setDrawSheet(true),
    pickFiles: () => fileRef.current?.click(),
    importBoard: () => importRef.current?.click(),
    exportBoard: () => void exportBoard(),
    exportPictures: (ids) => void exportPictures(ids),
    openItem,
    togglePanel: () => setPanelOpen((v) => !v),
    togglePalette: () => setPalette((v) => !v),
    present: () => setPresenting(true),
    help: () => setHelpOpen(true),
    say: setSpoken,
    closeEditor: () => setEditing(null),
    fit: (onlySelection) => {
      if (!fitToBoard(onlySelection)) say(onlySelection ? 'Nothing selected to fit' : 'Nothing on this board yet')
    },
    mark: (pick) => markPick(pick, say),
    takeAway,
    gather,
    compare,
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
      const at = centreOfView()
      /* Cards taken off another board come first: they are the only thing on
       * either clipboard that was put there by this app, so a paste after a
       * cut can only have meant them. */
      if (putHere(at)) return
      /* Copying a picture on a web page puts the <img> on the clipboard as
       * markup, not as an address, so the markup is read first. */
      const url = urlFromPaste(dt)
      if (url) {
        addUrl(at, url)
        return
      }
      const text = dt.getData('text/plain')?.trim()
      if (text) store.add(noteItem(at, text))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onDropFiles, centreOfView, putHere])

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
      help: () => setHelpOpen(true),
      pickFiles: (at: { x: number; y: number }) => {
        /* Remembered so the chosen files land where the menu was opened. */
        pendingAt.current = at
        fileRef.current?.click()
      },
      paste: async (at: { x: number; y: number }) => {
        /* Cards taken off another board first, for the same reason the key
         * does: they are the only thing on either clipboard this app put
         * there. */
        if (putHere(at)) return
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
    <div
      className="app"
      data-panel={panelOpen || undefined}
      /* On once the board on disk has been read in. Until then the board is an
         empty one that is about to be replaced, and nothing put on it would
         survive — so the keyboard and dropping are held until this is true,
         and saying so out here is what lets anything else know. */
      data-ready={booted || undefined}
    >
      {/* The trail is one more thing in a row that is already full, so the
          narrow-width rules that make room for it only apply while it is
          there. */}
      <TopBar
        path={path}
        name={name}
        onName={setName}
        onOpenBoard={(to) => void openBoard(to)}
        onGoTo={(to, itemId) => void goTo(to, itemId)}
        panelOpen={panelOpen}
        onPanel={() => setPanelOpen((v) => !v)}
        onCommands={() => setPalette(true)}
        onAddFiles={() => fileRef.current?.click()}
        onNote={() => store.add(noteItem(centreOfView()))}
        onLabel={() => store.add(labelItem(centreOfView()))}
        onSection={() => store.add(sectionItem(centreOfView()))}
        onBoard={() => void addBoard(centreOfView())}
        onLink={() => askForLink()}
        onDraw={() => setDrawSheet(true)}
        onImport={() => importRef.current?.click()}
        onExport={() => void exportBoard()}
        onHelp={() => setHelpOpen(true)}
      />

      <BoardTabs
        current={path[0].id}
        /* The tab you are in shows what you are typing in the name field,
           without waiting for the save and the re-read — but only while the
           field is naming the project. One board down it names that board,
           and a tab that renamed itself to whatever you had walked into would
           be saying the wrong thing about where you are. */
        currentName={path.length === 1 ? name : undefined}
        onCount={setProjectCount}
        onOpen={(id) => void openRoot(id)}
        onNew={(id) => void openRoot(id)}
        onClose={(id, name) => void closeRoot(id, name)}
        onRename={(id, next) => void renameRoot(id, next)}
        /* Bumped when a project is made, deleted or imported. Renames do not
           need it: the tab you are in is told the name directly. */
        revision={boardRev}
      />

      {/* Named as what the row of tabs is showing. The board inside keeps its
          own role: this says which project you are looking at, and that one
          says how to work it. */}
      <main
        className="main"
        id={BOARD_PANEL}
        role="tabpanel"
        aria-label={`${name || 'Untitled board'}, project`}
      >
        <Board
          onDropFiles={onDropFiles}
          onOpenEditor={openItem}
          onExportPictures={exportPictures}
          onPullColours={(ids) => void pullColours(ids)}
        onGather={gather}
        onTakeAway={takeAway}
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

      <SpaceAlarm onExport={() => void exportBoard()} onFolder={() => void keepInFolder()} onReclaim={() => void reclaim()} />
      {clash && (
        <TabClash
          onTakeTheirs={() => void takeTheirs()}
          onKeepMine={() => void keepMine()}
          onExport={() => void exportBoard()}
        />
      )}
      {drawSheet && (
        <GenerateSheet onClose={() => setDrawSheet(false)} onDraw={onDraw} working={working} busy={drawBusy} />
      )}
      {relaySheet && <RelaySheet onClose={() => setRelaySheet(false)} />}
      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
      {comparing && (
        <Compare ids={selection} onClose={() => setComparing(false)} say={say} />
      )}
      {presenting && (
        <Present
          ids={subject().items.map((i) => i.id)}
          startAt={presentAt}
          onClose={() => {
            setPresenting(false)
            setPresentAt(undefined)
          }}
        />
      )}
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {editing && <NoteEditor id={editing} onClose={() => setEditing(null)} />}
      {/* One line, whether it is carrying a message, an offer, or a message
          that arrived while an offer was standing. */}
      {(busy || openOffer) && (
        <div className="toast">
          <span>{busy?.text || openOffer?.text}</span>
          {openOffer && (
            <button className="toast-undo" onClick={openOffer.run}>
              {openOffer.label}
            </button>
          )}
        </div>
      )}
      {!engineOk && (
        <div className="toast warn">
          This browser cannot run the GPU effects engine. Images and adjustments still work.
        </div>
      )}
      <Stats count={selection.length} />
      <UpdateBar />
      {/* Off screen, and the only thing on the page that speaks. A selection
          moving is invisible to a screen reader otherwise: the cards are divs
          on a canvas, and nothing about a border changing colour is announced. */}
      <p className="said" role="status" aria-live="polite">
        {spoken}
      </p>
    </div>
  )
}
