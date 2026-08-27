import { apiBase, apiKey, modelId, modelMethod } from './key'

/* ---------------------------------------------------------------------------
 * Asking Google for a picture, from the browser, with your key.
 *
 * Two families of model live behind the same address and take different
 * requests. Imagen answers to `:predict` and wants `instances`; Gemini answers
 * to `:generateContent` and wants `contents`. Which one a model is is not
 * guessed here — the listing says, in `supportedGenerationMethods`, and the
 * request is built from that.
 *
 * Nothing about a particular model is written into this file. The model list
 * is fetched with your key, the model id is yours to choose, and the address
 * is a setting. A model released next month works without a change here, which
 * is the point: the names move faster than the code would.
 *
 * The reply is read by looking for a picture in it rather than by walking a
 * path. Both families bury the bytes at a different depth under a different
 * name, the shapes have moved before, and a search that recognises an image by
 * its own first bytes cannot be broken by a rename.
 * ------------------------------------------------------------------------- */

export interface AiModel {
  id: string
  name: string
  description: string
  methods: string[]
}

export interface FoundImage {
  mime: string
  data: string
}

/* A picture handed to the model to work from, rather than one it made. Same
 * shape either way, which is the whole convenience of it. */
export type Ref = FoundImage

export class AiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

/* `models/gemini-x` and `gemini-x` both name the same thing. */
export const bareId = (m: string) => m.trim().replace(/^models\//, '')

const endpoint = (base: string, model: string, method: string) =>
  `${base.replace(/\/+$/, '')}/models/${encodeURIComponent(bareId(model))}:${method}`

/* The key travels as a header rather than in the query string. Same request as
 * far as Google is concerned, but a URL is the one part of a request that gets
 * written down — in a referrer, in a devtools list, in the text of an error
 * that ends up pasted into a chat. A header is not. */
const headers = (key: string): Record<string, string> => ({
  'x-goog-api-key': key,
  'content-type': 'application/json',
})

/* Long enough for a slow model, short enough that a request which will never
 * answer does not leave a card pulsing on the board for the rest of the day.
 * Nothing else in the app has a fetch that can hang: this is the only one that
 * leaves the machine. */
const PATIENCE = 120_000

/* A caller's own signal wins. Without one, the wait is bounded here rather
 * than left to the browser, which will hold a connection open for minutes. */
function withTimeout(signal: AbortSignal | undefined): { signal: AbortSignal | undefined; timedOut: () => boolean } {
  if (signal) return { signal, timedOut: () => false }
  const T = (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout
  if (!T) return { signal: undefined, timedOut: () => false }
  const s = T(PATIENCE)
  return { signal: s, timedOut: () => s.aborted }
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  try {
    const j = JSON.parse(body)
    const m = j?.error?.message
    if (typeof m === 'string' && m) return m
  } catch {
    /* Not JSON. The status line below says more than half a page of HTML. */
  }
  return body.slice(0, 200) || `The request failed (${res.status})`
}

/* A refusal is worth a sentence a person can act on rather than a number. */
function friendly(status: number, message: string): string {
  if (status === 400 && /API key not valid/i.test(message)) return 'That key was not accepted. Check it and try again.'
  if (status === 401 || status === 403) {
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(message)) {
      return 'The key is real but the Generative Language API is not switched on for its project. ' + message
    }
    return 'The key was refused. It may be restricted to certain sites, or not allowed to use this model.'
  }
  if (status === 429) return 'Out of quota, or asking too fast. Wait a moment and try again.'
  if (status === 404) return 'No such model. Pick another one in the settings.'
  if (status >= 500) return 'Google had a problem answering. Try again.'
  return message
}

/* --------------------------------------------------------------------------
 * Which models are there
 * ------------------------------------------------------------------------ */

export async function listModels(key = apiKey(), base = apiBase(), signal?: AbortSignal): Promise<AiModel[]> {
  if (!key) throw new AiError('No key saved yet.', 0)
  const out: AiModel[] = []
  const wait = withTimeout(signal)
  let page = ''
  /* Paged, and bounded: a listing that never stops handing back a token must
   * not spin here for ever. */
  for (let i = 0; i < 10; i++) {
    const url = `${base.replace(/\/+$/, '')}/models?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`
    const res = await fetch(url, { headers: headers(key), signal: wait.signal }).catch((e) => {
      if (wait.timedOut()) throw new AiError('The model list took too long to arrive. Try again.', 0)
      if ((e as Error)?.name === 'AbortError') throw e
      throw new AiError('Could not reach the API. Check the connection, or the address in settings.', 0)
    })
    if (!res.ok) throw new AiError(friendly(res.status, await readError(res)), res.status)
    const j = await res.json().catch(() => ({}))
    for (const m of Array.isArray(j?.models) ? j.models : []) {
      const id = bareId(String(m?.name || m?.baseModelId || ''))
      if (!id) continue
      out.push({
        id,
        name: String(m?.displayName || id),
        description: String(m?.description || ''),
        methods: Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods.map(String) : [],
      })
    }
    page = typeof j?.nextPageToken === 'string' ? j.nextPageToken : ''
    if (!page) break
  }
  return out
}

/* Which method to call a model with. The listing is the authority; the name is
 * only consulted when a listing has not been fetched. */
export function methodFor(m: AiModel | undefined, model: string): 'predict' | 'generateContent' {
  if (m) {
    if (m.methods.includes('predict')) return 'predict'
    if (m.methods.includes('generateContent')) return 'generateContent'
  }
  return /imagen/i.test(model) ? 'predict' : 'generateContent'
}

const DRAWS = /image|imagen|banana|picture|photo/i

/* The ones worth offering, best first.
 *
 * `predict` on this API is only ever image generation, so it is a fact rather
 * than a guess. For `generateContent` there is nothing in the listing that
 * says whether a model draws or only writes, so the name and description are
 * read — which is a guess, and is why the model can also be typed in by hand.
 * Nothing here can lock you out of a model this heuristic has not heard of. */
export function imageModels(all: AiModel[]): AiModel[] {
  const can = all.filter((m) => {
    if (m.methods.includes('predict')) return true
    if (!m.methods.includes('generateContent')) return false
    return DRAWS.test(m.id) || DRAWS.test(m.name) || DRAWS.test(m.description)
  })
  /* Prefer a model that says it generates over one that only edits or embeds,
   * and newer over older, so the first entry is a sensible default. */
  const score = (m: AiModel) => {
    let s = 0
    if (/generate/i.test(m.id)) s += 4
    if (m.methods.includes('predict')) s += 2
    if (/preview|exp\b|experimental/i.test(m.id)) s -= 1
    const ver = /(\d+)\.(\d+)/.exec(m.id)
    if (ver) s += Math.min(9, Number(ver[1])) + Number(ver[2]) / 10
    return s
  }
  return can.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
}

/* --------------------------------------------------------------------------
 * Finding the picture in the reply
 * ------------------------------------------------------------------------ */

/* What a file says it is in its own first bytes, read through base64. Three
 * base64 characters carry three bytes, so the prefixes below are just the
 * usual magic numbers spelled in the encoding they arrive in. */
export function sniffMime(b64: string): string {
  const s = b64.slice(0, 24)
  if (s.startsWith('iVBORw0KGgo')) return 'image/png'
  if (s.startsWith('/9j/')) return 'image/jpeg'
  if (s.startsWith('R0lGOD')) return 'image/gif'
  if (s.startsWith('UklGR')) return 'image/webp'
  if (s.startsWith('PHN2Zy') || s.startsWith('PD94bWw')) return 'image/svg+xml'
  return ''
}

const LOOKS_B64 = /^[A-Za-z0-9+/\s_-]+={0,2}$/
/* Below this it is not a picture, whatever it calls itself. */
const MIN_B64 = 64

function isImageMime(v: unknown): v is string {
  return typeof v === 'string' && /^image\//i.test(v)
}

function usable(v: unknown): v is string {
  return typeof v === 'string' && v.length >= MIN_B64 && LOOKS_B64.test(v.slice(0, 200))
}

/* Depth-first, and it will not follow a reply into the weeds. */
function search(node: unknown, take: (obj: Record<string, unknown>) => FoundImage | null, depth = 0): FoundImage | null {
  if (depth > 12 || node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = search(v, take, depth + 1)
      if (hit) return hit
    }
    return null
  }
  const obj = node as Record<string, unknown>
  const here = take(obj)
  if (here) return here
  for (const v of Object.values(obj)) {
    const hit = search(v, take, depth + 1)
    if (hit) return hit
  }
  return null
}

/* Both families put an image somewhere in the reply. Gemini writes it as
 * `inlineData: { mimeType, data }` inside a part; Imagen writes it as
 * `bytesBase64Encoded` inside a prediction. Rather than encode either path,
 * look for an object that holds a long base64 string which is either declared
 * to be an image or begins like one.
 *
 * The declaration alone is never enough. Several fields in a Gemini reply are
 * base64 and are not pictures — a thought signature, most of all — so a string
 * has to either sit next to an `image/*` mime type or start with the first
 * bytes of a real image format before it is believed. */
export function findImage(reply: unknown): FoundImage | null {
  const strong = (obj: Record<string, unknown>): FoundImage | null => {
    const mime = obj.mimeType ?? obj.mime_type ?? obj.mime
    if (!isImageMime(mime)) return null
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'mimeType' || k === 'mime_type' || k === 'mime') continue
      if (usable(v)) return { mime, data: v }
    }
    return null
  }
  const byMagic = (obj: Record<string, unknown>): FoundImage | null => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'thoughtSignature' || k === 'thought_signature') continue
      if (!usable(v)) continue
      const mime = sniffMime(v)
      if (mime) return { mime, data: v }
    }
    return null
  }
  return search(reply, strong) || search(reply, byMagic)
}

/* A reply with no picture in it usually says why somewhere. Finding that is
 * worth more than "no image was returned". */
export function explainNoImage(reply: unknown): string {
  const r = reply as Record<string, any>
  const blocked = r?.promptFeedback?.blockReason
  if (typeof blocked === 'string' && blocked) {
    return `The prompt was refused (${String(blocked).toLowerCase().replace(/_/g, ' ')}).`
  }
  const cand = Array.isArray(r?.candidates) ? r.candidates[0] : undefined
  const why = cand?.finishReason
  if (typeof why === 'string' && why && why !== 'STOP') {
    const said = String(why).toLowerCase().replace(/_/g, ' ')
    if (/safety|prohibited|blocklist|recitation|spii/.test(said)) return `The picture was refused (${said}).`
    return `The model stopped without a picture (${said}).`
  }
  /* The commonest case by far: a model that writes rather than draws, politely
   * explaining itself. Its own words say more than anything we could add. */
  const parts = cand?.content?.parts
  if (Array.isArray(parts)) {
    const text = parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join(' ').trim()
    if (text) return `That model answered with words, not a picture: “${text.slice(0, 160)}”`
  }
  const filtered = Array.isArray(r?.predictions) && r.predictions.length === 0
  if (filtered) return 'The model returned nothing. The prompt may have been filtered.'
  return 'No picture came back. That model may not make images — pick another in settings.'
}

/* --------------------------------------------------------------------------
 * Asking
 * ------------------------------------------------------------------------ */

export interface GenOpts {
  prompt: string
  model?: string
  aspect?: string
  /* Pictures to work from. "This one, but at night" is a different request
   * from "a pot at night", and on a board full of references the first is
   * nearly always the one you mean. */
  refs?: Ref[]
  key?: string
  base?: string
  method?: 'predict' | 'generateContent'
  signal?: AbortSignal
}

/* The bodies to try, in order. The first is what should work; the rest drop
 * the parts that a given model is most likely to reject.
 *
 * `imageConfig` is documented to be an error on a model that does not support
 * it, and `responseModalities` an error unless it matches a combination the
 * model offers exactly — neither of which can be known from the listing. So
 * rather than pick one and be wrong for half the models, ask, and step down
 * when the answer is that the request was malformed. */
export function bodiesFor(
  method: 'predict' | 'generateContent',
  prompt: string,
  aspect: string,
  refs: Ref[] = []
): unknown[] {
  if (method === 'predict') {
    const params: Record<string, unknown> = { sampleCount: 1 }
    if (aspect) params.aspectRatio = aspect
    const full = { instances: [{ prompt }], parameters: params }
    if (!aspect) return [full]
    return [full, { instances: [{ prompt }], parameters: { sampleCount: 1 } }]
  }
  /* The pictures first and the words after, which is the order the model is
   * documented to read them in: here is the thing, now here is what to do
   * with it. */
  const parts = [
    ...refs.map((r) => ({ inlineData: { mimeType: r.mime, data: r.data } })),
    { text: prompt },
  ]
  const contents = [{ role: 'user', parts }]
  const out: unknown[] = []
  for (const modalities of [['TEXT', 'IMAGE'], ['IMAGE']]) {
    if (aspect) out.push({ contents, generationConfig: { responseModalities: modalities, imageConfig: { aspectRatio: aspect } } })
    out.push({ contents, generationConfig: { responseModalities: modalities } })
  }
  return out
}

export async function generate(o: GenOpts): Promise<FoundImage> {
  const key = o.key ?? apiKey()
  const base = o.base ?? apiBase()
  const model = o.model || modelId()
  if (!key) throw new AiError('No key saved yet.', 0)
  if (!model) throw new AiError('No model chosen yet.', 0)
  const prompt = o.prompt.trim()
  if (!prompt) throw new AiError('Say what to draw.', 0)

  /* What the listing said when this model was picked, if it was picked from
   * the list; otherwise the name is all there is to go on. */
  const method = o.method || modelMethod() || methodFor(undefined, model)
  const refs = o.refs || []
  /* Imagen answers to `predict`, and how it takes a picture to work from is
   * not in the discovery document — `instances` is typed as `any` there, so
   * there is nothing to build a request from but memory, and a request built
   * from memory is a request that fails in a way nobody can debug. Said
   * plainly instead. */
  if (refs.length && method === 'predict') {
    throw new AiError(
      'That model cannot be given a picture to work from. Pick a Gemini image model in settings, or take the pictures off.',
      0
    )
  }
  const url = endpoint(base, model, method)
  const bodies = bodiesFor(method, prompt, o.aspect || '', refs)
  const wait = withTimeout(o.signal)

  let last: AiError | null = null
  for (const body of bodies) {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(body),
      signal: wait.signal,
    }).catch((e) => {
      if (wait.timedOut()) {
        throw new AiError('That took too long — the model never answered. Try again, or pick another one.', 0)
      }
      if ((e as Error)?.name === 'AbortError') throw e
      throw new AiError('Could not reach the API. Check the connection, or the address in settings.', 0)
    })

    if (!res.ok) {
      const msg = await readError(res)
      last = new AiError(friendly(res.status, msg), res.status)
      /* Only a complaint about the shape of the request is worth asking again
       * with a different shape. A refused key or an exhausted quota says the
       * same thing four times over. */
      if (res.status === 400 && bodies.indexOf(body) < bodies.length - 1) continue
      throw last
    }

    const json = await res.json().catch(() => ({}))
    const img = findImage(json)
    if (img) return img
    last = new AiError(explainNoImage(json), 0)
    /* A well-formed request that came back without a picture will not be
     * fixed by dropping fields from it. */
    throw last
  }
  throw last || new AiError('No picture came back.', 0)
}
