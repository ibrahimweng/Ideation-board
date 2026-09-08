import { useEffect, useRef, useState } from 'react'
import { holdKeys } from './modal'
import { useDialog } from './dialog'
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
            <code>.board.zip</code> you can keep, and <strong>Keep a copy in a folder</strong> in
            the command list mirrors it to a folder on your disk as you work.
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
            The <strong>×</strong> on a tab deletes that project and everything in it. This browser
            holds the only copy, so it asks first and tells you what it is about to take — and for
            about ten seconds afterwards the line along the bottom offers it back, whole, in the
            same place in the row. Closing the one you are in leaves you on another.
          </p>
          <p>
            Double-click a tab to rename it, or press <K>F2</K> when it has the keyboard. The
            arrow keys walk along the row and <K>Enter</K> opens the one you have walked to.
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
            Drag pictures, video, audio, PDFs, Photoshop or Illustrator files, 3D models or
            anything else from your computer onto the board — a folder at a time is fine. Paste a link and it becomes a card; paste a YouTube or Vimeo link and it
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
            Select a card and press <K>{KEYS.effects.hint}</K>. Sixty four effects, applied on the
            graphics card, on as many pictures as you like at once — and on video and animated GIFs
            while they are still playing.
          </p>
          <p>
            Effects stack: up to four on one card, applied in the order you added them, each with
            its own settings. <strong>Adjust</strong> is the ordinary brightness and contrast sort
            of thing, and <strong>Looks</strong> saves whatever you have set up so you can put the
            same treatment on something else later.
          </p>
          <p>
            Every figure in the panel can be typed into as well as dragged, and double-clicking a
            slider puts it back where it started. Hold <K>{KEYS.original.hint}</K> at any point to
            see the selection without any of it — the whole board, if nothing is selected — and let
            go to bring it back.
          </p>
          <p>
            A card crops what is on it. Hold <K>Alt</K> and drag a picture to push it around inside
            its card, or <K>Alt</K> and scroll to scale it — the same two numbers the Frame sliders
            write, done by hand. Framing belongs to the one photograph, so it is the one thing a
            saved look never carries.
          </p>
          <p>
            <K>{KEYS.vary.hint}</K> on a picture puts twelve versions of it underneath — a different
            effect on each, and a tone to go with it. Mark the ones worth keeping with{' '}
            <K>{KEYS.keep.hint}</K> and press <K>{KEYS.vary.hint}</K> again: the ones you did not mark
            are replaced by twelve bred from the ones you did. Press it on a single version to go
            further into that one. The whole round is one press of undo, and{' '}
            <K>{KEYS.original.hint}</K> shows all twelve as the picture they started from.
          </p>
          <p>
            Every effect in the stack carries a <strong>×1</strong> beside its name. Press it and
            the effect runs again on what it drew — a kaleidoscope that recurses, a warp that
            spirals, a blur that blooms. It is a count rather than something that keeps going,
            because a card has to look the same next time you open it.
          </p>
          <p>
            Three effects read <em>two</em> pictures — <strong>Displace</strong>,{' '}
            <strong>Stencil</strong> and <strong>Through</strong>. Drag a line from one card to
            another and the card at the start of the line is the second picture: a texture pushed
            through a photograph, a photograph knocked out of a shape, a palette taken off one image
            and put onto another. With no line drawn they read the card itself, which is a real
            effect rather than an error.
          </p>
          <p>
            <strong>Layer</strong> is about two cards rather than one: an opacity, and how a card
            mixes with whatever it is sitting on. Lay a texture over a photograph on multiply, hold
            a scan at a quarter strength over the thing you are comparing it with, knock a wordmark
            out of a colour field. A card over the empty board is untouched by it, so a mode set
            once goes on meaning the same thing wherever you move the card to.
          </p>
        </>
      ),
    },
    {
      id: 'sound',
      title: 'Sound',
      body: (
        <>
          <p>
            A sound card draws its own waveform and plays. Select one and the panel becomes a{' '}
            <strong>Sound</strong> panel: thirteen effects in a chain of up to four — speed, reverse,
            trim, wow and flutter, filter, drive, bit crush, ring mod, delay, reverb, chorus, tremolo
            and a gate. It is rendered rather than played through, so the card keeps the treatment
            when you come back to it, the waveform on the card is the treated sound, and you can
            take it out of the board.
          </p>
          <p>
            The file you dropped is never written over. <strong>Back to the original</strong> puts
            the card back on it, because it was there the whole time.{' '}
            <strong>Export the selected sound</strong> in the command list hands you what the card
            plays, as a WAV.
          </p>
        </>
      ),
    },
    {
      id: 'sketches',
      title: 'Cards you write',
      body: (
        <>
          <p>
            <K>{KEYS.sketch.hint}</K> makes a card whose picture is drawn by a dozen lines of
            code, with eight starting points to work from — a grid you can shake, a flow field, a
            pattern of tiles, a colour field. Change a number, press <strong>Run</strong>. Press{' '}
            <strong>Roll again</strong> and you get another one from the same code, which is the
            whole point of the thing: a sketch is not a picture, it is a way of making a hundred.
          </p>
          <p>
            The code is handed a canvas, the size, a seeded random, and — if you wire another card
            into it — that card&rsquo;s picture, so a sketch can read a photograph and become
            another way to treat one. It runs on its own, away from the board, and is stopped after
            a few seconds: a loop with no end in it costs you a card rather than the tab. What it
            draws is a picture like any other, so it takes the effects, exports, and can be varied
            twelve ways.
          </p>
        </>
      ),
    },
    {
      id: 'models',
      title: 'Models',
      body: (
        <>
          <p>
            Drop a <strong>.glb</strong> or <strong>.gltf</strong> and you get a card showing the
            model, not a grey rectangle with three letters on it. Hold <K>Alt</K> and drag it to
            turn it round, <K>Alt</K> and scroll to move in and out; where you leave it is where it
            is next time you open the board. From there it is a picture like any other — every
            effect works on it, it exports, it gives up its colours to the palette, and{' '}
            <K>{KEYS.vary.hint}</K> gives you twelve of it.
          </p>
          <p>
            <strong>Adjust</strong> lists the materials the file declares, what each one is
            textured with and whether it was ever unwrapped. None of that is guessed — a glTF says
            so about itself, and this reads it. Draw a line from another card to the model and you
            can hand that card to a material: press <strong>Wear</strong> and the model comes back
            with your picture on it, which is the shortest route there is from a reference to the
            thing you are designing. It takes the card <em>as it looks</em> — the effect on it, the
            tone, the crop — so a halftoned scan goes onto the material halftoned. That is a
            picture taken at the moment you press it rather than a live link, so press{' '}
            <strong>Again</strong> after working on the card. <strong>Export the selected model as a .glb</strong> in the
            command list hands it back as a model rather than a picture of one, carrying whatever
            you put on it, so it opens in the program it came from.
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
            <K>{KEYS.search.hint}</K> searches everything you have — every board in this project
            and every other project too, not just the board in front of you. A result somewhere
            else says which project it is in, and picking it takes you there. <K>{KEYS.gather.hint}</K> brings a scattered selection back
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
            Three ways, for three different questions. <strong>Save as a page anyone can open</strong>{' '}
            in the command list is the one for handing a board to a person: one HTML file with
            every picture inside it and the boards inside it still reachable, which opens by
            double-clicking on any machine with no network and nothing installed. It is a document,
            not a board — it cannot be read back in.
          </p>
          <p>
            <K>{KEYS.export.hint}</K> is the backup, and the one that <em>can</em> be read back in
            with <K>{KEYS.import.hint}</K>: everything, at full size, in a file only this app
            understands. And <K>{KEYS.picture.hint}</K> writes the selected pictures out as image
            files with their effects baked in, while <strong>Export as a poster</strong> lays the
            whole board out as one PNG or PDF.
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
  { name: 'search', what: 'Search every board in every project' },
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
  const dialog = useDialog(onClose)

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
        ref={dialog}
        className="help"
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
