/* ---------------------------------------------------------------------------
 * Pictures that move.
 *
 * A GIF on the board plays, because it is an <img> and the browser plays it.
 * The moment an effect goes on it, the card becomes a canvas fed by the
 * renderer — and the renderer was handed one still, so the picture stopped.
 *
 * The obvious fix does not work, and it is worth writing down why so nobody
 * tries it again. `drawImage` and `createImageBitmap` on an animating <img>
 * both hand back the first frame, whether or not the element is in the
 * document and whether or not it is visible. The animation lives where a
 * canvas readback cannot reach it. Measured, not assumed.
 *
 * So the frames are decoded properly, with WebCodecs. `ImageDecoder` gives a
 * frame count, each frame as something the pipeline can already swallow, and
 * each frame's own duration — which matters, because a GIF is free to hold one
 * frame for a second and flick through the next four in a tenth of that.
 *
 * Where there is no ImageDecoder there is no animation: the card falls back to
 * the still it shows today, which is exactly what it did before any of this.
 * ------------------------------------------------------------------------- */

/* Not in the DOM lib yet. Only the parts used here are described. */
interface DecodedFrame {
  image: VideoFrameLike
}
interface VideoFrameLike {
  readonly duration: number | null
  readonly displayWidth: number
  readonly displayHeight: number
  close(): void
}
interface TrackLike {
  readonly animated: boolean
  readonly frameCount: number
  readonly repetitionCount: number
}
interface DecoderLike {
  readonly tracks: { ready: Promise<void>; selectedTrack: TrackLike | null }
  readonly completed: Promise<void>
  decode(o: { frameIndex: number }): Promise<DecodedFrame>
  close(): void
}
type DecoderCtor = {
  new (o: { data: ArrayBuffer | Uint8Array; type: string }): DecoderLike
  isTypeSupported(type: string): Promise<boolean>
}

const Decoder = (globalThis as { ImageDecoder?: DecoderCtor }).ImageDecoder

/* WebCodecs is only exposed on a secure origin, which every real deployment of
 * this is, and http://localhost counts. */
export const canDecodeFrames = () => !!Decoder

/* Which types are worth asking about at all. Opening a decoder for every JPEG
 * in a folder of two hundred photographs to be told what the type already said
 * is work for nothing. */
const MOVES = /^image\/(gif|webp|apng|avif|png)$/i
export const mightMove = (mime: string) => MOVES.test(mime || '')

async function open(blob: Blob): Promise<DecoderLike | null> {
  if (!Decoder || !mightMove(blob.type)) return null
  try {
    if (!(await Decoder.isTypeSupported(blob.type))) return null
    const dec = new Decoder({ data: new Uint8Array(await blob.arrayBuffer()), type: blob.type })
    await dec.tracks.ready
    return dec
  } catch {
    return null
  }
}

/* Does this file actually move? A GIF of one frame is a picture, and a PNG is
 * usually a picture, so the type is a question rather than an answer. */
export async function isAnimated(blob: Blob): Promise<boolean> {
  const dec = await open(blob)
  if (!dec) return false
  try {
    const t = dec.tracks.selectedTrack
    return !!t && t.animated && t.frameCount > 1
  } catch {
    return false
  } finally {
    try {
      dec.close()
    } catch {
      /* Already gone. */
    }
  }
}

export interface Reel {
  count: number
  /* One frame, and how long it is meant to be held. The caller closes it. */
  at(i: number): Promise<{ image: VideoFrameLike; ms: number } | null>
  close(): void
}

/* The frames of one moving picture, decoded as they are asked for.
 *
 * Not all at once: a long GIF at any size is a great deal of memory to hold
 * for a card that may be off screen, and the pump asks for one at a time
 * anyway. */
export async function openReel(blob: Blob): Promise<Reel | null> {
  const dec = await open(blob)
  if (!dec) return null
  const track = dec.tracks.selectedTrack
  if (!track || !track.animated || track.frameCount < 2) {
    try {
      dec.close()
    } catch {
      /* Already gone. */
    }
    return null
  }
  let shut = false
  return {
    count: track.frameCount,
    async at(i: number) {
      if (shut) return null
      try {
        const { image } = await dec.decode({ frameIndex: i % track.frameCount })
        /* Duration is in microseconds, and is allowed to be missing. A GIF
         * that says zero means "as fast as you can", which every viewer since
         * 1995 has read as a tenth of a second instead. */
        const us = image.duration ?? 0
        const ms = us > 0 ? us / 1000 : 100
        return { image, ms: Math.max(20, ms) }
      } catch {
        return null
      }
    },
    close() {
      shut = true
      try {
        dec.close()
      } catch {
        /* Already gone. */
      }
    },
  }
}
