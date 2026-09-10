import { useEffect } from 'react'
import { store } from '../state/store'
import { armTool } from '../board/tool'
import { isSection } from '../state/kinds'
import { matches, narrowed } from '../state/subject'
import { announce, step } from '../state/walk'
import { KEYS } from '../ui/shortcuts'
import { keysHeld } from '../ui/modal'
import { holdOriginal, releaseOriginal } from '../board/original'

/* Input types that words go into. A range, a checkbox or a colour swatch is an
 * <input> too, but nothing is typed into one, so it has no claim on the keys
 * the board wants. */
const TYPED = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number',
  'date', 'time', 'datetime-local', 'month', 'week',
])

function typingInto(t: HTMLElement | null): boolean {
  if (!t) return false
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true
  /* An <input> with no type at all is a text field. */
  return t.tagName === 'INPUT' && TYPED.has((t as HTMLInputElement).type || 'text')
}

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
  /* Made, picked up, and open to be written in — the same thing the rail and
     the menu do, so a note made with the keyboard is not a different note. */
  addNote: (at: { x: number; y: number }) => void
  addLabel: (at: { x: number; y: number }) => void
  addBoard: (at: { x: number; y: number }) => void
  askForLink: (at: { x: number; y: number }) => void
  draw: () => void
  writeSketch: (at: { x: number; y: number }) => void
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
  vary: () => void
  shuffle: () => void
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
    const cmd = e.metaKey || e.ctrlKey

    /* Somewhere words are being written. The keyboard is theirs, including
       ⌘Z, which in a text field means the field's own undo. */
    if (typingInto(t)) return

    /* The one key here that is held rather than pressed. A held key repeats,
       and every repeat arrives as another keydown, so starting the comparison
       twice has to be the same as starting it once. */
    if (!cmd && e.key === KEYS.original.key) {
      e.preventDefault()
      holdOriginal()
      return
    }

    if (cmd && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
      return
    }

    /* A slider or a swatch is an <input> with nothing being written into it,
       so the two above still work while one has the focus — which is the
       common case, since undo and the compare key are what you reach for
       straight after moving a slider, and having them do nothing there is
       baffling. Everything past this point is a bare letter or an arrow, and
       those the control is entitled to keep. */
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return
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
      if (k === KEYS.note.key) { e.preventDefault(); a.addNote(at); return }
      if (k === KEYS.label.key) { e.preventDefault(); a.addLabel(at); return }
      /* These two arm rather than fire. The size is the point of both of them,
         so the next drag on the board draws it — and until it does, the board
         wears the cursor for it and the rail lights the button. */
      if (k === KEYS.section.key) { e.preventDefault(); armTool('section'); return }
      if (k === KEYS.text.key) { e.preventDefault(); armTool('text'); return }
      if (k === KEYS.board.key) { e.preventDefault(); a.addBoard(at); return }
      if (k === KEYS.link.key) { e.preventDefault(); a.askForLink(at); return }
      if (k === KEYS.draw.key) { e.preventDefault(); a.draw(); return }
      if (k === KEYS.sketch.key) { e.preventDefault(); a.writeSketch(at); return }
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
      /* Twelve versions of the picture, to decide between. Pressed again on
         the batch it made, it breeds from whichever of them were kept. */
      if (k === KEYS.vary.key) { e.preventDefault(); a.vary(); return }
      /* The same dice thrown in place, for when you do not want to decide
         between twelve, you just want it to be something else. */
      if (k === KEYS.shuffle.key) { e.preventDefault(); a.shuffle(); return }
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

  /* Letting go, and every other way a hold can end without one.
   *
   * A key held down while the window loses focus never sends its keyup — the
   * window that takes the focus gets that — so a board left with the
   * comparison switched on would be a board showing none of your work with no
   * way to notice why. Blur ends it too, which is half the reason this is a
   * hold and not a toggle. */
  const onUp = (e: KeyboardEvent) => {
    if (e.key === KEYS.original.key) releaseOriginal()
  }
  const onBlur = () => releaseOriginal()

    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [a])
}
