import type { Item } from './types'

/* ---------------------------------------------------------------------------
 * What a material is wearing, and where.
 *
 * Handing a card to a material used to mean one thing: it became that
 * material's colour. Which is the useful answer nine times in ten and the
 * wrong one the tenth, because a picture on a surface is not only a picture of
 * that surface. A scan of paper as roughness is a matte patch on a gloss
 * shell; a scribble as relief is a thing you could run your thumb over; a
 * photograph as glow is a screen built into the object. The file already
 * declares which of these it uses — `parts` has said so on every card since
 * models arrived — and the board could write to exactly one of them.
 *
 * Five, then, and only five: the ones where a photograph means something.
 * Metalness is left out on purpose. Its map multiplies a number the file sets,
 * so wearing one does nothing at all unless that number is forced to one, and
 * a material forced to metal is a chrome material whatever picture is on it —
 * an answer that looks like a bug.
 *
 * ## Relief is the odd one
 *
 * The other four are slots a glTF can arrive with something already in, so
 * they can be worn and they can be treated. Relief is not: glTF carries normal
 * maps, and a normal map is three channels of direction rather than a picture
 * of a height. So relief is a thing you put on and never a thing the file came
 * with, and the panel offers no Treat for it.
 * ------------------------------------------------------------------------- */

export interface Slot {
  id: string
  /* What the panel calls it. */
  name: string
  /* What `parts[].maps` calls the same thing, where the file can declare one.
   * Relief has none, which is what says it cannot be treated. */
  reads?: string
  /* One line under the picker, because none of these is guessable. */
  what: string
}

export const SLOTS: Slot[] = [
  { id: 'colour', name: 'Colour', reads: 'colour', what: 'The picture on the surface.' },
  { id: 'roughness', name: 'Roughness', reads: 'roughness', what: 'Light where it is dark, matte where it is light.' },
  { id: 'glow', name: 'Glow', reads: 'glow', what: 'The surface gives off light in the shape of it.' },
  { id: 'relief', name: 'Relief', what: 'Raised where it is light, as if the picture were pressed into it.' },
  { id: 'cutout', name: 'Cut-out', reads: 'cut-out', what: 'Holes where it is dark.' },
]

export const SLOT_BY_ID: Record<string, Slot> = SLOTS.reduce(
  (m, s) => ((m[s.id] = s), m),
  {} as Record<string, Slot>
)

export const slotName = (id: string): string => SLOT_BY_ID[id]?.name || id

/* Material name -> slot id -> the address of the picture it is wearing. */
export type Dressed = Record<string, Record<string, string>>

/* What the card says, in one shape.
 *
 * Boards written while a material could only wear its colour kept one address
 * per material and meant the colour by it. That is still exactly what they
 * say, so it is still exactly how they are read — the alternative was
 * rewriting every board that has ever been saved to add a word it can only
 * have meant. */
export function dressOf(it: Item | null | undefined): Dressed {
  const out: Dressed = {}
  for (const [material, v] of Object.entries(it?.skins || {})) {
    if (!v) continue
    out[material] = typeof v === 'string' ? { colour: v } : { ...v }
  }
  return out
}

/* Every picture any material on this card is wearing. For the sweep, which
 * collects what nothing points at, and for the export, which has to carry what
 * it points at. */
export function skinKeys(it: Item | null | undefined): string[] {
  const out: string[] = []
  for (const slots of Object.values(dressOf(it))) {
    for (const key of Object.values(slots)) if (key) out.push(key)
  }
  return out
}

/* The card's `skins` with one more thing worn. Always written in the shape
 * with the slot named, whatever shape it was read in. */
export function withSkin(it: Item, material: string, slot: string, key: string): Dressed {
  const now = dressOf(it)
  return { ...now, [material]: { ...(now[material] || {}), [slot]: key } }
}

/* And with one taken off. A material wearing nothing is dropped rather than
 * left as an empty row, so "is anything worn" stays one question. */
export function withoutSkin(it: Item, material: string, slot: string): Dressed | undefined {
  const now = dressOf(it)
  const was = now[material]
  if (!was || !was[slot]) return undefined
  const rest = { ...was }
  delete rest[slot]
  const out = { ...now }
  if (Object.keys(rest).length) out[material] = rest
  else delete out[material]
  return Object.keys(out).length ? out : undefined
}

/* Every address swapped for another, keeping the shape. For the trip out of
 * this browser and back in, where every file is renamed on the way. */
export function remapSkins(it: Item, rename: (key: string) => string | undefined): Dressed | undefined {
  const out: Dressed = {}
  for (const [material, slots] of Object.entries(dressOf(it))) {
    const kept: Record<string, string> = {}
    for (const [slot, key] of Object.entries(slots)) {
      const to = rename(key)
      if (to) kept[slot] = to
    }
    if (Object.keys(kept).length) out[material] = kept
  }
  return Object.keys(out).length ? out : undefined
}
