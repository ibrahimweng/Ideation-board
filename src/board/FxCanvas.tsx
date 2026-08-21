import { useEffect, useRef } from 'react'
import { getEngine } from '../engine/client'
import { useSourceReady } from './sources'
import type { Params } from '../engine/types'

/* See the note on TRACE in engine/client.ts. */
const TRACE = (globalThis as unknown as { __fxTrace?: boolean }).__fxTrace === true

/* ---------------------------------------------------------------------------
 * The pixel surface of an effected card.
 *
 * The canvas uses a `bitmaprenderer` context, so delivering a finished render
 * is transferFromImageBitmap — a pointer swap. The previous version gave each
 * card a 2D canvas and blitted the shared WebGL canvas into it with
 * drawImage(), which forces a GPU pipeline flush and a readback per card. That
 * single line was the reason twenty effected images crawled.
 *
 * Work is requested only when the effect, its parameters, the media source or
 * the bucketed size actually change. Panning and zooming change none of those,
 * so a pan costs zero GPU work.
 * ------------------------------------------------------------------------- */

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
  const ref = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<ImageBitmapRenderingContext | null>(null)
  /* The dirty check for "have we already asked for exactly this?". */
  const sigRef = useRef('')
  const distRef = useRef(distance)
  distRef.current = distance
  /* Held until the media is decoded and resident on the GPU. */
  const sourceReady = useSourceReady(mediaKey)

  useEffect(() => {
    const engine = getEngine()
    engine.subscribe(id, (bitmap) => {
      const cv = ref.current
      if (TRACE) console.log('[fx] paint', id, `${bitmap.width}x${bitmap.height}`, 'canvas=', !!cv)
      if (!cv) {
        bitmap.close()
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
        return
      }
      /* Transfers ownership of the bitmap into the canvas. No copy, no
       * decode, no readback. */
      ctxRef.current.transferFromImageBitmap(bitmap)
    })
    return () => {
      engine.unsubscribe(id)
      /* Unsubscribing also drops any queued job for this card, so the
       * signature has to be cleared or the re-mount would consider itself
       * already satisfied and never ask again. React's StrictMode double
       * effect makes this the normal path in development, not an edge case. */
      sigRef.current = ''
    }
  }, [id])

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
