import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GROUPS, TOOL_HINT, TOOL_NAME, armShape, armTool, isShapeTool, usePicked, useTool } from '../board/tool'
import type { Group, ShapeTool } from '../board/tool'
import { KEYS, nameFor, titleFor } from './shortcuts'
import type { ShortcutName } from './shortcuts'
import {
  IconArrow, IconBoard, IconCurve, IconDraw, IconEllipse, IconExport, IconFiles,
  IconImport, IconLabel, IconLine, IconLink, IconNote, IconPen, IconPencil,
  IconPolygon, IconRect, IconSection, IconStar, IconText,
} from './icons'

/* Each tool drawn as the thing it makes. */
const ICONS: Record<ShapeTool, (p: { className?: string }) => React.ReactElement> = {
  rect: IconRect, ellipse: IconEllipse, polygon: IconPolygon, star: IconStar,
  line: IconLine, arrow: IconArrow,
  pen: IconPen, curve: IconCurve, pencil: IconPencil,
}

/* ---------------------------------------------------------------------------
 * The things you make, down the left.
 *
 * They used to live in the top row, alongside the search, the tags, the
 * commands, the help and the effects — eleven icon buttons in a line that was
 * also trying to hold a board's name and a search field, so on a narrow window
 * four of them quietly stood down and the rest were a grey undifferentiated
 * run. A row that holds everything says nothing about anything.
 *
 * Down here they are one thing: a rail of what you can put on the board, in
 * the place every tool in every drawing program has been for thirty years, and
 * with the room to be grouped by what they are — words, regions, the things
 * that arrive from somewhere else, and the whole board in and out.
 *
 * It leaves the top row to say where you are and what you are looking for, and
 * it puts the tools opposite the effects panel: what goes on the board on one
 * side, what is done to it on the other.
 * ------------------------------------------------------------------------- */

interface Props {
  onAddFiles: () => void
  onNote: () => void
  onLabel: () => void
  onBoard: () => void
  onLink: () => void
  onDraw: () => void
  onImport: () => void
  onExport: () => void
}

export function ToolRail({ onAddFiles, onNote, onLabel, onBoard, onLink, onDraw, onImport, onExport }: Props) {
  const tool = useTool()
  return (
    <nav className="rail" aria-label="Tools">
      {/* Words. Two ways to put some down: one that is a card you can read a
          paragraph off, and one that is type lying on the board. */}
      <div className="rail-group">
        <RailButton name="note" onClick={onNote}>
          <IconNote />
        </RailButton>
        <RailButton name="label" onClick={onLabel}>
          <IconLabel />
        </RailButton>
        {/* The two that arm. Pressed, they wait for you to draw the box; the
            board takes a cursor for it and the button stays lit until you
            have. Pressed again, they stand down. */}
        <RailButton name="text" onClick={() => armTool('text')} on={tool === 'text'}>
          <IconText />
        </RailButton>
        <RailButton name="section" onClick={() => armTool('section')} on={tool === 'section'}>
          <IconSection />
        </RailButton>
      </div>

      {/* What you draw. Two buttons for nine tools: the one you used last is
          on the rail and the rest are a press on its corner away, which is
          how every drawing program has grouped its tools since the first
          one. The key walks the group and then puts it down. */}
      <div className="rail-group">
        <RailGroup group="shape" />
        <RailGroup group="pen" />
      </div>

      {/* Things that come from somewhere else. */}
      <div className="rail-group">
        <RailButton name="addFiles" onClick={onAddFiles}>
          <IconFiles />
        </RailButton>
        <RailButton name="link" onClick={onLink}>
          <IconLink />
        </RailButton>
        <RailButton name="draw" onClick={onDraw}>
          <IconDraw />
        </RailButton>
        <RailButton name="board" onClick={onBoard}>
          <IconBoard />
        </RailButton>
      </div>

      {/* And the whole board, in and out. Apart from the rest because they are
          about the file rather than about this board's contents. */}
      <div className="rail-group rail-foot">
        <RailButton name="import" onClick={onImport}>
          <IconImport />
        </RailButton>
        <RailButton name="export" onClick={onExport}>
          <IconExport />
        </RailButton>
      </div>
    </nav>
  )
}

/* One tool group: the current member on the rail, the rest behind a corner
 * mark. The mark is its own button rather than a long press, because a long
 * press is a gesture nobody finds and a tool nobody finds is a tool that is
 * not there. */
function RailGroup({ group }: { group: Group }) {
  const tool = useTool()
  const pick = usePicked(group)
  /* Where the flyout goes, read off the button when it opens.
   *
   * Fixed rather than hung off the button, because the rail is a scrolling
   * column and anything absolutely placed beside a button in it is clipped by
   * the column — which is a flyout that is in the page, has a name, answers a
   * click, and cannot be seen. */
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const show = () => {
    const r = box.current?.getBoundingClientRect()
    setOpen(open || !r ? null : { left: r.right + 8, top: Math.min(r.top - 2, window.innerHeight - 180) })
  }
  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !pop.current?.contains(t)) setOpen(null)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const Icon = ICONS[pick]
  const on = isShapeTool(tool) && GROUPS[group].includes(tool)
  return (
    <div className="rail-stack" ref={box}>
      <button
        className="rail-tool"
        data-on={on || undefined}
        aria-pressed={on}
        onClick={() => armShape(pick)}
        title={`${TOOL_HINT[pick]}  (${KEYS[group].hint})`}
        aria-label={TOOL_NAME[pick]}
      >
        <Icon />
      </button>
      <button
        className="rail-more"
        onClick={show}
        aria-expanded={!!open}
        aria-label={nameFor(group)}
        title={titleFor(group)}
      />
      {/* Out into the page, not down the rail. The rail is a scrolling column
          and its wells are blurred, and either of those on its own is enough
          to make a flyout hung off a button in it a flyout you cannot see:
          laid out, named, answering a click, and painted nowhere. */}
      {open &&
        createPortal(
          <div className="rail-flyout" role="menu" ref={pop} style={{ left: open.left, top: open.top }}>
            {GROUPS[group].map((t) => {
              const Each = ICONS[t]
              return (
                <button
                  key={t}
                  role="menuitem"
                  className="rail-flyout-item"
                  data-on={tool === t || undefined}
                  onClick={() => { armShape(t); setOpen(null) }}
                  title={TOOL_HINT[t]}
                >
                  <Each />
                  <span>{TOOL_NAME[t]}</span>
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}

function RailButton({
  name, onClick, on, children,
}: {
  name: ShortcutName
  onClick: () => void
  /* Armed, for the two that are a mode rather than an action. */
  on?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      className="rail-tool"
      data-on={on || undefined}
      aria-pressed={on === undefined ? undefined : on}
      onClick={onClick}
      title={titleFor(name)}
      aria-label={nameFor(name)}
    >
      {children}
    </button>
  )
}
