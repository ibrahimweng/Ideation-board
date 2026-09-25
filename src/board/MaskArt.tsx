import { useRef } from 'react'
import { store, useItem, useViewport } from '../state/store'
import { trimDev } from '../state/develop'
import type { MaskPart, Stroke } from '../state/mask'
import { holdPress } from './press'
import { useBrushSlot } from './paintpart'

/* ---------------------------------------------------------------------------
 * Putting a mask somewhere.
 *
 * The panel can say how soft a gradient is and how far the colour range
 * reaches. It cannot say where — where is a place on a photograph, and the
 * only honest way to give a place is to point at it. So the controls for that
 * are on the picture, over the red overlay that shows what they are doing,
 * which is how every editor that has ever had masks has done it and is the
 * reason the red overlay exists at all.
 *
 * Four gestures, one per kind:
 *
 *   linear    drag either end of the line; drag the line to slide the whole
 *             gradient without changing its angle or its length
 *   radial    drag the middle to move it, the edge to resize it, and the
 *             mark on the rim to turn it
 *   brush     drag to paint, alt-drag to rub out
 *   colour    click to take the colour from under the pointer
 *
 * Coordinates are the picture's own, nought to one across and down, which is
 * exactly what the shader reads — so this sits inside the card's frame and is
 * moved, zoomed, turned and flipped by the same transform the picture is. A
 * handle that stayed put while the picture under it moved would be pointing
 * at the wrong thing.
 * ------------------------------------------------------------------------- */

/* How big the marks are, in screen pixels, divided back out by the board's
 * zoom — both are questions about how well somebody can aim rather than about
 * the photograph. */
const GRIP = 7
const HIT = 14

export function MaskArt({ id, maskId }: { id: string; maskId: string }) {
  const it = useItem(id)
  const { z } = useViewport()
  const box = useRef<HTMLDivElement>(null)
  const masks = it?.fx?.dev?.masks
  const mask = masks?.find((m) => m.id === maskId)
  /* Before the early return, because a hook behind a condition is a hook that
   * takes the board down the first time the condition changes. */
  const brushAt = useBrushSlot(maskId, mask?.parts.map((p) => p.kind) || [])
  if (!it || !mask) return null

  const w = it.w
  const h = it.h
  /* The handles sit inside the card's frame, which is what keeps them on the
   * picture when it is zoomed, moved, turned or flipped. The cost is that the
   * frame's own scale is applied to them as well as to the photograph — so a
   * picture zoomed to 1.6 had handles 1.6 times too big, and one zoomed out
   * had handles nobody could hit. Divided back out here, along with the
   * board's zoom, because both are questions about how well somebody can aim
   * rather than about the picture. */
  const cardZoom = Math.max(0.05, it.fx?.zoom || 1)
  const g = GRIP / (z * cardZoom)
  const hit = HIT / (z * cardZoom)

  /* Where the pointer is, in the picture's own nought-to-one. */
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return { x: 0.5, y: 0.5 }
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const putParts = (parts: MaskPart[], record: boolean) => {
    const next = (masks || []).map((m) => (m.id === maskId ? { ...m, parts } : m))
    store.update(id, { fx: { ...it.fx, dev: trimDev({ ...(it.fx.dev || {}), masks: next }) } }, record)
  }

  const setPart = (i: number, patch: Partial<MaskPart>, record: boolean) =>
    putParts(mask.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)), record)

  /* Every drag in here is the same shape: one snapshot when it really starts,
     and the numbers written straight onto the record while it runs. */
  const drag = (
    e: React.PointerEvent,
    step: (at: { x: number; y: number }, from: { x: number; y: number }, alt: boolean) => void
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    holdPress()
    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)
    const from = local(e)
    let began = false
    const move = (ev: PointerEvent) => {
      if (!began) {
        store.beginGesture()
        began = true
      }
      step(local(ev), from, ev.altKey)
    }
    const up = () => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---- one part's handles ---- */
  const artFor = (p: MaskPart, i: number) => {
    if (p.kind === 'linear') {
      const x1 = (p.x1 ?? 0.5) * w
      const y1 = (p.y1 ?? 0.05) * h
      const x2 = (p.x2 ?? 0.5) * w
      const y2 = (p.y2 ?? 0.45) * h
      /* The three lines a linear gradient is drawn as everywhere: the one you
         dragged, and one through each end at right angles to it, which is
         where the effect is full and where it has run out. */
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1
      const nx = (-dy / len) * Math.max(w, h)
      const ny = (dx / len) * Math.max(w, h)
      return (
        <g key={i} className="mk-linear">
          <line className="mk-edge" x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} />
          <line className="mk-edge mk-faint" x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} />
          <line
            className="mk-spine"
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            strokeWidth={hit}
            onPointerDown={(e) =>
              drag(e, (at, f) =>
                setPart(i, {
                  x1: (p.x1 ?? 0.5) + (at.x - f.x),
                  y1: (p.y1 ?? 0.05) + (at.y - f.y),
                  x2: (p.x2 ?? 0.5) + (at.x - f.x),
                  y2: (p.y2 ?? 0.45) + (at.y - f.y),
                }, false)
              )
            }
          />
          <circle className="mk-grip" cx={x1} cy={y1} r={g} onPointerDown={(e) => drag(e, (at) => setPart(i, { x1: at.x, y1: at.y }, false))} />
          <circle className="mk-grip mk-open" cx={x2} cy={y2} r={g} onPointerDown={(e) => drag(e, (at) => setPart(i, { x2: at.x, y2: at.y }, false))} />
        </g>
      )
    }

    if (p.kind === 'radial') {
      const cx = (p.cx ?? 0.5) * w
      const cy = (p.cy ?? 0.5) * h
      const rx = (p.rx ?? 0.3) * w
      const ry = (p.ry ?? 0.3) * h
      const rot = p.rot ?? 0
      return (
        <g key={i} className="mk-radial" transform={`rotate(${rot} ${cx} ${cy})`}>
          <ellipse
            className="mk-ring"
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            strokeWidth={hit}
            onPointerDown={(e) =>
              drag(e, (at) => {
                const ddx = (at.x - (p.cx ?? 0.5)) * w
                const ddy = (at.y - (p.cy ?? 0.5)) * h
                const k = Math.max(0.02, Math.hypot(ddx / Math.max(rx, 1), ddy / Math.max(ry, 1)))
                setPart(i, { rx: Math.min(2, (p.rx ?? 0.3) * k), ry: Math.min(2, (p.ry ?? 0.3) * k) }, false)
              })
            }
          />
          <ellipse className="mk-ring mk-faint" cx={cx} cy={cy} rx={rx * (1 - (p.feather ?? 50) / 100)} ry={ry * (1 - (p.feather ?? 50) / 100)} />
          <circle
            className="mk-grip"
            cx={cx}
            cy={cy}
            r={g}
            onPointerDown={(e) =>
              drag(e, (at, f) => setPart(i, { cx: (p.cx ?? 0.5) + (at.x - f.x), cy: (p.cy ?? 0.5) + (at.y - f.y) }, false))
            }
          />
          <circle
            className="mk-grip mk-open"
            cx={cx}
            cy={cy - ry}
            r={g}
            onPointerDown={(e) =>
              drag(e, (at) => {
                const a = (Math.atan2(at.y * h - cy, at.x * w - cx) * 180) / Math.PI + 90
                setPart(i, { rot: Math.round(a) }, false)
              })
            }
          />
        </g>
      )
    }

    return null
  }

  /* ---- where a spin turns from, or a zoom runs out of ---- */
  const spin = mask.blur && (mask.blur.kind === 'spin' || mask.blur.kind === 'zoom') && mask.blur.amount > 0
    ? mask.blur
    : null
  const putBlur = (patch: { cx: number; cy: number }) => {
    const next = (masks || []).map((m) => (m.id === maskId ? { ...m, blur: { ...m.blur!, ...patch } } : m))
    store.update(id, { fx: { ...it.fx, dev: trimDev({ ...(it.fx.dev || {}), masks: next }) } }, false)
  }

  /* ---- where a repair takes its pixels from ---- */
  const clone = mask.clone
  const putClone = (patch: { ox: number; oy: number }) => {
    const next = (masks || []).map((m) => (m.id === maskId ? { ...m, clone: { ...m.clone!, ...patch } } : m))
    store.update(id, { fx: { ...it.fx, dev: trimDev({ ...(it.fx.dev || {}), masks: next }) } }, false)
  }

  /* Where to draw it: the middle of whatever the mask is made of, plus the
     offset. A repair with nowhere obvious to anchor is anchored at the middle
     of the frame, which is still somewhere to take hold of. */
  const anchor = () => {
    const p = mask.parts[0]
    if (!p) return { x: 0.5, y: 0.5 }
    if (p.kind === 'radial') return { x: p.cx ?? 0.5, y: p.cy ?? 0.5 }
    if (p.kind === 'linear') return { x: ((p.x1 ?? 0.5) + (p.x2 ?? 0.5)) / 2, y: ((p.y1 ?? 0.5) + (p.y2 ?? 0.5)) / 2 }
    if (p.kind === 'brush') {
      const pts = (p.strokes || []).flatMap((st) => st.pts)
      if (pts.length >= 2) {
        let sx = 0
        let sy = 0
        for (let i = 0; i < pts.length; i += 2) {
          sx += pts[i]
          sy += pts[i + 1]
        }
        const n = pts.length / 2
        return { x: sx / n, y: sy / n }
      }
    }
    return { x: 0.5, y: 0.5 }
  }

  /* ---- painting, and picking a colour off the picture ---- */
  /* `brushAt` is worked out at the top: not simply the first brush, because a
   * mask can hold several and the reason to hold several is that one of them
   * takes away what another put down — so "the first one" would have meant
   * the second could never be painted, and the part that subtracts would have
   * stayed empty for ever. */
  const pickAt = mask.parts.findIndex((p) => p.kind === 'colour')

  const paint = (e: React.PointerEvent) => {
    if (e.button !== 0 || brushAt < 0) return
    e.stopPropagation()
    e.preventDefault()
    holdPress()
    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)
    const part = mask.parts[brushAt]
    const had = part.strokes || []
    /* The brush is the last stroke's settings, which is what the panel's
       sliders have been writing to. */
    const tip = had[had.length - 1]
    const s: Stroke = {
      pts: [],
      size: tip?.size ?? 12,
      soft: tip?.soft ?? 60,
      flow: tip?.flow ?? 100,
      ...(e.altKey ? { erase: true } : null),
    }
    /* An empty stroke on the end is the brush itself rather than a mark, so
       this one takes its place instead of piling up behind it. */
    const base = tip && tip.pts.length === 0 ? had.slice(0, -1) : had
    const at = local(e)
    s.pts = [at.x, at.y]
    store.beginGesture()
    setPart(brushAt, { strokes: [...base, s] }, false)

    let last = at
    const move = (ev: PointerEvent) => {
      const p = local(ev)
      /* Thinned, because a pointer at 240Hz gives four hundred points for a
         stroke the eye reads as one line, and every one of them is saved,
         re-baked and re-uploaded. */
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.006) return
      last = p
      s.pts = [...s.pts, p.x, p.y]
      setPart(brushAt, { strokes: [...base, { ...s }] }, false)
    }
    const up = () => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pick = (e: React.PointerEvent) => {
    if (e.button !== 0 || pickAt < 0) return
    e.stopPropagation()
    e.preventDefault()
    holdPress()
    const at = local(e)
    /* Read off whatever is drawing the card — which while the overlay is up is
       the overlay, so the picture is read from the element underneath it
       rather than from what is on screen. */
    const card = box.current?.closest('.card')
    const el = card?.querySelector('img.media') as HTMLImageElement | null
    const src = el || (card?.querySelector('canvas.media') as HTMLCanvasElement | null)
    if (!src) return
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    try {
      ctx.drawImage(src as CanvasImageSource, 0, 0, 64, 64)
      const d = ctx.getImageData(
        Math.max(0, Math.min(63, Math.round(at.x * 64))),
        Math.max(0, Math.min(63, Math.round(at.y * 64))),
        1,
        1
      ).data
      setPart(pickAt, { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255 }, true)
    } catch {
      /* A picture from a host that will not let its pixels be read. The panel
         still has its colour well. */
    }
  }

  const ground = brushAt >= 0 ? paint : pickAt >= 0 ? pick : undefined

  return (
    <div className="mask-art" ref={box} data-brush={brushAt >= 0 || undefined}>
      {/* Stretched to the box rather than fitted into it: `local` reads the
          pointer against the div, so a drawing that letterboxed itself inside
          the same div would put every handle somewhere other than where it
          can be grabbed. */}
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
        {ground && (
          <rect
            className="mk-ground"
            x={0}
            y={0}
            width={w}
            height={h}
            onPointerDown={ground}
          />
        )}
        {mask.parts.map(artFor)}
        {clone && (() => {
          const a = anchor()
          const sx = (a.x + clone.ox) * w
          const sy = (a.y + clone.oy) * h
          const r = Math.max(g * 2.6, Math.min(w, h) * 0.05)
          return (
            <g className="mk-clone">
              {/* A line from what is being repaired to where the good pixels
                  are coming from, because the two only mean anything as a
                  pair. */}
              <line className="mk-edge mk-faint" x1={a.x * w} y1={a.y * h} x2={sx} y2={sy} />
              <circle
                className="mk-ring"
                cx={sx}
                cy={sy}
                r={r}
                strokeWidth={hit}
                onPointerDown={(e) =>
                  drag(e, (at, f) => putClone({ ox: clone.ox + (at.x - f.x), oy: clone.oy + (at.y - f.y) }))
                }
              />
              <circle className="mk-grip mk-open" cx={sx} cy={sy} r={g} />
            </g>
          )
        })()}
        {spin && (
          /* A cross rather than a dot, because what it marks is a centre and a
             dot on a photograph is indistinguishable from a speck on it. */
          <g
            className="mk-centre"
            onPointerDown={(e) =>
              drag(e, (at, f) =>
                putBlur({ cx: (spin.cx ?? 0.5) + (at.x - f.x), cy: (spin.cy ?? 0.5) + (at.y - f.y) })
              )
            }
          >
            <circle className="mk-hit" cx={(spin.cx ?? 0.5) * w} cy={(spin.cy ?? 0.5) * h} r={hit} />
            <line className="mk-cross" x1={(spin.cx ?? 0.5) * w - g * 1.6} y1={(spin.cy ?? 0.5) * h} x2={(spin.cx ?? 0.5) * w + g * 1.6} y2={(spin.cy ?? 0.5) * h} />
            <line className="mk-cross" x1={(spin.cx ?? 0.5) * w} y1={(spin.cy ?? 0.5) * h - g * 1.6} x2={(spin.cx ?? 0.5) * w} y2={(spin.cy ?? 0.5) * h + g * 1.6} />
            <circle className="mk-grip mk-open" cx={(spin.cx ?? 0.5) * w} cy={(spin.cy ?? 0.5) * h} r={g} />
          </g>
        )}
      </svg>
    </div>
  )
}
