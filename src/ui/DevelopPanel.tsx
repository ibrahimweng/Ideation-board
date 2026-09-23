import { useState } from 'react'
import { Slider } from './Slider'
import { Curve } from './Curve'
import { GradeWheel } from './GradeWheel'
import { BANDS, DEV_0, HSL_0, developed, devOf, rangeOf, trimDev } from '../state/develop'
import type { CurvePt, DevKey, Develop, HSL, Wheel } from '../state/develop'

/* ---------------------------------------------------------------------------
 * The develop panel.
 *
 * Lightroom's panels, in Lightroom's order, under Lightroom's names — and the
 * order is not decoration. It is the order the arithmetic runs in, and it is
 * also the order anybody who has developed a photograph works in: get the
 * white balance right, then the exposure, then the ends of the range, then the
 * feel of it, and only then the colour. A panel that offered these in any
 * other order would be a panel that taught a worse habit.
 *
 * Every figure here is a `Slider`, which means every one of them can be typed
 * into, dragged, double-clicked back to where it started, and scrubbed by
 * dragging its own name. None of that is new work: it is what a slider on this
 * board already is.
 * ------------------------------------------------------------------------- */

/* Each section collapses, because all of it at once is four screens of
 * sliders and nobody works on all of it at once. Open on Basic, which is
 * where every edit starts. */
function Section({
  name, open, onToggle, children, onReset, touched,
}: {
  name: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  onReset?: () => void
  touched?: boolean
}) {
  return (
    <section className="dev-sec" data-open={open || undefined}>
      <h4>
        <button className="dev-head" onClick={onToggle} aria-expanded={open}>
          <i className="dev-caret" aria-hidden />
          {name}
          {/* A dot on a closed section, so a setting made three screens ago is
              not a setting nobody can find again. */}
          {touched && <i className="dev-dot" aria-hidden title="Something here has been changed" />}
        </button>
        {onReset && touched && (
          <button className="dev-reset" onClick={onReset} title={`Put ${name} back`}>
            Reset
          </button>
        )}
      </h4>
      {open && <div className="dev-body">{children}</div>}
    </section>
  )
}

export function DevelopPanel({
  dev, onChange, onReset,
}: {
  dev?: Develop
  onChange: (patch: Partial<Develop>, discrete?: boolean) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ basic: true })
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb')
  const [band, setBand] = useState(0)
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  /* One slider, from the ranges table, so a bound is never typed out twice. */
  const S = (k: DevKey, label?: string) => {
    const r = rangeOf(k)!
    return (
      <Slider
        key={k}
        label={label || r.label}
        min={r.min}
        max={r.max}
        step={r.step}
        unit={r.unit}
        def={DEV_0[k]}
        value={devOf(dev, k)}
        onChange={(v) => onChange({ [k]: v } as Partial<Develop>)}
      />
    )
  }

  const moved = (keys: DevKey[]) => keys.some((k) => devOf(dev, k) !== DEV_0[k])

  const curveFor = (c: typeof ch): CurvePt[] | undefined =>
    c === 'rgb' ? dev?.curve : c === 'r' ? dev?.curveR : c === 'g' ? dev?.curveG : dev?.curveB
  const setCurve = (c: typeof ch, pts: CurvePt[] | undefined) =>
    onChange(
      (c === 'rgb' ? { curve: pts } : c === 'r' ? { curveR: pts } : c === 'g' ? { curveG: pts } : { curveB: pts }) as Partial<Develop>
    )

  const hsl: HSL = dev?.hsl || HSL_0
  const setBandValue = (which: keyof HSL, i: number, v: number) => {
    const next: HSL = { h: [...hsl.h], s: [...hsl.s], l: [...hsl.l] }
    next[which][i] = v
    onChange({ hsl: next })
  }

  const wheel = (k: 'gradeShadow' | 'gradeMid' | 'gradeHigh' | 'gradeGlobal', label: string) => (
    <GradeWheel
      label={label}
      value={dev?.[k]}
      onChange={(w: Wheel) => onChange({ [k]: w } as Partial<Develop>)}
    />
  )

  const anyCurve = !!(dev?.curve || dev?.curveR || dev?.curveG || dev?.curveB)
  const anyBand = hsl.h.some((n) => n) || hsl.s.some((n) => n) || hsl.l.some((n) => n)
  const anyGrade = [dev?.gradeShadow, dev?.gradeMid, dev?.gradeHigh, dev?.gradeGlobal].some((w) => w && (w.s || w.l))

  return (
    <div className="develop">
      <Section
        name="Basic"
        open={!!open.basic}
        onToggle={() => toggle('basic')}
        touched={moved(['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation'])}
        onReset={() =>
          onChange({ temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0 }, true)
        }
      >
        <h5>White balance</h5>
        {S('temp')}
        {S('tint')}
        <h5>Tone</h5>
        {S('exposure')}
        {S('contrast')}
        {S('highlights')}
        {S('shadows')}
        {S('whites')}
        {S('blacks')}
        <h5>Presence</h5>
        {/* The three sizes of local contrast, in the order they work at:
            texture is about the surface of a thing, clarity about its body,
            dehaze about the air in front of it. */}
        {S('texture')}
        {S('clarity')}
        {S('dehaze')}
        {S('vibrance')}
        {S('saturation')}
      </Section>

      <Section
        name="Tone curve"
        open={!!open.curve}
        onToggle={() => toggle('curve')}
        touched={anyCurve}
        onReset={() => onChange({ curve: undefined, curveR: undefined, curveG: undefined, curveB: undefined }, true)}
      >
        <div className="dev-tabs">
          {(['rgb', 'r', 'g', 'b'] as const).map((c) => (
            <button key={c} data-on={ch === c || undefined} data-ch={c} onClick={() => setCh(c)}>
              {c === 'rgb' ? 'All' : c.toUpperCase()}
            </button>
          ))}
        </div>
        <Curve channel={ch} points={curveFor(ch)} onChange={(pts) => setCurve(ch, pts)} />
      </Section>

      <Section
        name="Colour"
        open={!!open.colour}
        onToggle={() => toggle('colour')}
        touched={anyBand || anyGrade}
        onReset={() =>
          onChange({ hsl: undefined, gradeShadow: undefined, gradeMid: undefined, gradeHigh: undefined, gradeGlobal: undefined }, true)
        }
      >
        <h5>Colour mixer</h5>
        {/* One band at a time rather than twenty-four sliders: the question
            being asked is always about one colour, and the rest are noise
            while it is being asked. */}
        <div className="dev-bands">
          {BANDS.map((b, i) => (
            <button
              key={b.k}
              data-on={band === i || undefined}
              style={{ background: `hsl(${b.hue} 70% 50%)` }}
              title={b.name}
              aria-label={b.name}
              onClick={() => setBand(i)}
            />
          ))}
        </div>
        <Slider label="Hue" min={-100} max={100} step={1} def={0} value={hsl.h[band]} onChange={(v) => setBandValue('h', band, v)} />
        <Slider label="Saturation" min={-100} max={100} step={1} def={0} value={hsl.s[band]} onChange={(v) => setBandValue('s', band, v)} />
        <Slider label="Luminance" min={-100} max={100} step={1} def={0} value={hsl.l[band]} onChange={(v) => setBandValue('l', band, v)} />

        <h5>Colour grading</h5>
        <div className="dev-wheels">
          {wheel('gradeShadow', 'Shadows')}
          {wheel('gradeMid', 'Midtones')}
          {wheel('gradeHigh', 'Highlights')}
          {wheel('gradeGlobal', 'Global')}
        </div>
        {S('gradeBlend')}
        {S('gradeBalance')}
      </Section>

      <Section
        name="Detail"
        open={!!open.detail}
        onToggle={() => toggle('detail')}
        touched={moved(['sharpen', 'sharpenRadius', 'sharpenDetail', 'sharpenMask', 'noise', 'noiseDetail', 'noiseColour'])}
        onReset={() => onChange({ sharpen: 0, sharpenRadius: 1, sharpenDetail: 25, sharpenMask: 0, noise: 0, noiseDetail: 50, noiseColour: 0 }, true)}
      >
        <h5>Sharpening</h5>
        {S('sharpen')}
        {S('sharpenRadius')}
        {S('sharpenDetail')}
        {/* The one that makes sharpening usable: wound up, only the pixels
            that sit on an edge get it, which is the difference between a
            sharpened photograph and a noisy one. */}
        {S('sharpenMask')}
        <h5>Noise reduction</h5>
        {S('noise')}
        {S('noiseDetail')}
        {S('noiseColour')}
      </Section>

      <Section
        name="Effects"
        open={!!open.effects}
        onToggle={() => toggle('effects')}
        touched={moved(['vignette', 'vignetteMid', 'vignetteRound', 'vignetteFeather', 'grain', 'grainSize', 'grainRough'])}
        onReset={() => onChange({ vignette: 0, vignetteMid: 50, vignetteRound: 0, vignetteFeather: 50, grain: 0, grainSize: 25, grainRough: 50 }, true)}
      >
        <h5>Vignette</h5>
        {S('vignette')}
        {S('vignetteMid')}
        {S('vignetteRound')}
        {S('vignetteFeather')}
        <h5>Grain</h5>
        {S('grain')}
        {S('grainSize')}
        {S('grainRough')}
      </Section>

      {developed(dev) && (
        <button className="ghost" onClick={onReset}>
          Undevelop — put the photograph back
        </button>
      )}
    </div>
  )
}

/* What a patch leaves on the record: the figures that were moved and nothing
 * else, so an edit undone to where it started leaves no trace at all. */
export const devPatch = (cur: Develop | undefined, patch: Partial<Develop>): Develop | undefined =>
  trimDev({ ...(cur || {}), ...patch })
