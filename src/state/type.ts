import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * How text on this board is set.
 *
 * The bug that started this file is the plainest kind there is. A label was
 * made with `#111114` written into the record — near-black, a sensible colour
 * on a pale board and an invisible one on a dark board, which is where it was
 * imported. Text you cannot see is indistinguishable from text that did not
 * arrive, so the first thing anybody did with it was look for what they had
 * lost.
 *
 * The export already knew: it strips that exact value on the way out, with a
 * comment saying baking it in "would make it unreadable on a page being read
 * in the dark". The board it is a picture of never got the same treatment. So
 * the rule lives here now and both sides ask it.
 *
 * ## Chosen, or not yet chosen
 *
 * A colour somebody picked is kept exactly and never touched. A colour nobody
 * picked is not a colour at all — it is the absence of one, and the answer to
 * it is the theme's own ink, which is right on either ground. Records written
 * before this file existed all carry the old near-black, so that one value is
 * read as "nobody picked this" rather than as a choice. It costs anybody who
 * deliberately wanted near-black one press to say so again, and it means every
 * label already on a dark board becomes readable the moment it is opened.
 * ------------------------------------------------------------------------- */

/* What every label was made with before the colour became a choice. */
export const WAS_BAKED_IN = '#111114'

/* The colour to draw text in, or undefined for "let the theme say". */
export const inkOf = (colour?: string | null): string | undefined =>
  !colour || colour.toLowerCase() === WAS_BAKED_IN.toLowerCase() ? undefined : colour

/* Whether this card's colour is one somebody chose, which is what the swatch
 * in the panel shows as selected. */
export const inkChosen = (colour?: string | null): boolean => inkOf(colour) !== undefined

/* The kinds this file is about. */
export const isText = (i?: Item | null): i is Item =>
  !!i && (i.kind === 'note' || i.kind === 'label')

/* ---------------------------------------------------------------------------
 * How a piece of text is set.
 *
 * Every field is optional and every one means "not said" rather than a value,
 * so a card carries only what somebody actually chose. That matters twice: a
 * board written before this existed reads back exactly as it did, and the
 * defaults can be changed later without rewriting anybody's records.
 * ------------------------------------------------------------------------- */

export interface TypeSet {
  /* A family id from FAMILIES, or a Google family's own name. */
  font?: string
  /* Points on the board, before the view's zoom. */
  size?: number
  weight?: number
  align?: 'left' | 'center' | 'right'
  /* A multiple of the size, the way a designer says line height. */
  leading?: number
  /* Ems, positive or negative, the way a designer says tracking. */
  tracking?: number
  /* Small caps and the like are one switch rather than five. */
  caps?: boolean
  italic?: boolean
  underline?: boolean
}

export interface Family {
  id: string
  name: string
  /* The stack to actually set. A bundled family names itself first; a Google
   * family names itself and falls back to something already on the machine, so
   * a board opened on a plane still reads. */
  stack: string
  /* Whether it has to be fetched before it will show. */
  google?: boolean
  /* What a weight picker should offer for it. */
  weights: number[]
}

/* The two the app carries, which is what a board uses until somebody asks for
 * something else — so an app that never picks a font never fetches one. */
export const BUNDLED: Family[] = [
  { id: 'sans', name: 'Instrument Sans', stack: "'Instrument Sans', system-ui, sans-serif", weights: [400, 500, 600, 700] },
  { id: 'mono', name: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace", weights: [400, 500, 700] },
]

/* And the ones a machine already has, which cost nothing and work offline. */
export const NATIVE: Family[] = [
  { id: 'system', name: 'System sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weights: [300, 400, 500, 600, 700, 800] },
  { id: 'serif', name: 'System serif', stack: 'Georgia, "Times New Roman", serif', weights: [400, 700] },
  { id: 'systemmono', name: 'System mono', stack: 'ui-monospace, Menlo, Consolas, monospace', weights: [400, 700] },
]

/* A shelf of Google families, curated rather than listed.
 *
 * Google serves thousands and a list of thousands is a list nobody reads; and
 * the endpoint that would enumerate them needs an API key, which this app has
 * nowhere to put. So: a range wide enough to set almost anything — a grotesque,
 * a geometric, a humanist, two serifs, a slab, a condensed, a display and a
 * mono — and a box to type any other family's name into for the rest.
 *
 * Fetched only when one is chosen. A board that never picks one never asks
 * Google for anything, which is the promise the rest of this app makes and the
 * reason this list is not simply loaded up front. */
export const GOOGLE: Family[] = [
  { id: 'inter', name: 'Inter', stack: "'Inter', system-ui, sans-serif", google: true, weights: [300, 400, 500, 600, 700, 800, 900] },
  { id: 'work', name: 'Work Sans', stack: "'Work Sans', system-ui, sans-serif", google: true, weights: [300, 400, 500, 600, 700, 800] },
  { id: 'dm', name: 'DM Sans', stack: "'DM Sans', system-ui, sans-serif", google: true, weights: [400, 500, 700] },
  { id: 'playfair', name: 'Playfair Display', stack: "'Playfair Display', Georgia, serif", google: true, weights: [400, 500, 600, 700, 800, 900] },
  { id: 'lora', name: 'Lora', stack: "'Lora', Georgia, serif", google: true, weights: [400, 500, 600, 700] },
  { id: 'roboto-slab', name: 'Roboto Slab', stack: "'Roboto Slab', Georgia, serif", google: true, weights: [300, 400, 500, 700, 800] },
  { id: 'oswald', name: 'Oswald', stack: "'Oswald', Impact, sans-serif", google: true, weights: [300, 400, 500, 600, 700] },
  { id: 'bebas', name: 'Bebas Neue', stack: "'Bebas Neue', Impact, sans-serif", google: true, weights: [400] },
  { id: 'space', name: 'Space Mono', stack: "'Space Mono', ui-monospace, monospace", google: true, weights: [400, 700] },
  { id: 'caveat', name: 'Caveat', stack: "'Caveat', cursive", google: true, weights: [400, 500, 600, 700] },
]

export const FAMILIES: Family[] = [...BUNDLED, ...NATIVE, ...GOOGLE]

export const BY_FAMILY: Record<string, Family> = FAMILIES.reduce(
  (m, f) => ((m[f.id] = f), m),
  {} as Record<string, Family>
)

/* What a card is set in, with anything unfamiliar taken as a Google family
 * somebody typed the name of. */
export function familyOf(id?: string): Family {
  if (!id) return BUNDLED[0]
  const known = BY_FAMILY[id]
  if (known) return known
  const name = id.replace(/["']/g, '')
  return { id, name, stack: `'${name}', system-ui, sans-serif`, google: true, weights: [400, 700] }
}

/* The defaults, per kind. A label is a line of display type and a note is a
 * paragraph, and they should not start life the same size. */
export const DEFAULTS: Record<string, Required<Pick<TypeSet, 'size' | 'weight' | 'align' | 'leading' | 'tracking'>>> = {
  label: { size: 28, weight: 600, align: 'left', leading: 1.2, tracking: 0 },
  note: { size: 15, weight: 400, align: 'left', leading: 1.5, tracking: 0 },
}

/* The CSS a card is drawn with. Written as a plain object so the same answer
 * serves the board, the editor's preview, the poster and the exported page —
 * four places that must not drift, which is what a shared function is for. */
export function typeStyle(kind: string, t?: TypeSet | null): Record<string, string> {
  const d = DEFAULTS[kind] || DEFAULTS.note
  const fam = familyOf(t?.font)
  const size = t?.size ?? d.size
  const out: Record<string, string> = {
    fontFamily: fam.stack,
    fontSize: `${size}px`,
    fontWeight: String(t?.weight ?? d.weight),
    textAlign: t?.align ?? d.align,
    lineHeight: String(t?.leading ?? d.leading),
    letterSpacing: `${t?.tracking ?? d.tracking}em`,
  }
  if (t?.italic) out.fontStyle = 'italic'
  if (t?.underline) out.textDecoration = 'underline'
  if (t?.caps) {
    out.textTransform = 'uppercase'
    /* Uppercase set at the tracking of lowercase reads as a jam, which is why
     * every typesetter opens the letterspacing when they set caps. */
    if (t?.tracking === undefined) out.letterSpacing = '0.06em'
  }
  return out
}
