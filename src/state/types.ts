import type { FxState } from '../engine/types'

export type Kind =
  | 'image' | 'video' | 'audio' | 'note' | 'link' | 'file' | 'label' | 'section' | 'embed' | 'board'
  | 'pdf' | 'edge'

export interface Item {
  id: string
  kind: Kind
  x: number
  y: number
  w: number
  h: number
  z: number
  /* Media identity: the key under which the blob is stored and the GPU
   * texture is cached. Stable for the life of the item. */
  media?: string
  name?: string
  mime?: string
  /* Object URL for the current session. Not persisted. */
  src?: string
  poster?: string
  text?: string
  url?: string
  /* Player URL for an embed card. Held rather than derived so a board that
   * was saved keeps working if the way we build embed URLs ever changes. */
  embed?: string
  /* Id of the board a board card opens. The board is a record of its own, so
   * what is inside it costs nothing until it is opened. */
  board?: string
  /* The two ends of a connection. An edge has no geometry of its own: it is
   * drawn from wherever these two cards are. */
  from?: string
  to?: string
  /* Video cards only, and only for ones loaded from a URL: whether the host
   * lets us read the video's pixels back. False means the picture plays but
   * shaders cannot run on it. Undefined for local files, whose pixels are
   * always ours. */
  readable?: boolean
  color?: string
  tag?: string | null
  /* Whether this one is in or out.
   *
   * Not a tag. A tag says what something is — a category you sort by — and the
   * five of them are colours with no meaning attached. This says what you
   * decided about it, which is the thing a board full of references is for and
   * the thing it could never record: boards only ever accumulated. */
  pick?: 'in' | 'out' | null
  /* Id of the section this item sits in, when it is in one. Membership is
   * decided when a drag finishes and then remembered, so an item stays where
   * it was put even if a section is later moved under or away from it. */
  parent?: string | null
  fx: FxState
  /* Natural pixel size, when known. */
  nw?: number
  nh?: number
  /* A picture that moves — an animated GIF, WebP or APNG. Worth writing down
   * rather than working out again, because finding out means decoding the file
   * and the answer never changes. An effected card reads it to decide whether
   * to feed the renderer one still or a reel of frames. */
  anim?: boolean
  /* A document with more than one page in it, and which of them the card is
   * showing. Both are one-based and both are written down rather than worked
   * out, because counting the pages means parsing the file and a card has to
   * be able to say "2 of 12" the moment it is drawn.
   *
   * The page itself is not here. It is a picture, kept under `poster` the way
   * a video's still is, which is what lets a page take effects, be exported
   * and give up its colours without any of that code knowing what a PDF is. */
  pages?: number
  page?: number
  /* The shape of a sound, and how long it runs.
   *
   * A couple of hundred whole numbers rather than a picture of a waveform: it
   * is a few hundred bytes on the board record, it draws crisply at any size
   * because it is drawn rather than scaled, and redrawing it as the track
   * plays costs nothing. Read once when the file arrives, because decoding a
   * track to find out is not something to do on every render.
   *
   * The cover inside the file, where it has one, is a real picture and is kept
   * under `poster` like any other still. */
  peaks?: number[]
  secs?: number
}

export interface Board {
  id: string
  name: string
  items: Item[]
  view: { x: number; y: number; z: number }
  updated: number
}

export const TYPE_LABEL: Record<Kind, string> = {
  image: 'IMG', video: 'VID', audio: 'AUD', note: 'TXT',
  link: 'URL', file: 'DOC', label: 'LBL', section: 'SEC', embed: 'VID', board: 'BRD',
  pdf: 'PDF', edge: 'ARR',
}

export const TAGS = [
  { id: 'red', c: '#E5484D' },
  { id: 'amber', c: '#EFA31D' },
  { id: 'green', c: '#3F8F63' },
  { id: 'blue', c: '#2F6FEB' },
  { id: 'violet', c: '#7A5AF8' },
]

export const SWATCH = ['#111114', '#F5F2EA', '#E5484D', '#F2C14E', '#3F8F63', '#2F6FEB', '#6B2BC9', '#3BE0D0']
