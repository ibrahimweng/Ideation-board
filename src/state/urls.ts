/* ---------------------------------------------------------------------------
 * Turning a pasted URL into a card.
 *
 * A URL can mean four different things on this board:
 *
 *   a picture             ->  a real image card, effects and all
 *   a direct video file   ->  a real video card, effects and all
 *   a YouTube/Vimeo page  ->  an embedded player
 *   anything else         ->  a link card
 *
 * The picture is the one that matters most and was the one missing. Dragging a
 * photograph out of another browser tab is how anybody actually gathers
 * references, and the browser hands over an address rather than a file — so
 * without this the commonest gesture in the product produced a dead link card
 * and you had to save every picture to disk first.
 *
 * The split matters because of what the GPU is allowed to read. Running a
 * shader over a video means reading its pixels back out of the video element,
 * and a browser only permits that for a cross-origin file whose host sends
 * `Access-Control-Allow-Origin`. Without that header the canvas is tainted and
 * the read throws. A player in an iframe is stricter still: nothing outside
 * the frame can see its pixels by any means, so a YouTube video can never take
 * a shader no matter what its host sends.
 *
 * So we find out rather than guess. `probeVideo` loads the URL twice: once
 * asking for cross-origin access, once without. The first answer that arrives
 * tells us both that the URL really is a playable video and whether its pixels
 * are ours to read.
 * ------------------------------------------------------------------------- */

const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|ogg|mov)(?:$|[?#])/i
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:$|[?#])/i

/* Hosts that serve pictures from addresses with no extension on them, which is
 * most of the ones anybody drags from. Guessing by host is crude, but the
 * alternative — fetching every unknown URL to find out — is slower and noisier
 * than being wrong about a link card that can be deleted. */
const IMAGE_HOST =
  /(^|\.)(images\.unsplash\.com|images\.pexels\.com|i\.imgur\.com|pbs\.twimg\.com|i\.redd\.it|cdn\.dribbble\.com|live\.staticflickr\.com|substackcdn\.com|imagedelivery\.net|githubusercontent\.com)$/i

export type UrlCard =
  | { kind: 'image'; url: string; name: string }
  | { kind: 'video'; url: string; name: string }
  | { kind: 'embed'; url: string; embed: string; name: string }
  | { kind: 'link'; url: string; name: string }

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return 'link'
  }
}

/* `?t=90`, `?t=1m30s` and `#t=90` all mean start ninety seconds in. */
function startSeconds(u: URL): number {
  const raw = u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([\dhms]+)/i)?.[1] ?? '')
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Number(raw)
  const m = raw.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i)
  if (!m) return 0
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
}

export function youtubeEmbed(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '')
  let id = ''
  if (host === 'youtu.be') id = u.pathname.slice(1)
  else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v') || ''
    else if (u.pathname.startsWith('/embed/')) id = u.pathname.slice(7)
    else if (u.pathname.startsWith('/shorts/')) id = u.pathname.slice(8)
    else if (u.pathname.startsWith('/live/')) id = u.pathname.slice(6)
    else if (u.pathname.startsWith('/v/')) id = u.pathname.slice(3)
  }
  id = id.split('/')[0].split('?')[0]
  if (!/^[\w-]{6,24}$/.test(id)) return null
  const t = startSeconds(u)
  /* nocookie so a board full of embeds is not a board full of trackers. */
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${t ? `&start=${t}` : ''}`
}

export function vimeoEmbed(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '')
  let id = ''
  if (host === 'vimeo.com') id = u.pathname.slice(1).split('/')[0]
  else if (host === 'player.vimeo.com' && u.pathname.startsWith('/video/')) id = u.pathname.slice(7).split('/')[0]
  if (!/^\d{6,12}$/.test(id)) return null
  /* An unlisted video needs the hash from the second path segment. */
  const h = u.pathname.slice(1).split('/')[1]
  const q = /^[a-f\d]{6,16}$/i.test(h || '') ? `?h=${h}` : ''
  return `https://player.vimeo.com/video/${id}${q}`
}

/* What a URL looks like before anything has been loaded. Cheap and certain
 * enough to draw a card with straight away; `probeVideo` corrects it. */
export function classifyUrl(raw: string): UrlCard {
  const url = raw.trim()
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { kind: 'link', url, name: 'link' }
  }
  if (!/^https?:$/.test(u.protocol)) return { kind: 'link', url, name: hostOf(url) }

  const yt = youtubeEmbed(u)
  if (yt) return { kind: 'embed', url, embed: yt, name: 'YouTube' }
  const vi = vimeoEmbed(u)
  if (vi) return { kind: 'embed', url, embed: vi, name: 'Vimeo' }

  const last = decodeURIComponent(u.pathname.split('/').pop() || '')
  if (VIDEO_EXT.test(u.pathname) || VIDEO_EXT.test(url)) {
    return { kind: 'video', url, name: last || hostOf(url) }
  }
  if (IMAGE_EXT.test(u.pathname) || IMAGE_EXT.test(url) || IMAGE_HOST.test(u.hostname)) {
    return { kind: 'image', url, name: last || hostOf(url) }
  }
  return { kind: 'link', url, name: hostOf(url) }
}

export interface Probe {
  nw: number
  nh: number
  /* True when the browser let us fetch the file with cross-origin access, so
   * its pixels can be read back and put through a shader. */
  readable: boolean
}

function tryLoad(url: string, cors: boolean, timeout: number): Promise<{ nw: number; nh: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    if (cors) v.crossOrigin = 'anonymous'
    v.preload = 'metadata'
    v.muted = true
    let settled = false
    const finish = (r: { nw: number; nh: number } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      v.onloadedmetadata = null
      v.onerror = null
      /* Let go of the connection: a probe that is left holding a stream keeps
       * downloading long after we have the one number we wanted. */
      v.removeAttribute('src')
      v.load()
      resolve(r)
    }
    const timer = setTimeout(() => finish(null), timeout)
    v.onloadedmetadata = () => finish({ nw: v.videoWidth || 640, nh: v.videoHeight || 360 })
    v.onerror = () => finish(null)
    v.src = url
    v.load()
  })
}

/* Null means the URL is not a video this browser can play. */
export async function probeVideo(url: string, timeout = 9000): Promise<Probe | null> {
  const open = await tryLoad(url, true, timeout)
  if (open) return { ...open, readable: true }
  /* Asking for cross-origin access can itself be the reason a perfectly good
   * video refused to load, so a failure is not yet an answer. Ask again
   * without it: if it plays now, it plays but cannot be read. */
  const plain = await tryLoad(url, false, timeout)
  if (plain) return { ...plain, readable: false }
  return null
}

/* ---------------------------------------------------------------------------
 * Fetching a picture.
 *
 * Two outcomes worth having, and one worth admitting to.
 *
 * The bytes come back  ->  the picture is ours. It is stored like a dropped
 *                          file, works offline, survives the page it came
 *                          from being taken down, and can take a shader.
 * The fetch is refused ->  the host allows no cross-origin read. An <img> can
 *                          still show it, because showing is not reading, so
 *                          the card is a picture that cannot be shaded.
 * Nothing loads at all ->  it was never a picture. Back to a link card.
 * ------------------------------------------------------------------------- */

export interface Fetched {
  blob: Blob | null
  nw: number
  nh: number
}

/* Whether a browser can display it, and at what size. Says nothing about
 * whether the pixels can be read. */
export function probeImage(url: string, timeout = 9000): Promise<{ nw: number; nh: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const finish = (r: { nw: number; nh: number } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(r)
    }
    const timer = setTimeout(() => finish(null), timeout)
    img.onload = () => finish({ nw: img.naturalWidth || 0, nh: img.naturalHeight || 0 })
    img.onerror = () => finish(null)
    img.src = url
  })
}

export async function fetchImage(url: string, timeout = 12000): Promise<Fetched | null> {
  /* The bytes first: a picture we hold is worth more than one we point at. */
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(timeout) })
    if (res.ok) {
      const blob = await res.blob()
      if (/^image\//.test(blob.type) && blob.size > 0) {
        const size = await probeImage(URL.createObjectURL(blob), timeout)
        if (size) return { blob, nw: size.nw, nh: size.nh }
      }
    }
  } catch {
    /* Refused, or not reachable. An <img> may still manage it. */
  }
  const shown = await probeImage(url, timeout)
  return shown ? { blob: null, nw: shown.nw, nh: shown.nh } : null
}
