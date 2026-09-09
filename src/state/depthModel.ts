import type { InferenceSession, Tensor } from 'onnxruntime-common'
import { delBlob, getBlob, putBlob } from '../store/idb'

/* ---------------------------------------------------------------------------
 * The other way of guessing.
 *
 * The map made in the engine is three cues and a blur: what carries detail is
 * near, what is washed out is far, and the bottom of the frame is the floor.
 * It costs nothing, it is instant, and it is wrong in one particular way that
 * no weighting fixes — it is reading brightness and texture, so a dark near
 * thing against a bright far one comes out backwards.
 *
 * A monocular depth model does not have that failure, because it is not
 * reading brightness. It has seen a few million photographs and knows what a
 * face, a doorway and a horizon are. This runs one, here, in the browser.
 *
 * ## What it costs, and why it is not the default
 *
 * A first use fetches a runtime and about twenty-five megabytes of weights.
 * That is a real download on a board that has never asked the network for
 * anything except a picture somebody paid for, so it happens when it is asked
 * for and never before — and the analytic map stands in the whole time, so the
 * board is never waiting on it.
 *
 * Both are kept afterwards. The weights go in the same store the pictures go
 * in, so the second use is offline and instant, and clearing the site's data
 * clears them along with everything else.
 *
 * ## Honest about the failure
 *
 * Every way this can fail is the same failure — something did not arrive — and
 * the answer is the same: say so, name what could not be fetched, and leave
 * the map that was already there. A depth map that quietly turned into noise
 * because a download was cut off would be worse than no button.
 * ------------------------------------------------------------------------- */

/* Pinned, both of them. A runtime that changed under the app would change what
 * every board's depth map looks like, which is not a thing to find out about
 * from a bug report. */
const RUNTIME = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.mjs'
const WEIGHTS =
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q8.onnx'

/* Where the weights are kept once they have been fetched. In the blob store,
 * beside the pictures, because that is where this browser keeps large things
 * and because the sweep must never collect it — no card points at it, so it is
 * deliberately not given a media key. */
const KEPT = 'model_depth_anything_v2_small_q8'

/* What the model was trained at. A multiple of fourteen because the patches
 * are fourteen across, and the model refuses anything else. */
const SIDE = 518

/* ImageNet, which is what the processor for this model normalises with. */
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/* Only the parts of onnxruntime-web this uses, typed from the package that
 * declares them. The runtime itself is fetched rather than bundled: it is half
 * a megabyte of JavaScript and eleven of WebAssembly, and an app that carries
 * that around for a button most boards never press is an app that got slower
 * for everybody. */
interface Ort {
  InferenceSession: {
    create(b: Uint8Array, o?: InferenceSession.SessionOptions): Promise<InferenceSession>
  }
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => Tensor
  env: { wasm: { numThreads: number; proxy: boolean } }
}

export type Say = (what: string, part?: number) => void

let ort: Ort | null = null
let session: InferenceSession | null = null

/* Whether the model is ready to run without fetching anything. For the button,
 * which should say "Sharpen" the second time and "Sharpen — one download" the
 * first. */
export const modelHere = (): boolean => !!session

export async function modelKept(): Promise<boolean> {
  if (session) return true
  try {
    return !!(await getBlob(KEPT))
  } catch {
    return false
  }
}

async function runtime(): Promise<Ort> {
  if (ort) return ort
  /* Vite must not try to resolve this at build time: it is an address, not a
   * package, and the whole point is that it is not in the bundle. */
  let mod: Ort | null = null
  try {
    mod = (await import(/* @vite-ignore */ RUNTIME)) as unknown as Ort
  } catch {
    /* The browser's own message for this names the module and nothing else,
     * which is true and unhelpful. Every way it fails is the same way — it did
     * not arrive — and the sentence should be about that. */
    mod = null
  }
  if (!mod?.InferenceSession) throw new Error(`the depth runtime could not be fetched from ${RUNTIME}`)
  /* One thread and no worker of its own. This already runs off the main
   * thread's critical path because the caller awaits it, and asking for
   * threads needs headers a static site does not send. */
  try {
    mod.env.wasm.numThreads = 1
    mod.env.wasm.proxy = false
  } catch {
    /* An older shape. It will still run, just not as told. */
  }
  ort = mod
  return mod
}

async function weights(say: Say): Promise<Uint8Array> {
  const kept = await getBlob(KEPT).catch(() => null)
  if (kept) return new Uint8Array(await kept.arrayBuffer())

  say('Fetching the depth model, once', 0)
  const res = await fetch(WEIGHTS).catch(() => null)
  if (!res || !res.ok) {
    throw new Error(`the depth model could not be fetched from ${WEIGHTS}`)
  }
  /* Read in pieces so the count can move. A twenty-five megabyte download with
   * no sign of life is a download people cancel. */
  const total = Number(res.headers.get('content-length') || 0)
  const body = res.body
  let bytes: Uint8Array
  if (!body) {
    bytes = new Uint8Array(await res.arrayBuffer())
  } else {
    const reader = body.getReader()
    const parts: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        parts.push(value)
        got += value.length
        if (total) say('Fetching the depth model, once', got / total)
      }
    }
    bytes = new Uint8Array(new ArrayBuffer(got))
    let at = 0
    for (const p of parts) {
      bytes.set(p, at)
      at += p.length
    }
  }
  await putBlob(KEPT, new Blob([bytes as BlobPart], { type: 'application/octet-stream' })).catch(() => {
    /* No room to keep it. It still ran this time, and the next press pays for
     * it again — which is better than refusing to run at all. */
  })
  return bytes
}

/* The picture, as the model wants it: three planes of floats, each channel
 * whole rather than interleaved, normalised the way the processor does. */
function feed(src: ImageBitmap): Float32Array {
  const c = document.createElement('canvas')
  c.width = SIDE
  c.height = SIDE
  const cx = c.getContext('2d', { willReadFrequently: true })!
  cx.drawImage(src, 0, 0, SIDE, SIDE)
  const d = cx.getImageData(0, 0, SIDE, SIDE).data
  const out = new Float32Array(3 * SIDE * SIDE)
  const plane = SIDE * SIDE
  for (let i = 0, p = 0; p < plane; i += 4, p++) {
    out[p] = (d[i] / 255 - MEAN[0]) / STD[0]
    out[plane + p] = (d[i + 1] / 255 - MEAN[1]) / STD[1]
    out[plane * 2 + p] = (d[i + 2] / 255 - MEAN[2]) / STD[2]
  }
  return out
}

/* And back: whatever shape the model returns, stretched to nothing-to-one and
 * drawn at the picture's own proportions.
 *
 * Normalised per picture rather than against an absolute scale, because that
 * is what this model gives — relative distance within one frame. Two maps of
 * two photographs are not on the same ruler and nothing here pretends they
 * are. */
async function picture(t: Tensor, w: number, h: number): Promise<ImageBitmap | null> {
  const dims = t.dims as readonly number[]
  const side = dims[dims.length - 1]
  const rows = dims[dims.length - 2]
  const raw = t.data as Float32Array
  if (!side || !rows || !raw?.length) return null

  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = hi - lo || 1

  const small = document.createElement('canvas')
  small.width = side
  small.height = rows
  const sx = small.getContext('2d')!
  const img = sx.createImageData(side, rows)
  for (let i = 0; i < side * rows; i++) {
    /* This model gives larger for nearer, which is the same way round as the
     * map made in the engine, so the two are interchangeable on a wire. */
    const v = Math.round(((raw[i] - lo) / span) * 255)
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  sx.putImageData(img, 0, 0)

  const big = document.createElement('canvas')
  big.width = Math.max(2, Math.round(w))
  big.height = Math.max(2, Math.round(h))
  const bx = big.getContext('2d')!
  bx.imageSmoothingEnabled = true
  bx.imageSmoothingQuality = 'high'
  bx.drawImage(small, 0, 0, big.width, big.height)
  return createImageBitmap(big)
}

/* Runs the model over one picture. Returns the map, or throws with a sentence
 * saying what did not arrive. The caller closes the source. */
export async function modelDepth(src: ImageBitmap, w: number, h: number, say: Say): Promise<ImageBitmap | null> {
  const lib = await runtime()
  if (!session) {
    const bytes = await weights(say)
    say('Starting the depth model')
    session = await lib.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
  }
  say('Reading the distances')
  /* By position rather than by name. The exported graph names its input
   * `pixel_values` today; a re-export that called it something else would
   * break a hard-coded name and nothing else about this. */
  const input = session.inputNames[0]
  const want = session.outputNames[0]
  const t = new lib.Tensor('float32', feed(src), [1, 3, SIDE, SIDE])
  const got = await session.run({ [input]: t })
  const out = got[want] as Tensor | undefined
  if (!out) throw new Error('the depth model gave nothing back')
  return picture(out, w, h)
}

/* For the person who wants the room back. The weights are the largest single
 * thing this app will ever put in a browser. */
export async function forgetModel(): Promise<void> {
  session = null
  await delBlob(KEPT).catch(() => {})
}
