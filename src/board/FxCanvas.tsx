import { useCallback, useEffect, useRef } from 'react'
import { getEngine } from '../engine/client'
import { useSourceReady } from './sources'
import type { Params } from '../engine/types'

/* ---------------------------------------------------------------------------
 * The pixel surface of an effected card.
 *
 * The canvas uses a `bitmaprenderer` context, so delivering a finished render
 * is transferFromImageBitmap — a pointer swap. The previous version gave each
 * card a 2D canvas and blitted the shared WebGL canvas into it with
 * drawImage(), which forces a GPU pipeline flush and a readback per card. That
 * single line was the reason twenty effected images crawled.
 *
 * There are two ways a card gets pixels. FxCanvas draws a still whose source
 * already lives on the GPU, and asks for work only when something about it
 * changed. FxVideoCanvas pulls frames off a playing video and hands each one
 * over for a single render.
 * ------------------------------------------------------------------------- */

/* See the note on TRACE in engine/client.ts. */
const TRACE = (globalThis as unknown as { __fxTrace?: boolean }).__fxTrace === true

/* requestVideoFrameCallback is not in every DOM lib version yet. */
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/* Wires a canvas to the engine's output for one card id. `onSettled` fires
 * whenever a request finishes, whether it produced a frame or not, so a caller
 * waiting to send the next one is never left hanging. */
function useFxSink(id: string, onSettled?: () => void, onTeardown?: () => void) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<ImageBitmapRenderingContext | null>(null)
  const settledRef = useRef(onSettled)
  const teardownRef = useRef(onTeardown)
  settledRef.current = onSettled
  teardownRef.current = onTeardown

  useEffect(() => {
    const engine = getEngine()
    engine.subscribe(
      id,
      (bitmap) => {
        const cv = ref.current
        if (TRACE) console.log('[fx] paint', id, `${bitmap.width}x${bitmap.height}`, 'canvas=', !!cv)
        if (!cv) {
          bitmap.close()
          settledRef.current?.()
          return
        }
        if (!ctxRef.current) {
          try {
            ctxRef.current = cv.getContext('bitmaprenderer')
          } catch {
            ctxRef.current = null
          }
        }
        if (!ctxRef.current) {
          bitmap.close()
          settledRef.current?.()
          return
        }
        /* Transfers ownership of the bitmap into the canvas. No copy, no
         * decode, no readback. */
        ctxRef.current.transferFromImageBitmap(bitmap)
        settledRef.current?.()
      },
      () => settledRef.current?.()
    )
    return () => {
      engine.unsubscribe(id)
      teardownRef.current?.()
    }
  }, [id])

  return ref
}

interface Props {
  id: string
  mediaKey: string
  effectId: string
  params: Params | null
  seed: number
  /* Card size in CSS pixels. */
  w: number
  h: number
  /* Distance to viewport centre, for render ordering. */
  distance: number
  className?: string
}

export function FxCanvas({ id, mediaKey, effectId, params, seed, w, h, distance, className }: Props) {
  /* The dirty check for "have we already asked for exactly this?". */
  const sigRef = useRef('')
  const distRef = useRef(distance)
  distRef.current = distance
  /* Held until the media is decoded and resident on the GPU. */
  const sourceReady = useSourceReady(mediaKey)

  /* Unsubscribing also drops any queued job for this card, so the signature
   * has to be cleared or the re-mount would consider itself already satisfied
   * and never ask again. React's StrictMode double effect makes this the
   * normal path in development, not an edge case. */
  const clearSig = useCallback(() => {
    sigRef.current = ''
  }, [])
  const ref = useFxSink(id, undefined, clearSig)

  useEffect(() => {
    const engine = getEngine()
    if (!engine.ok || !mediaKey || !sourceReady) return
    /* Size is quantised by the engine's buckets, so this string changes only
     * on a change that would alter the pixels. */
    const sig = `${mediaKey}|${effectId}|${JSON.stringify(params)}|${Math.round(w)}x${Math.round(h)}`
    if (sigRef.current === sig) return
    sigRef.current = sig
    engine.request({
      id,
      key: mediaKey,
      effectId,
      params,
      cssW: w,
      cssH: h,
      seed,
      distance: distRef.current,
    })
  }, [id, mediaKey, effectId, params, seed, w, h, sourceReady])

  return <canvas ref={ref} className={className} aria-hidden />
}

interface VideoProps {
  id: string
  video: HTMLVideoElement | null
  playing: boolean
  effectId: string
  params: Params | null
  seed: number
  w: number
  h: number
  className?: string
}

/* If a render never comes back, stop waiting after this long and capture
 * again. Without it one dropped frame would stall playback for good. */
const FRAME_TIMEOUT_MS = 500

export function FxVideoCanvas({ id, video, playing, effectId, params, seed, w, h, className }: VideoProps) {
  /* Timestamp of the frame currently being rendered, or 0 when idle. Capturing
   * a new frame while one is in flight would build a backlog of frames that
   * are already stale by the time they are drawn. */
  const waitingRef = useRef(0)
  /* Whether anything has been drawn for the current settings. A paused video
   * needs one render, not a loop, but it does need that one to succeed. */
  const paintedRef = useRef(false)
  const settled = useCallback(() => {
    waitingRef.current = 0
    paintedRef.current = true
  }, [])
  const ref = useFxSink(id, settled)

  /* Read inside the frame loop so a parameter change takes effect on the next
   * frame without tearing down and restarting the loop. */
  const jobRef = useRef({ effectId, params, seed, w, h })
  jobRef.current = { effectId, params, seed, w, h }

  useEffect(() => {
    const engine = getEngine()
    if (!engine.ok || !video) return

    let cancelled = false
    let rafHandle = 0
    let vfcHandle = 0
    const v = video as VideoWithFrameCallback
    /* requestVideoFrameCallback fires once per decoded frame, so it neither
     * misses a frame nor captures the same one twice. It only fires while the
     * video is advancing, so a paused card falls back to animation frames. */
    const hasVFC = typeof v.requestVideoFrameCallback === 'function'

    /* These settings have not been drawn yet. */
    paintedRef.current = false

    const schedule = () => {
      if (cancelled) return
      if (hasVFC && playing) vfcHandle = v.requestVideoFrameCallback!(tick)
      else rafHandle = requestAnimationFrame(tick)
    }

    const tick = () => {
      if (cancelled) return
      const now = performance.now()
      if (waitingRef.current && now - waitingRef.current < FRAME_TIMEOUT_MS) {
        schedule()
        return
      }
      /* A video can reach this state before any event we could have listened
       * for, so the readiness is read here rather than waited on. Until there
       * is a frame to take, keep looking. */
      if (video.readyState < 2 || !video.videoWidth) {
        schedule()
        return
      }
      const j = jobRef.current
      const size = engine.liveCaptureSize(j.w, j.h, playing)
      if (!size.w) {
        schedule()
        return
      }
      waitingRef.current = now
      /* Downscaling at capture time means the frame that crosses to the
       * worker is already the size the render needs. */
      createImageBitmap(video, {
        resizeWidth: size.w,
        resizeHeight: size.h,
        resizeQuality: playing ? 'low' : 'high',
      })
        .then((bmp) => {
          if (cancelled) {
            bmp.close()
            waitingRef.current = 0
            return
          }
          const c = jobRef.current
          engine.renderLive(
            { id, key: '', effectId: c.effectId, params: c.params, cssW: c.w, cssH: c.h, seed: c.seed, distance: 0 },
            bmp,
            playing
          )
        })
        .catch(() => {
          waitingRef.current = 0
        })
        .finally(() => {
          /* Keep going while playing. While paused, stop once something has
           * been drawn for these settings. */
          if (playing || !paintedRef.current) schedule()
        })
    }

    /* A seek while paused parks on a new frame, which needs drawing. */
    const onSeeked = () => {
      waitingRef.current = 0
      paintedRef.current = false
      tick()
    }
    video.addEventListener('seeked', onSeeked)
    tick()

    return () => {
      cancelled = true
      video.removeEventListener('seeked', onSeeked)
      if (rafHandle) cancelAnimationFrame(rafHandle)
      if (vfcHandle && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(vfcHandle)
      waitingRef.current = 0
    }
  }, [id, video, playing, effectId, params, seed, w, h])

  return <canvas ref={ref} className={className} aria-hidden />
}
