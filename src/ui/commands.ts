import { store } from '../state/store'
import { noteItem, labelItem, sectionItem } from '../state/ingest'
import { isSection, isWire, hasPixels } from '../state/kinds'
import { KEYS } from './shortcuts'
import { markPick } from '../state/walk'
import { matches, narrowed, subject, subjectLabel } from '../state/subject'
import { setTheme, themeWant } from './theme'
import type { Command } from './CommandPalette'
import type { MirrorState } from '../store/mirror'

/* ---------------------------------------------------------------------------
 * Everything the board can do, as a list.
 *
 * Built from the actions rather than owning them: this file knows what the
 * commands are called, what they are grouped under and which keys run them,
 * and nothing at all about how a picture is exported or a board is opened.
 * That is what lets it be read as a menu — which is what it is — rather than
 * as fifty lines in the middle of the component that holds the app together.
 * ------------------------------------------------------------------------- */

export interface CommandActions {
  selection: string[]
  panelOpen: boolean
  mirror: MirrorState
  centreOfView: () => { x: number; y: number }
  addBoard: (at: { x: number; y: number }) => void
  askForLink: () => void
  draw: () => void
  connectClaude: () => void
  reclaim: () => void
  deleteBoard: () => void
  help: () => void
  newProject: () => void
  stepProject: (by: number) => void
  closeProject: () => void
  projects: number
  pickFiles: () => void
  importBoard: () => void
  exportBoard: () => void
  exportPictures: (ids: string[]) => void
  pullColours: (ids: string[]) => void
  keepInFolder: () => void
  copyToFolder: () => void
  forgetFolder: () => void
  setPanelOpen: (fn: (v: boolean) => boolean) => void
  setTab: (t: 'effect' | 'adjust' | 'looks') => void
  setPresenting: (on: boolean) => void
  focusSearch: () => void
  fit: (onlySelection: boolean) => void
  say: (text: string) => void
  exportPoster: (as: 'png' | 'pdf') => void
  gather: () => void
  compare: () => void
  takeAway: () => void
  putHere: () => void
  clipped: number
}

export function buildCommands(a: CommandActions): Command[] {
  const sel = () => store.getSelection()
  const some = a.selection.length > 0
  /* What "this board" means right now — the selection, what a search has
     narrowed to, or all of it — so the names below say what they will act on
     rather than leaving you to find out by running them. */
  const what = subjectLabel(subject())
  const shown = () => matches().filter((i) => !isSection(i)).map((i) => i.id)
  const at = () => a.centreOfView()
  const cmd = (id: string, name: string, group: string, run: () => void, extra: Partial<Command> = {}): Command => ({
    id, name, group, run, ...extra,
  })
  return [
    cmd('add.files', 'Add files', 'Add', () => a.pickFiles(), { hint: KEYS.addFiles.hint, keywords: 'image photo picture video upload import' }),
    cmd('add.note', 'Note', 'Add', () => store.add(noteItem(at())), { hint: KEYS.note.hint, keywords: 'text write checklist' }),
    cmd('add.label', 'Label', 'Add', () => store.add(labelItem(at())), { hint: KEYS.label.hint, keywords: 'title heading caption' }),
    cmd('add.section', 'Section', 'Add', () => store.add(sectionItem(at())), { hint: KEYS.section.hint, keywords: 'group area frame' }),
    cmd('add.board', 'Board inside this one', 'Add', () => a.addBoard(at()), { hint: KEYS.board.hint, keywords: 'nested folder' }),
    cmd('add.link', 'Link or video URL', 'Add', () => a.askForLink(), { hint: KEYS.link.hint, keywords: 'url youtube vimeo paste' }),
    cmd('add.draw', 'Draw a picture from a prompt', 'Add', () => a.draw(), { hint: KEYS.draw.hint, keywords: 'ai generate image imagine gemini imagen prompt make' }),

    cmd('edit.undo', 'Undo', 'Edit', () => store.undo(), { hint: KEYS.undo.hint }),
    cmd('edit.redo', 'Redo', 'Edit', () => store.redo(), { hint: KEYS.redo.hint }),
    /* With a search running, "everything" means everything you can see. Lit
       four cards out of thirty and selecting all thirty — twenty-six of them
       faded out — is not what the words mean. */
    cmd(
      'edit.all',
      narrowed() ? 'Select everything shown' : 'Select everything',
      'Edit',
      () => store.select(narrowed() ? shown() : store.all().filter((i) => !isSection(i)).map((i) => i.id)),
      { keywords: 'all results matches shown' }
    ),
    cmd('edit.dup', 'Duplicate the selection', 'Edit', () => { const made = store.duplicate(sel()); if (made.length) store.select(made) }, { disabled: !some }),
    cmd('edit.del', 'Delete the selection', 'Edit', () => store.remove(sel()), { disabled: !some, keywords: 'remove' }),

    /* A board card holds a whole board and nothing could travel between them:
       you could nest boards and never bring anything up or send anything
       down. Cut here, walk to where it belongs, put it there. */
    cmd('edit.takeaway', KEYS.takeAway.label, 'Edit', () => a.takeAway(), {
      hint: KEYS.takeAway.hint,
      disabled: !some,
      keywords: 'cut move another board send transfer relocate',
    }),
    cmd(
      'edit.puthere',
      a.clipped ? `Put the ${a.clipped} you took away on this board` : KEYS.putHere.label,
      'Edit',
      () => a.putHere(),
      { hint: KEYS.putHere.hint, disabled: !a.clipped, keywords: 'paste move another board bring' }
    ),

    cmd('edit.keep', 'Mark as kept', 'Edit', () => markPick('in', a.say), { hint: KEYS.keep.hint, disabled: !some, keywords: 'pick in yes tick shortlist choose decide' }),
    cmd('edit.cut', 'Mark as cut', 'Edit', () => markPick('out', a.say), { hint: KEYS.cut.hint, disabled: !some, keywords: 'pick out no reject discard kill decide' }),

    /* The end of curating, and the one step that had no verb: what survived,
       in a place of its own with a name on it. */
    cmd('arrange.gather', a.selection.length > 1 ? `Put the ${a.selection.length} selected together in one place` : 'Put the selection together in one place', 'Arrange', () => a.gather(), {
      hint: KEYS.gather.hint,
      disabled: a.selection.length < 2,
      keywords: 'gather collect shortlist group section together keepers picks best',
    }),
    cmd('arrange.tidy', 'Tidy up the whole board', 'Arrange', () => store.tidy(store.all().filter((i) => !isWire(i)).map((i) => i.id)), { keywords: 'grid align layout sort' }),
    /* Tidying a selection was in the right click menu and nowhere else, so
       having just picked six cards out there was no way to lay them out. */
    cmd('arrange.tidysel', 'Tidy up the selection', 'Arrange', () => store.tidy(sel()), {
      disabled: a.selection.length < 2,
      keywords: 'grid align layout sort selection',
    }),
    cmd('arrange.left', 'Line the selection up on the left', 'Arrange', () => store.align(sel(), 'left'), { disabled: a.selection.length < 2 }),
    cmd('arrange.top', 'Line the selection up on the top', 'Arrange', () => store.align(sel(), 'top'), { disabled: a.selection.length < 2 }),
    cmd('arrange.spreadx', 'Space the selection out across', 'Arrange', () => store.distribute(sel(), 'x'), { disabled: a.selection.length < 3 }),
    cmd('arrange.spready', 'Space the selection out down', 'Arrange', () => store.distribute(sel(), 'y'), { disabled: a.selection.length < 3 }),

    cmd('out.picture', 'Export the selected pictures as PNG', 'Take out', () => a.exportPictures(sel()), { hint: KEYS.picture.hint, disabled: !some, keywords: 'png save download image' }),
    /* The other way out: not a file, but an agent given the board to work on. */
    cmd('out.claude', 'Connect to Claude', 'Take out', () => a.connectClaude(), { keywords: 'mcp agent ai relay attach claude code assistant' }),
    cmd('out.board', 'Export this board and everything in it', 'Take out', () => a.exportBoard(), { hint: KEYS.export.hint, keywords: 'zip backup save download' }),
    /* Deleting a card never deleted its picture, and deleting the card that
       stood for a board never deleted the board. So the store only ever grew.
       This is the one thing that gets the room back. */
    cmd('out.reclaim', 'Clear up files nothing uses any more', 'Take out', () => a.reclaim(), {
      keywords: 'storage space free disk clean purge unused orphan reclaim room full',
    }),
    cmd('out.delboard', 'Delete a board and everything in it', 'Take out', () => a.deleteBoard(), {
      keywords: 'remove board destroy nested',
    }),
    /* The one export that is a deliverable rather than a backup: the board
       as it looks, flat, in a file anyone can open. */
    cmd('out.poster', `Export ${what} as one picture`, 'Take out', () => a.exportPoster('png'), {
      keywords: 'png poster sheet flatten whole screenshot share send image',
    }),
    cmd('out.pdf', `Export ${what} as a PDF`, 'Take out', () => a.exportPoster('pdf'), {
      keywords: 'pdf print paper page poster share send deck a4 letter',
    }),
    cmd(
      'out.folder',
      a.mirror.folder ? `Stop keeping a copy in ${a.mirror.folder}` : 'Keep a copy in a folder on disk…',
      'Take out',
      () => (a.mirror.folder ? a.forgetFolder() : a.keepInFolder()),
      { keywords: 'sync backup dropbox icloud disk folder mirror copy' }
    ),
    cmd('out.folder.now', 'Copy to the folder now', 'Take out', () => a.copyToFolder(), {
      disabled: !a.mirror.folder,
      keywords: 'sync backup folder save',
    }),
    cmd('in.board', 'Import a board file', 'Take out', () => a.importBoard(), { hint: KEYS.import.hint, keywords: 'zip open restore' }),

    cmd('add.colours', 'Pull the colours out of the picture', 'Add', () => a.pullColours(sel()), { disabled: !a.selection.some((id) => hasPixels(store.getItem(id))), keywords: 'palette swatch colour color hex sample' }),
    cmd('view.present', `Present ${what}`, 'View', () => a.setPresenting(true), { hint: KEYS.present.hint, keywords: 'slideshow full screen show demo' }),
    /* The deciding itself. The show puts one thing on screen at a time, and
       when you are choosing the question is what the other one looked like. */
    cmd(
      'view.compare',
      a.selection.length > 1 ? `Hold the ${Math.min(4, a.selection.length)} selected up against each other` : 'Hold two things up against each other',
      'View',
      () => a.compare(),
      { hint: KEYS.compare.hint, disabled: a.selection.length < 2, keywords: 'compare side by side against versus choose between judge' }
    ),
    cmd('view.effects', a.panelOpen ? 'Hide the effects panel' : 'Show the effects panel', 'View', () => a.setPanelOpen((v) => !v), { hint: KEYS.effects.hint }),
    cmd('view.looks', 'Saved looks', 'View', () => { a.setPanelOpen(() => true); a.setTab('looks') }, { keywords: 'preset grade style' }),
    cmd('view.search', 'Search this board', 'View', () => a.focusSearch(), { hint: KEYS.search.hint, keywords: 'find filter' }),
    /* The step that was missing between narrowing a board and doing anything
       about it. */
    cmd('view.results', 'Select the search results', 'View', () => store.select(shown()), {
      hint: KEYS.selectShown.hint,
      disabled: !narrowed(),
      keywords: 'select matches shown found filter kept cut results',
    }),
    /* A board grows past the window, and until these there was no way back
       to the whole of it but scrolling until it turned up. */
    cmd('view.fit', KEYS.fitBoard.label, 'View', () => a.fit(false), { hint: KEYS.fitBoard.hint, keywords: 'zoom fit all everything overview zoom out see' }),
    cmd('view.fitsel', KEYS.fitSelection.label, 'View', () => a.fit(true), { hint: KEYS.fitSelection.hint, disabled: !some, keywords: 'zoom fit selected closer focus' }),
    /* The tab row, for anyone who would rather not reach for it. Switching
       wraps on purpose: with two projects — which is most of the time — one
       key gets you to the other and back, and there is nothing to aim at. */
    cmd('proj.new', 'New project', 'Projects', () => a.newProject(), { keywords: 'board tab add another blank start' }),
    cmd('proj.next', 'Next project', 'Projects', () => a.stepProject(1), {
      disabled: a.projects < 2, keywords: 'board tab switch move right forward',
    }),
    cmd('proj.prev', 'Previous project', 'Projects', () => a.stepProject(-1), {
      disabled: a.projects < 2, keywords: 'board tab switch move left back',
    }),
    /* Named for what it does rather than for the tab it does it to: closing a
       project destroys it, and nothing in this list should read as tidier than
       it is. */
    cmd('proj.close', 'Delete this project and everything in it', 'Projects', () => a.closeProject(), {
      keywords: 'close tab remove board destroy',
    }),

    cmd('view.help', 'How this works', 'View', () => a.help(), {
      hint: KEYS.help.hint, keywords: 'help guide manual docs explain what how start learn keys shortcuts',
    }),
    cmd('view.light', 'Light theme', 'View', () => setTheme('light'), { disabled: themeWant() === 'light', keywords: 'bright day appearance' }),
    cmd('view.dark', 'Dark theme', 'View', () => setTheme('dark'), { disabled: themeWant() === 'dark', keywords: 'night appearance' }),
    cmd('view.system', 'Follow the system theme', 'View', () => setTheme('system'), { disabled: themeWant() === 'system', keywords: 'auto appearance' }),
  ]
}
