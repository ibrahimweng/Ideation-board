import { useEffect, useState } from 'react'
import { store } from '../state/store'
import { getEngine } from '../engine/client'
import { describeSpace, measure, spaceNow, subscribeSpace, TIGHT as SPACE_TIGHT } from '../store/space'
import type { Space } from '../store/space'
import { describeMirror, mirrorState, subscribeMirror } from '../store/mirror'
import { useRelay } from '../mcp/bridge'
import type { MirrorState } from '../store/mirror'

/* ---------------------------------------------------------------------------
 * What the board is holding.
 *
 * This used to read "12 items  3 selected  41 tex · 180MB", which is the
 * renderer talking to whoever wrote it. The count of things on the board is
 * worth a corner of the screen; how many textures are resident is not, until
 * the moment the board has grown past what can be kept on the GPU and effects
 * begin re-uploading. So the number is on the tooltip, and it only says
 * anything out loud when it is about to matter.
 * ------------------------------------------------------------------------- */

/* Matches TEX_BUDGET in the worker. */
const BUDGET_MB = 220
const TIGHT = 0.82

export function Stats({ count }: { count: number }) {
  const [gpu, setGpu] = useState<{ textures: number; textureBytes: number } | null>(null)
  const [items, setItems] = useState(0)
  const [space, setSpace] = useState<Space>(spaceNow)
  const [mirror, setMirror] = useState<MirrorState>(mirrorState)

  const relay = useRelay()

  useEffect(() => subscribeSpace(setSpace), [])
  useEffect(() => subscribeMirror(setMirror), [])

  useEffect(() => {
    const engine = getEngine()
    engine.onStats = (s) => setGpu(s)
    const t = setInterval(() => {
      setItems(store.count())
      engine.requestStats()
      void measure()
    }, 1500)
    return () => {
      clearInterval(t)
      engine.onStats = null
    }
  }, [])

  const mb = gpu ? gpu.textureBytes / 1048576 : 0
  const tight = mb > BUDGET_MB * TIGHT
  const detail = gpu
    ? `${gpu.textures} picture${gpu.textures === 1 ? '' : 's'} on the GPU, ${mb.toFixed(0)}MB of ${BUDGET_MB}MB`
    : 'Nothing on the GPU yet'

  /* The disk is worth more of the corner than the GPU is: running out of the
   * one costs you a slower effect, and running out of the other costs you the
   * work. */
  const cramped = space.known && space.ratio > SPACE_TIGHT

  return (
    <div className="stats" title={detail}>
      {/* Something other than the person at the keyboard can move these cards.
          That is worth a corner of the screen for as long as it is true. */}
      {relay.status !== 'off' && (
        <span
          className="stats-relay"
          data-on={relay.status === 'on' || undefined}
          data-warn={relay.status === 'lost' || undefined}
          title={
            relay.status === 'on'
              ? relay.call
                ? `Claude is attached. Last asked for: ${relay.call}`
                : 'Claude is attached to this board'
              : relay.status === 'lost'
                ? 'The relay stopped answering. Trying again.'
                : 'Attaching to the relay'
          }
        >
          {relay.status === 'on' ? 'Claude' : relay.status === 'lost' ? 'Claude lost' : 'Claude…'}
        </span>
      )}
      <span>
        {items} item{items === 1 ? '' : 's'}
      </span>
      {count > 0 && <span>{count} selected</span>}
      {cramped && (
        <span className="stats-tight" title={describeSpace(space)}>
          Storage {Math.round(space.ratio * 100)}% full
        </span>
      )}
      {/* Where the work exists outside this browser, and when it last did. */}
      {mirror.folder && (
        <span className="stats-folder" data-busy={mirror.busy || undefined} title={describeMirror(mirror)}>
          {mirror.error ? 'Folder copy failed' : mirror.folder}
        </span>
      )}
      {tight && !cramped && (
        <span className="stats-tight" title={detail}>
          GPU memory full
        </span>
      )}
    </div>
  )
}
