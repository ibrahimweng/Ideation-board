import { useState } from 'react'
import { store, useItem } from '../state/store'
import { BUNDLED, GOOGLE, NATIVE, DEFAULTS, familyOf, inkChosen, typeStyle } from '../state/type'
import type { TypeSet } from '../state/type'
import { loadFamily } from '../state/fonts'
import { SWATCH } from '../state/types'
import { Slider } from './Slider'

/* ---------------------------------------------------------------------------
 * Setting the words.
 *
 * A board could put a picture through eleven shaders and could not make one
 * word bigger. Every note was 15px and every label was 28px semibold, and the
 * only thing you could say about either was what colour it was — which on a
 * label was the bug that started all this.
 *
 * This is the other half of the panel: the same card, asked what it is set in
 * rather than what has been done to its pixels. It edits the whole selection,
 * shows the first one's settings, and writes nothing it was not asked to —
 * every field is left unsaid until somebody sets it, so a board written before
 * this existed opens exactly as it did.
 * ------------------------------------------------------------------------- */

/* The things you actually reach for, as one press each.
 *
 * "I need headings, and body, and different kinds of heading" is not a request
 * for four sliders — it is a request for four buttons. The sliders are still
 * here underneath for when a press is nearly right. */
export const ROLES: Array<{ id: string; name: string; about: string; set: TypeSet }> = [
  { id: 'title', name: 'Title', about: 'The biggest thing on the board', set: { size: 64, weight: 700, leading: 1.02, tracking: -0.02 } },
  { id: 'h1', name: 'Heading', about: 'What a section is called', set: { size: 40, weight: 700, leading: 1.1, tracking: -0.015 } },
  { id: 'h2', name: 'Subheading', about: 'A step down from a heading', set: { size: 28, weight: 600, leading: 1.18, tracking: -0.01 } },
  { id: 'h3', name: 'Small heading', about: 'The last level before body', set: { size: 20, weight: 600, leading: 1.3, tracking: 0 } },
  { id: 'body', name: 'Body', about: 'Something meant to be read', set: { size: 16, weight: 400, leading: 1.55, tracking: 0 } },
  { id: 'caption', name: 'Caption', about: 'A note about something else', set: { size: 12, weight: 500, leading: 1.4, tracking: 0.02, caps: true } },
]

const WEIGHT_NAME: Record<number, string> = {
  100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black',
}

export function TextTab({ ids, id }: { ids: string[]; id: string }) {
  const it = useItem(id)
  /* Typing a family Google has and this shelf does not. Held here while it is
     being typed, because every keystroke would otherwise be a font request. */
  const [typed, setTyped] = useState('')

  if (!it) return null

  const kind = it.kind === 'label' ? 'label' : 'note'
  const d = DEFAULTS[kind]
  const t = it.type || {}
  const fam = familyOf(t.font)

  /* One gesture, one undo step: nudging a slider for half a second is one
     thing you did, and a board that needs nine undos to put a size back is a
     board nobody will touch the sliders on. */
  const set = (patch: TypeSet, discrete = false) => {
    store.beginGesture(discrete ? 0 : 600)
    for (const at of ids) {
      const cur = store.getItem(at)
      if (!cur) continue
      store.update(at, { type: { ...cur.type, ...patch } }, false)
    }
  }

  const pickFont = (font: string) => {
    /* Asked for at the moment it is chosen, which is the only moment this app
       talks to Google at all. */
    loadFamily(font)
    set({ font }, true)
  }

  /* A weight the family does not have is drawn by faking it or by the nearest
     one it does have, neither of which is what was asked for. So the buttons
     are the family's own list. */
  const weights = fam.weights
  const weight = t.weight ?? d.weight
  const nearest = weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), weights[0])

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button data-on>Text</button>
      </div>

      <div className="panel-scroll">
        <section className="fx-controls">
          <h4>Role</h4>
          <p className="fx-hint">Size, weight, line height and tracking, set together the way they go together.</p>
          <div className="type-roles">
            {ROLES.map((r) => (
              <button
                key={r.id}
                className="type-role"
                title={r.about}
                onClick={() => set(r.set, true)}
                style={{ fontWeight: r.set.weight, fontFamily: fam.stack }}
              >
                {r.name}
              </button>
            ))}
          </div>
        </section>

        <section className="fx-controls">
          <h4>Font</h4>
          <select
            className="type-family"
            value={fam.id}
            style={{ fontFamily: fam.stack }}
            onChange={(e) => pickFont(e.target.value)}
          >
            <optgroup label="In the app">
              {BUNDLED.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </optgroup>
            <optgroup label="Already on this machine">
              {NATIVE.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </optgroup>
            <optgroup label="From Google Fonts">
              {GOOGLE.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </optgroup>
            {/* A family typed in by hand is in none of those lists, and a
                select with no matching option shows the first one instead —
                which would make the board look like it had changed font. */}
            {!BUNDLED.concat(NATIVE, GOOGLE).some((f) => f.id === fam.id) && (
              <optgroup label="Typed in">
                <option value={fam.id}>{fam.name}</option>
              </optgroup>
            )}
          </select>

          <form
            className="type-typed"
            onSubmit={(e) => {
              e.preventDefault()
              const name = typed.trim()
              if (name) pickFont(name)
              setTyped('')
            }}
          >
            <input
              value={typed}
              placeholder="Any other Google family…"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="submit" disabled={!typed.trim()}>Use</button>
          </form>
          <p className="fx-hint">
            {fam.google
              ? 'Fetched from Google Fonts the first time it is used, and never again. Offline it falls back to something already on the machine.'
              : 'Carried by the app, so it works with nothing to connect to.'}
          </p>
        </section>

        <section className="fx-controls">
          <h4>Set</h4>

          <div className="ctl ctl-enum">
            <span>Weight</span>
            <div className="seg">
              {weights.map((w) => (
                <button key={w} data-on={nearest === w || undefined} title={WEIGHT_NAME[w] || String(w)} onClick={() => set({ weight: w }, true)}>
                  {w}
                </button>
              ))}
            </div>
          </div>

          <Slider label="Size" min={8} max={200} step={1} unit="px" def={d.size} value={t.size ?? d.size} onChange={(v) => set({ size: v })} />
          <Slider label="Line height" min={0.8} max={3} step={0.01} def={d.leading} value={t.leading ?? d.leading} onChange={(v) => set({ leading: v })} />
          <Slider label="Tracking" min={-0.1} max={0.4} step={0.005} def={d.tracking} value={t.tracking ?? d.tracking} onChange={(v) => set({ tracking: v })} />

          <div className="ctl ctl-enum">
            <span>Align</span>
            <div className="seg">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} data-on={(t.align ?? d.align) === a || undefined} onClick={() => set({ align: a }, true)}>
                  {a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}
                </button>
              ))}
            </div>
          </div>

          <div className="ctl ctl-enum">
            <span>Style</span>
            <div className="seg">
              <button data-on={t.italic || undefined} onClick={() => set({ italic: !t.italic }, true)} style={{ fontStyle: 'italic' }}>
                Italic
              </button>
              <button data-on={t.underline || undefined} onClick={() => set({ underline: !t.underline }, true)} style={{ textDecoration: 'underline' }}>
                Under
              </button>
              <button data-on={t.caps || undefined} onClick={() => set({ caps: !t.caps }, true)} style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Caps
              </button>
            </div>
          </div>
        </section>

        <section className="fx-controls">
          <h4>{it.kind === 'label' ? 'Ink' : 'Paper'}</h4>
          <div className="swatches">
            {it.kind === 'label' && (
              /* The theme's own ink, which is the right answer on a pale board
                 and on a dark one. It is the default because a colour chosen
                 for one ground is wrong on the other — which is exactly how
                 text arrived on a dark board and could not be found. */
              <button
                className="swatch-auto"
                data-on={!inkChosen(it.color) || undefined}
                title="Follows the theme, so it reads on a pale board and on a dark one"
                onClick={() => { store.beginGesture(0); for (const at of ids) store.update(at, { color: undefined }, false) }}
              >
                Auto
              </button>
            )}
            {SWATCH.filter((c) => it.kind !== 'label' || inkChosen(c)).map((c) => (
              <button
                key={c}
                style={{ background: c }}
                data-on={it.color === c || undefined}
                onClick={() => { store.beginGesture(0); for (const at of ids) store.update(at, { color: c }, false) }}
              />
            ))}
            <label className="swatch-any" title="Any colour at all">
              <input
                type="color"
                value={it.color || (it.kind === 'label' ? '#000000' : '#FBEFC4')}
                onChange={(e) => { store.beginGesture(600); for (const at of ids) store.update(at, { color: e.target.value }, false) }}
              />
            </label>
          </div>
        </section>

        <section className="fx-controls">
          <h4>How it reads</h4>
          <div className="type-preview" style={typeStyle(kind, it.type)}>
            {it.kind === 'label' ? it.text || 'Label' : (it.text || 'The quick brown fox').slice(0, 120)}
          </div>
          <p className="fx-hint">
            {ids.length > 1 ? `Setting all ${ids.length} of them.` : 'Double-click the card to write on it.'}
          </p>
        </section>
      </div>
    </aside>
  )
}
