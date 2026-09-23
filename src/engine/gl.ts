import { VERT, BLUR, PRE } from './shaders'
import { paintGlyphs } from './glyphs'
import { BY_ID } from './effects'
import { DEVELOP_FRAG } from './develop'
import { REPEATS } from './types'
import { CURVE_W, curveTable, devUniforms } from '../state/develop'
import { BRUSH_W, brushKey, liveMasks, maskUniforms, paintBrush } from '../state/mask'
import type { Develop } from '../state/develop'
import type { Mask } from '../state/mask'
import type { EffectSpec, Params } from './types'

/* ---------------------------------------------------------------------------
 * Renderer — the single WebGL2 context.
 *
 * Three things here are what make a board with hundreds of effected images
 * usable, and all three were the bottleneck in the previous version:
 *
 *   1. Textures are cached in a byte-budgeted LRU. The old engine cached
 *      exactly one, keyed by a single string, so every card in a pass evicted
 *      the previous card's texture and re-uploaded a full-resolution image.
 *      N cards meant N full texImage2D uploads per pass.
 *
 *   2. Results leave as an ImageBitmap via transferToImageBitmap(), which is a
 *      zero-copy handoff of the drawing buffer. The old engine blitted the GL
 *      canvas into a per-card 2D canvas with drawImage(), forcing a pipeline
 *      flush and a GPU->CPU->GPU round trip for every single card.
 *
 *   3. The drawing buffer is sized to the job. The old one grew to the largest
 *      card ever rendered and never shrank, so every small card rendered into
 *      the corner of a huge buffer and blurred through full-size FBOs.
 * ------------------------------------------------------------------------- */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type GL = WebGL2RenderingContext

interface Program {
  p: WebGLProgram | null
  fs: WebGLShader | null
  u: Record<string, WebGLUniformLocation | null> | null
  pending: boolean
  failed?: boolean
}

interface TexEntry {
  tex: WebGLTexture
  w: number
  h: number
  bytes: number
  used: number
}

interface FBO {
  tex: WebGLTexture
  fb: WebGLFramebuffer
  w: number
  h: number
}

/* One effect and its settings. A card is a list of these. */
export interface JobLayer {
  effectId: string
  params: Params | null
  /* Times to run, each pass reading the one before. */
  n?: number
}

/* The card wired into the one being rendered. Uploaded and cached exactly like
 * the first, because it is a card like any other. */
export interface Second {
  source: Source
  w: number
  h: number
  key: string
}

export interface RenderJob {
  effectId: string
  params: Params | null
  /* Repeats of the first effect. The rest carry their own in `stack`. */
  n?: number
  /* Effects applied after the first, in order, each reading what the one
   * before it drew. Absent or empty for a card with a single effect, which is
   * nearly every card — and that path is untouched by any of this: no extra
   * buffer, no extra pass, the same one draw straight to the canvas. */
  stack?: JobLayer[]
  /* What was done to the photograph itself, before any effect was put on it.
     Absent for a card nobody has developed, which is nearly every card — and
     that path is untouched: no extra buffer, no extra pass, no compile. */
  dev?: Develop
  /* One of that develop's masks, drawn as a red overlay instead of the
     picture, while it is being placed. Carried beside the develop rather than
     inside it because it is never saved: it is a thing the panel is doing, not
     a thing the card is wearing. */
  showMask?: string
  /* Identity of the four tone curves, so the table is re-uploaded only when
     the curve actually changed rather than on every draw. */
  curveKey?: string
  width: number
  height: number
  seed: number
}

/* Decoded pixel sources the engine can upload. */
export type Source = ImageBitmap | HTMLImageElement | HTMLVideoElement | OffscreenCanvas | HTMLCanvasElement

const hexToRGB = (hex: string): [number, number, number] => {
  const h = (hex || '#000000').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  if (!Number.isFinite(n)) return [0, 0, 0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/* Roughly 220MB of texture before we start evicting. Tuned to sit inside the
 * budget of an integrated GPU while holding ~50 full-resolution photographs.
 * Only visible cards are ever rendered, so the working set is the number of
 * cards on screen, not the number on the board. */
const TEX_BUDGET = 220 * 1024 * 1024

/* Evicted texture objects are kept for reuse rather than deleted. Allocating
 * and freeing GL texture objects is expensive, and a board that scrolls
 * through more images than fit in the budget would otherwise pay that cost on
 * every single render. This cap bounds what the pool itself holds. */
const POOL_BUDGET = 64 * 1024 * 1024

export interface Cover {
  sx: number
  sy: number
  ox: number
  oy: number
}

/* The part of the picture a card of this shape can show, as a scale and an
 * offset in texture coordinates. Wider than the card and it loses its sides,
 * taller and it loses its top and bottom: cropping to fill, which is what an
 * uneffected card already does through object-fit. */
export function coverUv(sw: number, sh: number, w: number, h: number): Cover {
  if (!(sw > 0 && sh > 0 && w > 0 && h > 0)) return { sx: 1, sy: 1, ox: 0, oy: 0 }
  const src = sw / sh
  const out = w / h
  if (Math.abs(src - out) < 1e-4) return { sx: 1, sy: 1, ox: 0, oy: 0 }
  if (src > out) {
    /* The picture is wider than the card: keep its height, take a slice out
     * of the middle. */
    const sx = out / src
    return { sx, sy: 1, ox: (1 - sx) / 2, oy: 0 }
  }
  const sy = src / out
  return { sx: 1, sy, ox: 0, oy: (1 - sy) / 2 }
}

export class Renderer {
  /* Was readonly, and that was the assumption worth breaking: a context is not
   * only given or refused at birth, it can be taken away afterwards. */
  ok: boolean
  private cv: AnyCanvas
  private gl!: GL
  private progs: Record<string, Program> = {}
  private pext: { COMPLETION_STATUS_KHR: number } | null = null
  private vao!: WebGLVertexArrayObject
  private blurProg!: Program
  /* The develop pass. Built the first time a picture is actually developed, so
     a board of untouched photographs never compiles it. */
  private devProg: Program | null = null
  /* The four tone curves as a 256 by 4 table, re-uploaded only when the curve
     the card asks for is not the one already there. */
  private curveTex: WebGLTexture | null = null
  private curveKey = ''
  private glyph!: WebGLTexture
  private fbo!: [FBO, FBO]
  /* Only ever made if something is actually stacked. */
  private stack: [FBO, FBO] | null = null
  private stackW = 0
  private stackH = 0
  /* Where the develop chain ping-pongs while it works through the masks. Its
   * own pair rather than the stack's, because the stack's first buffer is
   * where this chain is asked to leave its answer. Made on the first masked
   * card and never before: a board of unmasked pictures pays nothing. */
  private devbuf: [FBO, FBO] | null = null
  private devbufW = 0
  private devbufH = 0
  /* The painted parts of a mask, baked once and kept until the strokes
   * change. */
  private brushTex: WebGLTexture | null = null
  private brushKeyed = ''
  private brushCv: OffscreenCanvas | null = null
  private fboW = 0
  private fboH = 0

  private tex = new Map<string, TexEntry>()
  private texBytes = 0
  private clock = 0
  private liveTex: WebGLTexture | null = null
  /* Freed texture objects, bucketed by exact dimensions so a reuse can go
   * through texSubImage2D and skip reallocating the storage. */
  private pool = new Map<string, WebGLTexture[]>()
  private poolBytes = 0

  private warmQ: string[] | null = null
  private w = 0
  private h = 0
  /* Told when the context goes, so whoever owns this renderer can decide what
   * to do about it. Set by the worker; nothing else needs it. */
  onLost: (() => void) | null = null

  /* The context itself, for the worker to put where it can be inspected. */
  context(): WebGL2RenderingContext | null {
    return this.gl || null
  }

  constructor(canvas: AnyCanvas) {
    this.cv = canvas
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      /* The old engine set preserveDrawingBuffer so it could drawImage() the
       * canvas afterwards. transferToImageBitmap needs no such thing, and
       * leaving it off lets the driver discard the buffer after each frame. */
      preserveDrawingBuffer: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance',
    }) as GL | null

    this.ok = !!gl
    if (!gl) return
    this.gl = gl

    /* A context can be taken away after it is given.
     *
     * A GPU process that crashes, a driver that updates under a running tab, a
     * machine switching graphics chips: the context goes and every call on it
     * becomes a silent no-op that neither throws nor returns an error. Nothing
     * here noticed, so effects simply stopped working until the page was
     * reloaded, with nothing said and every card still showing whatever it had
     * painted last — which looks exactly like a board that is working.
     *
     * Refusing the default is what leaves the door open for the browser to
     * hand a context back at all. What is done with the news is the caller's:
     * in the worker it throws this renderer away, and the next frame asked for
     * builds another. */
    const lost = (e: Event) => {
      e.preventDefault()
      this.ok = false
      this.onLost?.()
    }
    ;(canvas as unknown as EventTarget).addEventListener?.('webglcontextlost', lost)

    this.pext = gl.getExtension('KHR_parallel_shader_compile')
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    /* One oversized triangle covers the viewport with no wasted vertex work. */
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

    this.blurProg = this.finalize(this.build(BLUR))
    this.fbo = [this.mkFBO(), this.mkFBO()]
    this.glyph = this.mkGlyphs()
  }

  /* ---------- programs ---------- */

  /* Compile and link are kicked off without reading status; reading status is
   * what blocks the thread until the driver finishes. */
  private build(fragSrc: string): Program {
    const gl = this.gl
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const p = gl.createProgram()!
    const fs = mk(gl.FRAGMENT_SHADER, fragSrc)
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, fs)
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    return { p, fs, u: null, pending: true }
  }

  private finalize(pr: Program): Program {
    const gl = this.gl
    if (!pr.pending) return pr
    pr.pending = false
    if (!pr.p || !gl.getProgramParameter(pr.p, gl.LINK_STATUS)) {
      pr.failed = true
      return pr
    }
    const u: Record<string, WebGLUniformLocation | null> = {}
    const n = gl.getProgramParameter(pr.p, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(pr.p, i)
      if (info) u[info.name] = gl.getUniformLocation(pr.p, info.name)
    }
    pr.u = u
    return pr
  }

  private compiled(pr: Program): boolean {
    if (!pr.pending) return true
    if (!this.pext || !pr.p) return false
    return !!this.gl.getProgramParameter(pr.p, this.pext.COMPLETION_STATUS_KHR)
  }

  private prog(id: string): Program {
    let pr = this.progs[id]
    if (!pr) {
      try {
        pr = this.progs[id] = this.build(PRE + '\n' + (BY_ID[id] || BY_ID.none).frag)
      } catch {
        pr = this.progs[id] = { p: null, fs: null, u: null, pending: false, failed: true }
      }
    }
    if (pr.pending) this.finalize(pr)
    if (pr.failed && id !== 'none') return this.prog('none')
    return pr
  }

  /* Queue every effect for background compilation so first use never stalls. */
  warmAll(ids: string[]) {
    this.warmQ = ids.filter((id) => !this.progs[id])
  }

  tickWarm() {
    if (!this.warmQ) return
    let started = 0
    while (this.warmQ.length && started < 3) {
      const id = this.warmQ.shift()!
      try {
        this.progs[id] = this.build(PRE + '\n' + (BY_ID[id] || BY_ID.none).frag)
      } catch {
        this.progs[id] = { p: null, fs: null, u: null, pending: false, failed: true }
      }
      started++
    }
    let done = 0
    let left = 0
    for (const id in this.progs) {
      const pr = this.progs[id]
      if (!pr.pending) continue
      if (done < 2 && this.compiled(pr)) {
        this.finalize(pr)
        done++
      } else left++
    }
    if (!this.warmQ.length && !left) this.warmQ = null
  }

  /* ---------- textures ---------- */

  private mkTex(): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return t
  }

  private sizeKey(w: number, h: number) {
    return w + 'x' + h
  }

  /* Uploads once per source and keeps it resident. This is the single biggest
   * win over the old one-slot cache when a board holds many distinct images.
   *
   * When a board does hold more distinct images than the budget can keep, the
   * access pattern degenerates to a full miss on every render — the textbook
   * worst case for LRU. Reusing pooled texture objects means that worst case
   * still costs only the upload, which is what the old single-slot cache paid
   * for every image anyway. */
  private uploadCached(key: string, source: Source, sw: number, sh: number): WebGLTexture {
    const gl = this.gl
    const hit = this.tex.get(key)
    if (hit) {
      hit.used = ++this.clock
      gl.bindTexture(gl.TEXTURE_2D, hit.tex)
      return hit.tex
    }

    const bytes = Math.max(1, sw * sh * 4)
    /* Make room before allocating, so the pool has something to hand back. */
    this.evict(bytes)

    const sk = this.sizeKey(sw, sh)
    const free = this.pool.get(sk)
    const reused = free && free.length ? free.pop()! : null
    if (reused) {
      this.poolBytes -= bytes
      gl.bindTexture(gl.TEXTURE_2D, reused)
      /* Same dimensions, so the storage is already the right shape and this
       * writes into it rather than reallocating. */
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
      this.tex.set(key, { tex: reused, w: sw, h: sh, bytes, used: ++this.clock })
      this.texBytes += bytes
      return reused
    }

    const t = this.mkTex()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
    this.tex.set(key, { tex: t, w: sw, h: sh, bytes, used: ++this.clock })
    this.texBytes += bytes
    return t
  }

  /* Frees just enough for `incoming`, oldest first. Evicting far past what is
   * needed only guarantees the next render misses too. */
  private evict(incoming: number) {
    if (this.texBytes + incoming <= TEX_BUDGET) return
    const entries = [...this.tex.entries()].sort((a, b) => a[1].used - b[1].used)
    for (const [key, e] of entries) {
      if (this.texBytes + incoming <= TEX_BUDGET) break
      this.tex.delete(key)
      this.texBytes -= e.bytes
      this.recycle(e)
    }
  }

  /* Keeps the texture object for reuse instead of deleting it. */
  private recycle(e: TexEntry) {
    if (this.poolBytes + e.bytes > POOL_BUDGET) {
      this.gl.deleteTexture(e.tex)
      return
    }
    const sk = this.sizeKey(e.w, e.h)
    let list = this.pool.get(sk)
    if (!list) this.pool.set(sk, (list = []))
    list.push(e.tex)
    this.poolBytes += e.bytes
  }

  /* Video frames change every frame, so they get a single reused texture
   * rather than polluting the cache with a new entry per frame. */
  private uploadLive(source: Source): WebGLTexture {
    const gl = this.gl
    if (!this.liveTex) this.liveTex = this.mkTex()
    gl.bindTexture(gl.TEXTURE_2D, this.liveTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
    return this.liveTex
  }

  /* The item is gone from the board, so its texture is not coming back;
   * release it outright rather than holding it in the pool. */
  dropTexture(key: string) {
    const e = this.tex.get(key)
    if (!e) return
    this.gl.deleteTexture(e.tex)
    this.texBytes -= e.bytes
    this.tex.delete(key)
  }

  stats() {
    return {
      textures: this.tex.size,
      textureBytes: this.texBytes,
      programs: Object.keys(this.progs).length,
      pooled: this.poolBytes,
    }
  }

  /* ---------- framebuffers ---------- */

  private mkFBO(): FBO {
    return { tex: this.mkTex(), fb: this.gl.createFramebuffer()!, w: 0, h: 0 }
  }

  /* Sized to the job and allowed to shrink. The old engine only ever grew. */
  private sizeFBO(f: FBO, w: number, h: number) {
    if (f.w === w && f.h === h) return
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, f.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.tex, 0)
    f.w = w
    f.h = h
  }

  private ensureBlurBufs(w: number, h: number) {
    if (this.fboW === w && this.fboH === h) return
    this.fboW = w
    this.fboH = h
    this.sizeFBO(this.fbo[0], w, h)
    this.sizeFBO(this.fbo[1], w, h)
  }

  /* Where one effect leaves its picture for the next one to read.
   *
   * Full size, unlike the blur's pair, which are deliberately downscaled — a
   * blur is throwing detail away on purpose and a stacked effect is not. Made
   * on first use and not before, so a board that never stacks anything never
   * pays for these at all. */
  private ensureDevBufs(w: number, h: number) {
    if (!this.devbuf) this.devbuf = [this.mkFBO(), this.mkFBO()]
    if (this.devbufW === w && this.devbufH === h) return
    this.devbufW = w
    this.devbufH = h
    this.sizeFBO(this.devbuf[0], w, h)
    this.sizeFBO(this.devbuf[1], w, h)
  }

  private ensureStackBufs(w: number, h: number) {
    if (!this.stack) this.stack = [this.mkFBO(), this.mkFBO()]
    if (this.stackW === w && this.stackH === h) return
    this.stackW = w
    this.stackH = h
    this.sizeFBO(this.stack[0], w, h)
    this.sizeFBO(this.stack[1], w, h)
  }

  /* Three ramps of characters, lightest first, in one atlas of sixteen columns
   * by three rows.
   *
   * The cells are the shape of a character rather than square. Square cells
   * left a glyph with a wide margin either side, so the picture came out as
   * widely spaced dots rather than as text, and anything drawn into a cell of
   * a different shape was stretched. These match what the effect lays on
   * screen, so a letter is letter-shaped.
   *
   * The characters are drawn rather than typed, which is a decision with a
   * long enough story to live in its own file: see `glyphs.ts`. Built once,
   * because nothing about it can change any more. */
  private mkGlyphs(): WebGLTexture {
    const cw = 24
    const ch = 40
    const c: AnyCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(cw * 16, ch * 3)
        : Object.assign(document.createElement('canvas'), { width: cw * 16, height: ch * 3 })
    paintGlyphs(c.getContext('2d') as OffscreenCanvasRenderingContext2D, cw, ch)
    const gl = this.gl
    const t = this.mkTex()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c as TexImageSource)
    return t
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  /* Blur runs at reduced resolution: a wide blur destroys the detail anyway,
   * so full-resolution passes are wasted fill rate. */
  /* ---------- developing ----------
   *
   * One pass, before any effect, that turns the photograph into the developed
   * photograph. It is its own program rather than an entry in the effects
   * table because it needs thirty uniforms where an effect gets six, and
   * because it is not a look: every effect on this board is something you put
   * on a picture, and this is the picture.
   *
   * Built lazily and cached like everything else, so a board nobody has
   * developed never compiles it and never pays for it. */
  private developProg(): Program {
    if (!this.devProg) {
      try {
        this.devProg = this.build(DEVELOP_FRAG)
      } catch {
        this.devProg = { p: null, fs: null, u: null, pending: false, failed: true }
      }
    }
    if (this.devProg.pending) this.finalize(this.devProg)
    return this.devProg
  }

  /* The curve table, uploaded only when it changed. A card whose curve is
   * straight still gets a table, because the shader would otherwise need a
   * branch per pixel to find out; it is 4KB and it is uploaded once. */
  private curveFor(dev: Develop | undefined, key: string): WebGLTexture {
    const gl = this.gl
    if (!this.curveTex) {
      this.curveTex = this.mkTex()
      /* Nearest across the table's four rows and linear along them: a row is a
         different curve and must not bleed into its neighbour, while along a
         row the table is a sampled function and linear is the point of it. */
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      this.curveKey = ''
    }
    if (this.curveKey !== key) {
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CURVE_W, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveTable(dev))
      this.curveKey = key
    }
    return this.curveTex
  }

  /* ---------------------------------------------------------------------
   * The develop chain.
   *
   * The photograph, developed; then one more pass for every mask on it, each
   * reading what the last one wrote and laying its own edit down only where
   * its mask says. Which is to say: exactly the shader above, run again with
   * different numbers, instead of a second shader that has to be kept in step
   * with the first one for ever.
   *
   * A masked pass costs one more full-screen draw, and a card has masks only
   * while somebody is working on it. The unmasked card — every card on every
   * board that nobody is editing right now — takes the same single pass it
   * took before any of this existed.
   * ------------------------------------------------------------------------ */
  private develop(
    dev: Develop,
    masks: Mask[] | undefined,
    curveKey: string,
    src: WebGLTexture,
    cover: Cover,
    w: number,
    h: number,
    into: FBO | null,
    seed: number,
    two: { tex: WebGLTexture; cover: Cover } | null,
    showMask?: string
  ): boolean {
    const live = liveMasks(masks)

    /* Show me where it is: the mask alone, in red, over the photograph. Drawn
     * from the source rather than from the developed picture, because the
     * question being asked is "is this the right place", and a gradient that
     * has just been dragged over a sky is easier to judge against the sky. */
    if (showMask) {
      const m = (masks || []).find((k) => k.id === showMask)
      if (m) return this.devPass({}, '', src, cover, w, h, into, seed, two, m, true)
    }

    if (!live.length) return this.devPass(dev, curveKey, src, cover, w, h, into, seed, two, null, false)

    this.ensureDevBufs(w, h)
    const bufs = this.devbuf!
    let t = 0
    if (!this.devPass(dev, curveKey, src, cover, w, h, bufs[t], seed, two, null, false)) return false
    let read = bufs[t].tex
    t = 1 - t
    /* Everything after the first reads a buffer that is already the shape of
     * the card, so it takes the whole of it. */
    const whole: Cover = { sx: 1, sy: 1, ox: 0, oy: 0 }
    for (let i = 0; i < live.length; i++) {
      const last = i === live.length - 1
      const dst = last ? into : bufs[t]
      if (!this.devPass(live[i].dev || {}, '', read, whole, w, h, dst, seed, two, live[i], false)) return false
      if (!last) {
        read = bufs[t].tex
        t = 1 - t
      }
    }
    return true
  }

  /* One draw of the develop shader: the global pass, or one mask's. */
  private devPass(
    dev: Develop,
    curveKey: string,
    src: WebGLTexture,
    cover: Cover,
    w: number,
    h: number,
    into: FBO | null,
    seed: number,
    two: { tex: WebGLTexture; cover: Cover } | null,
    mask: Mask | null,
    overlay: boolean
  ): boolean {
    const gl = this.gl
    const pr = this.developProg()
    if (pr.failed || !pr.u || !pr.p) return false
    const u = devUniforms(dev)

    /* Clarity and dehaze need a softened copy of the picture, and so does a
       mask carrying a defocus — the same chain, asked for a wider radius.
       Zero unless one of the three asked, and the chain is skipped. */
    const mu = mask ? maskUniforms(mask) : null
    const radius = Math.max(u.blurRadius, mu ? mu.blurRadius : 0)
    const bl = radius
      ? this.blurChain(src, radius * (h / 420), w, h, cover)
      : { tex: src, sx: cover.sx, sy: cover.sy, ox: cover.ox, oy: cover.oy }

    const curve = this.curveFor(dev, curveKey)

    gl.useProgram(pr.p)
    if (pr.u.uFlip) gl.uniform1f(pr.u.uFlip, into ? -1 : 1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null)
    gl.viewport(0, 0, w, h)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bl.tex)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, curve)
    if (pr.u.uTex) gl.uniform1i(pr.u.uTex, 0)
    if (pr.u.uBlur) gl.uniform1i(pr.u.uBlur, 1)
    if (pr.u.uCurve) gl.uniform1i(pr.u.uCurve, 2)

    if (pr.u.uRes) gl.uniform2f(pr.u.uRes, w, h)
    if (pr.u.uCover) gl.uniform2f(pr.u.uCover, cover.sx, cover.sy)
    if (pr.u.uCoverOff) gl.uniform2f(pr.u.uCoverOff, cover.ox, cover.oy)
    if (pr.u.uBlurScale) gl.uniform2f(pr.u.uBlurScale, bl.sx, bl.sy)
    if (pr.u.uBlurOff) gl.uniform2f(pr.u.uBlurOff, bl.ox, bl.oy)
    if (pr.u.uSeed) gl.uniform1f(pr.u.uSeed, seed)

    if (pr.u.uWB) gl.uniform2f(pr.u.uWB, u.wb[0], u.wb[1])
    if (pr.u.uTone) gl.uniform4f(pr.u.uTone, u.tone[0], u.tone[1], u.tone[2], u.tone[3])
    if (pr.u.uTone2) gl.uniform4f(pr.u.uTone2, u.tone2[0], u.tone2[1], u.tone2[2], u.tone2[3])
    if (pr.u.uPresence) gl.uniform4f(pr.u.uPresence, u.presence[0], u.presence[1], u.presence[2], u.presence[3])
    if (pr.u.uSharp) gl.uniform4f(pr.u.uSharp, u.sharp[0], u.sharp[1], u.sharp[2], u.sharp[3])
    if (pr.u.uNoise) gl.uniform3f(pr.u.uNoise, u.noise[0], u.noise[1], u.noise[2])
    if (pr.u.uVign) gl.uniform4f(pr.u.uVign, u.vign[0], u.vign[1], u.vign[2], u.vign[3])
    if (pr.u.uGrain) gl.uniform3f(pr.u.uGrain, u.grain[0], u.grain[1], u.grain[2])
    /* An array uniform is located by its first element's name. */
    const arr = (name: string, v: number[]) => {
      const loc = pr.u![name] || pr.u![name + '[0]']
      if (loc) gl.uniform1fv(loc, v)
    }
    arr('uHslH', u.hslH)
    arr('uHslS', u.hslS)
    arr('uHslL', u.hslL)
    if (pr.u.uGradeS) gl.uniform3f(pr.u.uGradeS, u.gradeS[0], u.gradeS[1], u.gradeS[2])
    if (pr.u.uGradeM) gl.uniform3f(pr.u.uGradeM, u.gradeM[0], u.gradeM[1], u.gradeM[2])
    if (pr.u.uGradeH) gl.uniform3f(pr.u.uGradeH, u.gradeH[0], u.gradeH[1], u.gradeH[2])
    if (pr.u.uGradeG) gl.uniform3f(pr.u.uGradeG, u.gradeG[0], u.gradeG[1], u.gradeG[2])
    if (pr.u.uGradeMix) gl.uniform2f(pr.u.uGradeMix, u.gradeMix[0], u.gradeMix[1])

    /* ---- the mask ---- */
    const vec4s = (name: string, v: number[]) => {
      const loc = pr.u![name] || pr.u![name + '[0]']
      if (loc) gl.uniform4fv(loc, v)
    }
    if (mask && mu) {
      if (pr.u.uMask) gl.uniform4f(pr.u.uMask, 1, mu.n, mu.amount, overlay ? 1 : 0)
      if (pr.u.uBlurFx) gl.uniform4f(pr.u.uBlurFx, mu.blur[0], overlay ? 0 : mu.blur[1], mu.blur[2], mu.blur[3])
      if (pr.u.uBlurAt) gl.uniform2f(pr.u.uBlurAt, mu.blurAt[0], mu.blurAt[1])
      vec4s('uPartA', mu.a)
      vec4s('uPartB', mu.b)
      vec4s('uPartC', mu.c)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, mu.brush ? this.brushFor(mask) : this.blankTex())
      if (pr.u.uBrush) gl.uniform1i(pr.u.uBrush, 3)
      /* A depth-range part reads whatever is wired into this card, which is
       * the same picture the depth effects read and the same one the app made
       * when it offered to work out how far away things are. */
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, two ? two.tex : this.blankTex())
      if (pr.u.uDepth) gl.uniform1i(pr.u.uDepth, 4)
      if (pr.u.uDepthOn) gl.uniform2f(pr.u.uDepthOn, two ? 1 : 0, 0)
    } else if (pr.u.uMask) {
      gl.uniform4f(pr.u.uMask, 0, 0, 1, 0)
      if (pr.u.uBlurFx) gl.uniform4f(pr.u.uBlurFx, 0, 0, 0, 0)
      if (pr.u.uBlurAt) gl.uniform2f(pr.u.uBlurAt, 0.5, 0.5)
      /* Every sampler a program declares has to have something bound to it,
       * whether the shader reads it or not. */
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, this.blankTex())
      if (pr.u.uBrush) gl.uniform1i(pr.u.uBrush, 3)
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, this.blankTex())
      if (pr.u.uDepth) gl.uniform1i(pr.u.uDepth, 4)
      if (pr.u.uDepthOn) gl.uniform2f(pr.u.uDepthOn, 0, 0)
    }

    this.draw()
    return true
  }

  /* One transparent pixel, for a sampler a pass does not use. */
  private blank: WebGLTexture | null = null
  private blankTex(): WebGLTexture {
    if (this.blank) return this.blank
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.blank = t
    return t
  }

  /* The painted parts of a mask, drawn once into a small picture and kept
   * until a stroke changes. Strokes are geometry, and geometry a fragment
   * shader would have to walk through for every pixel of every frame; a 2D
   * context draws the same thing once. */
  private brushFor(mask: Mask): WebGLTexture {
    const gl = this.gl
    const key = brushKey(mask)
    if (this.brushTex && this.brushKeyed === key) return this.brushTex
    if (!this.brushCv) {
      try {
        this.brushCv = new OffscreenCanvas(BRUSH_W, BRUSH_W)
      } catch {
        return this.blankTex()
      }
    }
    const ctx = this.brushCv.getContext('2d', { willReadFrequently: false })
    if (!ctx) return this.blankTex()
    paintBrush(ctx as unknown as Parameters<typeof paintBrush>[0], mask, BRUSH_W, BRUSH_W)
    if (!this.brushTex) {
      this.brushTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.brushTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.brushTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.brushCv)
    this.brushKeyed = key
    return this.brushTex!
  }

  private blurChain(src: WebGLTexture, radius: number, w: number, h: number, cover: Cover) {
    /* Unblurred, the effect samples the source itself, so it needs the same
     * crop the sharp path uses. */
    const flat = { tex: src, sx: cover.sx, sy: cover.sy, ox: cover.ox, oy: cover.oy }
    if (!radius || radius < 0.5) return flat
    const gl = this.gl
    const ds = Math.max(1, Math.min(16, Math.round(radius / 6)))
    const bw = Math.max(2, Math.round(w / ds))
    const bh = Math.max(2, Math.round(h / ds))
    this.ensureBlurBufs(bw, bh)

    const pr = this.blurProg
    if (pr.failed || !pr.u) return flat
    gl.useProgram(pr.p)
    gl.uniform1i(pr.u.uTex!, 0)
    /* Every blur pass writes into a buffer, so every one of them is drawn the
     * buffer's way up. Two passes used to cancel each other out and arrive at
     * the right answer by luck; this arrives at it on purpose. */
    if (pr.u.uFlip) gl.uniform1f(pr.u.uFlip, -1)
    gl.activeTexture(gl.TEXTURE0)

    const passes = Math.max(1, Math.min(4, Math.round(radius / ds / 4)))
    let read = src
    let target = 0
    let first = true
    const step = radius / ds / passes

    for (let i = 0; i < passes; i++) {
      for (let axis = 0; axis < 2; axis++) {
        const fb = this.fbo[target]
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fb)
        gl.viewport(0, 0, bw, bh)
        gl.bindTexture(gl.TEXTURE_2D, read)
        gl.uniform2f(pr.u.uDir!, axis ? 0 : step / bw, axis ? step / bh : 0)
        /* Only the first pass reads the picture; the rest read what the pass
         * before wrote, which is already cropped. */
        gl.uniform2f(pr.u.uScale!, first ? cover.sx : 1, first ? cover.sy : 1)
        gl.uniform2f(pr.u.uOff!, first ? cover.ox : 0, first ? cover.oy : 0)
        this.draw()
        read = fb.tex
        target = 1 - target
        first = false
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex: read, sx: 1, sy: 1, ox: 0, oy: 0 }
  }

  /* ---------- the render ---------- */

  /* Renders one card. `key` is the cache identity of the pixel source; pass
   * null for live video so the frame is uploaded rather than cached. */
  render(source: Source, srcW: number, srcH: number, key: string | null, job: RenderJob, second?: Second | null): boolean {
    if (!this.ok || !source) return false
    /* Asked rather than assumed: the event arrives a turn later than the loss
     * itself, so a job already in the queue would otherwise draw into nothing
     * and report success. */
    if (this.gl.isContextLost()) {
      this.ok = false
      this.onLost?.()
      return false
    }
    const gl = this.gl
    /* Four thousand and ninety six rather than two thousand: nothing on the
     * board asks for more than fifteen hundred, but an export asks for the
     * picture's own resolution and that is the point of it. */
    const w = Math.max(2, Math.min(4096, Math.round(job.width)))
    const h = Math.max(2, Math.min(4096, Math.round(job.height)))

    if (this.w !== w || this.h !== h) {
      this.cv.width = w
      this.cv.height = h
      this.w = w
      this.h = h
    }

    gl.bindVertexArray(this.vao)
    const src = key ? this.uploadCached(key, source, srcW, srcH) : this.uploadLive(source)

    /* How much of the picture the card can show without distorting it. */
    const cover = coverUv(srcW, srcH, w, h)

    /* And the same for whatever is wired in, so the two line up on the card
     * rather than on their own aspect ratios. */
    let two: { tex: WebGLTexture; cover: Cover } | null = null
    if (second) {
      const t2 = this.uploadCached(second.key, second.source, second.w, second.h)
      if (t2) two = { tex: t2, cover: coverUv(second.w, second.h, w, h) }
    }

    /* Every pass this card asks for, in order: each layer as many times as it
     * asked to run. Expanding here rather than in the loop keeps the two paths
     * below reading as "one pass" and "more than one pass" rather than having
     * to think about layers and repeats at once. */
    const asked: JobLayer[] = [{ effectId: job.effectId, params: job.params, n: job.n }, ...(job.stack || [])]
    const passes: JobLayer[] = []
    for (const l of asked) {
      const times = Math.max(1, Math.min(REPEATS, Math.round(l.n || 1)))
      for (let i = 0; i < times; i++) passes.push(l)
    }

    /* Developing runs before any of it, because developing is what is done to
     * the photograph and an effect is a look put on the developed thing. */
    const dev = job.dev
    /* Masks ride on the develop record, so there is nothing extra to carry
     * from the card to here: a look that brings a develop brings its masks. */
    const masks = dev?.masks
    const show = job.showMask
    const plain = passes.length === 1 && passes[0].effectId === 'none'

    /* The mask overlay is about the mask and not about the picture, so it goes
     * straight to the canvas whatever else is on the card: an effect drawn on
     * top of it would hide the one thing it is for. */
    if (show) return this.develop(dev || {}, masks, '', src, cover, w, h, null, job.seed, two, show)

    if (dev && plain) {
      /* Developed, with no effect over it: one pass, straight to the canvas.
       * The common case for anybody using this as a photo editor, and it must
       * not cost a buffer it does not need. */
      return this.develop(dev, masks, job.curveKey || '', src, cover, w, h, null, job.seed, two)
    }

    const stacked = passes.length > 1 ? passes.slice(1) : null
    if (!stacked && !dev) {
      /* The whole of the board, nearly always: one effect, one draw, straight
       * to the canvas. Deliberately not routed through the loop below — a card
       * with one effect must cost exactly what it cost before any of this. */
      return this.pass({ effectId: job.effectId, params: job.params }, src, cover, w, h, null, job.seed, two)
    }

    /* Each layer draws into a buffer for the next one to read, and the last
     * draws to the canvas. Two buffers are enough however deep the stack goes,
     * because a pass only ever needs what the pass before it wrote. */
    this.ensureStackBufs(w, h)
    const bufs = this.stack!
    const layers: JobLayer[] = passes
    let read = src
    /* Only the first layer sees the picture at its own proportions and has to
     * crop it. Everything after reads a buffer that is already the shape of
     * the card, so it takes the whole of it. */
    let from = cover
    let target = 0

    if (dev) {
      /* The developed photograph into a buffer, and the effects read that
       * instead of the source. From here down nothing else knows or cares. */
      if (!this.develop(dev, masks, job.curveKey || '', src, cover, w, h, bufs[target], job.seed, two)) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        return false
      }
      read = bufs[target].tex
      from = { sx: 1, sy: 1, ox: 0, oy: 0 }
      target = 1 - target
    }

    for (let i = 0; i < layers.length; i++) {
      const last = i === layers.length - 1
      const into = last ? null : bufs[target]
      if (!this.pass(layers[i], read, from, w, h, into, job.seed + i, two)) {
        /* A layer whose shader would not build. Anything already drawn stands;
         * finishing the rest would paint over it with a half-made stack. */
        if (!last) gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        return i > 0
      }
      if (!last) {
        read = into!.tex
        from = { sx: 1, sy: 1, ox: 0, oy: 0 }
        target = 1 - target
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return true
  }

  /* One effect, from one texture, into a buffer or onto the canvas.
   *
   * Everything that used to be the back half of `render`. Pulled out so a
   * stack is a loop over it rather than a second copy of it — two copies of
   * thirty lines of uniform binding is how a stacked card ends up subtly
   * different from a plain one. */
  private pass(
    layer: JobLayer,
    src: WebGLTexture,
    cover: Cover,
    w: number,
    h: number,
    into: FBO | null,
    seed: number,
    two: { tex: WebGLTexture; cover: Cover } | null = null
  ): boolean {
    const gl = this.gl
    const spec: EffectSpec = BY_ID[layer.effectId] || BY_ID.none
    const job = { effectId: layer.effectId, params: layer.params, seed }
    const p = job.params || {}

    const bl = spec.blurKey
      ? this.blurChain(src, ((p[spec.blurKey] as number) || 0) * (h / 420), w, h, cover)
      : { tex: src, sx: cover.sx, sy: cover.sy, ox: cover.ox, oy: cover.oy }

    const pr = this.prog(job.effectId)
    if (pr.failed || !pr.u || !pr.p) return false
    gl.useProgram(pr.p)
    if (pr.u.uBlurScale) gl.uniform2f(pr.u.uBlurScale, bl.sx, bl.sy)
    if (pr.u.uBlurOff) gl.uniform2f(pr.u.uBlurOff, bl.ox, bl.oy)

    /* Onto the canvas, or into a buffer for the next pass — and the two are
     * not the same way up. See VERT. */
    if (pr.u.uFlip) gl.uniform1f(pr.u.uFlip, into ? -1 : 1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fb : null)
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bl.tex)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.glyph)
    /* Unit three always has something bound to it, wired or not: sampling an
     * unbound unit is undefined, and a shader that reads S with nothing wired
     * would draw whatever the driver felt like. It reads the card's own pixels
     * in that case, which is what the preamble promises. */
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, two ? two.tex : src)
    if (pr.u.uTex) gl.uniform1i(pr.u.uTex, 0)
    if (pr.u.uBlur) gl.uniform1i(pr.u.uBlur, 1)
    if (pr.u.uGlyph) gl.uniform1i(pr.u.uGlyph, 2)
    if (pr.u.uTex2) gl.uniform1i(pr.u.uTex2, 3)
    if (pr.u.uHas2) gl.uniform1f(pr.u.uHas2, two ? 1 : 0)
    if (pr.u.uCover2) gl.uniform2f(pr.u.uCover2, two ? two.cover.sx : cover.sx, two ? two.cover.sy : cover.sy)
    if (pr.u.uCoverOff2) gl.uniform2f(pr.u.uCoverOff2, two ? two.cover.ox : cover.ox, two ? two.cover.oy : cover.oy)
    if (pr.u.uRes) gl.uniform2f(pr.u.uRes, w, h)
    if (pr.u.uCover) gl.uniform2f(pr.u.uCover, cover.sx, cover.sy)
    if (pr.u.uCoverOff) gl.uniform2f(pr.u.uCoverOff, cover.ox, cover.oy)
    if (pr.u.uSeed) gl.uniform1f(pr.u.uSeed, (job.seed || 1) % 997)

    for (let i = 0; i < 6; i++) {
      const loc = pr.u['p' + i]
      if (!loc) continue
      const ctl = spec.controls.find((c) => c.k === 'p' + i)
      const val = p['p' + i]
      gl.uniform1f(loc, typeof val === 'number' ? val : ctl ? (ctl.def as number) : 0)
    }
    for (let i = 0; i < 3; i++) {
      const loc = pr.u['c' + i]
      if (!loc) continue
      const ctl = spec.controls.find((c) => c.k === 'c' + i)
      const hex = (p['c' + i] as string) || (ctl ? (ctl.def as string) : '#000000')
      const rgb = hexToRGB(hex)
      gl.uniform3f(loc, rgb[0], rgb[1], rgb[2])
    }

    this.draw()
    return true
  }

  /* Zero-copy handoff of the drawing buffer. Replaces the old
   * drawImage(glCanvas) round trip that cost a readback per card. */
  takeBitmap(): ImageBitmap | null {
    const c = this.cv as OffscreenCanvas
    if (typeof c.transferToImageBitmap !== 'function') return null
    return c.transferToImageBitmap()
  }

  canvas(): AnyCanvas {
    return this.cv
  }
}
