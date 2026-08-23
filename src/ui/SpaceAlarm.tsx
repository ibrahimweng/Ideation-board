import { useEffect, useState } from 'react'
import { askToPersist, describeSpace, measure, spaceNow, subscribeSpace } from '../store/space'
import type { Space } from '../store/space'

/* ---------------------------------------------------------------------------
 * The one message that does not go away by itself.
 *
 * Everything else this app says is a line along the bottom that fades after a
 * couple of seconds, which is right for "exported 4 pictures" and wrong for
 * "the last thing you did was not saved". At that moment the only copy of the
 * work is in a tab, and the tab is one reload from losing it, so the message
 * stays put and offers the way out: take the board out as a file, now.
 * ------------------------------------------------------------------------- */

export function SpaceAlarm({ onExport }: { onExport: () => void }) {
  const [space, setSpace] = useState<Space>(spaceNow)
  const [hushed, setHushed] = useState(0)

  useEffect(() => subscribeSpace(setSpace), [])

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
          ? 'What is on screen is still here, but it is not being written down. Take the board out as a file before reloading, then remove what you do not need.'
          : 'Storage is unavailable — a private window, or a setting that blocks it. What is on screen will not survive a reload.'}
        {' '}
        {describeSpace(space)}.
      </span>
      <div className="alarm-do">
        <button onClick={onExport}>Export the board now</button>
        <button className="ghost" onClick={() => setHushed(Date.now())}>
          Not now
        </button>
      </div>
    </div>
  )
}
