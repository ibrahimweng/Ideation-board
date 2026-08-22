import { memo, useEffect, useMemo, useState } from 'react'
import { store } from '../state/store'
import { BY_ID } from '../engine/effects'
import { FxCanvas } from '../board/FxCanvas'
import { useSourceReady } from '../board/sources'
import { adjustCSS } from '../board/adjust'
import { GRAIN_URL } from '../board/grain'
import {
  copiedLook, copyLook, describe, isPlain, listLooks, lookFrom, removeLook, renameLook, saveLook, subscribeLooks,
} from '../state/looks'
import type { Look, LookFx } from '../state/looks'
import type { FxState } from '../engine/types'

/* ---------------------------------------------------------------------------
 * Saved looks.
 *
 * Each one previews on the picture you have selected rather than on a stock
 * sample, the same way the effect thumbnails do, because a grade you cannot
 * see on your own photograph tells you nothing. The preview is the same
 * machinery as a card: the shader through the engine, the tone as a CSS filter
 * over it.
 * ------------------------------------------------------------------------- */

function useLooks(): Look[] {
  const [, bump] = useState(0)
  useEffect(() => subscribeLooks(() => bump((n) => n + 1)), [])
  return listLooks()
}

interface Props {
  ids: string[]
  fx: FxState
  previewKey?: string
  onApplied: (n: number) => void
}

export function LooksTab({ ids, fx, previewKey, onApplied }: Props) {
  const looks = useLooks()
  const current = useMemo(() => lookFrom(fx), [fx])
  const clip = copiedLook()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const apply = (look: LookFx) => onApplied(store.applyLook(ids, look))

  const startSave = () => {
    setName(describe(current, (BY_ID[current.fxid] || BY_ID.none).name))
    setNaming(true)
  }

  const commit = () => {
    saveLook(name, current)
    setNaming(false)
  }

  return (
    <div className="panel-scroll">
      <section className="fx-controls">
        <h4>This card</h4>
        {isPlain(current) ? (
          <p className="panel-note">
            Nothing on this card yet. Pick an effect or move the sliders, then save it here to put the
            same treatment on others.
          </p>
        ) : naming ? (
          <div className="look-name">
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setNaming(false)
              }}
            />
            <button onClick={commit}>Save</button>
            <button className="ghost" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="look-actions">
            <button onClick={startSave}>Save this look</button>
            <button className="ghost" onClick={() => copyLook(current)}>
              Copy
            </button>
          </div>
        )}

        {clip && !isPlain(clip) && (
          <button className="ghost look-paste" onClick={() => apply(clip)}>
            Paste the copied look onto {ids.length === 1 ? 'this card' : `these ${ids.length}`}
          </button>
        )}
      </section>

      <section className="fx-controls">
        <h4>Saved</h4>
        {!looks.length ? (
          <p className="panel-note">
            None yet. What you save here stays with you rather than with the board, so it is waiting on
            the next board too.
          </p>
        ) : (
          <div className="look-grid">
            {looks.map((l) => (
              <LookTile key={l.id} look={l} mediaKey={previewKey} onApply={() => apply(l.fx)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const LookTile = memo(function LookTile({
  look, mediaKey, onApply,
}: {
  look: Look
  mediaKey?: string
  onApply: () => void
}) {
  const ready = useSourceReady(mediaKey)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(look.name)
  /* Tone is CSS on a card and CSS here, over the shader's own output. */
  const filter = adjustCSS({ ...look.fx, zoom: 1, ox: 0, oy: 0, rot: 0, fh: false, fv: false } as FxState)

  return (
    <div className="look">
      <button className="look-shot" onClick={onApply} title={`Put "${look.name}" on the selection`}>
        <span className="fx-thumb-img" style={{ filter: filter || undefined }}>
          {ready && mediaKey ? (
            <FxCanvas
              id={`look:${look.id}:${mediaKey}`}
              mediaKey={mediaKey}
              effectId={look.fx.fxid}
              params={look.fx.ep}
              seed={11}
              w={132}
              h={99}
              distance={1e6}
              className=""
            />
          ) : (
            <span className="fx-thumb-blank" />
          )}
          {look.fx.grain > 0 && (
            <span className="grain" style={{ opacity: look.fx.grain / 100, backgroundImage: GRAIN_URL }} />
          )}
        </span>
      </button>

      {editing ? (
        <input
          className="look-rename"
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            renameLook(look.id, name)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setName(look.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <div className="look-foot">
          <span className="look-title" onDoubleClick={() => setEditing(true)} title="Double click to rename">
            {look.name}
          </span>
          <button className="look-drop" title="Forget this look" onClick={() => removeLook(look.id)}>
            ×
          </button>
        </div>
      )}
    </div>
  )
})
