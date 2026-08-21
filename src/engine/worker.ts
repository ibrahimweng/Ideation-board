/// <reference lib="webworker" />
import { Renderer } from './gl'
import type { ToWorker, FromWorker } from './protocol'

/* The render worker owns the only WebGL2 context. Nothing on the main thread
 * ever touches the GPU, so shader compilation, texture upload and fill never
 * block scrolling, dragging or React. */

let renderer: Renderer | null = null
/* Decoded sources live here, keyed the same way the GPU texture cache is, so a
 * re-render after a parameter change costs no upload and no decode. */
const sources = new Map<string, ImageBitmap>()

const post = (m: FromWorker, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, transfer || [])

function boot() {
  if (renderer) return renderer
  try {
    renderer = new Renderer(new OffscreenCanvas(256, 256))
  } catch {
    renderer = null
  }
  post({ t: 'ready', ok: !!renderer?.ok })
  return renderer
}

/* Shader compilation is spread across idle turns so a first drop of many
 * images does not stall behind 24 program links. */
let warmTimer: ReturnType<typeof setInterval> | null = null
function startWarm() {
  if (warmTimer) return
  warmTimer = setInterval(() => {
    if (!renderer) return
    renderer.tickWarm()
  }, 16)
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  const r = boot()
  if (!r || !r.ok) {
    if (msg.t === 'render' || msg.t === 'live') post({ t: 'fail', id: msg.id, jobId: msg.jobId, reason: 'no-gl' })
    if (msg.t === 'live') msg.bitmap.close()
    return
  }

  switch (msg.t) {
    case 'put': {
      const prev = sources.get(msg.key)
      if (prev) prev.close()
      sources.set(msg.key, msg.bitmap)
      return
    }

    case 'drop': {
      const prev = sources.get(msg.key)
      if (prev) prev.close()
      sources.delete(msg.key)
      r.dropTexture(msg.key)
      return
    }

    case 'warm': {
      r.warmAll(msg.ids)
      startWarm()
      return
    }

    case 'stats': {
      const s = r.stats()
      post({ t: 'stats', ...s })
      return
    }

    case 'render': {
      const src = sources.get(msg.key)
      if (!src) {
        post({ t: 'fail', id: msg.id, jobId: msg.jobId, reason: 'no-source' })
        return
      }
      const okRender = r.render(src, src.width, src.height, msg.key, {
        effectId: msg.effectId,
        params: msg.params,
        width: msg.width,
        height: msg.height,
        seed: msg.seed,
      })
      if (!okRender) {
        post({ t: 'fail', id: msg.id, jobId: msg.jobId, reason: 'render-failed' })
        return
      }
      const bmp = r.takeBitmap()
      if (!bmp) {
        post({ t: 'fail', id: msg.id, jobId: msg.jobId, reason: 'no-bitmap' })
        return
      }
      post({ t: 'done', id: msg.id, jobId: msg.jobId, bitmap: bmp, width: bmp.width, height: bmp.height }, [bmp])
      return
    }

    case 'live': {
      const okRender = r.render(msg.bitmap, msg.bitmap.width, msg.bitmap.height, null, {
        effectId: msg.effectId,
        params: msg.params,
        width: msg.width,
        height: msg.height,
        seed: msg.seed,
      })
      msg.bitmap.close()
      if (!okRender) {
        post({ t: 'fail', id: msg.id, jobId: msg.jobId, reason: 'render-failed' })
        return
      }
      const bmp = r.takeBitmap()
      if (!bmp) {
        post({ t: 'fail', id: msg.id, jobId: msg.jobId, reason: 'no-bitmap' })
        return
      }
      post({ t: 'done', id: msg.id, jobId: msg.jobId, bitmap: bmp, width: bmp.width, height: bmp.height }, [bmp])
      return
    }
  }
}
