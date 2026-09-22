/* One place for the keyboard shortcuts, so the toolbar hints and the handler
 * that runs them cannot drift apart. */

/* Apple keyboards label the modifier differently, and showing the wrong one
 * is worse than showing none. */
const isApple = /Mac|iPhone|iPad|iPod/.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent
)

export const MOD = isApple ? '⌘' : 'Ctrl'
export const SHIFT = isApple ? '⇧' : 'Shift'
export const ALT = isApple ? '⌥' : 'Alt'
const join = (...parts: string[]) => (isApple ? parts.join('') : parts.join('+'))

/* `label` is the sentence on the tooltip. `short` is the name of the thing,
 * which is what a button without words has to be called: it is the accessible
 * name, so it is what a screen reader says and what a test asks for. Where
 * they are the same only one is written. */
export const KEYS = {
  addFiles: { key: 'f', hint: 'F', label: 'Add files' },
  note: { key: 'n', hint: 'N', label: 'Note' },
  label: { key: 'l', hint: 'L', label: 'Label' },
  /* Both of these arm rather than fire: you draw the box, because the size is
     the point. */
  section: { key: 's', hint: 'S', label: 'Draw a section around things', short: 'Section' },
  text: { key: 't', hint: 'T', label: 'Draw a text box and write in it', short: 'Text' },
  /* Two groups rather than nine buttons: the one you used last is on the
     rail and the rest are a press on its corner away, which is how every
     drawing program has grouped its tools since the first one. The key walks
     the group and then puts it down, so the key that picks a shape is also
     the key that stops. */
  shape: { key: 'm', hint: 'M', label: 'Shapes: press again for the next one', short: 'Shapes' },
  pen: { key: 'q', hint: 'Q', label: 'Pens: press again for the next one', short: 'Pens' },
  board: { key: 'b', hint: 'B', label: 'A board inside this one', short: 'Board' },
  link: { key: 'k', hint: 'K', label: 'Link or video URL', short: 'Link' },
  /* Not cmd+D, which duplicates. A picture that did not exist before. */
  draw: { key: 'd', hint: 'D', label: 'Draw a picture from a prompt', short: 'Draw' },
  /* W for write, and the letter was free. The other way to make a picture
     that did not exist before, and the only one that costs nothing to run
     again. */
  sketch: { key: 'w', hint: 'W', label: 'Write a sketch that draws a card', short: 'Sketch' },
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
  /* Figma's own combination for this, because it is the one gesture in this
     app that people arrive already knowing: a pile becomes a row, and a row
     is the thing whose gaps you can then take hold of. */
  tidy: { key: 't', mod: true, alt: true, hint: join(MOD, ALT, 'T'), label: 'Tidy the selection into a row or a grid', short: 'Tidy up' },
  /* The four booleans, on the combination every tool that has them uses. The
     fourth of them, intersect, is deliberately not here: on a Mac the browser
     keeps ⌥⌘I for its own developer tools and nothing a page does can have it,
     so a key for it would be a key that works on some machines and silently
     does nothing on others. It is on the menu and in the command list with the
     other three. */
  unite: { key: 'u', mod: true, alt: true, hint: join(MOD, ALT, 'U'), label: 'Unite the selected shapes into one', short: 'Unite' },
  subtract: { key: 's', mod: true, alt: true, hint: join(MOD, ALT, 'S'), label: 'Subtract the shapes above from the one below', short: 'Subtract' },
  exclude: { key: 'x', mod: true, alt: true, hint: join(MOD, ALT, 'X'), label: 'Keep everything but what the shapes share', short: 'Exclude' },
  compare: { key: 'c', hint: 'C', label: 'Hold the selection up against each other', short: 'Compare' },
  /* The same letter as Put here, without the modifier — which is the pattern
     already set by Draw and ⌘D, Export pictures and ⌘E, Add files and ⌘F. */
  vary: { key: 'v', hint: 'V', label: 'Make twelve versions of it', short: 'Vary' },
  /* The same dice as Vary, thrown in place rather than into a grid. */
  shuffle: { key: 'r', hint: 'R', label: 'Throw a random treatment at the selection', short: 'Shuffle' },
  /* The other one that is held. Alt already means "a copy of this" when a drag
     starts with it down; held over a card without pressing anything it means
     "tell me how far away that is", and the two cannot collide because one is
     a press and the other is not. */
  measure: { key: 'Alt', hint: ALT, label: 'Hold and point at something to measure the distance', short: 'Measure' },
  /* The other held one. Backslash is what every tool that grades a picture
     uses for this, and it is one of the few keys nothing else wanted. */
  original: { key: '\\', hint: '\\', label: 'Hold to see it without the effect', short: 'See the original' },
  search: { key: 'f', mod: true, hint: '/', label: 'Search' },
  undo: { key: 'z', mod: true, hint: join(MOD, 'Z'), label: 'Undo' },
  redo: { key: 'z', mod: true, shift: true, hint: join(SHIFT, MOD, 'Z'), label: 'Redo' },
  export: { key: 's', mod: true, hint: join(MOD, 'S'), label: 'Export board and everything in it', short: 'Export' },
  import: { key: 'o', mod: true, hint: join(MOD, 'O'), label: 'Import a board file', short: 'Import' },
  picture: { key: 'e', mod: true, hint: join(MOD, 'E'), label: 'Export the selected pictures', short: 'Export pictures' },
  commands: { key: 'k', mod: true, hint: join(MOD, 'K'), label: 'Commands', short: 'Commands' },
  /* Shifted on nearly every layout, which is why it is handled apart from the
     single letters rather than among them. */
  help: { key: '?', hint: '?', label: 'How this works', short: 'Help' },
} as const

export type ShortcutName = keyof typeof KEYS

/* Title text for a button, e.g. "Note  (N)". */
export const titleFor = (n: ShortcutName) => `${KEYS[n].label}  (${KEYS[n].hint})`

/* What the button is called when it has no words in it. */
export const nameFor = (n: ShortcutName): string => {
  const k = KEYS[n] as { label: string; short?: string }
  return k.short || k.label
}
