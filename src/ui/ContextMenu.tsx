import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { store } from '../state/store'
import { TAGS } from '../state/types'
import type { Item } from '../state/types'

/* ---------------------------------------------------------------------------
 * Right click menu for cards.
 *
 * It acts on the whole selection when the card you right clicked is part of
 * it, and on that card alone otherwise, which is how selection behaves
 * everywhere else on the board.
 * ------------------------------------------------------------------------- */

export interface MenuState {
  /* Where to draw it, in screen pixels. */
  x: number
  y: number
  /* Cards the menu acts on. Empty for the canvas menu. */
  ids: string[]
  /* Where on the board it was opened, so the canvas menu can add things
   * under the pointer rather than in the middle of the view. */
  board?: { x: number; y: number }
}

export interface CanvasActions {
  addNote: (at: { x: number; y: number }) => void
  addLabel: (at: { x: number; y: number }) => void
  addSection: (at: { x: number; y: number }) => void
  addBoard: (at: { x: number; y: number }) => void
  importBoard: (at: { x: number; y: number }) => void
  addLink: (at: { x: number; y: number }) => void
  pickFiles: (at: { x: number; y: number }) => void
  paste: (at: { x: number; y: number }) => void
}

interface Props {
  menu: MenuState
  onClose: () => void
  onOpenEditor: (id: string, mode?: 'open' | 'edit') => void
  canvas: CanvasActions
}

export function ContextMenu({ menu, onClose, onOpenEditor, canvas }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  /* Held in a ref so the listeners below can attach once and stay attached.
   *
   * They used to depend on `onClose`, which is a fresh function on every
   * render of the board. Pressing Escape re-rendered the board through
   * another handler on the same event, which tore these listeners down and
   * put new ones up while that very event was still being delivered. A
   * listener removed mid-dispatch never gets its turn, and one added
   * mid-dispatch is not called for that event, so Escape did nothing. */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  /* Nudged back inside the window when it would open past an edge. */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(menu.x, window.innerWidth - r.width - 8)
    const y = Math.min(menu.y, window.innerHeight - r.height - 8)
    setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [menu.x, menu.y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    /* Anything that moves the board underneath closes it, so the menu never
     * floats detached from the card it belongs to. */
    const onWheel = () => closeRef.current()
    /* Closing on a real pointerdown rather than behind a full screen cover.
     * A cover would swallow the click, so right clicking straight onto
     * another card would only dismiss this menu instead of opening that
     * card's. Capture runs before the card sees the event, and the browser
     * fires pointerdown before contextmenu, so the next menu still opens. */
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('resize', onWheel)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onWheel)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [])

  const ids = menu.ids
  const items = ids.map((id) => store.getItem(id)).filter(Boolean)
  const onCanvas = !ids.length
  if (!onCanvas && !items.length) return null

  const many = ids.length > 1
  const first = items[0]
  const anyInSection = items.some((i) => i!.parent)
  const anySection = items.some((i) => i!.kind === 'section')
  /* Sections are the ground and wires have no box, so neither can be lined up
   * with anything. Two cards that can is what makes the row worth showing. */
  const movable = items.filter((i) => i!.kind !== 'section' && i!.kind !== 'edge').length
  const currentTag = first && items.every((i) => i!.tag === first.tag) ? first.tag : null

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <>
      <div
        className="menu"
        ref={ref}
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={(e) => e.preventDefault()}
        /* The menu is rendered inside the board, so without this its own
         * presses bubble to the board and are treated as a click on empty
         * canvas. That cleared the menu before the button underneath the
         * pointer ever received its click, so no action ever ran. */
        onPointerDown={(e) => e.stopPropagation()}
      >
        {onCanvas ? (
          <CanvasMenu at={menu.board!} canvas={canvas} run={run} />
        ) : (
          <CardMenu
            ids={ids}
            first={first!}
            many={many}
            anySection={anySection}
            anyInSection={anyInSection}
            currentTag={currentTag}
            movable={movable}
            run={run}
            onOpenEditor={onOpenEditor}
          />
        )}
      </div>
    </>
  )
}

function CanvasMenu({
  at, canvas, run,
}: {
  at: { x: number; y: number }
  canvas: CanvasActions
  run: (fn: () => void) => () => void
}) {
  return (
    <>
      <div className="menu-head">Add here</div>
      <button onClick={run(() => canvas.addNote(at))}>Note</button>
      <button onClick={run(() => canvas.addLabel(at))}>Label</button>
      <button onClick={run(() => canvas.addSection(at))}>Section</button>
      <button onClick={run(() => canvas.addBoard(at))}>Board</button>
      <button onClick={run(() => canvas.addLink(at))}>Link</button>
      <button onClick={run(() => canvas.pickFiles(at))}>Files…</button>
      <button onClick={run(() => canvas.importBoard(at))}>Board file…</button>

      <div className="menu-sep" />

      <button onClick={run(() => canvas.paste(at))}>
        Paste <em>⌘V</em>
      </button>
      <button
        onClick={run(() =>
          store.select(store.all().filter((i) => i.kind !== 'section').map((i) => i.id))
        )}
      >
        Select all <em>⌘A</em>
      </button>
    </>
  )
}

function CardMenu({
  ids, first, many, anySection, anyInSection, currentTag, movable, run, onOpenEditor,
}: {
  ids: string[]
  first: Item
  many: boolean
  anySection: boolean
  anyInSection: boolean
  currentTag: string | null | undefined
  movable: number
  run: (fn: () => void) => () => void
  onOpenEditor: (id: string, mode?: 'open' | 'edit') => void
}) {
  return (
    <>
      <div className="menu-head">{many ? `${ids.length} items` : first.name || first.text || first.kind}</div>

      {!many && first.kind === 'board' && (
        <button onClick={run(() => onOpenEditor(first.id, 'open'))}>Open board</button>
      )}
      {!many && (
        <button onClick={run(() => onOpenEditor(first.id, 'edit'))}>
          {first.kind === 'note' || first.kind === 'label'
            ? 'Edit text'
            : first.kind === 'section'
              ? 'Rename section'
              : first.kind === 'board'
                ? 'Rename board'
                : 'Rename'}
        </button>
      )}
      <button onClick={run(() => { const made = store.duplicate(ids); if (made.length) store.select(made) })}>
        Duplicate <em>⌘D</em>
      </button>
      {/* Two cards and nothing else: the one case where what to connect to
          what is not a question. */}
      {ids.length === 2 && !anySection && (
        <button
          onClick={run(() => {
            const made = store.connect(ids[0], ids[1])
            if (made) store.select([made])
          })}
        >
          Connect
        </button>
      )}

      {movable >= 2 && (
        <>
          <div className="menu-sep" />
          <div className="menu-arrange">
            <span>Align</span>
            <button title="Left edges" onClick={run(() => store.align(ids, 'left'))}>L</button>
            <button title="Centres" onClick={run(() => store.align(ids, 'hcentre'))}>C</button>
            <button title="Right edges" onClick={run(() => store.align(ids, 'right'))}>R</button>
            <i />
            <button title="Tops" onClick={run(() => store.align(ids, 'top'))}>T</button>
            <button title="Middles" onClick={run(() => store.align(ids, 'vmiddle'))}>M</button>
            <button title="Bottoms" onClick={run(() => store.align(ids, 'bottom'))}>B</button>
          </div>
          {movable >= 3 && (
            <div className="menu-arrange">
              <span>Space evenly</span>
              <button title="Across" onClick={run(() => store.distribute(ids, 'x'))}>↔</button>
              <button title="Down" onClick={run(() => store.distribute(ids, 'y'))}>↕</button>
            </div>
          )}
          <button onClick={run(() => store.tidy(ids))}>Tidy up</button>
        </>
      )}

      <div className="menu-sep" />

      <button disabled={anySection} onClick={run(() => store.bringToFront(ids))}>
        Bring to front
      </button>
      <button disabled={anySection} onClick={run(() => store.sendToBack(ids))}>
        Send to back
      </button>
      {anyInSection && <button onClick={run(() => store.clearParent(ids))}>Remove from section</button>}

      <div className="menu-sep" />

      <div className="menu-tags">
        <span>Tag</span>
        <button
          className="menu-tag-none"
          data-on={!currentTag || undefined}
          title="No tag"
          onClick={run(() => store.setTag(ids, null))}
        />
        {TAGS.map((t) => (
          <button
            key={t.id}
            style={{ background: t.c }}
            data-on={currentTag === t.id || undefined}
            title={t.id}
            onClick={run(() => store.setTag(ids, t.id))}
          />
        ))}
      </div>

      <div className="menu-sep" />

      <button className="menu-danger" onClick={run(() => store.remove(ids))}>
        Delete{anySection ? ' with contents' : ''} <em>⌫</em>
      </button>
    </>
  )
}
