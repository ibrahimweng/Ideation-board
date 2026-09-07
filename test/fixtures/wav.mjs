/* A sound, written by hand.
 *
 * The suites need something to drop that a browser will really decode, and a
 * checked-in binary is a thing nobody can read or change. WAV is the format
 * worth writing by hand: the header is eleven fields and the samples are just
 * numbers, so this is fifty lines rather than an encoder.
 *
 * The clip is deliberately not a steady tone. It is loud, then quiet, then
 * loud again, so the waveform drawn from it has a shape that can be asserted
 * on — a test that only checks "there are some peaks" would pass just as well
 * against a flat line, which is the one thing a waveform must not be.
 */

/* Small on purpose. It travels into the browser as text, and a couple of
 * seconds is enough to have a shape and to seek about in. */
const RATE = 16000
const SECS = 2

/* Where the loud parts are, as a share of the whole. */
const LOUD = [
  [0.0, 0.22],
  [0.55, 0.78],
]

function envelope(t) {
  for (const [from, to] of LOUD) {
    if (t >= from && t < to) {
      /* Faded in and out at the edges, so the shape has slopes rather than
         cliffs and a peak taken from any one bucket is not a coin toss. */
      const into = (t - from) / (to - from)
      return Math.sin(into * Math.PI) * 0.9
    }
  }
  return 0.06
}

/* 16 bit mono PCM. Returns the bytes of a complete .wav file. */
export function makeWav({ rate = RATE, secs = SECS } = {}) {
  const frames = Math.floor(rate * secs)
  const bytes = new Uint8Array(44 + frames * 2)
  const v = new DataView(bytes.buffer)

  const tag = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) }

  tag(0, 'RIFF')
  v.setUint32(4, 36 + frames * 2, true)
  tag(8, 'WAVE')

  tag(12, 'fmt ')
  v.setUint32(16, 16, true)      /* the size of this chunk */
  v.setUint16(20, 1, true)       /* 1 is uncompressed PCM */
  v.setUint16(22, 1, true)       /* channels */
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) /* bytes per second */
  v.setUint16(32, 2, true)        /* bytes per frame */
  v.setUint16(34, 16, true)       /* bits per sample */

  tag(36, 'data')
  v.setUint32(40, frames * 2, true)

  /* A tone that slides upward, so the clip is audibly a thing rather than a
     buzz, under the loud and quiet envelope above. */
  for (let i = 0; i < frames; i++) {
    const t = i / frames
    const hz = 180 + t * 240
    const sample = Math.sin((2 * Math.PI * hz * i) / rate) * envelope(t)
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true)
  }
  return bytes
}

/* The same, as text, because that is what survives being handed to a page. */
export function wavBase64(opts) {
  return Buffer.from(makeWav(opts)).toString('base64')
}
