/* One place for the keyboard shortcuts, so the toolbar hints and the handler
 * that runs them cannot drift apart. */

/* Apple keyboards label the modifier differently, and showing the wrong one
 * is worse than showing none. */
const isApple = /Mac|iPhone|iPad|iPod/.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent
)

export const MOD = isApple ? '⌘' : 'Ctrl'
export const SHIFT = isApple ? '⇧' : 'Shift'
const join = (...parts: string[]) => (isApple ? parts.join('') : parts.join('+'))

/* `label` is the sentence on the tooltip. `short` is the name of the thing,
 * which is what a button without words has to be called: it is the accessible
 * name, so it is what a screen reader says and what a test asks for. Where
 * they are the same only one is written. */
export const KEYS = {
  addFiles: { key: 'f', hint: 'F', label: 'Add files' },
  note: { key: 'n', hint: 'N', label: 'Note' },
  label: { key: 'l', hint: 'L', label: 'Label' },
  section: { key: 's', hint: 'S', label: 'Section' },
  board: { key: 'b', hint: 'B', label: 'A board inside this one', short: 'Board' },
  link: { key: 'k', hint: 'K', label: 'Link or video URL', short: 'Link' },
  effects: { key: 'e', hint: 'E', label: 'Effects panel', short: 'Effects' },
  present: { key: 'p', hint: 'P', label: 'Present the board', short: 'Present' },
  fitBoard: { key: '1', hint: '1', label: 'Fit the whole board on screen', short: 'Fit board' },
  fitSelection: { key: '2', hint: '2', label: 'Fit the selection on screen', short: 'Fit selection' },
  keep: { key: 'i', hint: 'I', label: 'Mark as kept', short: 'Keep' },
  cut: { key: 'o', hint: 'O', label: 'Mark as cut', short: 'Cut' },
  selectShown: { key: 'enter', hint: '⌘⏎', label: 'Select the search results', short: 'Select shown' },
  /* Not called cut: this board already has a Cut, and it means the opposite of
     Keep. This one takes cards off a board to put them on another. */
  takeAway: { key: 'x', hint: '⌘X', label: 'Take the selection off this board', short: 'Take away' },
  putHere: { key: 'v', hint: '⌘V', label: 'Put them on this board', short: 'Put here' },
  gather: { key: 'g', hint: 'G', label: 'Put the selection together in one place', short: 'Gather' },
  compare: { key: 'c', hint: 'C', label: 'Hold the selection up against each other', short: 'Compare' },
  search: { key: 'f', mod: true, hint: '/', label: 'Search' },
  undo: { key: 'z', mod: true, hint: join(MOD, 'Z'), label: 'Undo' },
  redo: { key: 'z', mod: true, shift: true, hint: join(SHIFT, MOD, 'Z'), label: 'Redo' },
  export: { key: 's', mod: true, hint: join(MOD, 'S'), label: 'Export board and everything in it', short: 'Export' },
  import: { key: 'o', mod: true, hint: join(MOD, 'O'), label: 'Import a board file', short: 'Import' },
  picture: { key: 'e', mod: true, hint: join(MOD, 'E'), label: 'Export the selected pictures', short: 'Export pictures' },
  commands: { key: 'k', mod: true, hint: join(MOD, 'K'), label: 'Commands', short: 'Commands' },
} as const

export type ShortcutName = keyof typeof KEYS

/* Title text for a button, e.g. "Note  (N)". */
export const titleFor = (n: ShortcutName) => `${KEYS[n].label}  (${KEYS[n].hint})`

/* What the button is called when it has no words in it. */
export const nameFor = (n: ShortcutName): string => {
  const k = KEYS[n] as { label: string; short?: string }
  return k.short || k.label
}
