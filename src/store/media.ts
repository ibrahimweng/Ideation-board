import { useEffect, useState } from 'react'
import { putBlob, getBlob } from './idb'

/* ---------------------------------------------------------------------------
 * Media ingest and decode.
 *
 * Two things here matter for speed on a big board:
 *
 *   1. Decoding happens through createImageBitmap, which runs off the main
 *      thread, instead of `new Image()` + load event, which does not.
 *
 *   2. Decodes are capped at DECODE_CAP on the long edge. A 6000x4000 photo
 *      decodes to 96MB of RGBA and uploads all of it to the GPU, but nothing
 *      on the board ever renders above 1536px. Capping the decode cuts both
 *      the memory and the upload by an order of magnitude with no visible
 *      difference.
 * ------------------------------------------------------------------------- */

/* Sits just above the largest output the renderer will ever produce
 * (FULL_CAP, 1536px on the long edge). Going higher costs texture memory and
 * upload time for detail that is never sampled: a 6000px photo decodes to
 * 96MB of RGBA, this caps it at about 10MB. */
const DECODE_CAP = 1600

export const isImage = (m: string) => /^image\//.test(m)
export const isVideo = (m: string) => /^video\//.test(m)
export const isAudio = (m: string) => /^audio\//.test(m)

export async function decodeCapped(blob: Blob): Promise<ImageBitmap | null> {
  try {
    /* Probe cheaply first so the resize options are right in one pass. */
    const probe = await createImageBitmap(blob)
    const long = Math.max(probe.width, probe.height)
    if (long <= DECODE_CAP) return probe
    const scale = DECODE_CAP / long
    const out = await createImageBitmap(probe, {
      resizeWidth: Math.round(probe.width * scale),
      resizeHeight: Math.round(probe.height * scale),
      resizeQuality: 'high',
    })
    probe.close()
    return out
  } catch {
    return null
  }
}

/* Pulls the first usable frame out of a video for use as a still. */
export function posterFrom(url: string, cors = false): Promise<{ blob: Blob; w: number; h: number } | null> {
  return new Promise((res) => {
    const v = document.createElement('video')
    /* Reading a frame out of a cross-origin video needs the host's permission,
     * and asking for it has to happen before the file is fetched. Without it
     * the canvas is tainted and toBlob throws, which lands on `finish(null)`
     * below: no poster, rather than a broken one. */
    if (cors) v.crossOrigin = 'anonymous'
    v.preload = 'auto'
    v.muted = true
    v.playsInline = true
    let done = false
    const finish = (val: { blob: Blob; w: number; h: number } | null) => {
      if (done) return
      done = true
      v.removeAttribute('src')
      res(val)
    }
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.25, (v.duration || 1) * 0.1)
      } catch {
        finish(null)
      }
    }
    v.onseeked = () => {
      try {
        const w = Math.min(1280, v.videoWidth || 640)
        const h = Math.round(w * ((v.videoHeight || 360) / (v.videoWidth || 640)))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        c.getContext('2d')!.drawImage(v, 0, 0, w, h)
        c.toBlob((b) => finish(b ? { blob: b, w, h } : null), 'image/jpeg', 0.78)
      } catch {
        finish(null)
      }
    }
    v.onerror = () => finish(null)
    setTimeout(() => finish(null), 6000)
    v.src = url
  })
}

/* ---------- session URL cache ---------- */

const urls = new Map<string, string>()

export function urlFor(key: string, blob: Blob): string {
  const cached = urls.get(key)
  if (cached) return cached
  const u = URL.createObjectURL(blob)
  urls.set(key, u)
  return u
}

export async function urlForKey(key: string): Promise<string | null> {
  const cached = urls.get(key)
  if (cached) return cached
  const b = await getBlob(key)
  if (!b) return null
  return urlFor(key, b)
}

export function releaseUrl(key: string) {
  const u = urls.get(key)
  if (!u) return
  URL.revokeObjectURL(u)
  urls.delete(key)
}

export async function saveMedia(key: string, blob: Blob) {
  await putBlob(key, blob)
  return urlFor(key, blob)
}

export function newKey(prefix = 'm') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/* The address of one stored picture, for as long as a component wants it.
 *
 * Lived in Card.tsx until the generate sheet needed to show the pictures it is
 * about to work from, which is the same question asked by something that is
 * not a card. */
export function useObjectURL(key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!key) {
      setUrl(null)
      return
    }
    void urlForKey(key).then((u) => {
      if (live) setUrl(u)
    })
    return () => {
      live = false
    }
  }, [key])
  return url
}
