import { memo, useEffect, useState } from 'react'
import { useItem, store } from '../state/store'
import { TAGS } from '../state/types'
import { FxCanvas } from './FxCanvas'
import { VideoCard } from './VideoCard'
import { EmbedCard } from './EmbedCard'
import { BoardCard } from './BoardCard'
import { GRAIN_URL } from './grain'
import { adjustCSS, frameCSS, hasEffect } from './adjust'
import { urlForKey } from '../store/media'
import { useDrawing } from '../state/generate'
import { useSourceReady } from './sources'
import { RichText } from './RichText'
import { todoCount } from '../state/rich'
import { canShade, hasPixels } from '../state/kinds'
import { inkOn } from '../state/palette'
import { wireToPoint } from './wire'
import type { Side } from './wire'
import { screenToBoard } from './viewport'

/* ---------------------------------------------------------------------------
 * One card.
 *
 * memo + a per-item subscription means a card re-renders only when its own
 * item object changes. Dragging one card leaves the other 199 untouched, and
 * panning the board re-renders nothing at all — the surface transform moves
 * them as a group on the compositor.
 * ------------------------------------------------------------------------- */

interface Props {
  id: string
  selected: boolean
  /* Faded out because a search is running and this card does not match. */
  dim?: boolean
  distance: number
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onOpenEditor: (id: string) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
}

function useObjectURL(key: string | undefined) {
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

export const Card = memo(function Card({
  id, selected, dim, distance, onPointerDown, onOpenEditor, onContextMenu,
}: Props) {
  const it = useItem(id)
  const objectUrl = useObjectURL(it?.media)
  const ready = useSourceReady(it?.kind === 'image' ? it?.media : undefined)
  /* Still waiting on a picture that was asked for rather than dropped. */
  const drawing = useDrawing(id)

  if (!it) return null

  /* Either a file this board holds, which needs an object URL, or a remote one
   * shown straight from its own address — which is how a picture dragged out
   * of another tab looks for the moment between arriving and being fetched,
   * and how it stays if its host refuses the read. */
  const url = it.media ? objectUrl : it.url || null
  const remote = !it.media && !!it.url

  const fx = it.fx
  /* `readable` is only ever false for a remote video whose host refused us
   * cross-origin access. Everything else can be shaded. */
  const shadeable = canShade(it) || !hasPixels(it)
  const effected = hasEffect(fx) && canShade(it)
  const filter = adjustCSS(fx)
  const frame = frameCSS(fx)
  const tag = it.tag ? TAGS.find((t) => t.id === it.tag) : null
  /* A checklist says how far along it is without being opened. */
  const todo = it.kind === 'note' ? todoCount(it.text || '') : { done: 0, total: 0 }

  const shell: React.CSSProperties = {
    transform: `translate3d(${it.x}px, ${it.y}px, 0)`,
    width: it.w,
    height: it.h,
    zIndex: it.z,
  }

  /* Sections are backdrops: they sit behind everything and never capture the
   * pointer except on their own title bar. */
  if (it.kind === 'section') {
    return (
      <>
        <div
          className="card card-section"
          data-id={id}
          style={{ ...shell, zIndex: 1 }}
          data-sel={selected || undefined}
          data-dim={dim || undefined}
        >
          <div
            className="section-bar"
            onPointerDown={(e) => onPointerDown(e, id)}
            onContextMenu={(e) => onContextMenu(e, id)}
          >
            <span>{it.name || 'Section'}</span>
          </div>
        </div>
        {selected && !dim && <Handles id={id} x={it.x} y={it.y} w={it.w} h={it.h} onContextMenu={onContextMenu} />}
      </>
    )
  }

  if (it.kind === 'label') {
    return (
      <>
        <div
          className="card card-label"
          data-id={id}
          style={{ ...shell, color: it.color || '#111114' }}
          data-sel={selected || undefined}
          data-dim={dim || undefined}
          onPointerDown={(e) => onPointerDown(e, id)}
          onContextMenu={(e) => onContextMenu(e, id)}
          onDoubleClick={() => onOpenEditor(id)}
        >
          {it.text || 'Label'}
        </div>
        {!dim && <Ports id={id} x={it.x} y={it.y} w={it.w} h={it.h} />}
        {selected && !dim && <Handles id={id} x={it.x} y={it.y} w={it.w} h={it.h} onContextMenu={onContextMenu} />}
      </>
    )
  }

  return (
    <>
    <div
      className="card"
      data-id={id}
      style={shell}
      data-sel={selected || undefined}
      data-dim={dim || undefined}
      data-pick={it.pick || undefined}
      data-kind={it.kind}
      onPointerDown={(e) => onPointerDown(e, id)}
      onContextMenu={(e) => onContextMenu(e, id)}
      onDoubleClick={() => onOpenEditor(id)}
    >
      {/* The picture is the card. What the card is called, and how far along
          its checklist is, come forward when you are on it and go away again
          when you are not — a board of photographs should look like a board of
          photographs rather than like a list of filenames. The tag stays,
          because a tag is something you scan a whole board for. */}
      <div className="card-chrome">
        <span className="card-name" title={it.name}>
          {it.name || 'Untitled'}
        </span>
        {todo.total > 0 && (
          <span className="card-todo" title="Ticked off">
            {todo.done}/{todo.total}
          </span>
        )}
      </div>
      {tag && <i className="card-tag" style={{ background: tag.c }} title={tag.id} />}
      {/* The decision, which does not hide: the point of marking a board up is
          being able to see the shape of it at a glance. */}
      {it.pick && (
        <i className="card-pick" data-pick={it.pick} title={it.pick === 'in' ? 'Kept' : 'Cut'}>
          {it.pick === 'in' ? <TickIcon /> : <CrossIcon />}
        </i>
      )}

      {it.kind === 'video' ? (
        <VideoCard
          id={id}
          url={url}
          effected={effected}
          selected={selected}
          /* Optimistic while the probe is still out: asking for cross-origin
             access and being refused costs one reload, asking for it too late
             costs a cached response that can never be read. */
          crossOrigin={remote && it.readable !== false ? 'anonymous' : undefined}
          blocked={hasEffect(fx) && !shadeable}
          effectId={fx.fxid}
          params={fx.ep}
          seed={hashSeed(id)}
          w={it.w}
          h={it.h}
          filter={filter}
          frame={frame}
          grain={fx.grain}
        />
      ) : it.kind === 'board' ? (
        <BoardCard boardId={it.board || ''} />
      ) : it.kind === 'embed' ? (
        <EmbedCard
          embed={it.embed || ''}
          name={it.name || 'Video'}
          selected={selected}
          filter={filter}
          frame={frame}
          grain={fx.grain}
        />
      ) : (
      <div className="card-body" style={{ filter: filter || undefined }}>
        <div className="card-frame" style={{ transform: frame || undefined }}>
          {it.kind === 'image' &&
            (effected && ready ? (
              <FxCanvas
                id={id}
                mediaKey={it.media!}
                effectId={fx.fxid}
                params={fx.ep}
                seed={hashSeed(id)}
                w={it.w}
                h={it.h}
                distance={distance}
                className="media"
              />
            ) : url ? (
              <img
                className="media"
                src={url}
                alt={it.name || ''}
                draggable={false}
                /* A remote picture is asked for with cross-origin access so
                   its pixels can be read if the host allows it. Where it does
                   not, the browser falls back to showing it uncredited. */
                crossOrigin={!it.media && it.readable !== false ? 'anonymous' : undefined}
              />
            ) : (
              /* An image card with nothing in it yet is either a picture being
                 drawn or one that failed to arrive. Saying which is the whole
                 difference between "wait" and "that is broken". */
              <div className="media placeholder" data-drawing={drawing || undefined}>
                {drawing && <span className="drawing" aria-label="Drawing" />}
              </div>
            ))}

          {it.kind === 'audio' &&
            (url ? (
              <div className="audio-wrap">
                <div className="audio-title">{it.name}</div>
                <audio src={url} controls preload="metadata" />
              </div>
            ) : (
              <div className="media placeholder" />
            ))}

          {it.kind === 'note' && (
            /* The writing takes its colour from the paper. A note can be any
               colour the swatches offer, black among them, and dark ink on
               dark paper is a note you cannot read — which was true before
               swatches existed and is unmissable now that a palette makes
               five dark ones at a time. */
            <div className="note" style={{ background: it.color || '#FBEFC4', color: inkOn(it.color || '#FBEFC4') }}>
              <RichText id={id} text={it.text || ''} />
            </div>
          )}

          {it.kind === 'link' && (
            <a className="link-card" href={it.url} target="_blank" rel="noreferrer noopener">
              <span className="link-host">{hostOf(it.url)}</span>
              <span className="link-url">{it.url}</span>
            </a>
          )}

          {it.kind === 'file' && (
            <div className="file-card">
              <span className="file-ext">{extOf(it.name)}</span>
              <span className="file-name">{it.name}</span>
              {url && (
                <a className="file-dl" href={url} download={it.name}>
                  Download
                </a>
              )}
            </div>
          )}
        </div>

        {fx.grain > 0 && (
          <div className="grain" style={{ opacity: fx.grain / 100, backgroundImage: GRAIN_URL }} />
        )}
      </div>
      )}

    </div>
    {!dim && <Ports id={id} x={it.x} y={it.y} w={it.w} h={it.h} />}
    {selected && !dim && <Handles id={id} x={it.x} y={it.y} w={it.w} h={it.h} onContextMenu={onContextMenu} />}
    </>
  )
})

/* ---------------------------------------------------------------------------
 * Connection ports.
 *
 * Four dots on the sides of a card, hidden until the card is hovered or
 * selected. Dragging from one draws a wire to wherever you let go; letting go
 * on another card connects the two.
 *
 * They sit in their own layer, immediately after the card in the document, so
 * that hovering the card can show them: the pointer stays over the card while
 * it crosses them, because the layer itself takes no pointer events and only
 * the dots do.
 * ------------------------------------------------------------------------- */
function Ports({ id, x, y, w, h }: { id: string; x: number; y: number; w: number; h: number }) {
  return (
    <div className="card-ports" style={{ transform: `translate3d(${x}px, ${y}px, 0)`, width: w, height: h }}>
      {(['n', 'e', 's', 'w'] as const).map((s) => (
        <i key={s} className={`port port-${s}`} data-port={s} onPointerDown={(e) => startWire(e, id, s)} />
      ))}
    </div>
  )
}

/* The card under a point on screen, whatever part of it is there. Sections
 * are not cards for this purpose: they are the ground other cards sit on, and
 * they have no ports of their own to wire back from. */
function cardUnder(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  const card = el?.closest('.card') as HTMLElement | null
  if (!card || card.classList.contains('card-section')) return null
  return card.dataset.id || null
}

function startWire(e: React.PointerEvent, id: string, side: Side) {
  e.stopPropagation()
  e.preventDefault()
  const from = store.getItem(id)
  const vp = document.querySelector('.viewport') as HTMLElement | null
  const preview = document.querySelector('.wire-preview') as SVGPathElement | null
  if (!from || !vp || !preview) return

  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  let over: HTMLElement | null = null

  const move = (ev: PointerEvent) => {
    const r = vp.getBoundingClientRect()
    const p = screenToBoard(store.peekView(), ev.clientX - r.left, ev.clientY - r.top)
    /* Written straight to the DOM: this runs at pointer rate and has nothing
     * to do with the board's contents until it is let go of. */
    preview.setAttribute('d', wireToPoint(from, side, p.x, p.y))
    preview.setAttribute('data-on', '')
    const hit = cardUnder(ev.clientX, ev.clientY)
    const el = hit && hit !== id ? (document.querySelector(`.card[data-id="${hit}"]`) as HTMLElement | null) : null
    if (el !== over) {
      over?.removeAttribute('data-wire-over')
      el?.setAttribute('data-wire-over', '')
      over = el
    }
  }

  const up = (ev: PointerEvent) => {
    target.releasePointerCapture(e.pointerId)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    preview.removeAttribute('d')
    preview.removeAttribute('data-on')
    over?.removeAttribute('data-wire-over')
    const hit = cardUnder(ev.clientX, ev.clientY)
    /* No gesture snapshot: adding the wire takes one of its own, and two
     * would mean two presses of undo to take it away again. */
    if (hit && hit !== id) {
      const made = store.connect(id, hit)
      if (made) store.select([made])
    }
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/* ---------------------------------------------------------------------------
 * Resize handles.
 *
 * These sit in their own layer rather than inside the card. A card clips its
 * contents so the picture keeps the rounded corners, and handles straddling
 * the border were being clipped away with it. They still drew a few pixels of
 * themselves, but the part you would reach for was outside the clip and took
 * no clicks, so dragging a corner started a selection rectangle instead.
 * ------------------------------------------------------------------------- */
function Handles({
  id, x, y, w, h, onContextMenu,
}: {
  id: string
  x: number
  y: number
  w: number
  h: number
  onContextMenu: (e: React.MouseEvent, id: string) => void
}) {
  return (
    <div
      className="card-handles"
      style={{ transform: `translate3d(${x}px, ${y}px, 0)`, width: w, height: h }}
      /* Pressing on an unselected card selects it, which draws these handles
       * straight under the pointer. The contextmenu event that follows then
       * lands on a handle rather than the card, so right clicking near a
       * corner produced no menu at all. Handles hand it back to the card. */
      onContextMenu={(e) => onContextMenu(e, id)}
    >
      {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
        <i
          key={c}
          className={`handle handle-${c}`}
          data-resize={c}
          onPointerDown={(e) => startResize(e, id, c)}
        />
      ))}
    </div>
  )
}

/* Stable per-card seed so grain and dithering do not crawl between renders. */
function hashSeed(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % 997
}

const hostOf = (u?: string) => {
  try {
    return new URL(u || '').hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}
const extOf = (n?: string) => (n || 'file').split('.').pop()!.slice(0, 5).toUpperCase()

/* Resize drags write straight to the store; the pointer capture keeps the
 * gesture alive even when the cursor leaves the card. */
function startResize(e: React.PointerEvent, id: string, corner: string) {
  e.stopPropagation()
  e.preventDefault()
  const it = store.getItem(id)
  if (!it) return
  const z = store.peekView().z || 1
  const sx = e.clientX
  const sy = e.clientY
  const s = { x: it.x, y: it.y, w: it.w, h: it.h }
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  let began = false

  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / z
    const dy = (ev.clientY - sy) / z
    if (!began && Math.hypot(dx, dy) >= 2) {
      /* One snapshot for the whole resize, taken once it really starts. */
      store.beginGesture()
      began = true
    }
    let { x, y, w, h } = s
    if (corner.includes('e')) w = Math.max(80, s.w + dx)
    if (corner.includes('s')) h = Math.max(60, s.h + dy)
    if (corner.includes('w')) {
      w = Math.max(80, s.w - dx)
      x = s.x + (s.w - w)
    }
    if (corner.includes('n')) {
      h = Math.max(60, s.h - dy)
      y = s.y + (s.h - h)
    }
    store.update(id, { x, y, w: Math.round(w), h: Math.round(h) }, false)
  }
  const up = () => {
    target.releasePointerCapture(e.pointerId)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

const TickIcon = () => (
  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.4 6.3 4.7 8.6 9.6 3.6" />
  </svg>
)
const CrossIcon = () => (
  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
    <path d="M3.2 3.2 8.8 8.8M8.8 3.2 3.2 8.8" />
  </svg>
)
