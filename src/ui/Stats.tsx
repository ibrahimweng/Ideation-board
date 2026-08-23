import { useEffect, useState } from 'react'
import { store } from '../state/store'
import { getEngine } from '../engine/client'

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

  useEffect(() => {
    const engine = getEngine()
    engine.onStats = (s) => setGpu(s)
    const t = setInterval(() => {
      setItems(store.count())
      engine.requestStats()
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

  return (
    <div className="stats" title={detail}>
      <span>
        {items} item{items === 1 ? '' : 's'}
      </span>
      {count > 0 && <span>{count} selected</span>}
      {tight && (
        <span className="stats-tight" title={detail}>
          GPU memory full
        </span>
      )}
    </div>
  )
}
