import { developed } from '../state/develop'
import type { FxState } from '../engine/types'

/* Tone adjustments ride on the compositor as a CSS filter rather than costing
 * a GPU pass of their own. Changing exposure or saturation therefore never
 * invalidates a cached effect render — it just re-composites, which the
 * browser does for free on a layer it already has. */
export function adjustCSS(fx: FxState): string {
  const f: string[] = []
  if (fx.exp) f.push(`brightness(${(1 + fx.exp / 100).toFixed(3)})`)
  if (fx.con) f.push(`contrast(${(1 + fx.con / 100).toFixed(3)})`)
  if (fx.sat !== 100) f.push(`saturate(${(fx.sat / 100).toFixed(3)})`)
  if (fx.warm > 0) f.push(`sepia(${(fx.warm / 150).toFixed(3)}) saturate(${(1 + fx.warm / 300).toFixed(3)})`)
  if (fx.warm < 0) f.push(`hue-rotate(${(fx.warm * 0.4).toFixed(1)}deg) saturate(${(1 + -fx.warm / 400).toFixed(3)})`)
  if (fx.blur) f.push(`blur(${(fx.blur / 10).toFixed(2)}px)`)
  return f.join(' ')
}

/* Framing lives in a transform, which is also compositor-only. */
export function frameCSS(fx: FxState): string {
  const t: string[] = []
  if (fx.zoom !== 1) t.push(`scale(${fx.zoom})`)
  if (fx.ox || fx.oy) t.push(`translate(${fx.ox}%, ${fx.oy}%)`)
  if (fx.rot) t.push(`rotate(${fx.rot}deg)`)
  if (fx.fh) t.push('scaleX(-1)')
  if (fx.fv) t.push('scaleY(-1)')
  return t.join(' ')
}

/* Whether a card needs the shader at all.
 *
 * An effect on it, or a develop under it. A developed picture with no effect
 * still has to go through the pipeline, because everything a develop does —
 * exposure in linear light, a white balance, a curve — is arithmetic a CSS
 * filter cannot express. A card with neither goes on being an <img> the
 * browser draws for nothing, which is nearly every card on nearly every
 * board. */
export const hasEffect = (fx: FxState) => !!fx && (fx.fxid !== 'none' || developed(fx.dev))
export const hasGrain = (fx: FxState) => !!fx && fx.grain > 0
