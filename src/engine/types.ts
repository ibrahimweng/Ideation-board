/* Shared engine vocabulary. Kept free of DOM types so the worker can import it. */

export interface NumControl {
  k: string
  label: string
  min: number
  max: number
  step: number
  def: number
  unit: string
}
export interface ColorControl {
  k: string
  label: string
  def: string
  color: true
}
export interface EnumControl {
  k: string
  label: string
  def: number
  options: string[]
}
export type Control = NumControl | ColorControl | EnumControl

export const isColor = (c: Control): c is ColorControl => 'color' in c
export const isEnum = (c: Control): c is EnumControl => 'options' in c

export interface EffectSpec {
  id: string
  name: string
  group: string
  /* Control key whose value drives the pre-blur chain, when the effect uses one. */
  blurKey?: string
  controls: Control[]
  frag: string
}

/* A parameter block: p0..p5 numbers, c0..c2 hex colours. */
export type Params = Record<string, number | string>

/* Per-item adjustment layer applied before the effect shader. */
export interface Adjust {
  exp: number
  con: number
  sat: number
  warm: number
  blur: number
  grain: number
  zoom: number
  ox: number
  oy: number
  rot: number
  fh: boolean
  fv: boolean
  /* How a card sits with the cards under it.
   *
   * Everything above this line is about one picture on its own. These two are
   * about two of them at once, which is most of what a moodboard is for: a
   * texture laid over a photograph, a wordmark knocked out of a colour field,
   * a scan of a print held at a quarter strength over the thing it is being
   * compared with. Until now the only way to say any of that was to open
   * something else, do it there, and bring the answer back as a flat picture.
   *
   * Percent, and one of the blend modes below. Both live here rather than on
   * the item because they are part of the treatment: a saved look carries them
   * the way it carries the tone. */
  op: number
  mix: string
}

export const ADJUST_0: Adjust = {
  exp: 0, con: 0, sat: 100, warm: 0, blur: 0, grain: 0,
  zoom: 1, ox: 0, oy: 0, rot: 0, fh: false, fv: false,
  op: 100, mix: 'normal',
}

/* The ones worth having, which is not all of them: sixteen blend modes is a
 * menu nobody reads, and the eight below are the ones that do something a
 * person can name. Order matters — they read as four pairs: nothing, the two
 * that darken and lighten by multiplying, the two that do it by picking, and
 * the three that are their own thing. */
export const BLENDS: { id: string; name: string }[] = [
  { id: 'normal', name: 'Normal' },
  { id: 'multiply', name: 'Multiply' },
  { id: 'screen', name: 'Screen' },
  { id: 'overlay', name: 'Overlay' },
  { id: 'darken', name: 'Darken' },
  { id: 'lighten', name: 'Lighten' },
  { id: 'difference', name: 'Difference' },
  { id: 'luminosity', name: 'Luminosity' },
]

const BLEND_IDS = new Set(BLENDS.map((b) => b.id))
/* A board written by an older build has no blend mode on it, and one written
 * by a newer one may have a mode this build does not know. Both mean normal. */
export const blendOf = (mix?: string): string => (mix && BLEND_IDS.has(mix) ? mix : 'normal')

/* One effect and the settings it was given. */
export interface Layer {
  fxid: string
  ep: Params | null
}

export interface FxState extends Adjust {
  preset: string
  fxid: string
  ep: Params | null
  /* Effects applied after `fxid`, in order, each working on what the one
   * before it produced.
   *
   * An addition rather than a replacement: `fxid` stays the first effect, so
   * every board ever saved reads back exactly as it did, and a card with one
   * effect has no `more` at all. */
  more?: Layer[]
}

export const FX_0: FxState = { ...ADJUST_0, preset: 'none', fxid: 'none', ep: null }

/* Quality tiers. A card is rendered at PROXY first so something correct is on
 * screen within a frame, then upgraded to FULL once the queue is quiet. */
export const enum Tier {
  Proxy = 0,
  Full = 1,
}

/* Size buckets keep the FBO pool small and stop pan/zoom from invalidating
 * every cached render on a sub-pixel change. */
export const BUCKET = 128
export const PROXY_CAP = 384
export const FULL_CAP = 1536

/* Playing video is rendered smaller than a still. A frame is only on screen
 * for about 16ms, so detail beyond this is not visible, and holding the cap
 * down is what keeps a playing card from starving the rest of the board. */
export const VIDEO_CAP = 768
