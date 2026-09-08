import { useEffect, useRef, useState } from 'react'

/* ---------------------------------------------------------------------------
 * Things that cover the board.
 *
 * Seven of them: the help, the two sheets that ask for something, the note
 * editor, the command list, the show and the comparison. Every one covers the
 * whole window, takes the keyboard off the board and has to be got out of
 * before anything else can happen — which is what a dialog is. None of them
 * behaved like one.
 *
 * Three things were missing, and all three matter most to the person least
 * able to work around them.
 *
 * The focus stayed on the board underneath. Tab from an open sheet walked out
 * of it and off down a toolbar that was covered up, so a keyboard user was
 * driving something they could not see, and a screen reader was reading a
 * board that was no longer the subject.
 *
 * Nothing said what the thing was. A `<div>` over the window is a div: the
 * reader announced no change at all, which is why `role` and `aria-modal` go
 * on together — the role names it, and the modal flag is what tells a reader
 * to stop offering everything behind it.
 *
 * And the focus never came back. Closing a sheet dropped the focus on the body
 * and the next Tab started again from the top of the page, which on a board
 * with a toolbar of fourteen buttons is a long way from where you were.
 *
 * The trap is a keydown on the box rather than on the window, so it applies to
 * exactly what is inside it and nothing has to be undone when a second one
 * opens over the first.
 * ------------------------------------------------------------------------- */

/* Everything that can hold the focus. Deliberately not a general solution:
 * these seven contain buttons, links, fields and the odd list, and a rule that
 * covers those is a rule that can be read.
 *
 * The `-1` is spelled out on every one of them rather than only on the last.
 * A button taken out of the tab order on purpose — the command list's rows,
 * which are named by the field above them instead — is still a button, so a
 * rule that only excluded `[tabindex="-1"]` as its own clause would count
 * forty places to go where there is one, and hand the focus out of the box
 * looking for the fortieth. */
const NOT_HELD = ':not([tabindex="-1"])'
const REACHABLE = [
  `a[href]${NOT_HELD}`,
  `button:not([disabled])${NOT_HELD}`,
  `input:not([disabled])${NOT_HELD}`,
  `select:not([disabled])${NOT_HELD}`,
  `textarea:not([disabled])${NOT_HELD}`,
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/* A control in a tab that is not the tab being shown is still in the document.
 * Anything with no box at all is not somewhere the focus can usefully go. */
const shown = (el: HTMLElement) => el.getClientRects().length > 0

/* `onClose` is optional only because a couple of these are closed by their own
 * rules. Where it is given, Escape works from anywhere inside rather than only
 * from whichever field happened to be listening — which is how the command
 * list used to behave: Tab once and Escape stopped closing it. */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose?: () => void) {
  const ref = useRef<T>(null)
  /* So the listener always calls the current one without being torn down and
   * rebuilt, which would move the focus again on every render. */
  const shut = useRef(onClose)
  shut.current = onClose

  /* Whoever had the focus when this opened — usually the button that opened
   * it, sometimes nothing at all if it was opened with a key.
   *
   * Read on the first render rather than in the effect below, because a field
   * marked to take the focus takes it when the box is put on the page, which
   * is before any effect runs. Asking afterwards found the command list's own
   * search box and dutifully handed the focus back to it as it was being
   * thrown away, which is the same as handing it back to nothing. */
  const [came] = useState(() => document.activeElement as HTMLElement | null)

  useEffect(() => {
    const box = ref.current
    if (!box) return

    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    /* So the box can hold the focus itself: while nothing inside it has been
     * reached yet, and for one with nothing focusable in it at all. */
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1')

    /* Something inside may have asked for the focus already — a note's own
     * text, a search field — and where it put itself is a better answer than
     * the first button in the box. */
    if (!box.contains(document.activeElement)) {
      const first = [...box.querySelectorAll<HTMLElement>(REACHABLE)].find(shown)
      ;(first || box).focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shut.current) {
        /* Nothing behind this needs to hear it: the board would take it as
         * "select nothing", which is not what was being asked for. */
        e.stopPropagation()
        shut.current()
        return
      }
      if (e.key !== 'Tab') return
      const able = [...box.querySelectorAll<HTMLElement>(REACHABLE)].filter(shown)
      if (!able.length) {
        e.preventDefault()
        box.focus({ preventScroll: true })
        return
      }
      const first = able[0]
      const last = able[able.length - 1]
      const now = document.activeElement
      /* Only the two ends need catching. Everywhere in between, the browser's
       * own order is the right one and is left alone. Coming off the box
       * itself counts as the start, since that is where the focus sits before
       * anything inside has been reached. */
      const atStart = now === first || now === box
      if (e.shiftKey ? atStart : now === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus({ preventScroll: true })
      }
    }

    box.addEventListener('keydown', onKey)
    return () => {
      box.removeEventListener('keydown', onKey)
      /* Back where it came from, if that is still on the page: closing a sheet
       * that was opened from a card the sheet then deleted has nowhere to put
       * it, and the body is where the browser would have left it anyway. */
      if (came && came.isConnected && came !== document.body) {
        came.focus({ preventScroll: true })
      }
    }
  }, [])

  return ref
}
