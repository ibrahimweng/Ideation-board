import { useEffect, useState } from 'react'
import type { Item } from '../state/types'
import { FxCanvas } from '../board/FxCanvas'
import { useSourceReady } from '../board/sources'
import { urlForKey } from '../store/media'
import { adjustCSS, frameCSS, hasEffect } from '../board/adjust'
import { GRAIN_URL } from '../board/grain'
import { RichText } from '../board/RichText'
import { hostOf } from '../state/urls'
import { canShade } from '../state/kinds'
import { inkOn } from '../state/palette'

/* ---------------------------------------------------------------------------
 * One thing, as large as it is given room for.
 *
 * What the board draws in a card, drawn instead at whatever size it is handed:
 * the whole screen when a board is being shown, a quarter of it when two are
 * being held up against each other. The effect, the tone, the framing and the
 * grain are the card's, in the order the card applies them, because what is
 * being looked at has to be what was made.
 *
 * The class names say present because that is what this look is — a thing on
 * near-black ground with nothing else on screen — and comparing two things is
 * the same look with two of them.
 * ------------------------------------------------------------------------- */

/* The card's own shape, fitted into the room given, with a little to breathe. */
export function fitStage(item: Item, maxW: number, maxH: number) {
  const aspect = item.w / Math.max(1, item.h)
  let w = maxW
  let h = w / aspect
  if (h > maxH) {
    h = maxH
    w = h * aspect
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
}

export function Stage({ item, box, tag = 'present' }: { item: Item; box: { w: number; h: number }; tag?: string }) {
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

  const fx = item.fx
  const filter = adjustCSS(fx)
  const frame = frameCSS(fx)
  const effected = hasEffect(fx) && item.kind === 'image' && canShade(item)

  return (
    <div className="present-stage" style={{ width: box.w, height: box.h }}>
      <div className="present-body" style={{ filter: filter || undefined }}>
        <div className="present-frame" style={{ transform: frame || undefined }}>
          {item.kind === 'image' &&
            (effected && ready && item.media ? (
              <FxCanvas
                id={`${tag}:${item.id}`}
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
