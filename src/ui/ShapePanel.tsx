import { useState } from 'react'
import { store, useItem } from '../state/store'
import { DASHES, DEFAULTS, SHAPES, settingOf } from '../state/shapes'
import type { Cap, Heads, Join, ShapeSpec } from '../state/shapes'
import { rasterise, unrasterise } from '../state/raster'
import { SWATCH } from '../state/types'
import type { Item } from '../state/types'
import { ADJUST_0, BLENDS, blendOf } from '../engine/types'
import type { FxState } from '../engine/types'
import { Slider } from './Slider'

/* ---------------------------------------------------------------------------
 * Setting a drawing.
 *
 * The rest of this panel asks what has been done to a card's pixels. A drawing
 * has none, so none of those questions mean anything to it and every one of
 * its own is asked nowhere else: what it is filled with, what it is drawn
 * with, how thick, how dashed, how many sides, how round the corners, and
 * where on the board it is to the pixel.
 *
 * The last section is the door to the other panel. A shape can be baked into
 * a picture, and from then on it is a picture: the seventy shaders apply, the
 * palette can read it, it exports like anything else. The numbers stay on the
 * record while it is baked, which is what makes it a door rather than a
 * cliff — taking the picture off gives the drawing back.
 * ------------------------------------------------------------------------- */

const CAPS: { id: Cap; name: string }[] = [
  { id: 'butt', name: 'Flat' },
  { id: 'round', name: 'Round' },
  { id: 'square', name: 'Square' },
]

const JOINS: { id: Join; name: string }[] = [
  { id: 'miter', name: 'Sharp' },
  { id: 'round', name: 'Round' },
  { id: 'bevel', name: 'Cut' },
]

const HEADS: { id: Heads; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'end', name: 'End' },
  { id: 'start', name: 'Start' },
  { id: 'both', name: 'Both' },
]

/* Which questions a kind answers to. A rectangle has corners and a star has
 * points, and showing a star's ratio on a rectangle is a control that does
 * nothing, which is worse than one that is not there. */
const ROUNDS = new Set(['rect'])
const SIDED = new Set(['polygon', 'star'])
const TIPPED = new Set(['line', 'arrow', 'path'])
const OPENABLE = new Set(['path'])

export function ShapePanel({ ids, id, say }: { ids: string[]; id: string; say: (m: string) => void }) {
  const it = useItem(id)
  const [baking, setBaking] = useState(false)
  if (!it || !it.shape) return null
  const s = it.shape
  const kind = s.kind
  const baked = !!it.poster
  const name = SHAPES.find((k) => k.kind === kind)?.name || 'Shape'

  /* One gesture, one undo step, and every selected drawing gets it — but each
     from its own record, so a selection of a star and a rectangle does not
     quietly turn into two rectangles. */
  const set = (patch: Partial<ShapeSpec>, discrete = false) => {
    store.beginGesture(discrete ? 0 : 600)
    for (const at of ids) {
      const cur = store.getItem(at)
      if (!cur?.shape) continue
      store.update(at, { shape: { ...cur.shape, ...patch } }, false)
    }
  }

  const place = (patch: Partial<Pick<Item, 'x' | 'y' | 'w' | 'h'>>) => {
    store.beginGesture(0)
    for (const at of ids) store.update(at, patch, false)
  }

  /* How it sits with what is under it. Not a question about the drawing, so
     it is written where every other card writes it. */
  const sit = (patch: Partial<FxState>, discrete = false) => {
    store.beginGesture(discrete ? 0 : 600)
    for (const at of ids) {
      const cur = store.getItem(at)
      if (!cur) continue
      store.update(at, { fx: { ...cur.fx, ...patch } }, false)
    }
  }

  const bakeNow = async () => {
    setBaking(true)
    try {
      const done = await rasterise(ids)
      say(done === 1 ? 'Baked into a picture. Every effect applies to it now.' : `Baked ${done} of them into pictures.`)
    } catch {
      say('That drawing would not bake.')
    } finally {
      setBaking(false)
    }
  }

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button data-on>{name}</button>
      </div>

      <div className="panel-scroll">
        {ids.length > 1 && (
          <p className="panel-many">
            Setting <b>{ids.length}</b> drawings.
          </p>
        )}

        {baked ? (
          <section className="fx-controls">
            <h4>Baked</h4>
            <p className="fx-hint">
              This one is pixels now, so every effect, the palette and the export treat it like any other
              picture. What it was drawn from is still on the record.
            </p>
            <button className="shape-bake" onClick={() => { unrasterise(ids); say('Back to the drawing.') }}>
              Back to the drawing
            </button>
          </section>
        ) : (
          <>
            <section className="fx-controls">
              <h4>Fill</h4>
              <Inks
                value={settingOf(s, 'fill')}
                onPick={(c) => set({ fill: c }, true)}
                none="No fill, which is not the same as white"
              />
            </section>

            <section className="fx-controls">
              <h4>Stroke</h4>
              <Inks
                value={settingOf(s, 'stroke')}
                onPick={(c) => set({ stroke: c }, true)}
                none="No line round it"
              />
              <Slider
                label="Width"
                min={0.5}
                max={48}
                step={0.5}
                unit="px"
                def={DEFAULTS.width}
                value={settingOf(s, 'width')}
                onChange={(v) => set({ width: v })}
              />
              <div className="ctl ctl-enum">
                <span>Dash</span>
                <div className="seg">
                  {DASHES.map((d) => (
                    <button
                      key={d.id}
                      data-on={settingOf(s, 'dash') === d.dash || undefined}
                      onClick={() => set({ dash: d.dash }, true)}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ctl ctl-enum">
                <span>Ends</span>
                <div className="seg">
                  {CAPS.map((c) => (
                    <button key={c.id} data-on={settingOf(s, 'cap') === c.id || undefined} onClick={() => set({ cap: c.id }, true)}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ctl ctl-enum">
                <span>Corners</span>
                <div className="seg">
                  {JOINS.map((j) => (
                    <button key={j.id} data-on={settingOf(s, 'join') === j.id || undefined} onClick={() => set({ join: j.id }, true)}>
                      {j.name}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {(ROUNDS.has(kind) || SIDED.has(kind) || TIPPED.has(kind) || OPENABLE.has(kind)) && (
              <section className="fx-controls">
                <h4>{name}</h4>

                {ROUNDS.has(kind) && (
                  <>
                    <Slider
                      label="Round"
                      min={0}
                      max={0.5}
                      step={0.01}
                      def={DEFAULTS.radius}
                      value={settingOf(s, 'radius')}
                      onChange={(v) => set({ radius: v })}
                    />
                    <p className="fx-hint">
                      A fraction of the shortest side, so the corners stay the same shape at any size. Half is as
                      far as it goes: past half the two corners on a side have met.
                    </p>
                  </>
                )}

                {SIDED.has(kind) && (
                  <Slider
                    label={kind === 'star' ? 'Points' : 'Sides'}
                    min={3}
                    max={24}
                    step={1}
                    def={DEFAULTS.sides}
                    value={settingOf(s, 'sides')}
                    onChange={(v) => set({ sides: Math.round(v) })}
                  />
                )}

                {kind === 'star' && (
                  <Slider
                    label="Inner"
                    min={0.05}
                    max={0.95}
                    step={0.01}
                    def={DEFAULTS.inner}
                    value={settingOf(s, 'inner')}
                    onChange={(v) => set({ inner: v })}
                  />
                )}

                {SIDED.has(kind) && (
                  <Slider
                    label="Turn"
                    min={-180}
                    max={180}
                    step={1}
                    unit="°"
                    def={DEFAULTS.turn}
                    value={settingOf(s, 'turn')}
                    onChange={(v) => set({ turn: v })}
                  />
                )}

                {TIPPED.has(kind) && (
                  <div className="ctl ctl-enum">
                    <span>Arrows</span>
                    <div className="seg">
                      {HEADS.map((hd) => (
                        <button key={hd.id} data-on={settingOf(s, 'heads') === hd.id || undefined} onClick={() => set({ heads: hd.id }, true)}>
                          {hd.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {OPENABLE.has(kind) && (
                  <div className="ctl ctl-enum">
                    <span>Path</span>
                    <div className="seg">
                      <button data-on={!s.closed || undefined} onClick={() => set({ closed: false }, true)}>Open</button>
                      <button data-on={s.closed || undefined} onClick={() => set({ closed: true }, true)}>Closed</button>
                    </div>
                  </div>
                )}

                {OPENABLE.has(kind) && (
                  <p className="fx-hint">Double-click the drawing to move its points about.</p>
                )}
              </section>
            )}
          </>
        )}

        <section className="fx-controls">
          <h4>How it sits</h4>
          <Slider
            label="Opacity"
            def={ADJUST_0.op}
            min={0}
            max={100}
            step={1}
            unit="%"
            value={it.fx.op ?? 100}
            onChange={(v) => sit({ op: v })}
          />
          <div className="blend-row">
            {BLENDS.map((b) => (
              <button key={b.id} data-on={blendOf(it.fx.mix) === b.id || undefined} onClick={() => sit({ mix: b.id }, true)}>
                {b.name}
              </button>
            ))}
          </div>
        </section>

        <section className="fx-controls">
          <h4>Where it is</h4>
          <div className="shape-box">
            <Num label="X" value={it.x} onChange={(v) => place({ x: v })} />
            <Num label="Y" value={it.y} onChange={(v) => place({ y: v })} />
            <Num label="W" value={it.w} min={1} onChange={(v) => place({ w: v })} />
            <Num label="H" value={it.h} min={1} onChange={(v) => place({ h: v })} />
          </div>
          <p className="fx-hint">
            Board units, which are pixels at 100%. {ids.length > 1 ? 'Typing one puts all of them there.' : ''}
          </p>
        </section>

        {!baked && (
          <section className="fx-controls">
            <h4>Pixels</h4>
            <p className="fx-hint">
              A drawing is a handful of numbers, so it is exact at any zoom and there is nothing for a shader to
              read. Bake it and every effect on this board applies to it — and the numbers stay, so you can come
              back.
            </p>
            <button className="shape-bake" onClick={bakeNow} disabled={baking}>
              {baking ? 'Baking…' : 'Bake into a picture'}
            </button>
          </section>
        )}
      </div>
    </aside>
  )
}

/* A colour, or none at all. Null is a choice here rather than the absence of
 * one: a shape with no fill is a shape you can see through, which is not the
 * same as a white one. */
function Inks({ value, onPick, none }: { value: string | null; onPick: (c: string | null) => void; none: string }) {
  return (
    <div className="type-inks">
      <button className="swatch-auto" data-on={!value || undefined} title={none} onClick={() => onPick(null)}>
        None
      </button>
      {SWATCH.map((c) => (
        <button key={c} style={{ background: c }} data-on={value === c || undefined} onClick={() => onPick(c)} />
      ))}
      <label className="swatch-any" title="Any colour at all">
        <input type="color" value={value || '#2F6FEB'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  )
}

/* One number, typed. Committed as it is typed rather than on blur, because a
 * value you have to press Enter to apply is one people think did not work. */
function Num({ label, value, min, onChange }: { label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <label className="shape-num">
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={min}
        step={1}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(min === undefined ? Math.round(v) : Math.max(min, Math.round(v)))
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  )
}
