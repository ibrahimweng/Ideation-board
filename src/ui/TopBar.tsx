import { store } from '../state/store'
import { SearchBar } from './SearchBar'
import { TagFilter } from './TagFilter'
import { BoardTabs } from './BoardTabs'
import type { BoardTabsProps } from './BoardTabs'
import { nameFor, titleFor } from './shortcuts'
import type { ShortcutName } from './shortcuts'
import { IconCommand, IconEffects, IconUndo, IconRedo, IconHelp } from './icons'
import type { Crumb } from '../state/boards'

/* ---------------------------------------------------------------------------
 * The row across the top.
 *
 * One row now, and three regions, each answering a different question.
 *
 * Left is which project — the tabs themselves, which used to sit in a strip of
 * their own underneath. Two rows to hold one row's worth of things is two rows
 * of the board given up, and the strip was the thinner of them.
 *
 * Middle is what you are looking for: the search and the tags, in the one
 * place on a screen the eye goes to first for exactly that.
 *
 * Right is everything that acts on what is already there — undo, the command
 * list, help, and the panel. Opposite the rail of tools down the left, which
 * is the arrangement the whole window is now built on: what goes on the board
 * on one side, what is done to it on the other.
 *
 * All of it is presentation. It knows nothing about how a board is opened or a
 * file is read; every one of those arrives as a prop.
 * ------------------------------------------------------------------------- */

interface Props {
  path: Crumb[]
  name: string
  onName: (v: string) => void
  onOpenBoard: (to: Crumb[]) => void
  /* Opening a board because a search found something inside it, and landing
     on the card it found rather than wherever that board was left. */
  onGoTo: (to: Crumb[], itemId: string) => void
  panelOpen: boolean
  onPanel: () => void
  onCommands: () => void
  onHelp: () => void
  /* Everything the tabs need, passed straight through: this row is where they
     live now, and nothing here has an opinion about them. */
  tabs: BoardTabsProps
}

export function TopBar({
  path, name, onName, onOpenBoard, onGoTo, panelOpen, onPanel, onCommands, onHelp, tabs,
}: Props) {
  const nested = path.length > 1
  return (
  <header className="topbar" data-nested={nested || undefined}>
    <div className="topbar-left">
      <span className="dot" />
      <BoardTabs {...tabs} />

      {/* Where you are *inside* the project, which the tabs cannot say: they
          name projects, and a board four levels down is not a fifth project.
          Only there when you are down one, so at the top of a project the tab
          is the only thing naming it — and it renames in place, which is what
          the field in this row used to be for. */}
      {nested && (
        <div className="topbar-where">
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
          <input
            className="board-name"
            value={name}
            onChange={(e) => {
              onName(e.target.value)
              store.setName(e.target.value)
            }}
            spellCheck={false}
            aria-label="Name for this board"
          />
        </div>
      )}
    </div>

    <div className="topbar-mid">
      <SearchBar path={path} onGo={onGoTo} />
      <TagFilter />
    </div>

    <div className="topbar-right">
      <div className="tool-group">
        <ToolButton name="undo" onClick={() => store.undo()}>
          <IconUndo />
        </ToolButton>
        <ToolButton name="redo" onClick={() => store.redo()}>
          <IconRedo />
        </ToolButton>
      </div>

      <ToolButton name="commands" onClick={onCommands}>
        <IconCommand />
      </ToolButton>

      {/* Beside the command list on purpose. They are the two ways out of not
          knowing something: one finds the thing you can already name, and this
          one is for when you cannot name it yet. Never stands down on a narrow
          window — the smaller the window the more likely it is a first look at
          this. */}
      <ToolButton name="help" onClick={onHelp}>
        <IconHelp />
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
    <button
      className="tool"
      onClick={onClick}
      title={titleFor(name)}
      aria-label={nameFor(name)}
    >
      {children}
    </button>
  )
}
