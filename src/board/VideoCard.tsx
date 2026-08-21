import { useCallback, useEffect, useRef, useState } from 'react'
import { FxVideoCanvas } from './FxCanvas'
import type { Params } from '../engine/types'

/* ---------------------------------------------------------------------------
 * A video card.
 *
 * With no effect on it, this is an ordinary video element with the browser's
 * own controls. With an effect on it, the video element is still what decodes
 * and plays, but it is made invisible and the card shows a canvas fed by the
 * renderer instead. The controls below the picture stand in for the native
 * ones, which are no longer reachable.
 *
 * The video element is kept at full size with opacity zero rather than removed
 * or hidden with `display: none`, because a browser is free to stop decoding a
 * video it is not painting.
 * ------------------------------------------------------------------------- */

interface Props {
  id: string
  url: string | null
  effected: boolean
  /* Set for a video loaded from a URL whose host allows cross-origin reads.
   * It has to be on the element before the source is fetched, so changing it
   * remounts the element rather than editing it in place. */
  crossOrigin?: 'anonymous'
  /* An effect is selected but this source's pixels cannot be read, so there
   * is nothing to run it on. The card says so rather than quietly showing an
   * unaffected picture. */
  blocked?: boolean
  effectId: string
  params: Params | null
  seed: number
  w: number
  h: number
  /* Tone and framing come from the card. They are applied here rather than by
   * the card so the control bar can sit outside them. A CSS filter applies to
   * the whole subtree and a child cannot opt out, so a bar inside the filtered
   * element would be tinted along with the picture. */
  filter: string
  frame: string
  grain: number
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r < 10 ? '0' : ''}${r}`
}

export function VideoCard({
  id, url, effected, crossOrigin, blocked, effectId, params, seed, w, h, filter, frame, grain,
}: Props) {
  /* State rather than a ref: the canvas needs to re-render once the element
   * exists so it can start pulling frames from it. */
  const [el, setEl] = useState<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const barRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!el) return
    /* A video with a local source can reach a loaded state before React has
     * attached anything, and an event that already fired will not fire again.
     * So the element is read once here rather than only waited on. */
    setPlaying(!el.paused)
    if (el.duration) setDuration(el.duration)
    if (el.currentTime) setTime(el.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => setTime(el.currentTime)
    const onMeta = () => setDuration(el.duration || 0)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onPause)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onPause)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
    }
  }, [el])

  const toggle = useCallback(() => {
    if (!el) return
    if (el.paused) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }, [el])

  /* Scrubbing writes straight to the element. The canvas redraws from the
   * video's own `seeked` event, so there is nothing to keep in step here. */
  const seekTo = useCallback(
    (clientX: number) => {
      const bar = barRef.current
      if (!bar || !el || !duration) return
      const r = bar.getBoundingClientRect()
      const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      el.currentTime = p * duration
      setTime(el.currentTime)
    },
    [el, duration]
  )

  const onScrubDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      seekTo(e.clientX)
      const move = (ev: PointerEvent) => seekTo(ev.clientX)
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [seekTo]
  )

  const body = (inner: React.ReactNode) => (
    <div className="card-body" style={{ filter: filter || undefined }}>
      <div className="card-frame" style={{ transform: frame || undefined }}>
        {inner}
      </div>
      {grain > 0 && <div className="grain" style={{ opacity: grain / 100 }} />}
      {blocked && <div className="fx-blocked">Effects unavailable for this source</div>}
    </div>
  )

  if (!url) return body(<div className="media placeholder" />)

  /* Leave room for the control bar only when we are drawing it ourselves. */
  const pictureH = effected ? Math.max(24, h - 28) : h

  return (
    <>
      {body(
        <>
          <video
            key={crossOrigin || 'same-origin'}
            ref={setEl}
            className={effected ? 'media video-source' : 'media'}
            crossOrigin={crossOrigin}
            src={url}
            playsInline
            loop
            muted={muted}
            controls={!effected}
            /* An effected card shows a canvas fed from this element, so it
               needs a decoded frame even before anyone presses play. */
            preload={effected ? 'auto' : 'metadata'}
            onPointerDown={(e) => e.stopPropagation()}
          />

          {/* One canvas, always mounted while an effect is on. It stays
              transparent until its first frame arrives, so there is no swap
              between two canvases and no moment where they disagree about
              which of them owns this card's renders. */}
          {effected && (
            <FxVideoCanvas
              id={id}
              video={el}
              playing={playing}
              effectId={effectId}
              params={params}
              seed={seed}
              w={w}
              h={pictureH}
              className="media video-out"
            />
          )}
        </>
      )}

      {effected && (
        <div className="video-bar" onPointerDown={(e) => e.stopPropagation()}>
          <button className="video-play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="video-scrub" ref={barRef} onPointerDown={onScrubDown}>
            <i style={{ width: duration ? `${(time / duration) * 100}%` : '0%' }} />
          </div>
          <span className="video-time">
            {fmt(time)} / {fmt(duration)}
          </span>
          <button className="video-mute" onClick={() => setMuted((m) => !m)} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? 'M' : 'A'}
          </button>
        </div>
      )}
    </>
  )
}
