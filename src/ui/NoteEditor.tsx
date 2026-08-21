import { useEffect, useRef, useState } from 'react'
import { store, useItem } from '../state/store'
import { SWATCH, TAGS } from '../state/types'

/* Inline editor for the text-bearing card kinds. Edits are written on close
 * rather than on every keystroke, so typing never touches the board. */
export function NoteEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const it = useItem(id)
  const [text, setText] = useState(it?.text || it?.name || '')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  if (!it) return null
  const isText = it.kind === 'note' || it.kind === 'label' || it.kind === 'section'

  const commit = () => {
    if (it.kind === 'section') store.update(id, { name: text })
    else if (isText) store.update(id, { text })
    else store.update(id, { name: text })
    onClose()
  }

  return (
    <div className="sheet-veil" onPointerDown={commit}>
      <div className="sheet" onPointerDown={(e) => e.stopPropagation()}>
        <h3>{it.kind === 'note' ? 'Note' : it.kind === 'label' ? 'Label' : it.kind === 'section' ? 'Section' : 'Rename'}</h3>
        <textarea
          ref={ref}
          value={text}
          rows={it.kind === 'note' ? 8 : 2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
          }}
        />

        {(it.kind === 'note' || it.kind === 'label') && (
          <div className="swatches">
            {SWATCH.map((c) => (
              <button key={c} style={{ background: c }} data-on={it.color === c || undefined} onClick={() => store.update(id, { color: c })} />
            ))}
          </div>
        )}

        <div className="tag-row">
          <span>Tag</span>
          <button data-on={!it.tag || undefined} onClick={() => store.update(id, { tag: null })}>
            None
          </button>
          {TAGS.map((t) => (
            <button key={t.id} style={{ background: t.c }} data-on={it.tag === t.id || undefined} onClick={() => store.update(id, { tag: t.id })} />
          ))}
        </div>

        <div className="sheet-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button onClick={commit}>Save</button>
        </div>
      </div>
    </div>
  )
}
