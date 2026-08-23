import { memo, useMemo, useState } from 'react'
import { store, useSelection, useItem } from '../state/store'
import { EFFECTS, GROUPS, BY_ID, defaults } from '../engine/effects'
import { isColor, isEnum } from '../engine/types'
import type { Control, Params, FxState } from '../engine/types'
import { FxCanvas } from '../board/FxCanvas'
import { useSourceReady } from '../board/sources'
import { LooksTab } from './LooksTab'
import { IconEffects, IconSearch } from './icons'

/* ---------------------------------------------------------------------------
 * Effects panel.
 *
 * The previous version built its preview strip by rendering five effects per
 * animation frame and calling toDataURL('image/jpeg') on each — a synchronous
 * CPU encode plus a fresh canvas allocation — then setState on every frame,
 * which re-rendered the entire board.
 *
 * Each preview here is just another FxCanvas at 132px. It goes through the
 * same worker, the same resident texture and the same zero-copy delivery as a
 * full card, so the strip costs a handful of small draw calls and no encoding.
 * ------------------------------------------------------------------------- */

const PRESETS: { id: string; name: string; vals: Partial<FxState> }[] = [
  { id: 'none', name: 'Original', vals: {} },
  { id: 'bw', name: 'B&W', vals: { sat: 0, con: 12 } },
  { id: 'noir', name: 'Noir', vals: { sat: 0, con: 36, exp: -8 } },
  { id: 'faded', name: 'Faded', vals: { sat: 74, con: -18, exp: 10, warm: 12 } },
  { id: 'warm', name: 'Warm', vals: { warm: 28, sat: 112, exp: 4 } },
  { id: 'cool', name: 'Cool', vals: { warm: -26, sat: 106, con: 8 } },
  { id: 'punch', name: 'Punch', vals: { con: 28, sat: 134 } },
  { id: 'print', name: 'Print', vals: { sat: 86, con: 12, grain: 30, warm: 8 } },
]

export type PanelTab = 'effect' | 'adjust' | 'looks'

interface Props {
  tab: PanelTab
  onTab: (t: PanelTab) => void
  say: (msg: string) => void
}

export function EffectsPanel({ tab, onTab, say }: Props) {
  const selection = useSelection()
  const [find, setFind] = useState('')
  const found = useMemo(() => {
    const q = find.trim().toLowerCase()
    if (!q) return GROUPS
    return GROUPS.map((g) => ({ ...g, items: g.items.filter((e) => e.name.toLowerCase().includes(q)) })).filter(
      (g) => g.items.length
    )
  }, [find])
  /* Controls edit the first selected media item and apply to all of them. */
  const targets = useMemo(
    () =>
      selection
        .map((id) => store.getItem(id))
        .filter((i) => i && (i.kind === 'image' || i.kind === 'video' || i.kind === 'embed')),
    [selection]
  )
  const primaryId = targets[0]?.id
  const primary = useItem(primaryId || '')

  /* Open, with nothing to work on. A full width column of one sentence takes
   * three hundred and twenty pixels off the board to say nothing; a rail says
   * the same thing and gives them back. */
  if (!primary) {
    return (
      <aside className="panel panel-rail" title="Select a picture or a video to work on it">
        <IconEffects />
      </aside>
    )
  }

  const fx = primary.fx
  const spec = BY_ID[fx.fxid] || BY_ID.none
  const ids = targets.map((t) => t!.id)

  /* Shaders need the picture's pixels. An embedded player never gives them up,
   * and neither does a video whose host refused cross-origin access. Tone,
   * framing and grain are CSS and work on both, so the Adjust tab stays. */
  const shadeable =
    primary.kind === 'embed' ? false : primary.kind === 'video' ? primary.readable !== false : true
  const why =
    primary.kind === 'embed'
      ? `A ${primary.name || 'player'} embed runs in its own frame, so nothing outside it can read the picture. Tone, framing and grain still apply.`
      : 'This video is served from a host that does not allow its pixels to be read, so shaders cannot run on it. Tone, framing and grain still apply.'

  /* A video card previews its effects on the still it was opened with; a
   * remote one has no still to use, so its thumbnails stay blank. */
  const previewKey = primary.kind === 'video' ? primary.poster : primary.media

  const patchFx = (patch: Partial<FxState>) => {
    /* A slider sweep is one undo step rather than none. */
    store.beginGesture(600)
    for (const id of ids) {
      const cur = store.getItem(id)
      if (!cur) continue
      store.update(id, { fx: { ...cur.fx, ...patch } }, false)
    }
  }

  const setEffect = (fxid: string) => patchFx({ fxid, ep: fxid === 'none' ? null : (defaults(fxid) as Params) })

  const setParam = (k: string, v: number | string) => {
    store.beginGesture(600)
    for (const id of ids) {
      const cur = store.getItem(id)
      if (!cur) continue
      const ep = { ...(cur.fx.ep || (defaults(cur.fx.fxid) as Params)), [k]: v }
      store.update(id, { fx: { ...cur.fx, ep } }, false)
    }
  }

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button data-on={tab === 'effect' || undefined} onClick={() => onTab('effect')}>
          Effect
        </button>
        <button data-on={tab === 'adjust' || undefined} onClick={() => onTab('adjust')}>
          Adjust
        </button>
        <button data-on={tab === 'looks' || undefined} onClick={() => onTab('looks')}>
          Looks
        </button>
      </div>

      {tab === 'looks' && (
        <LooksTab
          ids={ids}
          fx={fx}
          previewKey={previewKey}
          onApplied={(n) => n > 0 && say(n === 1 ? 'Look applied' : `Look applied to ${n} cards`)}
        />
      )}

      {tab === 'effect' && !shadeable && (
        <div className="panel-scroll">
          <section className="fx-controls">
            <h4>Effects unavailable</h4>
            <p className="panel-note">{why}</p>
            <button className="ghost" onClick={() => onTab('adjust')}>
              Open Adjust
            </button>
          </section>
        </div>
      )}

      {tab === 'effect' && shadeable && (
        <div className="panel-scroll">
          {/* Thirty one of them in a three across grid is more than anyone can
              scan, and knowing the name is faster than finding the picture. */}
          <div className="fx-find">
            <IconSearch />
            <input
              value={find}
              placeholder="Find an effect"
              spellCheck={false}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFind('')
                e.stopPropagation()
              }}
            />
            {!!find && (
              <button className="fx-find-clear" onClick={() => setFind('')} title="Clear">
                ×
              </button>
            )}
          </div>

          {found.map((g) => (
            <section key={g.name} className="fx-group">
              <h4>{g.name}</h4>
              <div className="fx-grid">
                {g.items.map((e) => (
                  <FxThumb
                    key={e.id}
                    effectId={e.id}
                    name={e.name}
                    mediaKey={previewKey}
                    active={fx.fxid === e.id}
                    onPick={() => setEffect(e.id)}
                  />
                ))}
              </div>
            </section>
          ))}
          {!found.length && <p className="panel-note">No effect is called that.</p>}

          {!!spec.controls.length && (
            <section className="fx-controls">
              <h4>{spec.name}</h4>
              {spec.controls.map((c) => (
                <ControlRow
                  key={c.k}
                  control={c}
                  value={(fx.ep || (defaults(fx.fxid) as Params))[c.k]}
                  onChange={(v) => setParam(c.k, v)}
                />
              ))}
              <button className="ghost" onClick={() => patchFx({ ep: defaults(fx.fxid) as Params })}>
                Reset {spec.name}
              </button>
            </section>
          )}
        </div>
      )}

      {tab === 'adjust' && (
        <div className="panel-scroll">
          <section className="fx-controls">
            <h4>Presets</h4>
            <div className="preset-row">
              {PRESETS.map((p) => (
                <button key={p.id} data-on={fx.preset === p.id || undefined} onClick={() => patchFx({ ...resetTone(), ...p.vals, preset: p.id })}>
                  {p.name}
                </button>
              ))}
            </div>
          </section>

          <section className="fx-controls">
            <h4>Tone</h4>
            <Slider label="Exposure" min={-100} max={100} step={1} value={fx.exp} onChange={(v) => patchFx({ exp: v, preset: 'custom' })} />
            <Slider label="Contrast" min={-100} max={100} step={1} value={fx.con} onChange={(v) => patchFx({ con: v, preset: 'custom' })} />
            <Slider label="Saturation" min={0} max={200} step={1} value={fx.sat} onChange={(v) => patchFx({ sat: v, preset: 'custom' })} />
            <Slider label="Warmth" min={-100} max={100} step={1} value={fx.warm} onChange={(v) => patchFx({ warm: v, preset: 'custom' })} />
            <Slider label="Blur" min={0} max={100} step={1} value={fx.blur} onChange={(v) => patchFx({ blur: v, preset: 'custom' })} />
            <Slider label="Grain" min={0} max={100} step={1} value={fx.grain} onChange={(v) => patchFx({ grain: v, preset: 'custom' })} />
          </section>

          <section className="fx-controls">
            <h4>Frame</h4>
            <Slider label="Zoom" min={1} max={3} step={0.01} value={fx.zoom} onChange={(v) => patchFx({ zoom: v })} />
            <Slider label="Offset X" min={-50} max={50} step={1} value={fx.ox} onChange={(v) => patchFx({ ox: v })} />
            <Slider label="Offset Y" min={-50} max={50} step={1} value={fx.oy} onChange={(v) => patchFx({ oy: v })} />
            <Slider label="Rotate" min={-180} max={180} step={1} value={fx.rot} onChange={(v) => patchFx({ rot: v })} />
            <div className="flip-row">
              <button data-on={fx.fh || undefined} onClick={() => patchFx({ fh: !fx.fh })}>
                Flip H
              </button>
              <button data-on={fx.fv || undefined} onClick={() => patchFx({ fv: !fx.fv })}>
                Flip V
              </button>
            </div>
          </section>

          <button className="ghost" onClick={() => patchFx({ ...resetTone(), preset: 'none' })}>
            Reset adjustments
          </button>
        </div>
      )}
    </aside>
  )
}

const resetTone = () => ({
  exp: 0, con: 0, sat: 100, warm: 0, blur: 0, grain: 0,
  zoom: 1, ox: 0, oy: 0, rot: 0, fh: false, fv: false,
})

/* A preview is a real render of the selected image through that effect, at
 * thumbnail size, scheduled behind the visible cards. */
const FxThumb = memo(function FxThumb({
  effectId,
  name,
  mediaKey,
  active,
  onPick,
}: {
  effectId: string
  name: string
  mediaKey?: string
  active: boolean
  onPick: () => void
}) {
  const ready = useSourceReady(mediaKey)
  const params = useMemo(() => defaults(effectId) as Params, [effectId])
  return (
    <button className="fx-thumb" data-on={active || undefined} onClick={onPick} title={name}>
      <span className="fx-thumb-img">
        {ready && mediaKey ? (
          <FxCanvas
            id={`thumb:${effectId}:${mediaKey}`}
            mediaKey={mediaKey}
            effectId={effectId}
            params={params}
            seed={7}
            w={132}
            h={99}
            /* Large distance keeps previews behind on-board cards in the queue. */
            distance={1e6}
          />
        ) : (
          <span className="fx-thumb-blank" />
        )}
      </span>
      <span className="fx-thumb-name">{name}</span>
    </button>
  )
})

function ControlRow({ control, value, onChange }: { control: Control; value: number | string | undefined; onChange: (v: number | string) => void }) {
  if (isColor(control)) {
    return (
      <label className="ctl ctl-color">
        <span>{control.label}</span>
        <input type="color" value={(value as string) || control.def} onChange={(e) => onChange(e.target.value)} />
      </label>
    )
  }
  if (isEnum(control)) {
    const v = typeof value === 'number' ? value : control.def
    return (
      <div className="ctl ctl-enum">
        <span>{control.label}</span>
        <div className="seg">
          {control.options.map((o, i) => (
            <button key={o} data-on={Math.round(v) === i || undefined} onClick={() => onChange(i)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <Slider
      label={control.label}
      min={control.min}
      max={control.max}
      step={control.step}
      unit={control.unit}
      value={typeof value === 'number' ? value : control.def}
      onChange={onChange}
    />
  )
}

function Slider({
  label, min, max, step, value, unit, onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="ctl">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <em>
        {step < 1 ? value.toFixed(2) : Math.round(value)}
        {unit}
      </em>
    </label>
  )
}

export { EFFECTS }
