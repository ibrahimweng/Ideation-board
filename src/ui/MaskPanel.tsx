import { useState } from 'react'
import { Slider } from './Slider'
import { DEV_0, devOf, rangeOf } from '../state/develop'
import type { DevKey, Develop } from '../state/develop'
import {
  BLUR_KINDS,
  BLUR_STARTS,
  MASK_KEYS,
  MASK_KINDS,
  MAX_PARTS,
  kindName,
  maskEmpty,
  newBlurMask,
  newMask,
  newPart,
  trimMaskDev,
} from '../state/mask'
import type { Blur, Mask, MaskKind, MaskOp, MaskPart } from '../state/mask'
import { hideMask, showMask, useShowing } from '../board/showmask'

/* ---------------------------------------------------------------------------
 * The masks panel.
 *
 * A list of masks, and inside the open one: what it is made of, and what it
 * does there. Lightroom's shape exactly, because Lightroom's shape is the one
 * that makes the two questions separable — "where" is the parts, "what" is the
 * sliders, and being able to change one without disturbing the other is the
 * whole reason to have masks rather than a stack of cropped copies.
 *
 * The parts combine in order: the first one is the mask, and each one after it
 * adds to what is there, subtracts itself from it, or keeps only the overlap.
 * Three operations is the complete set — everything anybody draws with masks
 * is some sentence in those three, and a fourth would be a second way to say
 * one of them.
 * ------------------------------------------------------------------------- */

function OpPicker({ value, onChange }: { value: MaskOp; onChange: (op: MaskOp) => void }) {
  const ops: { k: MaskOp; label: string; title: string }[] = [
    { k: 'add', label: 'Add', title: 'And this as well' },
    { k: 'sub', label: 'Subtract', title: 'But not this' },
    { k: 'int', label: 'Intersect', title: 'Only where both' },
  ]
  return (
    <div className="mask-ops">
      {ops.map((o) => (
        <button key={o.k} data-on={value === o.k || undefined} title={o.title} onClick={() => onChange(o.k)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* The controls a part of each kind needs, and nothing else. A luminance range
 * has no centre and a radial gradient has no tolerance, and showing either the
 * greyed-out other is how a panel becomes a form. */
function PartControls({ part, onChange }: { part: MaskPart; onChange: (p: Partial<MaskPart>) => void }) {
  const k = part.kind
  if (k === 'linear' || k === 'radial') {
    return (
      <>
        {k === 'radial' && (
          <>
            <Slider label="Size" min={2} max={100} step={1} def={30} value={Math.round((part.rx ?? 0.3) * 100)}
                    onChange={(v) => onChange({ rx: v / 100, ry: ((part.ry ?? 0.3) / Math.max(part.rx ?? 0.3, 1e-3)) * (v / 100) })} />
            <Slider label="Roundness" min={-100} max={100} step={1} def={0}
                    value={Math.round((((part.ry ?? 0.3) / Math.max(part.rx ?? 0.3, 1e-3)) - 1) * 100)}
                    onChange={(v) => onChange({ ry: (part.rx ?? 0.3) * (1 + v / 100) })} />
            <Slider label="Angle" min={-180} max={180} step={1} def={0} unit="°" value={part.rot ?? 0} onChange={(v) => onChange({ rot: v })} />
          </>
        )}
        <Slider label="Feather" min={0} max={100} step={1} def={50} value={part.feather ?? 50} onChange={(v) => onChange({ feather: v })} />
        <p className="panel-note">Drag it on the picture itself.</p>
      </>
    )
  }
  if (k === 'brush') {
    const strokes = part.strokes || []
    const last = strokes[strokes.length - 1]
    return (
      <>
        <Slider label="Size" min={1} max={60} step={1} def={12} value={last?.size ?? 12} onChange={(v) => onChange({ strokes: bumpBrush(strokes, { size: v }) })} />
        <Slider label="Softness" min={0} max={100} step={1} def={60} value={last?.soft ?? 60} onChange={(v) => onChange({ strokes: bumpBrush(strokes, { soft: v }) })} />
        <Slider label="Flow" min={5} max={100} step={1} def={100} value={last?.flow ?? 100} onChange={(v) => onChange({ strokes: bumpBrush(strokes, { flow: v }) })} />
        <p className="panel-note">
          {strokes.length ? `${strokes.length} ${strokes.length === 1 ? 'stroke' : 'strokes'}. ` : 'Nothing painted yet. '}
          Paint on the picture; hold Alt to rub out.
        </p>
        {strokes.length > 0 && (
          <button className="ghost" onClick={() => onChange({ strokes: strokes.slice(0, -1) })}>
            Undo the last stroke
          </button>
        )}
      </>
    )
  }
  if (k === 'whole') {
    return <p className="panel-note">Everything. Add a part below and subtract it to leave a hole.</p>
  }
  if (k === 'colour') {
    const hex = rgbHex(part.r ?? 0.5, part.g ?? 0.5, part.b ?? 0.5)
    return (
      <>
        <label className="mask-pick">
          <span>Colour</span>
          <input type="color" value={hex} onChange={(e) => onChange(hexRgb(e.target.value))} />
        </label>
        <Slider label="Range" min={1} max={100} step={1} def={30} value={part.tol ?? 30} onChange={(v) => onChange({ tol: v })} />
        <p className="panel-note">Or click the picture to pick the colour off it.</p>
      </>
    )
  }
  /* Luminance and depth are the same question asked of two different pictures,
     so they are the same three controls. */
  const isDepth = k === 'depth'
  return (
    <>
      <Slider label={isDepth ? 'Nearest' : 'Darkest'} min={0} max={100} step={1} def={isDepth ? 0 : 60} value={part.lo ?? 0} onChange={(v) => onChange({ lo: Math.min(v, part.hi ?? 100) })} />
      <Slider label={isDepth ? 'Furthest' : 'Brightest'} min={0} max={100} step={1} def={isDepth ? 40 : 100} value={part.hi ?? 100} onChange={(v) => onChange({ hi: Math.max(v, part.lo ?? 0) })} />
      <Slider label="Softness" min={0} max={100} step={1} def={20} value={part.tol ?? 20} onChange={(v) => onChange({ tol: v })} />
      {isDepth && <p className="panel-note">Wire a depth map into this card for this to have anything to read.</p>}
    </>
  )
}

/* A brush setting changes the brush, not the strokes already down — so it
 * lands on a new empty stroke that the next drag will fill, and the strokes
 * behind it keep the size they were painted at. */
function bumpBrush(strokes: { pts: number[]; size: number; soft: number; flow: number; erase?: boolean }[], patch: Record<string, number>) {
  const last = strokes[strokes.length - 1]
  const base = { ...{ size: 12, soft: 60, flow: 100 }, ...(last || {}), pts: [] as number[] }
  const next = { ...base, ...patch }
  /* An empty stroke on the end is the brush itself; replace it rather than
     growing a list of them. */
  if (last && last.pts.length === 0) return [...strokes.slice(0, -1), next]
  return [...strokes, next]
}

const rgbHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')).join('')

const hexRgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
})

function OneMask({
  card, mask, open, onOpen, onChange, onDrop, onDuplicate,
}: {
  card: string
  mask: Mask
  open: boolean
  onOpen: () => void
  onChange: (m: Mask, discrete?: boolean) => void
  onDrop: () => void
  onDuplicate: () => void
}) {
  const showing = useShowing(mask.id)
  const [addOpen, setAddOpen] = useState(false)

  const setPart = (i: number, patch: Partial<MaskPart>) =>
    onChange({ ...mask, parts: mask.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  const addPart = (kind: MaskKind) => {
    setAddOpen(false)
    onChange({ ...mask, parts: [...mask.parts, newPart(kind, 'add')] }, true)
  }

  const setBlur = (patch: Partial<Blur>) => {
    const cur: Blur = mask.blur || { kind: 'defocus', amount: 0, angle: 0, cx: 0.5, cy: 0.5 }
    const next = { ...cur, ...patch }
    onChange({ ...mask, blur: next.amount > 0 ? next : undefined })
  }

  const S = (k: DevKey) => {
    const r = rangeOf(k)!
    return (
      <Slider
        key={k}
        label={r.label}
        min={r.min}
        max={r.max}
        step={r.step}
        unit={r.unit}
        def={DEV_0[k]}
        value={devOf(mask.dev, k)}
        onChange={(v) => onChange({ ...mask, dev: trimMaskDev({ ...(mask.dev || {}), [k]: v } as Develop) })}
      />
    )
  }

  return (
    <div className="mask" data-open={open || undefined} data-off={mask.off || undefined}>
      <div className="mask-head">
        <button className="mask-name" onClick={onOpen} aria-expanded={open}>
          <i className="dev-caret" aria-hidden />
          {mask.name}
          {maskEmpty(mask) && <span className="mask-warn">empty</span>}
        </button>
        <button
          className="mask-eye"
          data-on={showing || undefined}
          title={showing ? 'Stop showing where it is' : 'Show where it is'}
          aria-pressed={showing}
          onClick={() => (showing ? hideMask(mask.id) : showMask(card, mask.id))}
        >
          Show
        </button>
        <button
          className="mask-off"
          data-on={!mask.off || undefined}
          title={mask.off ? 'Switch it back on' : 'Switch it off, but keep it'}
          aria-pressed={!mask.off}
          onClick={() => onChange({ ...mask, off: !mask.off }, true)}
        >
          {mask.off ? 'Off' : 'On'}
        </button>
      </div>

      {open && (
        <div className="mask-body">
          <h5>Where</h5>
          {mask.parts.map((p, i) => (
            <div className="mask-part" key={i}>
              <div className="mask-part-head">
                {i > 0 && <OpPicker value={p.op || 'add'} onChange={(op) => setPart(i, { op })} />}
                <span className="mask-part-name">{kindName(p.kind)}</span>
                <button
                  className="mask-inv"
                  data-on={p.inv || undefined}
                  title="Everywhere except here"
                  aria-pressed={!!p.inv}
                  onClick={() => setPart(i, { inv: !p.inv })}
                >
                  Invert
                </button>
                {mask.parts.length > 1 && (
                  <button
                    className="mask-drop"
                    title="Take this part out"
                    onClick={() => onChange({ ...mask, parts: mask.parts.filter((_, j) => j !== i) }, true)}
                  >
                    ×
                  </button>
                )}
              </div>
              <PartControls part={p} onChange={(patch) => setPart(i, patch)} />
            </div>
          ))}

          {mask.parts.length < MAX_PARTS && (
            <div className="mask-add">
              <button className="ghost" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen}>
                Add to this mask
              </button>
              {addOpen && (
                <div className="mask-kinds">
                  {MASK_KINDS.map((m) => (
                    <button key={m.k} title={m.hint} onClick={() => addPart(m.k)}>
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <h5>Blur</h5>
          {/* Photoshop's gallery is five entries on a submenu and every one of
              them is this: a shape of blur, and a mask saying where. The
              shapes are here; the where is the parts above. */}
          <div className="mask-blurkinds">
            {BLUR_KINDS.map((b) => (
              <button
                key={b.k}
                data-on={(mask.blur?.kind || 'defocus') === b.k && (mask.blur?.amount || 0) > 0 || undefined}
                title={b.hint}
                onClick={() =>
                  onChange(
                    {
                      ...mask,
                      blur: {
                        kind: b.k,
                        amount: mask.blur?.amount || 45,
                        angle: mask.blur?.angle ?? 0,
                        cx: mask.blur?.cx ?? 0.5,
                        cy: mask.blur?.cy ?? 0.5,
                      },
                    },
                    true
                  )
                }
              >
                {b.name}
              </button>
            ))}
          </div>
          <Slider
            label="Blur"
            min={0}
            max={100}
            step={1}
            def={0}
            value={mask.blur?.amount ?? 0}
            onChange={(v) => setBlur({ amount: v })}
          />
          {mask.blur?.kind === 'motion' && (
            <Slider label="Direction" min={-180} max={180} step={1} def={0} unit="°" value={mask.blur.angle ?? 0} onChange={(v) => setBlur({ angle: v })} />
          )}
          {(mask.blur?.kind === 'spin' || mask.blur?.kind === 'zoom') && (
            <p className="panel-note">Drag the cross on the picture to say where it turns from.</p>
          )}

          <h5>What it does there</h5>
          <Slider
            label="Amount"
            min={0}
            max={100}
            step={1}
            def={100}
            unit="%"
            value={mask.amount ?? 100}
            onChange={(v) => onChange({ ...mask, amount: v })}
          />
          {MASK_KEYS.map(S)}

          <div className="mask-foot">
            <button className="ghost" onClick={onDuplicate}>Duplicate</button>
            <button className="ghost" onClick={onDrop}>Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function MaskPanel({
  card, masks, onChange,
}: {
  card: string
  masks: Mask[]
  onChange: (masks: Mask[] | undefined, discrete?: boolean) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [blurring, setBlurring] = useState(false)

  const add = (kind: MaskKind) => {
    setAdding(false)
    const n = masks.filter((m) => m.parts[0]?.kind === kind).length + 1
    const m = newMask(kind, n)
    onChange([...masks, m], true)
    setOpen(m.id)
    /* Straight into the overlay, because a mask nobody can see is not yet a
       place — and this is the moment it is being put somewhere. */
    showMask(card, m.id)
  }

  const addBlur = (start: string) => {
    setBlurring(false)
    const n = masks.filter((k) => !!k.blur).length + 1
    const m = newBlurMask(start, n)
    onChange([...masks, m], true)
    setOpen(m.id)
    showMask(card, m.id)
  }

  const put = (m: Mask, discrete?: boolean) =>
    onChange(masks.map((k) => (k.id === m.id ? m : k)), discrete)

  return (
    <section className="fx-controls masks">
      <h4>Masks</h4>
      <p className="fx-hint">Where an edit happens. Everything above is the whole picture; everything here is one part of it.</p>

      <div className="mask-list">
        {masks.map((m) => (
          <OneMask
            key={m.id}
            card={card}
            mask={m}
            open={open === m.id}
            onOpen={() => setOpen((o) => (o === m.id ? null : m.id))}
            onChange={put}
            onDuplicate={() => {
              const copy = { ...m, id: newMask('linear').id, name: `${m.name} copy` }
              onChange([...masks, copy], true)
              setOpen(copy.id)
            }}
            onDrop={() => {
              hideMask(m.id)
              const left = masks.filter((k) => k.id !== m.id)
              onChange(left.length ? left : undefined, true)
            }}
          />
        ))}
      </div>

      <div className="mask-add">
        <button className="ghost" onClick={() => { setBlurring(false); setAdding((a) => !a) }} aria-expanded={adding}>
          New mask
        </button>
        {adding && (
          <div className="mask-kinds">
            {MASK_KINDS.map((m) => (
              <button key={m.k} title={m.hint} onClick={() => add(m.k)}>
                <b>{m.name}</b>
                <small>{m.hint}</small>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* And the five entries off Photoshop's gallery, as five starting
          points. Each is a mask already put where that kind of blur belongs,
          so the next thing anybody does is drag it — which is the answer to
          "where does the blur come from". */}
      <div className="mask-add blurs">
        <button className="ghost" onClick={() => { setAdding(false); setBlurring((b) => !b) }} aria-expanded={blurring}>
          New blur
        </button>
        {blurring && (
          <div className="mask-kinds">
            {BLUR_STARTS.map((b) => (
              <button key={b.k} title={b.hint} onClick={() => addBlur(b.k)}>
                <b>{b.name}</b>
                <small>{b.hint}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
