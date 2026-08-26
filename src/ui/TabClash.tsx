/* ---------------------------------------------------------------------------
 * Both tabs changed the same board.
 *
 * This is the one case the tabs cannot settle between themselves. Another tab
 * has written a newer version of this board and this tab has edits of its own
 * that have not been written yet, so there is no answer that is not somebody's
 * loss — and nothing at all is lost while the question is on screen. Their
 * version is on disk. Yours is in front of you. Saving has stopped, which is
 * why nothing is quietly overwriting anything while you decide.
 *
 * It does not go away by itself, for the same reason the storage alarm does
 * not: a line along the bottom that fades after two seconds is right for
 * "exported four pictures" and wrong for "one of these two is about to be
 * thrown away".
 * ------------------------------------------------------------------------- */

export function TabClash({
  onTakeTheirs, onKeepMine, onExport,
}: {
  onTakeTheirs: () => void
  onKeepMine: () => void
  onExport: () => void
}) {
  return (
    <div className="alarm" role="alert">
      <strong>This board changed in another tab</strong>
      <span>
        Both copies have been edited, so one of them has to give way. Nothing is
        being saved until you say which — what is on screen is yours, and the
        other tab&rsquo;s version is the one on disk.
      </span>
      <div className="alarm-do">
        <button onClick={onKeepMine}>Keep what is on screen</button>
        <button className="ghost" onClick={onTakeTheirs}>
          Take the other tab&rsquo;s
        </button>
      </div>
      {/* The way to lose nothing at all: take this version out as a file, then
          take theirs. */}
      <button className="alarm-more" onClick={onExport}>
        Or export this version first, and lose neither
      </button>
    </div>
  )
}
