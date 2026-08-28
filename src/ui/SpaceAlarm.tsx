import { useEffect, useState } from 'react'
import { askToPersist, describeSpace, measure, spaceNow, subscribeSpace } from '../store/space'
import type { Space } from '../store/space'
import { mirrorState, subscribeMirror } from '../store/mirror'
import type { MirrorState } from '../store/mirror'

/* ---------------------------------------------------------------------------
 * The one message that does not go away by itself.
 *
 * Everything else this app says is a line along the bottom that fades after a
 * couple of seconds, which is right for "exported 4 pictures" and wrong for
 * "the last thing you did was not saved". At that moment the only copy of the
 * work is in a tab, and the tab is one reload from losing it, so the message
 * stays put and offers the way out: take the board out as a file, now.
 * ------------------------------------------------------------------------- */

export function SpaceAlarm({
  onExport,
  onFolder,
  onReclaim,
}: {
  onExport: () => void
  onFolder: () => void
  /* Clearing up the files nothing points at any more. Offered here because
     this is where the room being gone is announced, and until it existed every
     button on this alarm freed exactly nothing — it told you to remove what
     you did not need while giving you no way to do it. */
  onReclaim: () => void
}) {
  const [space, setSpace] = useState<Space>(spaceNow)
  const [mirror, setMirror] = useState<MirrorState>(mirrorState)
  const [hushed, setHushed] = useState(0)

  useEffect(() => subscribeSpace(setSpace), [])
  useEffect(() => subscribeMirror(setMirror), [])

  /* Asked for once, on the way in. Chrome decides on its own, Firefox asks the
   * person, Safari grants it after the site has been used a few times — so
   * this is a request, not a setting, and a refusal is normal. */
  useEffect(() => {
    void askToPersist().then(() => measure())
  }, [])

  if (!space.trouble || space.troubleAt <= hushed) return null

  const full = space.trouble === 'full'
  return (
    <div className="alarm" role="alert">
      <strong>{full ? 'There is no room left to save' : 'This browser is refusing to save'}</strong>
      <span>
        {full
          ? 'What is on screen is still here, but it is not being written down. Take the board out as a file before reloading, and clear up the files nothing points at any more.'
          : 'Storage is unavailable — a private window, or a setting that blocks it. What is on screen will not survive a reload.'}
        {' '}
        {describeSpace(space)}.
      </span>
      <div className="alarm-do">
        <button onClick={onExport}>Export the board now</button>
        <button className="ghost" onClick={onReclaim}>
          Clear up
        </button>
        <button className="ghost" onClick={() => setHushed(Date.now())}>
          Not now
        </button>
      </div>
      {/* The better answer, where the browser can do it: a folder outside the
          browser keeps being written to, where one export is a moment in time. */}
      {mirror.supported && !mirror.folder && (
        <button className="alarm-more" onClick={onFolder}>
          Or keep a copy in a folder on disk, from now on
        </button>
      )}
    </div>
  )
}
