import type { Item, Kind } from './types'

/* ---------------------------------------------------------------------------
 * What each kind of card can do.
 *
 * `Item` is one wide type with eleven kinds in it, and the code asked which
 * kind it was in a hundred and one places. Some of those were the same
 * question written differently — "image or video", "not a section and not an
 * edge", "image or video or embed" — spread across sixteen files, so adding a
 * twelfth kind meant finding every one of them and guessing which side of each
 * question the new kind belonged on.
 *
 * The table is that guess, made once and written down. Everything else asks a
 * question by name. Add a kind, fill in its row, and the answers follow.
 *
 * The traits are deliberately about capability rather than about category: not
 * "is it a picture" but "does it have pixels of its own that can be read",
 * because that is the thing the code actually wants to know before it tries.
 * ------------------------------------------------------------------------- */

export interface Traits {
  /* A box on the board: something to move, resize, line up, tidy, and select
     as content. A section is the ground under the boxes and a wire is drawn
     between two of them, so neither is one. */
  thing: boolean
  /* Pixels of its own that can be read back — shaded, exported, sampled for
     colour. An embedded player has pixels, but they belong to the provider
     and nothing on this side can reach them. */
  pixels: boolean
  /* Can wear a look: an effect and a tone. Wider than `pixels`, because tone
     is a CSS filter over the box and works even where a shader cannot. */
  graded: boolean
  /* Keeps a blob in the media store, so a copy has to carry the file and a
     delete has to take it away. */
  media: boolean
  /* Words you type into it, which are also words the search should find. */
  words: boolean
}

const NOTHING: Traits = { thing: false, pixels: false, graded: false, media: false, words: false }
const CARD: Traits = { ...NOTHING, thing: true }

export const TRAITS: Record<Kind, Traits> = {
  image: { thing: true, pixels: true, graded: true, media: true, words: false },
  video: { thing: true, pixels: true, graded: true, media: true, words: false },
  /* The player's pixels are the provider's. Tone still applies, because tone
     is applied to the box the player is painted into. */
  embed: { thing: true, pixels: false, graded: true, media: false, words: false },
  /* A page of it is a picture like any other, so everything that works on
     pixels works here: the effects, the export, the palette. What is under
     `media` is the document, and what is looked at is under `poster` — the
     same split a video has, for the same reason. */
  pdf: { thing: true, pixels: true, graded: true, media: true, words: false },
  /* Photoshop, Illustrator and Sketch. The same shape as a document: the file
     under `media`, the picture inside it under `poster`. What is different is
     only that there is one picture rather than a run of pages. */
  design: { thing: true, pixels: true, graded: true, media: true, words: false },
  /* A model is a rendered view of itself and the file beside it, which is the
     same shape a document has: the .glb under `media`, the picture under
     `poster`. Everything that works on pixels then works on it — the effects,
     the export, the palette, being read through by another card. */
  model: { thing: true, pixels: true, graded: true, media: true, words: false },
  /* A sketch is code that draws, and what it drew is kept beside it under
     `poster` — so the card is a picture in every respect that matters here,
     and the code is the thing you edit rather than the thing you look at. */
  sketch: { thing: true, pixels: true, graded: true, media: false, words: false },
  audio: { ...CARD, media: true },
  file: { ...CARD, media: true },
  note: { ...CARD, words: true },
  label: { ...CARD, words: true },
  link: { ...CARD },
  board: { ...CARD },
  /* The ground, and the line between two things. Neither is a card. */
  section: { ...NOTHING, words: true },
  edge: { ...NOTHING },
}

/* Every one of these takes a possibly-missing item, because nearly every call
 * site had one: `store.getItem(id)` returns undefined, and the old code said
 * `i!.kind === 'image'` to get past it.
 *
 * They are type guards rather than plain booleans, so asking the question also
 * settles whether there is anything there — which is what the exclamation
 * marks were standing in for. */
const trait =
  (k: keyof Traits) =>
  (i?: Item | null): i is Item =>
    !!i && TRAITS[i.kind][k]

/* A box to move, resize, line up and tidy. */
export const isThing = trait('thing')
/* Pixels this side can read: export it, shade it, take its colours. */
export const hasPixels = trait('pixels')
/* Can wear a look. */
export const isGradeable = trait('graded')
/* Holds a file in the media store. */
export const holdsMedia = trait('media')
/* Has text of its own. */
export const hasWords = trait('words')

/* Which field a kind keeps its typed words in.
 *
 * A different question from `hasWords`, which asks whether the search should
 * read them. A section has words and keeps them in `name`, because its name is
 * the thing written across the top of it — so the two questions give different
 * answers for exactly one kind, and confusing them puts a section's title in a
 * field nothing displays. Asked in one place so that cannot happen twice. */
export const wordsField = (it: Item | undefined): 'text' | 'name' =>
  it && hasWords(it) && it.kind !== 'section' ? 'text' : 'name'

/* These two are plain booleans rather than guards on purpose. They are nearly
 * always asked in the negative — "if this is not a section, carry on with it" —
 * and a guard that proves an item is there narrows the other branch to nothing
 * at all, which is not what "not a section" means. */
export const isSection = (i?: Item | null): boolean => i?.kind === 'section'
export const isWire = (i?: Item | null): boolean => i?.kind === 'edge'

/* Pixels a shader can actually run on. A video served from a host that refuses
 * cross-origin reads has pixels in principle and none in practice, and the
 * difference is only knowable after asking. */
export const canShade = (i?: Item | null): i is Item => hasPixels(i) && i.readable !== false

/* Which stored file holds the pixels of a card.
 *
 * For most cards that is `media`, because the file is the picture. For the two
 * whose file is not itself an image — a video, and a document — it is the
 * still kept beside it under `poster`. Three places were asking this with the
 * same ternary written out by hand, and the third kind was the one that would
 * have been missed. */
const BESIDE = new Set<string>(['video', 'pdf', 'design', 'model', 'sketch'])
export const pixelKey = (i?: Item | null): string | undefined =>
  !i ? undefined : BESIDE.has(i.kind) ? i.poster : i.media

/* A card the app draws a still picture for.
 *
 * Not the same question as `hasPixels`: a video has pixels and is drawn by a
 * video element, which everything below has to leave alone. Everything else
 * with pixels — a photograph, a page, an artboard, a view of a model — is an
 * <img> or a canvas, and is treated identically wherever one of those will do.
 *
 * Asked rather than listed, because it was listed: four places wrote out
 * `image || pdf || design` by hand, and every one of them silently left the
 * next kind out of the full-screen view, the board poster and the export. */
export const isStill = (i?: Item | null): i is Item => hasPixels(i) && i.kind !== 'video'

/* Both ends of a wire, or nothing. */
export const endsOf = (i?: Item | null): [string, string] | null =>
  i && isWire(i) && i.from && i.to ? [i.from, i.to] : null
