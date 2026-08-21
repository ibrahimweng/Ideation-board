/* File System Access: keeps a board as a real folder on disk, with media
 * written alongside a board.json, so the work is portable and inspectable. */

type Dir = FileSystemDirectoryHandle

export const supportsFS = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

export async function pickFolder(): Promise<Dir> {
  return await (window as unknown as {
    showDirectoryPicker: (o: unknown) => Promise<Dir>
  }).showDirectoryPicker({ mode: 'readwrite', id: 'ideation-board' })
}

export async function ensurePerm(dir: Dir): Promise<boolean> {
  const d = dir as Dir & {
    queryPermission?: (o: unknown) => Promise<string>
    requestPermission?: (o: unknown) => Promise<string>
  }
  if (!d || !d.queryPermission) return false
  if ((await d.queryPermission({ mode: 'readwrite' })) === 'granted') return true
  return (await d.requestPermission?.({ mode: 'readwrite' })) === 'granted'
}

export async function readJSON<T>(dir: Dir, name: string): Promise<T | null> {
  try {
    const fh = await dir.getFileHandle(name)
    return JSON.parse(await (await fh.getFile()).text()) as T
  } catch {
    return null
  }
}

export async function writeJSON(dir: Dir, name: string, obj: unknown) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  await w.close()
}

export async function writeMedia(dir: Dir, name: string, blob: Blob) {
  const md = await dir.getDirectoryHandle('media', { create: true })
  const fh = await md.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(blob)
  await w.close()
  return 'media/' + name
}

export async function readMedia(dir: Dir, path: string): Promise<File | null> {
  try {
    const p = String(path).split('/')
    const md = await dir.getDirectoryHandle(p[0])
    return await (await md.getFileHandle(p[1])).getFile()
  } catch {
    return null
  }
}

export function safeName(s: string) {
  return (
    String(s || 'file')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file'
  )
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
