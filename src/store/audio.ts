/* ---------------------------------------------------------------------------
 * What a sound looks like.
 *
 * An audio card used to be the browser's own grey player bar with a filename
 * over it. It worked, and it was the one thing on the board that looked like a
 * web page from 2010 rather than like part of the app — and worse, it showed
 * nothing at all about the sound. A board of eight tracks was eight identical
 * grey bars.
 *
 * So a sound gets a shape. The file is decoded once when it arrives, reduced to
 * a couple of hundred peaks, and those are kept on the card. That is a few
 * hundred bytes rather than a picture, it draws crisply at any size because it
 * is drawn rather than scaled, and it costs nothing to redraw while the track
 * plays.
 *
 * The artwork inside the file, where there is any, is pulled out and kept as a
 * picture. A track chosen as a reference usually has a cover, and a cover is
 * the thing that makes one card tell itself apart from another across a board.
 * ------------------------------------------------------------------------- */

/* How many peaks a waveform is drawn from.
 *
 * A card is a few hundred units across, so this is roughly two units per peak:
 * fine enough that the shape of a track reads, coarse enough that the numbers
 * are a few hundred bytes on the board record rather than a few thousand. */
const PEAKS = 160

/* Peaks are kept as whole numbers from nothing to a hundred. Floats would be
 * seventeen characters each in the saved board for precision that is a
 * fraction of one screen pixel. */
const SCALE = 100

export interface Sound {
  /* One per bucket, 0 to 100, the loudest thing in that slice of the track. */
  peaks: number[]
  secs: number
  /* The cover inside the file, where it has one. */
  art: Blob | null
}

/* ---------------------------------------------------------------------------
 * The cover, out of an ID3 tag.
 *
 * Only mp3, deliberately. It is the format people actually hand each other
 * sound references in, the tag is well defined and the parser is fifty lines.
 * Everything else gets its waveform and no cover, which is a card that is a
 * little plainer rather than a card that is broken.
 * ------------------------------------------------------------------------- */

/* ID3 sizes are stored seven bits to the byte, so that no length can ever
 * contain the eleven set bits that mark the start of an audio frame. */
const syncsafe = (v: DataView, at: number) =>
  (v.getUint8(at) << 21) | (v.getUint8(at + 1) << 14) | (v.getUint8(at + 2) << 7) | v.getUint8(at + 3)

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes)

/* Exported for its own test. The parsing is the fiddly part of this file and
 * it is pure, so it is worth checking directly rather than through a decode
 * that needs a browser. */
export function coverFromId3(buf: ArrayBuffer): Blob | null {
  const v = new DataView(buf)
  const u = new Uint8Array(buf)
  if (u.length < 10 || latin1(u.subarray(0, 3)) !== 'ID3') return null

  const major = v.getUint8(3)
  /* v2.2 uses three character frame names and a different picture frame. Rare
   * enough now to be worth leaving alone rather than half supporting. */
  if (major < 3) return null
  const tagEnd = Math.min(u.length, 10 + syncsafe(v, 6))

  let at = 10
  /* An extended header, whose own length is the first four bytes of it. */
  if (v.getUint8(5) & 0x40) at += major === 4 ? syncsafe(v, at) : v.getUint32(at) + 4

  while (at + 10 <= tagEnd) {
    const id = latin1(u.subarray(at, at + 4))
    /* Padding: the tag is over even though the space it was given is not. */
    if (id === '\0\0\0\0' || !/^[A-Z0-9]{4}$/.test(id)) break
    /* v2.4 made frame sizes syncsafe too. v2.3 left them as plain integers,
     * and reading one as the other is how a picture ends up truncated. */
    const size = major === 4 ? syncsafe(v, at + 4) : v.getUint32(at + 4)
    const body = at + 10
    if (size <= 0 || body + size > tagEnd) break

    if (id === 'APIC') {
      const enc = v.getUint8(body)
      let p = body + 1
      /* The mime type, always latin1 whatever the text encoding says. */
      const mimeStart = p
      while (p < body + size && u[p] !== 0) p++
      const mime = latin1(u.subarray(mimeStart, p)) || 'image/jpeg'
      p++
      /* The picture type: 3 is the front cover, 0 is "other". Anything else is
       * a back cover, a band photograph, a leaflet — worth skipping rather
       * than showing in place of the cover. */
      const kind = u[p]
      p++
      /* The description, terminated by one null in latin1 or two in UTF-16. */
      if (enc === 1 || enc === 2) {
        while (p + 1 < body + size && !(u[p] === 0 && u[p + 1] === 0)) p += 2
        p += 2
      } else {
        while (p < body + size && u[p] !== 0) p++
        p++
      }
      if ((kind === 3 || kind === 0) && p < body + size) {
        const bytes = u.slice(p, body + size)
        if (bytes.length > 100) {
          return new Blob([bytes], { type: /^image\//.test(mime) ? mime : 'image/jpeg' })
        }
      }
    }
    at = body + size
  }
  return null
}

/* ---------------------------------------------------------------------------
 * The waveform.
 * ------------------------------------------------------------------------- */

/* Exported because a treated sound has to be drawn on the same scale as the
 * one it was made from. Two peak functions is two waveforms for one card: the
 * card would visibly change shape when a treatment was taken off and put back,
 * which is a redraw pretending to be an edit. */
export function peaksFrom(audio: AudioBuffer, buckets = PEAKS): number[] {
  const n = audio.length
  if (!n) return []
  /* Both channels, because a track mixed hard to one side would otherwise
   * come out looking like silence for half of it. */
  const chans: Float32Array[] = []
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) chans.push(audio.getChannelData(c))

  const out: number[] = []
  const per = n / buckets
  let loudest = 0
  const raw: number[] = []
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per)
    const to = Math.min(n, Math.floor((b + 1) * per))
    let peak = 0
    /* Every sample of a long track is more reading than the shape needs, so
     * long buckets are sampled rather than walked. The peak of a few hundred
     * samples is the peak of the bucket to within a pixel. */
    const step = Math.max(1, Math.floor((to - from) / 400))
    for (const data of chans) {
      for (let i = from; i < to; i += step) {
        const a = data[i] < 0 ? -data[i] : data[i]
        if (a > peak) peak = a
      }
    }
    raw.push(peak)
    if (peak > loudest) loudest = peak
  }

  /* Normalised to the loudest moment in the track, so a quietly mastered
   * recording is a waveform rather than a flat line. */
  const norm = loudest > 0 ? SCALE / loudest : 0
  for (const p of raw) out.push(Math.round(p * norm))
  return out
}

/* Everything worth knowing about a sound, read once when it arrives.
 *
 * Returns null rather than throwing on a file this browser cannot decode. The
 * card then has a name and a player and no waveform, which is where audio
 * cards were before this existed. */
export async function readSound(file: Blob): Promise<Sound | null> {
  try {
    const buf = await file.arrayBuffer()
    /* The cover first, and from its own copy of the bytes: decodeAudioData is
     * allowed to detach the buffer it is given, and reading a tag out of a
     * detached buffer afterwards gets nothing. */
    const art = coverFromId3(buf.slice(0))

    /* Offline, so that nothing has to be resumed after a gesture and nothing
     * can make a sound. One channel at one frame is enough of a context to
     * decode through; the rate is ignored for decoding. */
    const Ctx =
      (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    if (!Ctx) return art ? { peaks: [], secs: 0, art } : null
    const ctx = new Ctx(1, 1, 44100)
    const audio = await ctx.decodeAudioData(buf)
    return { peaks: peaksFrom(audio), secs: audio.duration, art }
  } catch {
    return null
  }
}

/* Minutes and seconds, which is the only way anybody reads a track length.
 * Exported because the card and its transport both want it. */
export function clock(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '0:00'
  const whole = Math.floor(secs)
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/* The waveform as one SVG path.
 *
 * A bar per peak, as a filled shape rather than a stroked line. A stroke would
 * have to choose between scaling with the card — which scales it by different
 * amounts in each direction, because the box is a hundred and sixty wide and
 * one tall — and not scaling at all, which leaves a hairline. A filled bar has
 * a width in the same units as everything else and comes out right at any size.
 *
 * One path rather than a hundred and sixty rects: one node in the document,
 * and the browser draws it in one go. */
export function wavePath(peaks: number[], min = 0.05): string {
  if (!peaks.length) return ''
  /* Six tenths of each slot, leaving four for the gap between bars. */
  const bar = 0.6
  const pad = (1 - bar) / 2
  const out: string[] = []
  for (let i = 0; i < peaks.length; i++) {
    /* A floor, so silence is a line rather than a gap: a track that opens
       quietly should still look like a track from the first bar. */
    const h = Math.max(min, (peaks[i] || 0) / SCALE)
    const y0 = ((1 - h) / 2).toFixed(4)
    const y1 = ((1 + h) / 2).toFixed(4)
    const x0 = (i + pad).toFixed(2)
    const x1 = (i + pad + bar).toFixed(2)
    out.push(`M${x0} ${y0}H${x1}V${y1}H${x0}Z`)
  }
  return out.join('')
}
