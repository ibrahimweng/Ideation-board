import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { clock, wavePath } from '../store/audio'

/* ---------------------------------------------------------------------------
 * A sound, drawn.
 *
 * This was the browser's own player bar with a filename over it: the one thing
 * on the board that looked like a web page rather than like part of the app,
 * and eight identical grey bars on a board holding eight tracks.
 *
 * It is the waveform now, which is the only part of a sound you can actually
 * see. The waveform is also the scrub bar, because they were always the same
 * thing drawn twice — the shape tells you where the quiet part is and pressing
 * on it is how you get there.
 *
 * The controls are drawn here rather than left to the browser for the same
 * reason VideoCard draws its own: `controls` is a black box that cannot be
 * styled, cannot be made to match the board it sits on, and is a different
 * shape and size in every browser.
 * ------------------------------------------------------------------------- */

interface Props {
  url: string | null
  name: string
  /* The cover out of the file, where it had one. */
  art: string | null
  peaks: number[]
  /* What the file said when it was read, used until the element knows better.
   * A card should be able to say how long a track is before anybody presses
   * play on it. */
  secs: number
  selected: boolean
  /* Whether the compare key is being held, which is to say whether the file
   * under the player is the treated one or the one that was dropped. */
  plain: boolean
}

export const AudioCard = memo(function AudioCard({ url, name, art, peaks, secs, selected, plain }: Props) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [length, setLength] = useState(secs || 0)
  /* Every card on the board draws the same number of bars, so a clip named
     after that number would be the same name on all of them — and an id used
     twice in one document means every card after the first is clipped by the
     first one's progress. */
  /* Colons stripped: React's ids contain them, and a fragment reference with a
     colon in it is the sort of thing one browser in four takes badly. */
  const clipId = 'wave' + useId().replace(/[^a-zA-Z0-9]/g, '')

  /* Read off the element rather than kept in step with it: an element that is
   * paused, seeked or ended by anything other than these controls still has to
   * be able to say so. */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const tick = () => setAt(el.currentTime || 0)
    const meta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setLength(el.duration)
    }
    const on = () => setPlaying(true)
    const off = () => setPlaying(false)
    el.addEventListener('timeupdate', tick)
    el.addEventListener('loadedmetadata', meta)
    el.addEventListener('durationchange', meta)
    el.addEventListener('play', on)
    el.addEventListener('pause', off)
    el.addEventListener('ended', off)
    meta()
    return () => {
      el.removeEventListener('timeupdate', tick)
      el.removeEventListener('loadedmetadata', meta)
      el.removeEventListener('durationchange', meta)
      el.removeEventListener('play', on)
      el.removeEventListener('pause', off)
      el.removeEventListener('ended', off)
    }
  }, [url])

  /* The file, put on the element rather than written into the markup.
   *
   * Holding the compare key swaps the treated render for the file that was
   * dropped, and the whole point of that swap is hearing the same moment
   * untreated — so where you were and whether you were playing come across
   * with it. A comparison that starts you back at the beginning is not one.
   *
   * Which means reading the position before the new file lands, and React
   * writing `src` in the markup would already have cleared it by the time any
   * effect could look. So the assignment is here, in order.
   *
   * Only across the swap. Treating a sound gives you a different sound and a
   * different length, and carrying a position into it would be carrying it
   * into a track that may not be that long. */
  const wasPlain = useRef(plain)
  const on = useRef<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !url) { on.current = null; return }
    const swap = wasPlain.current !== plain
    wasPlain.current = plain
    /* An untreated sound is the same file with the key held as without it, so
       there is nothing to swap and the load below would be a reload of what is
       already loaded, on every press of the key. */
    if (on.current === url) return
    const from = el.currentTime
    const going = !el.paused
    on.current = url
    el.src = url
    if (!swap) return
    const land = () => {
      const len = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
      el.currentTime = len ? Math.min(from, len) : from
      setAt(el.currentTime)
      if (going) void el.play().catch(() => {})
    }
    /* HAVE_METADATA or better means the length is known and a seek will hold;
       before that it is thrown away, so wait for the one event that says so. */
    if (el.readyState >= 1) land()
    else el.addEventListener('loadedmetadata', land, { once: true })
  }, [url, plain])

  /* A card taken off the board, or scrolled far enough away to be unmounted,
   * must not go on playing from nowhere. */
  useEffect(() => () => { ref.current?.pause() }, [])

  const toggle = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (el.paused) void el.play().catch(() => {})
    else el.pause()
  }, [])

  /* Pressing the waveform goes to that moment in the track. The whole point of
   * seeing the shape is being able to reach the part of it you can see. */
  const seek = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || !length) return
    const box = e.currentTarget.getBoundingClientRect()
    if (!box.width) return
    const share = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    el.currentTime = share * length
    setAt(el.currentTime)
  }, [length])

  const done = length > 0 ? Math.min(1, at / length) : 0
  const path = wavePath(peaks)

  return (
    <div className="sound" data-art={art ? '' : undefined} data-on={selected || undefined}>
      {/* The cover, where the file carried one. Behind everything and dimmed,
          because what is being read here is the waveform and the time. */}
      {art && <img className="sound-art" src={art} alt="" draggable={false} />}

      <div className="sound-head">
        <button
          className="sound-play"
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); toggle() }}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" />
              <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M5 3.5v9l8-4.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="sound-name" title={name}>{name}</span>
      </div>

      {/* The waveform, which is also the scrub bar.
          preserveAspectRatio="none" on purpose: the path is drawn in a box one
          unit tall and one per peak wide, and the card stretches it to whatever
          shape the card happens to be. */}
      <div
        className="sound-wave"
        onPointerDown={(e) => { e.stopPropagation(); seek(e) }}
        role="slider"
        aria-label="Position in the track"
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(at)}
        aria-valuetext={`${clock(at)} of ${clock(length)}`}
        tabIndex={0}
        onKeyDown={(e) => {
          const el = ref.current
          if (!el) return
          if (e.key === 'ArrowRight') { e.stopPropagation(); el.currentTime = Math.min(length, at + 5) }
          else if (e.key === 'ArrowLeft') { e.stopPropagation(); el.currentTime = Math.max(0, at - 5) }
          else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); toggle() }
        }}
      >
        {path ? (
          <svg
            className="sound-svg"
            viewBox={`0 0 ${peaks.length} 1`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* Drawn twice, and the played half clipped to how far in you are.
                One path under, one over, rather than a peak per element. */}
            <path className="wave-rest" d={path} />
            {/* In the box's own units rather than as a share of the path's
                bounding box, which starts at the first bar rather than at the
                edge and would put the boundary a bar out. */}
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <rect x="0" y="0" width={done * peaks.length} height="1" />
            </clipPath>
            <path className="wave-done" d={path} clipPath={`url(#${clipId})`} />
          </svg>
        ) : (
          /* A file this browser would not decode. There is still a track here
             and it still plays; what is missing is the picture of it. */
          <div className="sound-flat" style={{ ['--done' as string]: `${done * 100}%` }} />
        )}
      </div>

      <div className="sound-time">
        <span>{clock(at)}</span>
        <span>{clock(length)}</span>
      </div>

      {/* The element itself, which does the work and is never seen. The file
          it plays is put on it below rather than written here, because the
          swap has to read where the track was before the new one lands. */}
      {url && <audio ref={ref} preload="metadata" />}
    </div>
  )
})
