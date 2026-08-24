import { store } from '../state/store'
import { SearchBar } from './SearchBar'
import { TagFilter } from './TagFilter'
import { nameFor, titleFor } from './shortcuts'
import type { ShortcutName } from './shortcuts'
import {
  IconBoard, IconCommand, IconEffects, IconExport, IconFiles, IconImport, IconLabel, IconLink,
  IconNote, IconSection, IconUndo, IconRedo,
} from './icons'
import type { Crumb } from '../state/boards'

/* ---------------------------------------------------------------------------
 * The row across the top.
 *
 * All of it is presentation: where you are, what you are looking for, and the
 * things you can make. It knows nothing about how a board is opened or a file
 * is read — every one of those arrives as a prop — which is what lets the row
 * be read in one screenful and what took a hundred lines out of App.
 * ------------------------------------------------------------------------- */

interface Props {
  path: Crumb[]
  name: string
  onName: (v: string) => void
  onOpenBoard: (to: Crumb[]) => void
  panelOpen: boolean
  onPanel: () => void
  onCommands: () => void
  onAddFiles: () => void
  onNote: () => void
  onLabel: () => void
  onSection: () => void
  onBoard: () => void
  onLink: () => void
  onImport: () => void
  onExport: () => void
}

export function TopBar({
  path, name, onName, onOpenBoard, panelOpen, onPanel, onCommands,
  onAddFiles, onNote, onLabel, onSection, onBoard, onLink, onImport, onExport,
}: Props) {
  return (
  <header className="topbar" data-nested={path.length > 1 || undefined}>
    <div className="brand">
      <span className="dot" />
      {path.length > 1 && (
        <nav className="crumbs">
          {path.length > 3 && (
            <span className="crumb">
              <button onClick={() => onOpenBoard([path[0]])} title={path[0].name}>
                …
              </button>
              <i>/</i>
            </span>
          )}
          {path.slice(0, -1).slice(-2).map((c) => (
            <span key={c.id} className="crumb">
              <button
                title={c.name}
                onClick={() => onOpenBoard(path.slice(0, path.findIndex((p) => p.id === c.id) + 1))}
              >
                {c.name}
              </button>
              <i>/</i>
            </span>
          ))}
        </nav>
      )}
      <input
        className="board-name"
        value={name}
        onChange={(e) => {
          onName(e.target.value)
          store.setName(e.target.value)
        }}
        spellCheck={false}
      />
    </div>

    <SearchBar />
    <TagFilter />

    {/* Icons in three groups rather than eleven grey words in a row.
        The words told you nothing the icon does not — they were all the
        same size, weight and colour, so nothing in the row stood out and
        the row itself was as wide as the window would allow. What each one
        is, and the key that runs it, is on its tooltip and in the command
        list. Effects keeps its name because it is the only thing here that
        is a mode rather than an action. */}
    <div className="tools">
      <div className="tool-group">
        <ToolButton name="addFiles" onClick={onAddFiles}>
          <IconFiles />
        </ToolButton>
        <ToolButton name="note" onClick={onNote}>
          <IconNote />
        </ToolButton>
        <ToolButton name="label" onClick={onLabel}>
          <IconLabel />
        </ToolButton>
        <ToolButton name="section" onClick={onSection}>
          <IconSection />
        </ToolButton>
        <ToolButton name="board" onClick={onBoard}>
          <IconBoard />
        </ToolButton>
        <ToolButton name="link" onClick={onLink}>
          <IconLink />
        </ToolButton>
      </div>

      <div className="tool-group">
        <ToolButton name="undo" onClick={() => store.undo()}>
          <IconUndo />
        </ToolButton>
        <ToolButton name="redo" onClick={() => store.redo()}>
          <IconRedo />
        </ToolButton>
      </div>

      {/* First to go when the row runs short: both are also a drop, a menu
          entry, a shortcut and a line in the command list, while nothing
          else here has a second way in. */}
      <div className="tool-group tools-wide">
        <ToolButton name="import" onClick={onImport}>
          <IconImport />
        </ToolButton>
        <ToolButton name="export" onClick={onExport}>
          <IconExport />
        </ToolButton>
      </div>

      <ToolButton name="commands" onClick={onCommands}>
        <IconCommand />
      </ToolButton>

      <button
        className="tool-mode"
        data-on={panelOpen || undefined}
        onClick={onPanel}
        title={titleFor('effects')}
        aria-label="Effects"
      >
        <IconEffects />
        <span>Effects</span>
      </button>
    </div>
  </header>
  )
}

/* A button in the top row: an icon, and the name and key it runs on its
   tooltip and for anything reading the page aloud. */
function ToolButton({
  name, onClick, children,
}: {
  name: ShortcutName
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button className="tool" onClick={onClick} title={titleFor(name)} aria-label={nameFor(name)}>
      {children}
    </button>
  )
}
