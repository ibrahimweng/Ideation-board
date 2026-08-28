import { KEYS } from './shortcuts'
import { IconCommand, IconDraw, IconFiles, IconNote, IconPresent } from './icons'

/* ---------------------------------------------------------------------------
 * The empty board.
 *
 * It used to be a grey field, a row of icons with no words on them, and
 * nothing at all to say that you could drop a folder of photographs onto it or
 * that one key opens everything the board can do. A first-time user was left
 * to guess, and the two things most worth knowing — drop files, press the
 * command key — were the two least visible.
 *
 * It is drawn on the board rather than over it, so it reads as the board
 * being empty rather than as a dialog to get past, and it goes the moment
 * there is anything to look at instead. Nothing has to be dismissed.
 * ------------------------------------------------------------------------- */

export function FirstRun({ onAddFiles, onNote, onCommands, onHelp }: {
  onAddFiles: () => void
  onNote: () => void
  onCommands: () => void
  onHelp: () => void
}) {
  return (
    <div className="first">
      <h2>Drop pictures here</h2>
      <p>
        Photographs, video, audio, files — drag them from your computer onto this space, or paste a
        link. Everything stays on this machine.
      </p>

      <div className="first-do">
        <button onClick={onAddFiles}>
          <IconFiles />
          <span>Choose files</span>
          <em>{KEYS.addFiles.hint}</em>
        </button>
        <button onClick={onNote}>
          <IconNote />
          <span>Write a note</span>
          <em>{KEYS.note.hint}</em>
        </button>
        <button onClick={onCommands}>
          <IconCommand />
          <span>Everything else</span>
          <em>{KEYS.commands.hint}</em>
        </button>
      </div>

      <ul className="first-more">
        <li>
          <IconPresent />
          Thirty one effects, applied on the GPU, on as many pictures as you like at once.
        </li>
        <li>
          <IconDraw />
          <strong>{KEYS.draw.hint}</strong> draws a picture from a description, with your own key, kept in
          this browser.
        </li>
        <li>
          <IconCommand />
          <strong>{KEYS.commands.hint}</strong> finds anything the board can do, and tells you the key for it.
        </li>
      </ul>

      {/* Last, and quiet. Somebody who wants to start has three buttons above
          to start with; this is for the one who would rather read first, and
          the point of it being here is that they do not have to go looking. */}
      <button className="first-help" onClick={onHelp}>
        How this works <em>{KEYS.help.hint}</em>
      </button>
    </div>
  )
}
