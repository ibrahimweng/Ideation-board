import { JobQueue, Heat } from './scheduler'
import type { Job } from './scheduler'
import { Tier, BUCKET, PROXY_CAP, FULL_CAP, VIDEO_CAP } from './types'
import type { Params } from './types'
import { EFFECTS } from './effects'
import { Renderer } from './gl'
import type { ToWorker, FromWorker } from './protocol'

/* ---------------------------------------------------------------------------
 * FxEngine — the board's handle on the GPU.
 *
 * Owns the render worker, the job queue and the source cache. Cards subscribe
 * with a canvas and a description of what they want; the engine decides when
 * that work runs and hands back an ImageBitmap.
 * ------------------------------------------------------------------------- */

export interface RenderRequest {
  id: string
  key: string
  effectId: string
  params: Params | null
  /* CSS pixel size of the card's canvas. */
  cssW: number
  cssH: number
  seed: number
  /* Distance from viewport centre, in pixels. Drives ordering. */
  distance: number
}

type Sink = (bitmap: ImageBitmap) => void

/* Round a target size into buckets so panning and zooming do not invalidate
 * every cached render on a sub-pixel change. */
export function bucketed(cssW: number, cssH: number, cap: number, dpr: number) {
  const long = Math.max(cssW, cssH)
  if (long <= 0) return { w: 0, h: 0 }
  const scale = Math.min(cap / (long * dpr), 1)
  const w = Math.max(BUCKET, Math.ceil((cssW * dpr * scale) / BUCKET) * BUCKET)
  const h = Math.max(2, Math.round((w * cssH) / cssW))
  return { w: Math.min(w, cap), h: Math.min(h, cap) }
}

/* Set `window.__fxTrace = true` before load to log the render pipeline. A GPU
 * pipeline that silently produces nothing is very hard to diagnose without
 * being able to see which stage dropped the work. */
const TRACE = (globalThis as unknown as { __fxTrace?: boolean }).__fxTrace === true

export class FxEngine {
  ok = false
  private worker: Worker | null = null
  private local: Renderer | null = null
  private localCanvasBusy = false

  private queue = new JobQueue()
  private heat = new Heat()
  private sinks = new Map<string, Sink>()
  /* Told when a render for this card failed, so a caller waiting on a frame
   * does not wait forever. */
  private fails = new Map<string, () => void>()
  /* jobId of the newest dispatch per card, so a late reply for superseded work
   * is dropped instead of flashing an old frame onto the card. */
  private latest = new Map<string, number>()
  private inflight = 0
  private maxInflight = 3
  /* Live jobs count down so they never collide with queued job ids. */
  private liveSeq = 0
  private known = new Set<string>()
  private raf: number | null = null
  private running = false

  /* Cards that want a full-resolution upgrade once the board goes quiet. */
  private upgrades = new Map<string, RenderRequest>()

  private dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)

  onStats: ((s: { textures: number; textureBytes: number; programs: number }) => void) | null = null

  async start(): Promise<boolean> {
    if (this.running) return this.ok
    this.running = true

    if (typeof OffscreenCanvas === 'undefined') {
      this.ok = false
      return false
    }

    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
      this.worker.onerror = () => this.fallbackLocal()
      this.ok = true
    } catch {
      this.fallbackLocal()
    }

    this.send({ t: 'warm', ids: EFFECTS.map((e) => e.id) })
    this.loop()
    return this.ok
  }

  /* Workers are unavailable in a few embedding contexts. The same renderer
   * then runs on the main thread under the same frame budget, so behaviour
   * degrades in throughput rather than in correctness. */
  private fallbackLocal() {
    if (this.local) return
    try {
      this.local = new Renderer(new OffscreenCanvas(256, 256))
      this.ok = this.local.ok
      this.maxInflight = 1
      this.local.warmAll(EFFECTS.map((e) => e.id))
    } catch {
      this.ok = false
    }
    this.worker = null
  }

  private send(m: ToWorker, transfer?: Transferable[]) {
    if (this.worker) this.worker.postMessage(m, transfer || [])
  }

  stop() {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = null
    if (this.worker) this.worker.terminate()
    this.worker = null
  }

  /* ---------- sources ---------- */

  hasSource(key: string) {
    return this.known.has(key)
  }

  /* Hands a decoded frame to the renderer once. Everything afterwards — every
   * parameter tweak, every resize — reuses the resident GPU texture. */
  putSource(key: string, bitmap: ImageBitmap) {
    this.known.add(key)
    if (this.worker) this.send({ t: 'put', key, bitmap }, [bitmap])
    else this.localSources.set(key, bitmap)
  }

  dropSource(key: string) {
    this.known.delete(key)
    if (this.worker) this.send({ t: 'drop', key })
    else {
      const b = this.localSources.get(key)
      if (b) b.close()
      this.localSources.delete(key)
      this.local?.dropTexture(key)
    }
  }

  private localSources = new Map<string, ImageBitmap>()

  /* ---------- requests ---------- */

  subscribe(id: string, sink: Sink, onFail?: () => void) {
    this.sinks.set(id, sink)
    if (onFail) this.fails.set(id, onFail)
  }

  unsubscribe(id: string) {
    this.sinks.delete(id)
    this.fails.delete(id)
    this.queue.drop(id)
    this.latest.delete(id)
    this.upgrades.delete(id)
  }

  /* Called by a card when its effect, parameters or size actually changed.
   * Nothing polls; if no card changes, no work is queued and no frame is
   * spent looking for work. */
  request(req: RenderRequest) {
    if (TRACE) console.log('[fx] request', req.id, req.effectId)
    if (!this.ok) return
    const proxy = bucketed(req.cssW, req.cssH, PROXY_CAP, this.dpr)
    const full = bucketed(req.cssW, req.cssH, FULL_CAP, this.dpr)
    if (!proxy.w) return

    /* If the full-resolution target is no larger than the proxy, there is
     * nothing to upgrade to; render once and be done. */
    const single = full.w <= proxy.w

    this.queue.push({
      id: req.id,
      key: req.key,
      effectId: req.effectId,
      params: req.params,
      width: single ? full.w : proxy.w,
      height: single ? full.h : proxy.h,
      seed: req.seed,
      tier: single ? Tier.Full : Tier.Proxy,
      priority: req.distance,
    })

    if (single) this.upgrades.delete(req.id)
    else this.upgrades.set(req.id, req)
  }

  /* Marks interaction. While hot, the queue serves proxy work only. */
  touch() {
    this.heat.touch()
  }

  /* The size a caller should capture a video frame at. Capturing larger than
   * this only costs decode bandwidth for detail the render discards. */
  liveCaptureSize(cssW: number, cssH: number, playing: boolean) {
    return bucketed(cssW, cssH, playing ? VIDEO_CAP : FULL_CAP, this.dpr)
  }

  /* A video frame, which changes every frame and so bypasses the source cache
   * entirely. The frame is transferred, used once and closed.
   *
   * Live frames skip the queue. A queued frame is a stale frame, and showing
   * one late is worse than dropping it, so the caller is expected to hold off
   * capturing the next frame until this one comes back. */
  renderLive(req: RenderRequest, frame: ImageBitmap, playing: boolean) {
    if (!this.ok) {
      frame.close()
      return
    }
    const size = this.liveCaptureSize(req.cssW, req.cssH, playing)
    if (!size.w) {
      frame.close()
      return
    }
    const jobId = --this.liveSeq
    this.latest.set(req.id, jobId)

    if (this.worker) {
      this.inflight++
      this.send(
        {
          t: 'live',
          id: req.id,
          jobId,
          bitmap: frame,
          effectId: req.effectId,
          params: req.params,
          width: size.w,
          height: size.h,
          seed: req.seed,
        },
        [frame]
      )
      return
    }

    /* No worker: draw it here, under the same rules. */
    const r = this.local
    if (!r) {
      frame.close()
      return
    }
    try {
      const okRender = r.render(frame, frame.width, frame.height, null, {
        effectId: req.effectId,
        params: req.params,
        width: size.w,
        height: size.h,
        seed: req.seed,
      })
      if (okRender) {
        const bmp = r.takeBitmap()
        if (bmp) this.deliver(req.id, jobId, bmp)
      }
    } catch {
      /* A failed frame drops; the next one will be along shortly. */
    } finally {
      frame.close()
    }
  }

  /* ---------- the pump ---------- */

  private loop = () => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)

    if (this.local) this.local.tickWarm()

    const hot = this.heat.hot

    /* Once interaction settles, promote visible cards to full resolution. */
    if (!hot && this.upgrades.size && this.queue.size === 0 && this.inflight === 0) {
      for (const [id, req] of this.upgrades) {
        const full = bucketed(req.cssW, req.cssH, FULL_CAP, this.dpr)
        this.queue.push({
          id,
          key: req.key,
          effectId: req.effectId,
          params: req.params,
          width: full.w,
          height: full.h,
          seed: req.seed,
          tier: Tier.Full,
          priority: req.distance,
        })
      }
      this.upgrades.clear()
    }

    /* A frame budget, not a job count. Whatever the machine manages inside
     * the budget is what runs; the board keeps its frame either way. */
    const budget = hot ? 4 : 8
    const t0 = performance.now()
    if (TRACE && this.queue.size) {
      console.log('[fx] loop q=', this.queue.size, 'inflight=', this.inflight, 'hot=', hot, 'ok=', this.ok, 'worker=', !!this.worker)
    }
    while (this.inflight < this.maxInflight && performance.now() - t0 < budget) {
      const job = this.queue.take(!hot)
      if (!job) break
      this.dispatch(job)
      /* The worker path returns immediately; only the local path actually
       * consumes the budget here. */
      if (this.worker) break
    }
  }

  private dispatch(job: Job) {
    if (TRACE) console.log('[fx] dispatch', job.id, job.effectId, `${job.width}x${job.height}`, 'tier', job.tier)
    this.latest.set(job.id, job.jobId)

    if (this.worker) {
      this.inflight++
      this.send({
        t: 'render',
        id: job.id,
        jobId: job.jobId,
        key: job.key,
        effectId: job.effectId,
        params: job.params,
        width: job.width,
        height: job.height,
        seed: job.seed,
      })
      return
    }

    /* Local path: same renderer, main thread, one job at a time. */
    const r = this.local
    if (!r || this.localCanvasBusy) return
    const src = this.localSources.get(job.key)
    if (!src) return
    this.localCanvasBusy = true
    try {
      const okRender = r.render(src, src.width, src.height, job.key, {
        effectId: job.effectId,
        params: job.params,
        width: job.width,
        height: job.height,
        seed: job.seed,
      })
      if (okRender) {
        const bmp = r.takeBitmap()
        if (bmp) this.deliver(job.id, job.jobId, bmp)
      }
    } catch {
      /* A failed effect should never take the board down with it. */
    } finally {
      this.localCanvasBusy = false
    }
  }

  private onMessage(m: FromWorker) {
    switch (m.t) {
      case 'ready':
        this.ok = m.ok
        if (!m.ok) this.fallbackLocal()
        return
      case 'done':
        this.inflight = Math.max(0, this.inflight - 1)
        this.deliver(m.id, m.jobId, m.bitmap)
        return
      case 'fail':
        if (TRACE) console.log('[fx] fail', m.id, m.reason)
        this.inflight = Math.max(0, this.inflight - 1)
        this.fails.get(m.id)?.()
        return
      case 'stats':
        this.onStats?.({ textures: m.textures, textureBytes: m.textureBytes, programs: m.programs })
        return
    }
  }

  private deliver(id: string, jobId: number, bitmap: ImageBitmap) {
    if (TRACE) console.log('[fx] deliver', id, `${bitmap.width}x${bitmap.height}`, 'current=', this.latest.get(id) === jobId, 'sink=', !!this.sinks.get(id))
    /* Drop replies for work that a newer request already superseded. */
    if (this.latest.get(id) !== jobId) {
      bitmap.close()
      this.fails.get(id)?.()
      return
    }
    const sink = this.sinks.get(id)
    if (!sink) {
      bitmap.close()
      this.fails.get(id)?.()
      return
    }
    sink(bitmap)
  }

  requestStats() {
    this.send({ t: 'stats' })
  }
}

/* One engine per document. Exposed on window so the render pipeline can be
 * inspected from the console without a build flag. */
let singleton: FxEngine | null = null
export function getEngine(): FxEngine {
  if (!singleton) {
    singleton = new FxEngine()
    ;(globalThis as unknown as { __fx?: FxEngine }).__fx = singleton
  }
  return singleton
}
