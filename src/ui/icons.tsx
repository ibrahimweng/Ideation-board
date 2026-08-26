/* ---------------------------------------------------------------------------
 * The icon set.
 *
 * One grid, one weight, one visual language: 16 by 16, a 1.5 stroke in the
 * current colour, rounded ends, and nothing filled unless being filled is the
 * point. Drawn here rather than pulled from a library so the whole set can be
 * one line thick and one size, which is what makes a row of them read as a row
 * rather than as a collection.
 * ------------------------------------------------------------------------- */

type P = { className?: string }

const Svg = ({ children, className }: P & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

/* A photograph: a frame with a horizon and a sun in it. */
export const IconFiles = (p: P) => (
  <Svg {...p}>
    <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" />
    <circle cx="5.9" cy="6.4" r="1.15" />
    <path d="M2.2 11.1l3.2-2.7 2.6 2.2 2.4-2 3.4 3" />
  </Svg>
)

/* A note: a page with a folded corner and two lines of writing. */
export const IconNote = (p: P) => (
  <Svg {...p}>
    <path d="M3 2.4h6.2l3.8 3.7v7.5a.4.4 0 0 1-.4.4H3a.4.4 0 0 1-.4-.4V2.8a.4.4 0 0 1 .4-.4Z" />
    <path d="M9.2 2.5v3.5h3.6M5.2 8.9h5.4M5.2 11.2h3.4" />
  </Svg>
)

/* A label: a piece of type on its baseline. */
export const IconLabel = (p: P) => (
  <Svg {...p}>
    <path d="M3.2 4.2V3h9.6v1.2M8 3.2v9.6M5.9 12.9h4.2" />
  </Svg>
)

/* A section: a region drawn around things. */
export const IconSection = (p: P) => (
  <Svg {...p}>
    <path d="M2.4 5.6V3.4a1 1 0 0 1 1-1h2.2M10.4 2.4h2.2a1 1 0 0 1 1 1v2.2M13.6 10.4v2.2a1 1 0 0 1-1 1h-2.2M5.6 13.6H3.4a1 1 0 0 1-1-1v-2.2" />
  </Svg>
)

/* A board inside a board: a frame with a smaller frame in it. */
export const IconBoard = (p: P) => (
  <Svg {...p}>
    <rect x="1.9" y="2.6" width="12.2" height="10.8" rx="1.8" />
    <rect x="4.6" y="5.4" width="6.8" height="5.2" rx="1" />
  </Svg>
)

/* A link: two rings of a chain. */
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l1.8-1.8a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3L3.7 8.1a2.6 2.6 0 0 0 3.7 3.7l1-1" />
  </Svg>
)

/* Drawing something that was not there: a picture frame, and the spark of it
 * arriving. Four points rather than a star, to stay on the one weight. */
export const IconDraw = (p: P) => (
  <Svg {...p}>
    <path d="M13.4 8.4v3.6a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6V4.2a1.6 1.6 0 0 1 1.6-1.6h3.6" />
    <path d="M2.8 11.2 5.9 8.4l2.3 2.1 2.2-2 2.2 2" />
    <path d="M11.8 1.8v3.4M10.1 3.5h3.4" />
  </Svg>
)

export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M3 7.6h6.6a3.4 3.4 0 1 1 0 6.8H6.4" />
    <path d="M5.6 4.6 2.6 7.6l3 3" />
  </Svg>
)

export const IconRedo = (p: P) => (
  <Svg {...p}>
    <path d="M13 7.6H6.4a3.4 3.4 0 1 0 0 6.8h3.2" />
    <path d="m10.4 4.6 3 3-3 3" />
  </Svg>
)

/* Out of the board, into a file. */
export const IconExport = (p: P) => (
  <Svg {...p}>
    <path d="M8 10.4V2.2M5.2 5l2.8-2.8L10.8 5" />
    <path d="M2.8 10v3a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8v-3" />
  </Svg>
)

/* Into the board, out of a file. */
export const IconImport = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.2v8.2M5.2 7.6 8 10.4l2.8-2.8" />
    <path d="M2.8 10v3a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8v-3" />
  </Svg>
)

/* The picture out on its own. */
export const IconPicture = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="3" width="9" height="8" rx="1.6" />
    <circle cx="5" cy="6" r="1" />
    <path d="M2.4 9.4 4.8 7.6l2 1.6 1.6-1.3 1.8 1.6" />
    <path d="M13.6 6.2v7.2M11.6 11.6l2 1.8 2-1.8" />
  </Svg>
)

/* Effects: the sliders that make them. */
export const IconEffects = (p: P) => (
  <Svg {...p}>
    <path d="M3 4.4h10M3 8h10M3 11.6h10" />
    <circle cx="5.8" cy="4.4" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="10.4" cy="8" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="11.6" r="1.5" fill="currentColor" stroke="none" />
  </Svg>
)

/* Everything you can do, in a list. */
export const IconCommand = (p: P) => (
  <Svg {...p}>
    <path d="M6.2 4.4a1.6 1.6 0 1 0-1.6 1.6h6.8a1.6 1.6 0 1 0-1.6-1.6v7.2a1.6 1.6 0 1 0 1.6-1.6H4.6a1.6 1.6 0 1 0 1.6 1.6z" />
  </Svg>
)

/* Full screen, nothing else. */
export const IconPresent = (p: P) => (
  <Svg {...p}>
    <path d="M2.6 6V3.4a.8.8 0 0 1 .8-.8H6M10 2.6h2.6a.8.8 0 0 1 .8.8V6M13.4 10v2.6a.8.8 0 0 1-.8.8H10M6 13.4H3.4a.8.8 0 0 1-.8-.8V10" />
  </Svg>
)

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="m10.4 10.4 3 3" />
  </Svg>
)

export const IconTidy = (p: P) => (
  <Svg {...p}>
    <rect x="2.4" y="2.4" width="4.6" height="4.6" rx="1" />
    <rect x="9" y="2.4" width="4.6" height="4.6" rx="1" />
    <rect x="2.4" y="9" width="4.6" height="4.6" rx="1" />
    <rect x="9" y="9" width="4.6" height="4.6" rx="1" />
  </Svg>
)

export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M2.8 4.4h10.4M6.4 4.2V2.9a.5.5 0 0 1 .5-.5h2.2a.5.5 0 0 1 .5.5v1.3" />
    <path d="M4.2 4.4l.6 8.4a.8.8 0 0 0 .8.8h4.8a.8.8 0 0 0 .8-.8l.6-8.4" />
  </Svg>
)
