import type { Item } from './types'
import type { StoredBoard } from '../store/idb'
import { getBoard, putBoard, getBlob, putBlob } from '../store/idb'
import { zip, unzip } from '../store/zip'
import type { ZipEntry } from '../store/zip'
import { safeName } from '../store/fs'
import { boardItem } from './ingest'
import { newBoardId, invalidateSummary } from './boards'

/* ---------------------------------------------------------------------------
 * Taking a board out, and putting one back.
 *
 * What leaves is the board you are on and everything nested inside it,
 * together with every picture, video and file any of them use. Until now
 * "Export" wrote a listing whose media were keys into this browser's own
 * storage, which is not a board so much as a description of one that only this
 * browser can read.
 *
 * The file is a zip: a board.json describing the tree, and a media folder
 * beside it. Openable by anything, and readable by a person.
 *
 * Coming back in, every id is renamed — boards, cards and media alike. An
 * import can then never land on top of something already here, the same file
 * can be brought in twice as two separate boards, and a board sent to someone
 * else arrives whole rather than half merged into whatever they already had.
 * ------------------------------------------------------------------------- */

const FORMAT = 'ideation-board'
const VERSION = 1

export interface Bundle {
  format: string
  version: number
  exported: number
  root: string
  boards: StoredBoard[]
  /* Media key to the path it was written to inside the file. */
  media: Record<string, string>
}

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
}

const extFor = (blob: Blob, key: string) => EXT[blob.type] || (key.includes(':poster') ? '.jpg' : '.bin')

/* Every board reachable from this one, depth first, each visited once. */
async function collect(rootId: string): Promise<StoredBoard[]> {
  const seen = new Set<string>()
  const out: StoredBoard[] = []
  const walk = async (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const rec = await getBoard(id)
    if (!rec) return
    out.push(rec)
    for (const it of rec.items as Item[]) {
      if (it.kind === 'board' && it.board) await walk(it.board)
    }
  }
  await walk(rootId)
  return out
}

export interface ExportResult {
  blob: Blob
  name: string
  boards: number
  media: number
}

export async function exportTree(rootId: string): Promise<ExportResult> {
  const boards = await collect(rootId)

  /* Media is shared: two cards can use one picture, and a duplicate keeps the
   * original's key rather than copying the bytes. It is written once. */
  const keys = new Set<string>()
  for (const b of boards) {
    for (const it of b.items as Item[]) {
      if (it.media) keys.add(it.media)
      if (it.poster) keys.add(it.poster)
    }
  }

  const media: Record<string, string> = {}
  const files: ZipEntry[] = []
  for (const key of keys) {
    const blob = await getBlob(key)
    /* A missing blob is not worth failing the whole export over: the card
     * comes back as an empty one rather than nothing coming back at all. */
    if (!blob) continue
    const path = `media/${safeName(key)}${extFor(blob, key)}`
    media[key] = path
    files.push({ name: path, blob })
  }

  const bundle: Bundle = {
    format: FORMAT,
    version: VERSION,
    exported: Date.now(),
    root: rootId,
    boards,
    media,
  }

  files.unshift({
    name: 'board.json',
    blob: new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
    deflate: true,
  })

  const root = boards.find((b) => b.id === rootId)
  return {
    blob: await zip(files),
    name: `${safeName(root?.name || 'board')}.board.zip`,
    boards: boards.length,
    media: files.length - 1,
  }
}

export const looksLikeBoardFile = (name: string) => /\.(board|zip)$/i.test(name || '')

const newItemId = () => 'i_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const newMediaKey = (old: string) =>
  (old.split('_')[0] || 'm') + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) +
  (old.endsWith(':poster') ? ':poster' : '')

export interface ImportResult {
  card: Item
  boards: number
  media: number
}

/* Reads the file and writes the boards it holds, then hands back a card that
 * opens the one at the top of it. The caller decides where that card goes. */
export async function importTree(file: Blob, at: { x: number; y: number }): Promise<ImportResult> {
  const files = await unzip(file)
  const listing = files.get('board.json')
  if (!listing) throw new Error('this file has no board in it')

  let bundle: Bundle
  try {
    bundle = JSON.parse(await listing.text()) as Bundle
  } catch {
    throw new Error('the board listing in this file is damaged')
  }
  if (bundle.format !== FORMAT || !Array.isArray(bundle.boards) || !bundle.boards.length) {
    throw new Error('this file was not written by this board')
  }

  /* Media first, so the cards that point at it are never written ahead of it. */
  const mediaMap = new Map<string, string>()
  let mediaCount = 0
  for (const [key, path] of Object.entries(bundle.media || {})) {
    const blob = files.get(path)
    if (!blob) continue
    const fresh = newMediaKey(key)
    await putBlob(fresh, blob)
    mediaMap.set(key, fresh)
    mediaCount++
  }

  const boardMap = new Map<string, string>()
  for (const b of bundle.boards) boardMap.set(b.id, newBoardId())

  for (const b of bundle.boards) {
    const items = (b.items || []) as Item[]
    const ids = new Map<string, string>()
    for (const it of items) ids.set(it.id, newItemId())

    const next = items.map((it) => {
      const copy: Item = { ...it, id: ids.get(it.id)! }
      if (it.parent) copy.parent = ids.get(it.parent) || null
      if (it.from) copy.from = ids.get(it.from) || it.from
      if (it.to) copy.to = ids.get(it.to) || it.to
      if (it.board) copy.board = boardMap.get(it.board) || it.board
      if (it.media) copy.media = mediaMap.get(it.media) || undefined
      if (it.poster) copy.poster = mediaMap.get(it.poster) || undefined
      /* Object URLs belong to the session that made them. */
      delete copy.src
      return copy
    })

    const id = boardMap.get(b.id)!
    await putBoard({
      id,
      name: b.name || 'Board',
      items: next,
      view: b.view || { x: 0, y: 0, z: 1 },
      updated: Date.now(),
    })
    invalidateSummary(id)
  }

  const rootId = boardMap.get(bundle.root) || boardMap.get(bundle.boards[0].id)!
  const rootName = bundle.boards.find((b) => b.id === bundle.root)?.name || bundle.boards[0].name || 'Board'
  return { card: boardItem(at, rootId, rootName), boards: bundle.boards.length, media: mediaCount }
}
