import { useEffect } from 'react'
import { store } from '../state/store'
import { noteItem, labelItem, sectionItem } from '../state/ingest'
import { isSection } from '../state/kinds'
import { announce, step } from '../state/walk'
import { KEYS } from '../ui/shortcuts'

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
  centreOfView: () => { x: number; y: number }
  addBoard: (at: { x: number; y: number }) => void
  askForLink: (at: { x: number; y: number }) => void
  pickFiles: () => void
  importBoard: () => void
  exportBoard: () => void
  exportPictures: (ids: string[]) => void
  openItem: (id: string) => void
  togglePanel: () => void
  togglePalette: () => void
  present: () => void
  say: (text: string) => void
  closeEditor: () => void
}

export function useShortcuts(a: KeyActions) {
  useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
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
      store.select(store.all().filter((i) => !isSection(i)).map((i) => i.id))
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

    /* Single key shortcuts only when no modifier is held, so they cannot
     * swallow a browser or system combination. */
    if (!cmd && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      const at = a.centreOfView()
      if (k === KEYS.note.key) { e.preventDefault(); store.add(noteItem(at)); return }
      if (k === KEYS.label.key) { e.preventDefault(); store.add(labelItem(at)); return }
      if (k === KEYS.section.key) { e.preventDefault(); store.add(sectionItem(at)); return }
      if (k === KEYS.board.key) { e.preventDefault(); a.addBoard(at); return }
      if (k === KEYS.link.key) { e.preventDefault(); a.askForLink(at); return }
      if (k === KEYS.addFiles.key) { e.preventDefault(); a.pickFiles(); return }
      if (k === KEYS.effects.key) { e.preventDefault(); a.togglePanel(); return }
      if (k === KEYS.present.key) { e.preventDefault(); a.present(); return }
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
