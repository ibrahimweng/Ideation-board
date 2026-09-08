import type { Item } from './types'
import { getBlob } from '../store/idb'
import { safeName } from '../store/fs'
import { isSound, isTreated } from './sounds'

/* ---------------------------------------------------------------------------
 * A sound, as a file you can hand to someone.
 *
 * The treated one, where there is a treatment: what comes out is what the card
 * plays, which is the only answer that is not a surprise. An untreated card
 * exports the file it was given, unchanged, because that is also what it
 * plays.
 * ------------------------------------------------------------------------- */

export interface ExportedSound {
  blob: Blob
  name: string
  treated: boolean
}

const baseName = (item: Item) => safeName((item.name || 'sound').replace(/\.[a-z0-9]{1,5}$/i, '')) || 'sound'

export async function exportSounds(items: Item[]): Promise<ExportedSound[]> {
  const out: ExportedSound[] = []
  const used = new Set<string>()
  for (const item of items) {
    if (!isSound(item)) continue
    const treated = isTreated(item) && !!item.heard
    const blob = await getBlob(treated ? item.heard! : item.media!)
    if (!blob) continue
    /* A render is always a WAV; an untreated file keeps whatever it arrived
       as, because renaming an mp3 to .wav would be a lie about its contents. */
    const ext = treated ? '.wav' : (/\.[a-z0-9]{1,5}$/i.exec(item.name || '')?.[0] || '.wav').toLowerCase()
    let name = `${baseName(item)}${treated ? '-treated' : ''}${ext}`
    let n = 2
    while (used.has(name)) name = `${baseName(item)}${treated ? '-treated' : ''}-${n++}${ext}`
    used.add(name)
    out.push({ blob, name, treated })
  }
  return out
}
