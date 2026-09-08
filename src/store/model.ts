/* ---------------------------------------------------------------------------
 * A model, as a picture of itself.
 *
 * A .glb dropped on this board used to be a grey card with three letters on
 * it. On a board whose subject is looking at things, that is the wrong answer
 * for exactly the file a product designer works in all day.
 *
 * So a model card is a rendered view, and the file itself is kept beside it —
 * the same shape a video, a PDF and a Photoshop document already have here:
 * `media` is the file, `poster` is what you look at. Everything downstream
 * then works with no special case at all. The view goes to the graphics card
 * and takes all forty-one effects, exports as a picture, gives up its colours
 * to the palette, can be varied twelve ways, and can be read through by
 * another card.
 *
 * ## Turning it
 *
 * The view is a camera angle, kept on the card, so a model comes back showing
 * what it was left showing. Turning it re-renders and writes a new poster.
 * That is a real cost — a render and a blob — so it is debounced, and the
 * board holds one renderer for every model on it rather than one each.
 *
 * ## What it reads out of the file
 *
 * A glTF declares its own materials, which texture slots each one fills, and
 * which UV set each texture reads. Nothing has to be guessed and nothing has
 * to be recognised: the answer is in the file, and reading it is a walk over
 * the scene graph. That is worth saying plainly, because "work out the
 * materials and UVs" sounds like a job for a model and is in fact a job for a
 * for-loop.
 *
 * What that buys is per-material work: a card on the board can be handed to a
 * material as its colour map, and the model comes back wearing it.
 *
 * ## Why the library is loaded late
 *
 * three.js is not small and most boards hold no models, so it sits behind a
 * dynamic import and costs nothing until the first one is dropped — the same
 * arrangement pdf.js has, for the same reason, and the service worker caches
 * the chunk with the rest of the build so it still works offline.
 * ------------------------------------------------------------------------- */

import type * as THREE from 'three'

/* Big enough that a card's picture is sharp on a dense screen and an export
 * has something to work with; small enough that turning a model is not a
 * second of waiting. Matches the cap the rest of the app decodes to. */
export const VIEW = 1024

/* A product-shot lens: long enough that the model is not distorted, short
 * enough that it still reads as a thing in space rather than an elevation. */
const FOV = 35

export interface Stage {
  /* Degrees round the model, and up and down from its equator. */
  yaw: number
  pitch: number
  /* Multiples of the distance at which the model exactly fills the frame, so 1
   * is "as large as it goes", less is inside it and more is small in the
   * middle. Said that way rather than in the file's own units because a ring
   * and a building are modelled at wildly different scales and a number that
   * means "quite close" for one means "inside the concrete" for the other. */
  dist: number
}

/* Turned a little off square and looked slightly down on, which is how a thing
 * is photographed when the photograph is meant to show what it is; and far
 * enough out to leave a margin, because a card that crops the model is a card
 * that has to be adjusted before it is any use. */
export const STAGE_0: Stage = { yaw: 35, pitch: 18, dist: 1.15 }

/* One material as the file describes it. */
export interface Part {
  name: string
  /* Which texture slots it fills — colour, roughness, normal and so on. */
  maps: string[]
  /* Which UV sets its textures read. Two means the model was unwrapped twice,
   * which is worth knowing before handing it a new picture. */
  uv: number[]
  /* Base colour, as hex, for a material with no texture at all. */
  tint: string
}

export const isModel = (name: string, type?: string): boolean => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return ext === 'glb' || ext === 'gltf' || type === 'model/gltf-binary' || type === 'model/gltf+json'
}

const TRACE = () => (globalThis as unknown as { __modelTrace?: boolean }).__modelTrace === true
const say = (...a: unknown[]) => { if (TRACE()) console.log('[model]', ...a) }

/* ---------------------------------------------------------------------------
 * The renderer, held once for the whole board.
 * ------------------------------------------------------------------------- */

interface Kit {
  three: typeof THREE
  renderer: THREE.WebGLRenderer
  loadGLB: (buf: ArrayBuffer) => Promise<THREE.Group>
}

let kit: Promise<Kit | null> | null = null

async function getKit(): Promise<Kit | null> {
  if (kit) return kit
  kit = (async () => {
    try {
      const three = (await import('three')) as unknown as typeof THREE
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const canvas = new OffscreenCanvas(VIEW, VIEW)
      const renderer = new three.WebGLRenderer({
        canvas: canvas as unknown as HTMLCanvasElement,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      })
      renderer.setSize(VIEW, VIEW, false)
      renderer.setClearColor(0x000000, 0)
      const loader = new GLTFLoader()
      return {
        three,
        renderer,
        loadGLB: (buf: ArrayBuffer) =>
          new Promise<THREE.Group>((res, rej) =>
            loader.parse(buf, '', (g) => res(g.scene as unknown as THREE.Group), (e) => rej(e))
          ),
      }
    } catch (e) {
      say('no renderer', e)
      return null
    }
  })()
  return kit
}

/* Parsed scenes, keyed the way everything else here is keyed. A model is
 * parsed once however many times it is turned, which is what makes turning it
 * a render rather than a load. */
const scenes = new Map<string, { scene: THREE.Group; radius: number; fit: number; centre: THREE.Vector3; parts: Part[] }>()

export function forgetModel(key: string) {
  scenes.delete(key)
}

const SLOTS: [keyof THREE.MeshStandardMaterial, string][] = [
  ['map', 'colour'],
  ['normalMap', 'normal'],
  ['roughnessMap', 'roughness'],
  ['metalnessMap', 'metal'],
  ['emissiveMap', 'glow'],
  ['aoMap', 'shadowing'],
  ['alphaMap', 'cut-out'],
]

/* What the file says about itself. A walk, not a guess. */
function readParts(three: typeof THREE, scene: THREE.Group): Part[] {
  const seen = new Map<string, Part>()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (!m) continue
      const std = m as THREE.MeshStandardMaterial
      const name = std.name || 'Unnamed'
      const part: Part = seen.get(name) || { name, maps: [], uv: [], tint: '#cccccc' }
      for (const [slot, label] of SLOTS) {
        const tex = std[slot] as unknown as THREE.Texture | null
        if (!tex) continue
        if (!part.maps.includes(label)) part.maps.push(label)
        /* Which UV set the texture reads, which glTF calls the channel. */
        const ch = (tex as unknown as { channel?: number }).channel ?? 0
        if (!part.uv.includes(ch)) part.uv.push(ch)
      }
      if (std.color) part.tint = '#' + std.color.getHexString()
      /* Which UV sets exist at all, as opposed to which ones something is
       * currently reading — a model unwrapped but not yet textured can wear a
       * picture, and one with no UVs cannot, and those are different answers
       * that both come out as "nothing textured" if only the textures are
       * counted. -1 means there is nowhere for a picture to go. */
      if (!part.uv.length) {
        const g = mesh.geometry
        if (g?.getAttribute?.('uv')) part.uv.push(0)
        if (g?.getAttribute?.('uv1')) part.uv.push(1)
        if (!part.uv.length) part.uv.push(-1)
      }
      seen.set(name, part)
      void three
    }
  })
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function load(key: string, file: Blob): Promise<{ kit: Kit; got: NonNullable<ReturnType<typeof scenes.get>> } | null> {
  const k = await getKit()
  if (!k) return null
  const hit = scenes.get(key)
  if (hit) return { kit: k, got: hit }
  try {
    const scene = await k.loadGLB(await file.arrayBuffer())
    const box = new k.three.Box3().setFromObject(scene)
    /* The sphere that holds it rather than the box, because the camera goes
     * round: a long model framed on its width disappears off the sides the
     * moment it is turned to face you. */
    const sphere = box.getBoundingSphere(new k.three.Sphere())
    const radius = Math.max(0.0001, sphere.radius)
    /* Where the camera has to stand for that sphere to just touch the edges of
     * the frame. Every distance on the card is a multiple of this one. */
    const fit = radius / Math.sin(((FOV * Math.PI) / 180) / 2)
    const centre = box.getCenter(new k.three.Vector3())
    const got = { scene, radius, fit, centre, parts: readParts(k.three, scene) }
    scenes.set(key, got)
    say('loaded', key, got.parts.length, 'materials')
    return { kit: k, got }
  } catch (e) {
    say('would not parse', key, e)
    return null
  }
}

/* ---------------------------------------------------------------------------
 * A view of it.
 * ------------------------------------------------------------------------- */

export interface Look {
  /* Material name -> an ImageBitmap to use as its colour map. */
  skins?: Map<string, ImageBitmap>
}

/* Anything handed a picture wears it, and is put back by the returned list —
 * so a swap costs nothing once the card that asked for it has gone, and the
 * parsed model held in memory is never quietly altered by having been looked
 * at. */
function dress(three: typeof THREE, scene: THREE.Group, look: Look): (() => void)[] {
  const undo: (() => void)[] = []
  if (!look.skins?.size) return undo
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial
      const bmp = look.skins?.get(std.name || 'Unnamed')
      if (!bmp) continue
      const was = std.map
      const tex = new three.Texture(bmp as unknown as HTMLImageElement)
      tex.needsUpdate = true
      tex.colorSpace = three.SRGBColorSpace
      tex.flipY = false
      tex.wrapS = three.RepeatWrapping
      tex.wrapT = three.RepeatWrapping
      std.map = tex
      std.needsUpdate = true
      undo.push(() => {
        std.map = was
        std.needsUpdate = true
        tex.dispose()
      })
    }
  })
  return undo
}

/* Renders one view and hands back a PNG. Returns null for anything that is not
 * a model this can read, which the caller turns into an ordinary file card. */
export async function renderModel(
  key: string,
  file: Blob,
  stage: Stage,
  look: Look = {}
): Promise<{ blob: Blob; parts: Part[] } | null> {
  const loaded = await load(key, file)
  if (!loaded) return null
  const { kit: k, got } = loaded
  const { three, renderer } = k

  const scene = new three.Scene()
  scene.add(got.scene)

  /* Three lights and no environment map: a key, a fill and a rim is what a
   * product shot is, and it needs no file to be fetched from anywhere. */
  scene.add(new three.AmbientLight(0xffffff, 0.55))
  const key1 = new three.DirectionalLight(0xffffff, 2.1)
  key1.position.set(1, 1.6, 1.2)
  scene.add(key1)
  const fill = new three.DirectionalLight(0xdfe6f0, 0.7)
  fill.position.set(-1.4, 0.3, 0.8)
  scene.add(fill)
  const rim = new three.DirectionalLight(0xfff0e0, 1.1)
  rim.position.set(-0.6, 0.9, -1.5)
  scene.add(rim)

  const undo = dress(three, got.scene, look)

  const d = got.fit * Math.max(0.2, stage.dist)
  const cam = new three.PerspectiveCamera(FOV, 1, Math.max(0.0001, (d - got.radius) * 0.5), d + got.radius * 4)
  const yaw = (stage.yaw * Math.PI) / 180
  const pitch = Math.max(-1.5, Math.min(1.5, (stage.pitch * Math.PI) / 180))
  cam.position.set(
    got.centre.x + d * Math.cos(pitch) * Math.sin(yaw),
    got.centre.y + d * Math.sin(pitch),
    got.centre.z + d * Math.cos(pitch) * Math.cos(yaw)
  )
  cam.lookAt(got.centre)

  renderer.render(scene, cam)
  for (const fn of undo) fn()
  scene.remove(got.scene)

  const cv = renderer.domElement as unknown as OffscreenCanvas
  const blob = await cv.convertToBlob({ type: 'image/png' })
  return blob ? { blob, parts: got.parts } : null
}

/* The materials alone, for a card that already has a picture and only needs
 * the list. Parses if it has to, which is why it takes the file. */
export async function partsOf(key: string, file: Blob): Promise<Part[]> {
  const loaded = await load(key, file)
  return loaded ? loaded.got.parts : []
}

/* ---------------------------------------------------------------------------
 * Back out again.
 *
 * A model that came in and can only leave as a picture is a one way door. The
 * point of putting a reference onto a material is that the result is a model —
 * so it goes out as one, wearing what it was given, in the format it arrived
 * in, openable in the program it came from.
 *
 * The exporter is loaded later still than the loader: importing a model is
 * common and exporting one is not, so the cost is paid by the person who asked
 * for it.
 * ------------------------------------------------------------------------- */

export async function exportModel(key: string, file: Blob, look: Look = {}): Promise<Blob | null> {
  const loaded = await load(key, file)
  if (!loaded) return null
  const { kit: k, got } = loaded
  try {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
    const undo = dress(k.three, got.scene, look)
    try {
      const out = await new Promise<ArrayBuffer>((res, rej) =>
        new GLTFExporter().parse(
          got.scene,
          (r) => res(r as ArrayBuffer),
          (e) => rej(e),
          /* Binary, so a picture put on a material travels inside the file
           * rather than as a second file nobody remembers to send. */
          { binary: true }
        )
      )
      return new Blob([out], { type: 'model/gltf-binary' })
    } finally {
      for (const fn of undo) fn()
    }
  } catch (e) {
    say('would not write', key, e)
    return null
  }
}
