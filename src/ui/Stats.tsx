import { useEffect, useState } from 'react'
import { store } from '../state/store'
import { getEngine } from '../engine/client'

/* A small readout of what the board and the GPU are holding. Useful when
 * judging whether a board has grown past what the texture budget can keep
 * resident, which is the point where effects start re-uploading. */
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

  return (
    <div className="stats" title="Board and GPU residency">
      <span>{items} items</span>
      {count > 0 && <span>{count} selected</span>}
      {gpu && (
        <span>
          {gpu.textures} tex · {(gpu.textureBytes / 1048576).toFixed(0)}MB
        </span>
      )}
    </div>
  )
}
