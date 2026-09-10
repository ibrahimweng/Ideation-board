import { useId, useRef, useState } from 'react'

/* A slider whose number can be typed into.
 *
 * Every control in this panel was a bare range input with a read-only figure
 * beside it, which meant a setting could not be entered exactly, could not be
 * copied, and could not be matched across two cards by hand. A setting you
 * cannot enter is a setting you cannot repeat, and repeating a treatment is
 * most of what this panel is for.
 *
 * Three ways in now: drag it, type it, or double-click to put it back where it
 * started. Shift with an arrow key moves in tens, because a range of two
 * hundred in steps of one is forty presses from end to end otherwise. */
export function Slider({
  label, min, max, step, value, unit, def, onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  /* What double-clicking puts it back to. */
  def?: number
  onChange: (v: number) => void
}) {
  const id = useId()
  /* What is in the box while it is being typed in, which is not a number yet:
     halfway through "-1" is "-", and turning that into a number every
     keystroke would fight whoever is typing it. */
  const [typing, setTyping] = useState<string | null>(null)
  /* Escape blurs the box, and a blur is the other way a figure is committed.
     Without this the escape would put the box back and then the blur would
     immediately commit what it was put back from. */
  const abandoned = useRef(false)
  const shown = step < 1 ? value.toFixed(2) : String(Math.round(value))

  const commit = (raw: string) => {
    setTyping(null)
    const n = parseFloat(raw)
    if (!Number.isFinite(n)) return
    const clamped = Math.min(max, Math.max(min, n))
    if (clamped !== value) onChange(clamped)
  }

  const nudge = (by: number) => onChange(Math.min(max, Math.max(min, value + by)))

  return (
    <div className="ctl">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => def !== undefined && onChange(def)}
        onKeyDown={(e) => {
          if (!e.shiftKey) return
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); nudge(-step * 10) }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nudge(step * 10) }
        }}
      />
      <input
        className="ctl-num"
        type="text"
        inputMode="decimal"
        aria-label={`${label}${unit ? ` in ${unit}` : ''}`}
        value={typing ?? `${shown}${unit || ''}`}
        /* Selected, so typing replaces it, but not copied into state: a write
           on focus is a write racing whatever put the focus there, and the
           value on show is already the right thing to be editing. The unit
           comes with it and parses away again. */
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setTyping(e.target.value)}
        onBlur={(e) => {
          if (abandoned.current) { abandoned.current = false; setTyping(null); return }
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          /* The board listens for keys on the window and already stands down
             for an input, but the panel is inside a sheet on a narrow window
             and this is cheaper than finding out. */
          e.stopPropagation()
          if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur() }
          else if (e.key === 'Escape') { abandoned.current = true; setTyping(null); e.currentTarget.blur() }
        }}
      />
    </div>
  )
}

