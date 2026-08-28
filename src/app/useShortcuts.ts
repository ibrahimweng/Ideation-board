import { useEffect } from 'react'
import { store } from '../state/store'
import { noteItem, labelItem, sectionItem } from '../state/ingest'
import { isSection } from '../state/kinds'
import { matches, narrowed } from '../state/subject'
import { announce, step } from '../state/walk'
import { KEYS } from '../ui/shortcuts'
import { keysHeld } from '../ui/modal'

/* ---------------------------------------------------------------------------
 * The keyboard.
 *
 * One handler on the window, in one file, so the answer to "what does this key
 * do" is one place to look rather than a hundred lines in the middle of the
 * component that holds the app together.
 *
 * Two rules run through all of it. A key does nothing while a field has focus,
 * because a person typing a note means the letter and not the shortcut — with
 * one exception, the command list, which is how you get out of whatever you
 * are in. And a single letter only fires with no modifier held, so nothing
 * here can swallow a browser or system combination.
 * ------------------------------------------------------------------------- */

export interface KeyActions {
  /* False until the board on disk has been read into the store.
   *
   * The board draws before that read finishes, and the read ends by replacing
   * everything in the store — so a card added in between was thrown away a
   * moment later with nothing to say it had gone. A key that does nothing is
   * an annoyance; a card that appears and then vanishes is a bug nobody can
   * report. */
  ready: boolean
  centreOfView: () => { x: number; y: number }
  addBoard: (at: { x: number; y: number }) => void
  askForLink: (at: { x: number; y: number }) => void
  draw: () => void
  pickFiles: () => void
  importBoard: () => void
  exportBoard: () => void
  exportPictures: (ids: string[]) => void
  openItem: (id: string) => void
  togglePanel: () => void
  togglePalette: () => void
  present: () => void
  help: () => void
  say: (text: string) => void
  closeEditor: () => void
  fit: (onlySelection: boolean) => void
  mark: (pick: 'in' | 'out') => void
  takeAway: () => void
  gather: () => void
  compare: () => void
}

export function useShortcuts(a: KeyActions) {
  useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    /* The board is not the board yet. */
    if (!a.ready) return
    /* Something is covering the board and listening for these itself. */
    if (keysHeld()) return
    const t = e.target as HTMLElement
    /* The command list opens from anywhere, a half typed note included: it
       is how you get out of whatever you are in and do something else. */
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === KEYS.commands.key) {
      e.preventDefault()
      a.togglePalette()
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
      /* With a search running, everything means everything you can see. */
      store.select(
        narrowed()
          ? matches().filter((i) => !isSection(i)).map((i) => i.id)
          : store.all().filter((i) => !isSection(i)).map((i) => i.id)
      )
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
      a.exportBoard()
      return
    }
    if (cmd && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      a.exportPictures(store.getSelection())
      return
    }
    if (cmd && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      a.importBoard()
      return
    }
    /* Taking cards off one board to put them on another. Nothing else on the
       board answers to it, and the browser's own cut has nothing to cut when
       the focus is the canvas. */
    if (cmd && e.key.toLowerCase() === KEYS.takeAway.key) {
      e.preventDefault()
      a.takeAway()
      return
    }

    /* Single key shortcuts only when no modifier is held, so they cannot
     * swallow a browser or system combination. */
    /* Apart from the single letters below because it is a shifted key on
       nearly every layout, and because it is the one thing you want to be able
       to reach when you do not know what any of the others do. */
    if (!cmd && !e.altKey && e.key === KEYS.help.key) {
      e.preventDefault()
      a.help()
      return
    }

    if (!cmd && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      const at = a.centreOfView()
      if (k === KEYS.note.key) { e.preventDefault(); store.add(noteItem(at)); return }
      if (k === KEYS.label.key) { e.preventDefault(); store.add(labelItem(at)); return }
      if (k === KEYS.section.key) { e.preventDefault(); store.add(sectionItem(at)); return }
      if (k === KEYS.board.key) { e.preventDefault(); a.addBoard(at); return }
      if (k === KEYS.link.key) { e.preventDefault(); a.askForLink(at); return }
      if (k === KEYS.draw.key) { e.preventDefault(); a.draw(); return }
      if (k === KEYS.addFiles.key) { e.preventDefault(); a.pickFiles(); return }
      if (k === KEYS.effects.key) { e.preventDefault(); a.togglePanel(); return }
      if (k === KEYS.present.key) { e.preventDefault(); a.present(); return }
      if (k === KEYS.fitBoard.key) { e.preventDefault(); a.fit(false); return }
      if (k === KEYS.fitSelection.key) { e.preventDefault(); a.fit(true); return }
      /* A board only ever grew. These two are how it resolves: the keeper
         wears a tick, the reject fades back, and either mark comes straight
         off again by pressing the same key. */
      if (k === KEYS.keep.key) { e.preventDefault(); a.mark('in'); return }
      if (k === KEYS.cut.key) { e.preventDefault(); a.mark('out'); return }
      /* The last step of curating: what survived, in one place. */
      if (k === KEYS.gather.key) { e.preventDefault(); a.gather(); return }
      /* And the deciding itself, which is nearly always between two things. */
      if (k === KEYS.compare.key) { e.preventDefault(); a.compare(); return }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      store.remove(store.getSelection())
      return
    }
    if (e.key === 'Escape') {
      store.clearSel()
      a.closeEditor()
      return
    }
    /* Tab walks the board in reading order and brings what it lands on into
       view. It is the only way to reach a card without a pointer, which
       until now meant the whole of the app behind a selection — the effects,
       the looks, the export, the menu — could not be reached at all. */
    if (e.key === 'Tab') {
      e.preventDefault()
      const item = step(e.shiftKey ? -1 : 1)
      a.say(announce(item))
      return
    }
    if (e.key === 'Enter' && !cmd) {
      const sel = store.getSelection()
      const it = sel.length === 1 ? store.getItem(sel[0]) : null
      if (it) {
        e.preventDefault()
        a.openItem(it.id)
      }
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
  }, [a])
}
