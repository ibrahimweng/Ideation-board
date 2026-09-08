import type { Control, Params } from '../engine/types'

/* ---------------------------------------------------------------------------
 * Sound is for sound design.
 *
 * An audio card played and drew its own waveform, and that was all it did. On
 * a board where a photograph can be taken through sixty-four treatments and
 * varied twelve ways, a sound was the one medium you could only look at.
 *
 * So a sound gets the same shape a picture has: a chain of effects, rendered,
 * with the result kept beside the original. `media` is still the file that was
 * dropped and is never touched; `heard` is what the card plays and what the
 * waveform is drawn from. Take the chain off and the original is still there,
 * because it always was.
 *
 * ## Rendered rather than live
 *
 * The obvious build is a live graph — nodes between the element and the
 * speakers, changing as you move a slider. This renders instead, offline, into
 * a buffer that is saved.
 *
 * Three reasons, and they are the same three that made the picture side render
 * rather than filter. A card has to look the same next time the board is
 * opened, and a live graph is gone the moment the tab is. The waveform has to
 * show the treatment — a gate that chops a track to pieces should look like a
 * track in pieces — and only a rendered buffer can be measured. And it has to
 * be exportable, because a treatment you cannot take out of the board is a
 * treatment you cannot use.
 *
 * Offline rendering runs far faster than the sound is long, so the cost is a
 * pause rather than a wait.
 *
 * ## Two kinds of effect
 *
 * Some of these are graphs — a filter, a delay, a reverb — and are rendered
 * through an OfflineAudioContext. Some are arithmetic on the samples — reverse,
 * trim, bit crush — and are done directly, because building a node graph to
 * play a buffer backwards is a long way round.
 *
 * Each step of the chain does whichever it is and hands on a buffer, so the
 * two kinds compose without knowing about each other.
 * ------------------------------------------------------------------------- */

const N = (k: string, label: string, min: number, max: number, step: number, def: number, unit?: string) =>
  ({ k, label, min, max, step, def, unit: unit || '' })
const E = (k: string, label: string, def: number, options: string[]) => ({ k, label, def, options })

export interface SoundSpec {
  id: string
  name: string
  group: string
  controls: Control[]
  /* What it says on the card's line when it is the only thing on. */
  about: string
}

/* Up to this many in a chain. The same four the picture side allows, and for
 * the same reason: past four nobody can hear which one is doing what. */
export const MAX_CHAIN = 4

export const SOUNDS: SoundSpec[] = [
  {
    id: 'speed', name: 'Speed', group: 'Tape', about: 'Played faster or slower, pitch and all',
    controls: [N('p0', 'Speed', 0.25, 4, 0.01, 1, '×')],
  },
  {
    id: 'reverse', name: 'Reverse', group: 'Tape', about: 'Backwards',
    controls: [N('p0', 'Amount', 0, 1, 0.01, 1)],
  },
  {
    id: 'trim', name: 'Trim', group: 'Tape', about: 'A piece of it',
    controls: [N('p0', 'Start', 0, 1, 0.005, 0), N('p1', 'End', 0, 1, 0.005, 1),
      N('p2', 'Fade', 0, 0.5, 0.005, 0.01, 's')],
  },
  {
    id: 'wobble', name: 'Wow and flutter', group: 'Tape', about: 'Tape that has been played too often',
    controls: [N('p0', 'Wow', 0, 1, 0.01, 0.35), N('p1', 'Flutter', 0, 1, 0.01, 0.25),
      N('p2', 'Rate', 0.1, 12, 0.1, 1.2, 'Hz')],
  },
  {
    id: 'filter', name: 'Filter', group: 'Tone', about: 'Only part of the spectrum',
    controls: [E('p0', 'Shape', 0, ['Low pass', 'High pass', 'Band pass', 'Notch']),
      N('p1', 'Cutoff', 40, 16000, 10, 1200, 'Hz'), N('p2', 'Resonance', 0.1, 20, 0.1, 1),
      N('p3', 'Sweep', -1, 1, 0.01, 0)],
  },
  {
    id: 'drive', name: 'Drive', group: 'Tone', about: 'Pushed into the red',
    controls: [N('p0', 'Drive', 0, 1, 0.01, 0.45), N('p1', 'Tone', 200, 12000, 10, 4000, 'Hz'),
      N('p2', 'Level', 0, 1.5, 0.01, 0.8)],
  },
  {
    id: 'crush', name: 'Bit crush', group: 'Tone', about: 'Fewer bits and a coarser clock',
    controls: [N('p0', 'Bits', 1, 16, 1, 6), N('p1', 'Rate', 0.01, 1, 0.005, 0.25),
      N('p2', 'Mix', 0, 1, 0.01, 1)],
  },
  {
    id: 'ring', name: 'Ring mod', group: 'Tone', about: 'Multiplied by a tone',
    controls: [N('p0', 'Frequency', 5, 3000, 1, 220, 'Hz'), N('p1', 'Mix', 0, 1, 0.01, 0.7),
      N('p2', 'Drift', 0, 1, 0.01, 0)],
  },
  {
    id: 'delay', name: 'Delay', group: 'Space', about: 'It comes back',
    controls: [N('p0', 'Time', 0.01, 1.5, 0.005, 0.28, 's'), N('p1', 'Feedback', 0, 0.95, 0.01, 0.4),
      N('p2', 'Mix', 0, 1, 0.01, 0.35), N('p3', 'Damping', 200, 16000, 10, 4000, 'Hz')],
  },
  {
    id: 'reverb', name: 'Reverb', group: 'Space', about: 'In a room',
    controls: [N('p0', 'Size', 0.05, 4, 0.05, 1.4, 's'), N('p1', 'Decay', 0.5, 8, 0.1, 2.5),
      N('p2', 'Mix', 0, 1, 0.01, 0.35), N('p3', 'Bright', 0, 1, 0.01, 0.5)],
  },
  {
    id: 'chorus', name: 'Chorus', group: 'Space', about: 'More than one of it',
    controls: [N('p0', 'Depth', 0, 1, 0.01, 0.5), N('p1', 'Rate', 0.05, 6, 0.05, 0.8, 'Hz'),
      N('p2', 'Mix', 0, 1, 0.01, 0.5)],
  },
  {
    id: 'tremolo', name: 'Tremolo', group: 'Shape', about: 'Turned up and down',
    controls: [N('p0', 'Rate', 0.1, 20, 0.1, 5, 'Hz'), N('p1', 'Depth', 0, 1, 0.01, 0.7),
      E('p2', 'Shape', 0, ['Smooth', 'Square'])],
  },
  {
    id: 'gate', name: 'Gate', group: 'Shape', about: 'Chopped into pieces',
    controls: [N('p0', 'Rate', 0.5, 24, 0.5, 8, 'Hz'), N('p1', 'Open', 0.02, 0.98, 0.01, 0.35),
      N('p2', 'Edge', 0.001, 0.1, 0.001, 0.006, 's')],
  },
]

export const SOUND_BY_ID: Record<string, SoundSpec> = SOUNDS.reduce(
  (m, s) => ((m[s.id] = s), m),
  {} as Record<string, SoundSpec>
)

export const soundGroups = (): { name: string; items: SoundSpec[] }[] => {
  const out: { name: string; items: SoundSpec[] }[] = []
  for (const s of SOUNDS) {
    const g = out.find((x) => x.name === s.group)
    if (g) g.items.push(s)
    else out.push({ name: s.group, items: [s] })
  }
  return out
}

export const soundDefaults = (id: string): Params => {
  const spec = SOUND_BY_ID[id]
  if (!spec) return {}
  const out: Params = {}
  for (const c of spec.controls) out[c.k] = c.def
  return out
}

export interface SoundLayer {
  fxid: string
  ep: Params | null
}

const num = (ep: Params | null, k: string, fallback: number): number => {
  const v = ep?.[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/* ---------------------------------------------------------------------------
 * Arithmetic on the samples.
 * ------------------------------------------------------------------------- */

type Ctx = { new (channels: number, length: number, rate: number): OfflineAudioContext }

const offline = (channels: number, length: number, rate: number): OfflineAudioContext =>
  new (window.OfflineAudioContext as unknown as Ctx)(channels, Math.max(1, Math.round(length)), rate)

function emptyLike(buf: AudioBuffer, frames: number): AudioBuffer {
  return offline(buf.numberOfChannels, Math.max(1, frames), buf.sampleRate).createBuffer(
    buf.numberOfChannels,
    Math.max(1, frames),
    buf.sampleRate
  )
}

function reverse(buf: AudioBuffer, amount: number): AudioBuffer {
  if (amount <= 0) return buf
  const out = emptyLike(buf, buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < src.length; i++) {
      const back = src[src.length - 1 - i]
      dst[i] = amount >= 1 ? back : src[i] * (1 - amount) + back * amount
    }
  }
  return out
}

function trim(buf: AudioBuffer, from: number, to: number, fade: number): AudioBuffer {
  const a = Math.max(0, Math.min(1, Math.min(from, to)))
  const b = Math.max(0, Math.min(1, Math.max(from, to)))
  const start = Math.floor(a * buf.length)
  const end = Math.max(start + 1, Math.floor(b * buf.length))
  const frames = end - start
  const out = emptyLike(buf, frames)
  const ramp = Math.max(1, Math.round(fade * buf.sampleRate))
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < frames; i++) {
      /* Cut anywhere and you cut through a waveform, which is a click. */
      const inAt = Math.min(1, i / ramp)
      const outAt = Math.min(1, (frames - 1 - i) / ramp)
      dst[i] = src[start + i] * inAt * outAt
    }
  }
  return out
}

function crush(buf: AudioBuffer, bits: number, rate: number, mix: number): AudioBuffer {
  const steps = Math.pow(2, Math.max(1, Math.round(bits))) - 1
  const hold = Math.max(1, Math.round(1 / Math.max(0.01, rate)))
  const out = emptyLike(buf, buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    let held = 0
    for (let i = 0; i < src.length; i++) {
      /* The clock is coarser as well as the numbers: a crush that only
         quantises the level sounds like distortion, and it is the held sample
         that gives it the aliasing whine everyone is actually after. */
      if (i % hold === 0) held = Math.round(((src[i] + 1) / 2) * steps) / steps * 2 - 1
      dst[i] = src[i] * (1 - mix) + held * mix
    }
  }
  return out
}

/* Speed is resampling: the same samples read at another rate, so the pitch
 * goes with it. That is what a tape does and it is what people mean. */
function speed(buf: AudioBuffer, by: number): AudioBuffer {
  const k = Math.max(0.05, by)
  if (Math.abs(k - 1) < 1e-4) return buf
  const frames = Math.max(1, Math.floor(buf.length / k))
  const out = emptyLike(buf, frames)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < frames; i++) {
      const at = i * k
      const j = Math.floor(at)
      const f = at - j
      const a = src[Math.min(src.length - 1, j)]
      const b = src[Math.min(src.length - 1, j + 1)]
      dst[i] = a + (b - a) * f
    }
  }
  return out
}

function ringMod(buf: AudioBuffer, hz: number, mix: number, drift: number): AudioBuffer {
  const out = emptyLike(buf, buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < src.length; i++) {
      const t = i / buf.sampleRate
      const f = hz * (1 + Math.sin(t * 0.7) * drift * 0.5)
      dst[i] = src[i] * (1 - mix) + src[i] * Math.sin(2 * Math.PI * f * t) * mix
    }
  }
  return out
}

function gate(buf: AudioBuffer, hz: number, open: number, edge: number): AudioBuffer {
  const out = emptyLike(buf, buf.length)
  const period = buf.sampleRate / Math.max(0.5, hz)
  const ramp = Math.max(1, edge * buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < src.length; i++) {
      const at = i % period
      const shut = period * open
      /* Ramped at both ends of the window: a gate that opens instantly is a
         click at every opening, which is a different effect. */
      const g = Math.min(Math.min(at, shut - at) / ramp, 1)
      dst[i] = src[i] * Math.max(0, Math.min(1, g))
    }
  }
  return out
}

function wobble(buf: AudioBuffer, wow: number, flutter: number, hz: number): AudioBuffer {
  const out = emptyLike(buf, buf.length)
  const depth = (wow * 0.004 + flutter * 0.0008) * buf.sampleRate
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < src.length; i++) {
      const t = i / buf.sampleRate
      /* Wow is the slow one — the reel being slightly out of round — and
         flutter is the fast one from the capstan. Both at once, because a tape
         has both and either alone sounds synthetic. */
      const off = Math.sin(2 * Math.PI * hz * t) * depth * (wow > 0 ? 1 : 0)
        + Math.sin(2 * Math.PI * hz * 11.7 * t) * depth * 0.25 * (flutter > 0 ? 1 : 0)
      const at = i + off
      const j = Math.floor(at)
      const f = at - j
      const a = src[Math.max(0, Math.min(src.length - 1, j))]
      const b = src[Math.max(0, Math.min(src.length - 1, j + 1))]
      dst[i] = a + (b - a) * f
    }
  }
  return out
}

/* ---------------------------------------------------------------------------
 * The ones that are a graph.
 * ------------------------------------------------------------------------- */

function impulse(ctx: OfflineAudioContext, secs: number, decay: number, bright: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * secs))
  const buf = ctx.createBuffer(2, frames, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let last = 0
    for (let i = 0; i < frames; i++) {
      const t = i / frames
      const noise = Math.random() * 2 - 1
      /* A room with hard walls keeps its top end; one full of curtains does
         not. That is a one-pole filter on the noise and nothing more. */
      last = last + (noise - last) * (0.08 + bright * 0.85)
      d[i] = last * Math.pow(1 - t, Math.max(0.5, decay))
    }
  }
  return buf
}

function curve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const out = new Float32Array(new ArrayBuffer(1024 * 4))
  const k = 1 + drive * 60
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    out[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return out
}

async function graph(buf: AudioBuffer, tail: number, build: (ctx: OfflineAudioContext, src: AudioBufferSourceNode) => AudioNode): Promise<AudioBuffer> {
  const frames = Math.max(1, Math.round(buf.length + tail * buf.sampleRate))
  const ctx = offline(buf.numberOfChannels, frames, buf.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buf
  build(ctx, src).connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

async function applyOne(buf: AudioBuffer, layer: SoundLayer): Promise<AudioBuffer> {
  const ep = layer.ep
  switch (layer.fxid) {
    case 'speed': return speed(buf, num(ep, 'p0', 1))
    case 'reverse': return reverse(buf, num(ep, 'p0', 1))
    case 'trim': return trim(buf, num(ep, 'p0', 0), num(ep, 'p1', 1), num(ep, 'p2', 0.01))
    case 'crush': return crush(buf, num(ep, 'p0', 6), num(ep, 'p1', 0.25), num(ep, 'p2', 1))
    case 'ring': return ringMod(buf, num(ep, 'p0', 220), num(ep, 'p1', 0.7), num(ep, 'p2', 0))
    case 'gate': return gate(buf, num(ep, 'p0', 8), num(ep, 'p1', 0.35), num(ep, 'p2', 0.006))
    case 'wobble': return wobble(buf, num(ep, 'p0', 0.35), num(ep, 'p1', 0.25), num(ep, 'p2', 1.2))

    case 'filter':
      return graph(buf, 0, (ctx, src) => {
        const f = ctx.createBiquadFilter()
        const kinds: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch']
        f.type = kinds[Math.max(0, Math.min(3, Math.round(num(ep, 'p0', 0))))]
        const hz = num(ep, 'p1', 1200)
        f.Q.value = num(ep, 'p2', 1)
        const sweep = num(ep, 'p3', 0)
        if (Math.abs(sweep) < 0.01) f.frequency.value = hz
        else {
          /* A sweep is the whole reason a filter is interesting on one clip
             rather than on a live instrument. */
          const to = Math.max(40, Math.min(18000, hz * Math.pow(8, sweep)))
          f.frequency.setValueAtTime(hz, 0)
          f.frequency.exponentialRampToValueAtTime(to, buf.duration)
        }
        src.connect(f)
        return f
      })

    case 'drive':
      return graph(buf, 0, (ctx, src) => {
        const shaper = ctx.createWaveShaper()
        shaper.curve = curve(num(ep, 'p0', 0.45))
        shaper.oversample = '4x'
        const tone = ctx.createBiquadFilter()
        tone.type = 'lowpass'
        tone.frequency.value = num(ep, 'p1', 4000)
        const level = ctx.createGain()
        level.gain.value = num(ep, 'p2', 0.8)
        src.connect(shaper).connect(tone).connect(level)
        return level
      })

    case 'delay': {
      const time = num(ep, 'p0', 0.28)
      const fb = num(ep, 'p1', 0.4)
      /* Long enough for the repeats to die away rather than being cut off
         mid-bounce, which is the giveaway of a delay rendered too short. */
      const tail = Math.min(12, time * (1 + fb * 14))
      return graph(buf, tail, (ctx, src) => {
        const d = ctx.createDelay(2)
        d.delayTime.value = Math.min(2, time)
        const back = ctx.createGain()
        back.gain.value = Math.min(0.95, fb)
        const damp = ctx.createBiquadFilter()
        damp.type = 'lowpass'
        damp.frequency.value = num(ep, 'p3', 4000)
        const wet = ctx.createGain()
        wet.gain.value = num(ep, 'p2', 0.35)
        const dry = ctx.createGain()
        dry.gain.value = 1
        const sum = ctx.createGain()
        src.connect(dry).connect(sum)
        src.connect(d)
        d.connect(damp).connect(back).connect(d)
        d.connect(wet).connect(sum)
        return sum
      })
    }

    case 'reverb': {
      const size = num(ep, 'p0', 1.4)
      return graph(buf, size + 0.4, (ctx, src) => {
        const conv = ctx.createConvolver()
        conv.buffer = impulse(ctx, size, num(ep, 'p1', 2.5), num(ep, 'p3', 0.5))
        const wet = ctx.createGain()
        wet.gain.value = num(ep, 'p2', 0.35)
        const dry = ctx.createGain()
        dry.gain.value = 1
        const sum = ctx.createGain()
        src.connect(dry).connect(sum)
        src.connect(conv).connect(wet).connect(sum)
        return sum
      })
    }

    case 'chorus':
      return graph(buf, 0.05, (ctx, src) => {
        const sum = ctx.createGain()
        const dry = ctx.createGain()
        dry.gain.value = 1 - num(ep, 'p2', 0.5) * 0.4
        src.connect(dry).connect(sum)
        /* Three voices at different rates. One is a vibrato; three is a
           chorus, and the difference is entirely that they disagree. */
        for (let v = 0; v < 3; v++) {
          const d = ctx.createDelay(0.1)
          d.delayTime.value = 0.012 + v * 0.007
          const lfo = ctx.createOscillator()
          lfo.frequency.value = num(ep, 'p1', 0.8) * (1 + v * 0.37)
          const amt = ctx.createGain()
          amt.gain.value = num(ep, 'p0', 0.5) * 0.006
          lfo.connect(amt).connect(d.delayTime)
          lfo.start()
          const g = ctx.createGain()
          g.gain.value = num(ep, 'p2', 0.5) / 3
          src.connect(d).connect(g).connect(sum)
        }
        return sum
      })

    case 'tremolo':
      return graph(buf, 0, (ctx, src) => {
        const g = ctx.createGain()
        const depth = num(ep, 'p1', 0.7)
        g.gain.value = 1 - depth / 2
        const lfo = ctx.createOscillator()
        lfo.type = num(ep, 'p2', 0) > 0.5 ? 'square' : 'sine'
        lfo.frequency.value = num(ep, 'p0', 5)
        const amt = ctx.createGain()
        amt.gain.value = depth / 2
        lfo.connect(amt).connect(g.gain)
        lfo.start()
        src.connect(g)
        return g
      })

    default:
      return buf
  }
}

/* The whole chain, in order. Returns the original untouched when there is
 * nothing on it, which is what makes taking every effect off the same thing as
 * never having put one on. */
export async function renderSound(buf: AudioBuffer, chain: SoundLayer[]): Promise<AudioBuffer> {
  let out = buf
  for (const layer of chain) {
    if (!layer.fxid || layer.fxid === 'none') continue
    out = await applyOne(out, layer)
  }
  return out
}

/* ---------------------------------------------------------------------------
 * Out, as a file.
 *
 * WAV rather than anything smaller: the browser can encode nothing else
 * without a library, it is the format every editor opens, and a treatment you
 * cannot take out of the board is a treatment you cannot use.
 * ------------------------------------------------------------------------- */

export function toWav(buf: AudioBuffer): Blob {
  const channels = Math.min(2, buf.numberOfChannels)
  const frames = buf.length
  const bytes = new Uint8Array(44 + frames * channels * 2)
  const v = new DataView(bytes.buffer)
  const tag = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) }

  tag(0, 'RIFF')
  v.setUint32(4, 36 + frames * channels * 2, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, channels, true)
  v.setUint32(24, buf.sampleRate, true)
  v.setUint32(28, buf.sampleRate * channels * 2, true)
  v.setUint16(32, channels * 2, true)
  v.setUint16(34, 16, true)
  tag(36, 'data')
  v.setUint32(40, frames * channels * 2, true)

  const data: Float32Array[] = []
  for (let c = 0; c < channels; c++) data.push(buf.getChannelData(c))
  let at = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]))
      v.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      at += 2
    }
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

/* ---------------------------------------------------------------------------
 * Out, as part of a page.
 *
 * A WAV is a hundred and seventy kilobytes a second, and an exported page
 * carries its contents inside itself as text — which adds a third again. A
 * twenty-second treatment would be seven megabytes of one HTML file, and the
 * point of that file is that it can be sent.
 *
 * Pictures already make this trade on the way out: the page carries a copy at
 * the size it is being looked at rather than the file it was made from. This
 * is the same trade for the ear. One channel at 22 kHz is a quarter of the
 * bytes, and it is what a laptop speaker was going to give you anyway.
 *
 * A file that arrived compressed is left alone by the caller, because nothing
 * here can encode an mp3 and an mp3 is already smaller than this.
 * ------------------------------------------------------------------------- */

export const PAGE_RATE = 22050

/* How much of a page may be sound.
 *
 * Two limits rather than one. The first is per sound: past about a minute a
 * single card would be most of the page, and a minute is long enough for
 * anything made by treating a moment. The second is the page: once that much
 * has gone in, the rest are named and placed and say why they are not
 * playable, which is the answer this had for every sound before.
 *
 * Both are measured before the text encoding, which adds a third on top. Six
 * megabytes of sound is an eight megabyte page — about what a dozen
 * photographs already cost. */
export const SOUND_MAX = 3 * 1024 * 1024
export const SOUND_BUDGET = 6 * 1024 * 1024

/* Seconds as a clock, for saying how long the one that would not fit was. */
export const clock = (secs: number): string => {
  const s = Math.max(0, Math.round(secs || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* Whether this one fits, and if not, what the card should say instead. The
 * reason is written for the person reading the page rather than for the person
 * who made it: they cannot do anything about it, so it says what is true about
 * the card rather than what went wrong. */
export function roomForSound(bytes: number, spent: number, secs: number): string | null {
  if (bytes > SOUND_MAX) return `${clock(secs)} is too long to carry in a page`
  if (spent + bytes > SOUND_BUDGET) return 'left out to keep the page small'
  return null
}

export async function forListening(blob: Blob, rate = PAGE_RATE): Promise<Blob | null> {
  try {
    /* Decoding resamples to the context it is decoded into, so the rate is
       chosen once, here, and the render below only has to fold the channels
       down. A length of one frame: this context is opened to decode, not to
       play. */
    const buf = await offline(1, 1, rate).decodeAudioData(await blob.arrayBuffer())
    const frames = Math.max(1, Math.round(buf.duration * rate))
    const ctx = offline(1, frames, rate)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start()
    return toWav(await ctx.startRendering())
  } catch {
    return null
  }
}
