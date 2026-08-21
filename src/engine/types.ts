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
}

export const ADJUST_0: Adjust = {
  exp: 0, con: 0, sat: 100, warm: 0, blur: 0, grain: 0,
  zoom: 1, ox: 0, oy: 0, rot: 0, fh: false, fv: false,
}

export interface FxState extends Adjust {
  preset: string
  fxid: string
  ep: Params | null
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
