import { armTool, useTool } from '../board/tool'
import { nameFor, titleFor } from './shortcuts'
import type { ShortcutName } from './shortcuts'
import {
  IconBoard, IconDraw, IconExport, IconFiles, IconImport, IconLabel, IconLink,
  IconNote, IconSection, IconText,
} from './icons'

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
