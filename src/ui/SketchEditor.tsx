import { useEffect, useId, useRef, useState } from 'react'
import { store, useItem } from '../state/store'
import { useObjectURL } from '../store/media'
import { SHELF, runSketch, rollSketch } from '../state/sketches'
import { TIMEOUT_MS } from '../store/sketch'
import { useFeeder } from '../state/feeds'
import { useDialog } from './dialog'

/* ---------------------------------------------------------------------------
 * Writing one.
 *
 * Code on the left, the card on the right, and the shelf across the top. The
 * preview is the card itself — the same picture, made the same way, at the
 * same shape — rather than a canvas that runs the code a second way and
 * disagrees with it later.
 *
 * Two buttons, and the second one is the point. Run is what you press after
 * changing a line. Roll again keeps the code and throws the dice, which is the
 * press that turns a sketch from a picture into a way of making a hundred of
 * them — and it is why the random here is seeded rather than free: a sketch
 * worth keeping has to come back the same tomorrow.
 * ------------------------------------------------------------------------- */

export function SketchEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useDialog(onClose)
  const titleId = useId()
  const it = useItem(id)
  const [code, setCode] = useState(it?.code || '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [took, setTook] = useState<number | null>(null)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const shown = useObjectURL(it?.poster)
  const fed = useFeeder(id)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  if (!it) return null

  const run = async (next = code) => {
    setBusy(true)
    const started = Date.now()
    const why = await runSketch(id, next)
    setErr(why)
    setTook(why ? null : Date.now() - started)
    setBusy(false)
  }

  const roll = async () => {
    setBusy(true)
    /* What is in the box is what gets thrown, so a line changed and not yet
       run is not quietly left behind by the dice. */
    store.update(id, { code }, false)
    const why = await rollSketch(id)
    setErr(why)
    setBusy(false)
  }

  const commit = () => {
    if (code !== (it.code || '')) store.update(id, { code })
    onClose()
  }

  return (
    <div className="sheet-veil" onPointerDown={commit}>
      <div ref={dialog} className="sheet sketch-sheet" aria-labelledby={titleId} onPointerDown={(e) => e.stopPropagation()}>
        <h3 id={titleId}>Sketch</h3>

        <div className="shelf">
          <span>Start from</span>
          {SHELF.map((s) => (
            <button
              key={s.id}
              title={`Replace what is here with ${s.name}`}
              onClick={() => {
                setCode(s.code)
                void run(s.code)
              }}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="sketch-body">
          <div className="sketch-code">
            <textarea
              ref={ref}
              value={code}
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void run()
                }
                /* A tab in a code box is an indent. Leaving it as "move to the
                   next control" is right everywhere else on this board and
                   wrong in the one place people are writing code. */
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const ta = e.currentTarget
                  const at = ta.selectionStart
                  const next = code.slice(0, at) + '  ' + code.slice(ta.selectionEnd)
                  setCode(next)
                  requestAnimationFrame(() => ta.setSelectionRange(at + 2, at + 2))
                }
              }}
            />
            <p className="sketch-hint">
              <code>ctx</code> <code>w</code> <code>h</code> <code>rand(a, b)</code> <code>img</code>{' '}
              <code>seed</code>
              {fed ? ' — a card is wired in, so img is its picture.' : ' — img is null until a card is wired in.'}
            </p>
          </div>

          <div className="sketch-shown">
            {shown ? <img src={shown} alt="What the sketch drew" /> : <span className="sketch-blank" />}
            {busy && <span className="sketch-running" aria-label="Running" />}
          </div>
        </div>

        {err ? (
          <p className="sketch-error" role="alert">
            {err}
          </p>
        ) : (
          <p className="sketch-note">
            It runs on its own, away from the board, and is stopped after{' '}
            {Math.round(TIMEOUT_MS / 1000)} seconds — so a loop with no end in it costs you a card
            rather than the tab.
            {took !== null ? ` Drew in ${took} ms.` : ''}
          </p>
        )}

        <div className="sheet-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="ghost" disabled={busy} onClick={() => void roll()}>
            Roll again
          </button>
          <button disabled={busy} onClick={() => void run()}>
            Run
          </button>
          <button onClick={commit}>Done</button>
        </div>
      </div>
    </div>
  )
}
