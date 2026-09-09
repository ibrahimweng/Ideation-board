import type { Item } from './types'
import { getBlob } from '../store/idb'
import { safeName } from '../store/fs'
import { exportModel } from '../store/model'
import { eachSkin, isStaged, skinsOn } from './staging'

/* ---------------------------------------------------------------------------
 * A model, as a file you can hand to someone.
 *
 * A model can already leave here as a picture, because a model card is a
 * picture: the export path for a photograph works on it unchanged. This is the
 * other question, and it is the one that makes putting a reference onto a
 * material worth doing — the model goes back out as a model, wearing what it
 * was given, and opens in whatever it was made in.
 *
 * Always .glb rather than .gltf, whichever came in. A picture handed to a
 * material has to travel with the file or it is not on it any more, and a
 * single binary that carries its own textures is the format that does that;
 * the alternative is a .gltf plus a folder of images and a note asking someone
 * to keep them together.
 * ------------------------------------------------------------------------- */

export interface ExportedModel {
  blob: Blob
  name: string
}

const baseName = (item: Item) => safeName((item.name || 'model').replace(/\.[a-z0-9]{1,5}$/i, '')) || 'model'

export async function exportModels(items: Item[]): Promise<ExportedModel[]> {
  const out: ExportedModel[] = []
  const used = new Set<string>()
  for (const item of items) {
    if (!isStaged(item)) continue
    const file = await getBlob(item.media!)
    if (!file) continue
    const skins = await skinsOn(item)
    let blob: Blob | null = null
    try {
      blob = await exportModel(item.media!, file, { skins })
    } finally {
      for (const bmp of eachSkin(skins)) bmp.close()
    }
    if (!blob) continue
    let name = `${baseName(item)}.glb`
    let n = 2
    while (used.has(name)) name = `${baseName(item)}-${n++}.glb`
    used.add(name)
    out.push({ blob, name })
  }
  return out
}
