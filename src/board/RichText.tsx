import { memo } from 'react'
import { store } from '../state/store'
import { parse, toggleTodo } from '../state/rich'
import type { Block, Span } from '../state/rich'

/* ---------------------------------------------------------------------------
 * A note, drawn.
 *
 * The text is parsed on render rather than kept in a second form beside it.
 * Notes are short and only the visible ones are drawn at all, so there is
 * nothing to gain from holding a tree in the store and everything to lose:
 * one string is what gets saved, searched and edited.
 *
 * Checkboxes are the exception to a note being read-only on the board. Ticking
 * one writes the tick straight back into the text, because a checklist you
 * have to open an editor to tick is not a checklist.
 * ------------------------------------------------------------------------- */

export const RichText = memo(function RichText({ id, text }: { id: string; text: string }) {
  const blocks = parse(text)
  return (
    <div className="rich">
      {blocks.map((b, i) => (
        <Line key={i} id={id} b={b} />
      ))}
    </div>
  )
})

function Line({ id, b }: { id: string; b: Block }) {
  if (b.t === 'gap') return <div className="rich-gap" />
  if (b.t === 'hr') return <hr className="rich-hr" />
  if (b.t === 'h') return <div className={`rich-h rich-h${b.level}`}><Spans spans={b.spans} /></div>
  if (b.t === 'quote') return <div className="rich-quote"><Spans spans={b.spans} /></div>
  if (b.t === 'li') {
    return (
      <div className="rich-li">
        <span className="rich-bullet">{b.ordered ? `${b.n}.` : '•'}</span>
        <span><Spans spans={b.spans} /></span>
      </div>
    )
  }
  if (b.t === 'todo') {
    return (
      <div className="rich-todo" data-done={b.done || undefined}>
        <button
          className="rich-box"
          role="checkbox"
          aria-checked={b.done}
          /* The card underneath treats a press as the start of a drag, so the
             tick has to claim the event before it gets there. */
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const it = store.getItem(id)
            if (!it) return
            store.update(id, { text: toggleTodo(it.text || '', b.line) })
          }}
        >
          {b.done ? '✓' : ''}
        </button>
        <span><Spans spans={b.spans} /></span>
      </div>
    )
  }
  return <div className="rich-p"><Spans spans={b.spans} /></div>
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.href) {
          return (
            <a
              key={i}
              className="rich-link"
              href={s.href}
              target="_blank"
              rel="noreferrer noopener"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {s.text}
            </a>
          )
        }
        if (s.code) return <code key={i} className="rich-code">{s.text}</code>
        if (s.b) return <strong key={i}>{s.text}</strong>
        if (s.i) return <em key={i}>{s.text}</em>
        return <span key={i}>{s.text}</span>
      })}
    </>
  )
}
