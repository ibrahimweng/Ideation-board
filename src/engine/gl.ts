import { VERT, BLUR, PRE } from './shaders'
import { BY_ID } from './effects'
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

export interface RenderJob {
  effectId: string
  params: Params | null
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
  readonly ok: boolean
  private cv: AnyCanvas
  private gl!: GL
  private progs: Record<string, Program> = {}
  private pext: { COMPLETION_STATUS_KHR: number } | null = null
  private vao!: WebGLVertexArrayObject
  private blurProg!: Program
  private glyph!: WebGLTexture
  private fbo!: [FBO, FBO]
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

  /* Three ramps of characters, darkest first, drawn into one atlas of sixteen
   * columns by three rows.
   *
   * The cells are the shape of a character rather than square. Square cells
   * left a monospace glyph with a wide margin either side, so the picture came
   * out as widely spaced dots rather than as text, and anything drawn into a
   * cell of a different shape was stretched. These match what the effect lays
   * on screen, so a letter is letter-shaped. */
  private mkGlyphs(): WebGLTexture {
    const sets = [' .:-=+*#%@', ' .:*#']
    const cw = 24
    const ch = 40
    const c: AnyCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(cw * 16, ch * 3)
        : Object.assign(document.createElement('canvas'), { width: cw * 16, height: ch * 3 })
    const x = c.getContext('2d') as OffscreenCanvasRenderingContext2D
    x.fillStyle = '#000'
    x.fillRect(0, 0, cw * 16, ch * 3)
    x.fillStyle = '#fff'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.font = 'bold ' + Math.round(ch * 0.84) + 'px ui-monospace, "JetBrains Mono", Menlo, monospace'
    sets.forEach((set, row) => {
      for (let i = 0; i < set.length; i++) x.fillText(set[i], i * cw + cw / 2, row * ch + ch / 2 + 1)
    })

    /* The third row is drawn rather than typed. A font's block characters sit
     * inside their cell with a margin, which tiled into a grid of seams across
     * the picture, and not every platform has them at all. These are the same
     * five densities as patterns that meet edge to edge. */
    const step = 4
    for (let i = 0; i < 5; i++) {
      const cov = i / 4
      if (!cov) continue
      const size = step * Math.sqrt(cov)
      const inset = (step - size) / 2
      for (let py = 0; py < ch; py += step) {
        for (let px = 0; px < cw; px += step) {
          x.fillRect(i * cw + px + inset, 2 * ch + py + inset, size, size)
        }
      }
    }
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
  render(source: Source, srcW: number, srcH: number, key: string | null, job: RenderJob): boolean {
    if (!this.ok || !source) return false
    const gl = this.gl
    const spec: EffectSpec = BY_ID[job.effectId] || BY_ID.none
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
    const p = job.params || {}

    /* How much of the picture the card can show without distorting it. */
    const cover = coverUv(srcW, srcH, w, h)
    const bl = spec.blurKey
      ? this.blurChain(src, ((p[spec.blurKey] as number) || 0) * (h / 420), w, h, cover)
      : { tex: src, sx: cover.sx, sy: cover.sy, ox: cover.ox, oy: cover.oy }

    const pr = this.prog(job.effectId)
    if (pr.failed || !pr.u || !pr.p) return false
    gl.useProgram(pr.p)
    if (pr.u.uBlurScale) gl.uniform2f(pr.u.uBlurScale, bl.sx, bl.sy)
    if (pr.u.uBlurOff) gl.uniform2f(pr.u.uBlurOff, bl.ox, bl.oy)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bl.tex)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.glyph)
    if (pr.u.uTex) gl.uniform1i(pr.u.uTex, 0)
    if (pr.u.uBlur) gl.uniform1i(pr.u.uBlur, 1)
    if (pr.u.uGlyph) gl.uniform1i(pr.u.uGlyph, 2)
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
