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

export const KEYS = {
  addFiles: { key: 'f', hint: 'F', label: 'Add files' },
  note: { key: 'n', hint: 'N', label: 'Note' },
  label: { key: 'l', hint: 'L', label: 'Label' },
  section: { key: 's', hint: 'S', label: 'Section' },
  board: { key: 'b', hint: 'B', label: 'New board' },
  link: { key: 'k', hint: 'K', label: 'Link' },
  effects: { key: 'e', hint: 'E', label: 'Effects panel' },
  search: { key: 'f', mod: true, hint: '/', label: 'Search' },
  undo: { key: 'z', mod: true, hint: join(MOD, 'Z'), label: 'Undo' },
  redo: { key: 'z', mod: true, shift: true, hint: join(SHIFT, MOD, 'Z'), label: 'Redo' },
  export: { key: 's', mod: true, hint: join(MOD, 'S'), label: 'Export' },
} as const

export type ShortcutName = keyof typeof KEYS

/* Title text for a button, e.g. "Note  (N)". */
export const titleFor = (n: ShortcutName) => `${KEYS[n].label}  (${KEYS[n].hint})`
