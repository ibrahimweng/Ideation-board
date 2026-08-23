import { useCallback, useEffect, useMemo, useState } from 'react'
import { store } from '../state/store'
import type { Item } from '../state/types'
import { FxCanvas } from '../board/FxCanvas'
import { useSourceReady } from '../board/sources'
import { urlForKey } from '../store/media'
import { adjustCSS, frameCSS, hasEffect } from '../board/adjust'
import { GRAIN_URL } from '../board/grain'
import { RichText } from '../board/RichText'
import { hostOf } from '../state/urls'
import { inkOn } from '../state/palette'

/* ---------------------------------------------------------------------------
 * The board, shown rather than worked on.
 *
 * A board is where a set of pictures is arrived at, and then it has to be
 * shown to somebody — and until now the only way to do that was to share a
 * screen with a toolbar, a panel, a grid of dots and eleven other cards around
 * the one being talked about. This is the same board with all of that taken
 * away: one thing at a time, as large as the screen allows, in the order it is
 * laid out in.
 *
 * Reading order, not creation order. Somebody who arranged twelve photographs
 * into three rows meant those rows, and a slideshow that ignored them would be
 * showing a different sequence from the one on the board. So the order is top
 * to bottom in bands, then left to right inside each band, which is how the
 * eye crosses a wall of pictures.
 *
 * The effect, the tone, the framing and the grain are the card's. What is
 * shown is what was made, at the size of the screen instead of the size of a
 * card.
 * ------------------------------------------------------------------------- */

/* Sections are the ground and arrows are between things, so neither is a thing
 * to show. Everything else on a board is something somebody put there. */
const showable = (i: Item) => i.kind !== 'section' && i.kind !== 'edge'

/* Bands of roughly one card's height, so a row of pictures that do not line up
 * to the pixel is still read as a row. */
export function presentOrder(items: Item[]): Item[] {
  const list = items.filter(showable)
  if (!list.length) return []
  const band = Math.max(80, Math.min(...list.map((i) => i.h)) * 0.6)
  return [...list].sort((a, b) => {
    const ra = Math.floor(a.y / band)
    const rb = Math.floor(b.y / band)
    return ra !== rb ? ra - rb : a.x - b.x
  })
}

export function Present({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const items = useMemo(() => {
    const chosen = ids.length > 1 ? ids.map((id) => store.getItem(id)).filter((i): i is Item => !!i) : store.all()
    return presentOrder(chosen)
  }, [ids])

  const [at, setAt] = useState(0)
  /* The chrome fades out of the way and comes back on any movement, so the
   * picture is alone for as long as you are only looking at it. */
  const [idle, setIdle] = useState(false)

  const go = useCallback(
    (step: number) => {
      setAt((n) => Math.min(items.length - 1, Math.max(0, n + step)))
      setIdle(false)
    },
    [items.length]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        return go(1)
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        return go(-1)
      }
      if (e.key === 'Home') return setAt(0)
      if (e.key === 'End') return setAt(items.length - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, items.length])

  /* Ask for the whole display. Refused is fine — a browser may only grant this
   * from a gesture, and the overlay covers the page either way. */
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [])

  /* Leaving full screen by the browser's own means leaves the show as well,
   * since staying in it would look like a window that will not close. */
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) onClose()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [onClose])

  useEffect(() => {
    if (idle) return
    const t = window.setTimeout(() => setIdle(true), 2200)
    return () => window.clearTimeout(t)
  }, [idle, at])

  if (!items.length) {
    return (
      <div className="present" onPointerDown={onClose}>
        <p className="present-none">Nothing on this board to show.</p>
      </div>
    )
  }

  const item = items[Math.min(at, items.length - 1)]

  return (
    <div
      className="present"
      data-idle={idle || undefined}
      onPointerMove={() => setIdle(false)}
      onPointerDown={(e) => {
        /* The left third goes back, the rest goes on: a whole screen of target
           beats a pair of small arrows. */
        const back = e.clientX < window.innerWidth / 3
        go(back ? -1 : 1)
      }}
    >
      <Stage item={item} />

      <div className="present-bar">
        <span className="present-name">{item.name || ''}</span>
        <span className="present-count">
          {at + 1} / {items.length}
        </span>
        <button
          className="present-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title="Leave (Esc)"
        >
          Done
        </button>
      </div>
    </div>
  )
}

/* One thing, as large as it goes. */
function Stage({ item }: { item: Item }) {
  const [url, setUrl] = useState<string | null>(null)
  const ready = useSourceReady(item.kind === 'image' ? item.media : undefined)

  useEffect(() => {
    let live = true
    if (!item.media) {
      setUrl(null)
      return
    }
    void urlForKey(item.media).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [item.media])

  /* The card's own shape, fitted into the screen with room to breathe. */
  const box = useMemo(() => {
    const aspect = item.w / Math.max(1, item.h)
    const maxW = window.innerWidth * 0.9
    const maxH = window.innerHeight * 0.86
    let w = maxW
    let h = w / aspect
    if (h > maxH) {
      h = maxH
      w = h * aspect
    }
    return { w: Math.round(w), h: Math.round(h) }
  }, [item.w, item.h])

  const fx = item.fx
  const filter = adjustCSS(fx)
  const frame = frameCSS(fx)
  const effected = hasEffect(fx) && item.kind === 'image' && item.readable !== false

  return (
    <div className="present-stage" style={{ width: box.w, height: box.h }}>
      <div className="present-body" style={{ filter: filter || undefined }}>
        <div className="present-frame" style={{ transform: frame || undefined }}>
          {item.kind === 'image' &&
            (effected && ready && item.media ? (
              <FxCanvas
                id={`present:${item.id}`}
                mediaKey={item.media}
                effectId={fx.fxid}
                params={fx.ep}
                seed={11}
                w={box.w}
                h={box.h}
                distance={0}
                className="present-media"
              />
            ) : url ? (
              <img className="present-media" src={url} alt={item.name || ''} draggable={false} />
            ) : (
              <div className="present-media" />
            ))}

          {item.kind === 'video' &&
            (url || item.url ? (
              <video
                className="present-media"
                src={url || item.url}
                controls
                autoPlay
                loop
                playsInline
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : null)}

          {item.kind === 'embed' && item.embed && (
            <iframe
              className="present-media present-embed"
              src={item.embed}
              title={item.name || 'Video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              onPointerDown={(e) => e.stopPropagation()}
            />
          )}

          {item.kind === 'note' && (
            <div className="present-note" style={{ background: item.color || '#FBEFC4', color: inkOn(item.color || '#FBEFC4') }}>
              <RichText id={item.id} text={item.text || ''} />
            </div>
          )}

          {item.kind === 'label' && (
            <div className="present-label" style={{ color: item.color || undefined }}>
              {item.text || 'Label'}
            </div>
          )}

          {item.kind === 'link' && (
            <div className="present-plain">
              <span className="present-host">{hostOf(item.url || '')}</span>
              <span className="present-sub">{item.url}</span>
            </div>
          )}

          {(item.kind === 'file' || item.kind === 'audio' || item.kind === 'board') && (
            <div className="present-plain">
              <span className="present-host">{item.name || item.kind}</span>
              {item.kind === 'audio' && url && <audio src={url} controls onPointerDown={(e) => e.stopPropagation()} />}
            </div>
          )}
        </div>

        {fx.grain > 0 && (
          <div className="grain" style={{ opacity: fx.grain / 100, backgroundImage: GRAIN_URL }} />
        )}
      </div>
    </div>
  )
}
