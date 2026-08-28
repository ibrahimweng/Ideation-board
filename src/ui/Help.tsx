import { useEffect, useRef, useState } from 'react'
import { holdKeys } from './modal'
import { KEYS, MOD } from './shortcuts'

/* ---------------------------------------------------------------------------
 * How this works.
 *
 * The board explains its buttons — every one has its name and its key on a
 * tooltip, and the command list will find anything by name. What none of that
 * explains is the handful of things you cannot deduce from a button: that the
 * work is in this browser and nowhere else, that a tab is a project and
 * closing one destroys it, that effects stack, that the picture-drawing spends
 * your own money on your own key. Those are the questions somebody actually
 * arrives with, and they were answered nowhere.
 *
 * So this is a page rather than a tour. A tour is a thing you sit through once
 * and cannot go back to the middle of; this is scannable, comes up on one key,
 * and is worth opening again in a month for the one paragraph you need. The
 * keys at the end are generated from the same table the toolbar reads, so
 * there is no second list of shortcuts to fall out of step with the first.
 * ------------------------------------------------------------------------- */

interface Part {
  id: string
  title: string
  body: React.ReactNode
}

/* A key, drawn the way the tooltips draw it. */
const K = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>

function parts(): Part[] {
  return [
    {
      id: 'where',
      title: 'Where your work lives',
      body: (
        <>
          <p>
            In this browser, on this machine. There is no account, no server and nothing to sign in
            to — the pictures you drop are stored by the browser itself, and nothing you put on a
            board is sent anywhere.
          </p>
          <p>
            Which cuts both ways, and it is worth knowing which way. Nobody else can see your work,
            and it is still there with the network off. But clearing this site's data clears the
            boards with it, and a board is not on your other computer. <K>{KEYS.export.hint}</K>{' '}
            writes the whole thing — every board inside it and every file — to one{' '}
            <code>.board.zip</code> you can keep or hand to somebody, and{' '}
            <strong>Keep a copy in a folder</strong> in the command list mirrors it to a folder on
            your disk as you work.
          </p>
        </>
      ),
    },
    {
      id: 'projects',
      title: 'Projects and the row of tabs',
      body: (
        <>
          <p>
            The row under the toolbar is your projects, one tab each. <strong>+</strong> starts a
            new one and moves you into it. Clicking a tab switches — nothing reloads, and the
            address in the bar follows, so the link you copy opens the project you were looking at
            and only that one.
          </p>
          <p>
            The <strong>×</strong> on a tab deletes that project and everything in it. There is no
            undo across projects and this browser holds the only copy, so it asks first and tells
            you what it is about to take. Closing the one you are in leaves you on another.
          </p>
        </>
      ),
    },
    {
      id: 'boards',
      title: 'Boards inside boards',
      body: (
        <>
          <p>
            A project is a board, and <K>{KEYS.board.hint}</K> puts a board <em>inside</em> it as a
            card. Open it and the crumbs at the top left say how deep you are; click one to come
            back up. Nesting costs nothing — a board of a thousand cards does not slow down the
            board it sits on, because only the one you are looking at is loaded.
          </p>
          <p>
            Nothing could travel between boards, which was the annoying part.{' '}
            <K>{KEYS.takeAway.hint}</K> takes the selection off this board and{' '}
            <K>{KEYS.putHere.hint}</K> puts it on whichever board you are on when you press it.
          </p>
        </>
      ),
    },
    {
      id: 'adding',
      title: 'Getting things onto a board',
      body: (
        <>
          <p>
            Drag pictures, video, audio or files from your computer onto the board — a folder at a
            time is fine. Paste a link and it becomes a card; paste a YouTube or Vimeo link and it
            becomes something you can play. <K>{KEYS.note.hint}</K> writes a note,{' '}
            <K>{KEYS.label.hint}</K> a label, <K>{KEYS.section.hint}</K> a section to group things
            in. Drag from one card to another to draw a line between them.
          </p>
          <p>
            <K>{KEYS.draw.hint}</K> makes a picture from a description, or from pictures already on
            the board. That one needs your own Google Gemini key, which you paste in once and which
            stays in this browser — it is never sent anywhere but Google, never written into a board, and
            never included in an export. The pictures cost whatever Google charges you.
          </p>
        </>
      ),
    },
    {
      id: 'effects',
      title: 'Effects',
      body: (
        <>
          <p>
            Select a card and press <K>{KEYS.effects.hint}</K>. Thirty one effects, applied on the
            graphics card, on as many pictures as you like at once — and on video and animated GIFs
            while they are still playing.
          </p>
          <p>
            Effects stack: up to four on one card, applied in the order you added them, each with
            its own settings. <strong>Adjust</strong> is the ordinary brightness and contrast sort
            of thing, and <strong>Looks</strong> saves whatever you have set up so you can put the
            same treatment on something else later.
          </p>
        </>
      ),
    },
    {
      id: 'deciding',
      title: 'Choosing between things',
      body: (
        <>
          <p>
            What a moodboard is for. <K>{KEYS.keep.hint}</K> marks a card kept and{' '}
            <K>{KEYS.cut.hint}</K> marks it cut; the filter at the top narrows the board to one or
            the other. <K>{KEYS.compare.hint}</K> holds up to four things side by side at full
            size, and <K>{KEYS.present.hint}</K> shows the board one card at a time with nothing
            else on screen.
          </p>
          <p>
            <K>{KEYS.search.hint}</K> searches every board in the project, not just this one, and
            takes you to what it finds. <K>{KEYS.gather.hint}</K> brings a scattered selection back
            together, <K>{KEYS.fitBoard.hint}</K> fits the whole board on screen and{' '}
            <K>{KEYS.fitSelection.hint}</K> fits what you have selected.
          </p>
        </>
      ),
    },
    {
      id: 'out',
      title: 'Getting work back out',
      body: (
        <>
          <p>
            <K>{KEYS.picture.hint}</K> writes the selected pictures out as files, with their
            effects baked in at full size. <strong>Export as a poster</strong> in the command list
            lays the board out as one PNG or PDF — the thing you send somebody who does not have
            this app. <K>{KEYS.export.hint}</K> is the backup: everything, in one file,{' '}
            <K>{KEYS.import.hint}</K> reads it back.
          </p>
        </>
      ),
    },
    {
      id: 'claude',
      title: 'Letting Claude at the board',
      body: (
        <>
          <p>
            <strong>Connect Claude</strong> in the command list starts a small relay on your own
            machine. Claude talks to the relay and the relay asks this tab, which is the only thing
            that has ever known what is on your board — so an agent can read it, add cards, move
            things and draw pictures without your work leaving this browser.
          </p>
        </>
      ),
    },
    {
      id: 'offline',
      title: 'With the network off',
      body: (
        <>
          <p>
            Everything above still works, because none of it needed a network in the first place.
            The two things that do are drawing pictures and playing a video you linked to rather
            than dropped. When a new version of the app is available you are told, and it is put
            in when you say so rather than under you mid-sentence.
          </p>
        </>
      ),
    },
  ]
}

/* The keys, from the same table the toolbar and the handler read. */
const KEY_ROWS: { name: keyof typeof KEYS; what: string }[] = [
  { name: 'commands', what: 'Everything the board can do, by name' },
  { name: 'search', what: 'Search every board in this project' },
  { name: 'addFiles', what: 'Add files' },
  { name: 'note', what: 'Note' },
  { name: 'label', what: 'Label' },
  { name: 'section', what: 'Section' },
  { name: 'board', what: 'A board inside this one' },
  { name: 'link', what: 'Link, or a video URL' },
  { name: 'draw', what: 'Draw a picture from a description' },
  { name: 'effects', what: 'Effects panel' },
  { name: 'keep', what: 'Mark the selection kept' },
  { name: 'cut', what: 'Mark the selection cut' },
  { name: 'compare', what: 'Hold the selection up against each other' },
  { name: 'present', what: 'Present the board' },
  { name: 'gather', what: 'Bring the selection together' },
  { name: 'fitBoard', what: 'Fit the whole board on screen' },
  { name: 'fitSelection', what: 'Fit the selection on screen' },
  { name: 'takeAway', what: 'Take the selection off this board' },
  { name: 'putHere', what: 'Put them on this board' },
  { name: 'selectShown', what: 'Select what the search found' },
  { name: 'picture', what: 'Export the selected pictures' },
  { name: 'export', what: 'Export this project and everything in it' },
  { name: 'import', what: 'Import a board file' },
  { name: 'undo', what: 'Undo' },
  { name: 'redo', what: 'Redo' },
]

export function Help({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState('where')
  const body = useRef<HTMLDivElement | null>(null)
  const close = useRef<HTMLButtonElement | null>(null)
  const shown = parts()

  useEffect(holdKeys, [])

  /* Where the keyboard goes, and where it comes back to.
   *
   * This covers the board and takes its keys, so leaving focus behind on
   * whatever was pressed to open it means Tab walks through a board nobody can
   * see. Putting it on Close is the honest starting point — it is the way out,
   * and from it Tab reaches the sections and then the page. */
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => was?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  /* Which section you are reading, so the list on the left says where you are.
   * Watching the sections go by rather than only listening for clicks: most of
   * the moving through this is scrolling, and a list that only updates when
   * you click it is a list that is usually wrong. */
  useEffect(() => {
    const root = body.current
    if (!root) return
    const seen = new IntersectionObserver(
      (es) => {
        const top = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setAt(top.target.id.replace('help-', ''))
      },
      { root, rootMargin: '0px 0px -70% 0px' }
    )
    root.querySelectorAll('section').forEach((s) => seen.observe(s))
    return () => seen.disconnect()
  }, [])

  const goTo = (id: string) => {
    setAt(id)
    body.current?.querySelector(`#help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="sheet-veil" onPointerDown={onClose}>
      <div
        className="help"
        role="dialog"
        aria-modal="true"
        aria-label="How this works"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="help-top">
          <h2>How this works</h2>
          <button className="ghost" ref={close} onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <nav className="help-nav" aria-label="Sections">
          {shown.map((p) => (
            <button key={p.id} data-on={p.id === at || undefined} onClick={() => goTo(p.id)}>
              {p.title}
            </button>
          ))}
          <button data-on={at === 'keys' || undefined} onClick={() => goTo('keys')}>
            Every key
          </button>
        </nav>

        <div className="help-body" ref={body}>
          {shown.map((p) => (
            <section key={p.id} id={`help-${p.id}`}>
              <h3>{p.title}</h3>
              {p.body}
            </section>
          ))}

          <section id="help-keys">
            <h3>Every key</h3>
            <p>
              No modifier unless one is shown — the board's own keys are single letters, so they
              are one press rather than three. They do nothing while you are typing in a note.
            </p>
            <table className="help-keys">
              <tbody>
                {KEY_ROWS.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <kbd>{KEYS[r.name].hint}</kbd>
                    </td>
                    <td>{r.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="help-last">
              Anything without a key is in the command list, on <K>{MOD}+K</K>, which will find it
              by name and tell you the key if it has one.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
