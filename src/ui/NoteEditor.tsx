import { useEffect, useRef, useState } from 'react'
import { store, useItem } from '../state/store'
import { SWATCH, TAGS } from '../state/types'
import { renameBoard } from '../state/boards'
import { hasWords } from '../state/kinds'

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
  const isText = hasWords(it)

  /* The buttons write the same marks a person would have typed, so what is
   * stored stays a plain string and nothing has to agree with anything. */
  const edit = (fn: (s: { value: string; start: number; end: number }) => { value: string; start: number; end: number }) => {
    const ta = ref.current
    if (!ta) return
    const next = fn({ value: text, start: ta.selectionStart, end: ta.selectionEnd })
    setText(next.value)
    /* After React has written the new value back into the field. */
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(next.start, next.end)
    })
  }

  const wrap = (mark: string) =>
    edit(({ value, start, end }) => {
      const sel = value.slice(start, end)
      const before = value.slice(0, start)
      const after = value.slice(end)
      if (before.endsWith(mark) && after.startsWith(mark)) {
        return {
          value: before.slice(0, -mark.length) + sel + after.slice(mark.length),
          start: start - mark.length,
          end: end - mark.length,
        }
      }
      const body = sel || 'text'
      return {
        value: before + mark + body + mark + after,
        start: start + mark.length,
        end: start + mark.length + body.length,
      }
    })

  /* Line marks apply to every line the selection touches, and take themselves
   * off again when they are already on all of them. */
  const prefix = (mark: string) =>
    edit(({ value, start, end }) => {
      const from = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const nl = value.indexOf('\n', end)
      const to = nl === -1 ? value.length : nl
      const lines = value.slice(from, to).split('\n')
      const on = lines.every((l) => l.startsWith(mark))
      const next = lines.map((l) => (on ? l.slice(mark.length) : mark + l)).join('\n')
      return { value: value.slice(0, from) + next + value.slice(to), start: from, end: from + next.length }
    })

  const link = () =>
    edit(({ value, start, end }) => {
      const sel = value.slice(start, end)
      const isUrl = /^https?:\/\//i.test(sel)
      const made = isUrl ? `[link](${sel})` : `[${sel || 'label'}](https://)`
      return { value: value.slice(0, start) + made + value.slice(end), start: start + 1, end: start + 1 + (isUrl ? 4 : (sel || 'label').length) }
    })

  const commit = () => {
    if (it.kind === 'section') store.update(id, { name: text })
    else if (isText) store.update(id, { text })
    else store.update(id, { name: text })
    /* A board is named in two places, on the card and in its own record, and
     * the two have to agree or opening it would show a different name. */
    if (it.kind === 'board' && it.board) void renameBoard(it.board, text)
    onClose()
  }

  return (
    <div className="sheet-veil" onPointerDown={commit}>
      <div className="sheet" onPointerDown={(e) => e.stopPropagation()}>
        <h3>
          {it.kind === 'note'
            ? 'Note'
            : it.kind === 'label'
              ? 'Label'
              : it.kind === 'section'
                ? 'Section'
                : it.kind === 'board'
                  ? 'Board name'
                  : 'Rename'}
        </h3>
        {it.kind === 'note' && (
          <div className="note-tools">
            <button title="Bold  (⌘B)" onClick={() => wrap('**')}><b>B</b></button>
            <button title="Italic  (⌘I)" onClick={() => wrap('*')}><i>I</i></button>
            <button title="Code" onClick={() => wrap('`')}>{'<>'}</button>
            <span className="note-sep" />
            <button title="Heading" onClick={() => prefix('## ')}>H</button>
            <button title="Bullet list" onClick={() => prefix('- ')}>•</button>
            <button title="Numbered list" onClick={() => prefix('1. ')}>1.</button>
            <button title="Checklist" onClick={() => prefix('- [ ] ')}>☐</button>
            <button title="Quote" onClick={() => prefix('> ')}>&rdquo;</button>
            <span className="note-sep" />
            <button title="Link" onClick={link}>↗</button>
          </div>
        )}

        <textarea
          ref={ref}
          value={text}
          rows={it.kind === 'note' ? 8 : 2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            if ((e.metaKey || e.ctrlKey) && it.kind === 'note') {
              const k = e.key.toLowerCase()
              if (k === 'b') { e.preventDefault(); wrap('**') }
              if (k === 'i') { e.preventDefault(); wrap('*') }
            }
          }}
        />

        {it.kind === 'note' && (
          <p className="note-hint">
            <b>**bold**</b> <i>*italic*</i> <code>`code`</code> # heading &nbsp;- list &nbsp;- [ ] to do
          </p>
        )}

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
