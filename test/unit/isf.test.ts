import { describe, expect, it } from 'vitest'
import { IsfError, fromISF, headerOf } from '../../src/engine/isf'

/* ISF is a GLSL fragment shader with a JSON blob at the top describing its
 * inputs, and it is how video people have shared effects since 2013. This
 * engine's own effects are already that shape — a list of controls and a
 * fragment function — so the distance between the two formats is a rename,
 * and this is the rename.
 *
 * What it has to get right is not the happy path. It is the refusals: a
 * shader that needs something the engine does not have has to say so, because
 * one that quietly drops a pass or an audio input compiles fine and draws the
 * wrong picture, and nobody would know which of thirty effects was lying.
 */

const shader = (header: string, body: string) => `/*{\n${header}\n}*/\n${body}`

const PLAIN = shader(
  `"DESCRIPTION": "Dims it",
   "CREDIT": "nobody",
   "CATEGORIES": ["Color"],
   "INPUTS": [
     { "NAME": "inputImage", "TYPE": "image" },
     { "NAME": "amount", "TYPE": "float", "LABEL": "Amount", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4 }
   ]`,
  `void main() {
     vec4 c = IMG_THIS_PIXEL(inputImage);
     gl_FragColor = vec4(c.rgb * amount, c.a);
   }`
)

describe('reading the header', () => {
  it('takes the JSON off the top', () => {
    const { header, body } = headerOf(PLAIN)
    expect(header.DESCRIPTION).toBe('Dims it')
    expect(header.INPUTS).toHaveLength(2)
    expect(body).toContain('void main')
  })

  /* A file whose first comment is a licence is not one this can read, and
     guessing which comment is the header is how the wrong thing gets parsed. */
  it('refuses a file that does not open with one', () => {
    expect(() => headerOf('// a licence\n/*{ "INPUTS": [] }*/\nvoid main(){}')).toThrow(IsfError)
  })

  it('and one whose header is not JSON', () => {
    expect(() => headerOf('/*{ nope }*/ void main(){}')).toThrow(IsfError)
  })
})

describe('translating a plain one', () => {
  const { spec, about } = fromISF(PLAIN, { id: 'dim', name: 'Dim', group: 'Map' })

  it('keeps what the shader said about itself', () => {
    expect(about.description).toBe('Dims it')
    expect(about.credit).toBe('nobody')
  })

  it('turns a float input into a slider in the first slot', () => {
    expect(spec.controls).toHaveLength(1)
    expect(spec.controls[0]).toMatchObject({ k: 'p0', label: 'Amount', min: 0, max: 1, def: 0.4 })
  })

  it('renames the input to the slot it was given', () => {
    expect(spec.frag).toContain('p0')
    expect(spec.frag).not.toMatch(/\bamount\b/)
  })

  it('turns the picture macros into this engine', () => {
    expect(spec.frag).toContain('T(uv)')
    expect(spec.frag).not.toContain('IMG_')
  })

  it('and main into the function the engine calls', () => {
    expect(spec.frag).toContain('vec4 fx(vec2 uv)')
    expect(spec.frag).toContain('return isf_out;')
    expect(spec.frag).not.toContain('gl_FragColor')
  })
})

describe('the inputs it maps', () => {
  it('a colour comes out as hex', () => {
    const { spec } = fromISF(
      shader(
        `"INPUTS": [{ "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.0, 1.0] }]`,
        'void main(){ gl_FragColor = vec4(tint, 1.0); }'
      ),
      { id: 'x', name: 'X', group: 'Map' }
    )
    expect(spec.controls[0]).toMatchObject({ k: 'c0', def: '#ff8000', color: true })
    expect(spec.frag).toContain('c0')
  })

  it('a menu comes out as the segmented control it is', () => {
    const { spec } = fromISF(
      shader(
        `"INPUTS": [{ "NAME": "mode", "TYPE": "long", "LABELS": ["Soft", "Hard"], "VALUES": [0, 1], "DEFAULT": 1 }]`,
        'void main(){ gl_FragColor = vec4(float(mode)); }'
      ),
      { id: 'x', name: 'X', group: 'Map' }
    )
    expect(spec.controls[0]).toMatchObject({ k: 'p0', options: ['Soft', 'Hard'], def: 1 })
  })

  /* ISF numbers a menu by its VALUES and this side numbers it by position, so
     a menu whose values are not its positions needs the numbers folding back
     in or the body compares against the wrong ones. */
  it('and keeps the numbers a menu was written against', () => {
    const { spec } = fromISF(
      shader(
        `"INPUTS": [{ "NAME": "mode", "TYPE": "long", "LABELS": ["A", "B"], "VALUES": [4, 9], "DEFAULT": 9 }]`,
        'void main(){ gl_FragColor = vec4(mode == 9 ? 1.0 : 0.0); }'
      ),
      { id: 'x', name: 'X', group: 'Map' }
    )
    expect(spec.controls[0]).toMatchObject({ def: 1 })
    expect(spec.frag).toContain('4.0')
    expect(spec.frag).toContain('9.0')
  })

  it('a point costs two sliders, because it is two numbers', () => {
    const { spec } = fromISF(
      shader(
        `"INPUTS": [{ "NAME": "at", "TYPE": "point2D", "DEFAULT": [0.25, 0.75] }]`,
        'void main(){ gl_FragColor = vec4(at, 0.0, 1.0); }'
      ),
      { id: 'x', name: 'X', group: 'Map' }
    )
    expect(spec.controls).toHaveLength(2)
    expect(spec.frag).toContain('vec2(p0, p1)')
  })

  /* A second image input is the card wired into this one, which is the thing
     the board learned to do just before this. */
  it('a second picture reads the card wired in', () => {
    const { spec } = fromISF(
      shader(
        `"INPUTS": [
           { "NAME": "inputImage", "TYPE": "image" },
           { "NAME": "other", "TYPE": "image" }
         ]`,
        'void main(){ gl_FragColor = IMG_NORM_PIXEL(other, isf_FragNormCoord) - IMG_THIS_PIXEL(inputImage); }'
      ),
      { id: 'x', name: 'X', group: 'Pair' }
    )
    expect(spec.frag).toContain('S(uv)')
    expect(spec.frag).toContain('T(uv)')
  })
})

describe('the words it swaps', () => {
  const { spec } = fromISF(
    shader(
      `"INPUTS": [{ "NAME": "inputImage", "TYPE": "image" }]`,
      `void main(){
         vec2 p = isf_FragNormCoord * RENDERSIZE;
         vec4 a = IMG_PIXEL(inputImage, p + vec2(1.0, 0.0));
         gl_FragColor = a * sin(TIME);
       }`
    ),
    { id: 'x', name: 'X', group: 'Map' }
  )

  it('coordinates and size', () => {
    expect(spec.frag).toContain('uv * uRes')
    expect(spec.frag).not.toContain('RENDERSIZE')
    expect(spec.frag).not.toContain('isf_FragNormCoord')
  })

  it('pixel coordinates are divided back into the range this engine reads in', () => {
    expect(spec.frag).toContain('/ uRes')
  })

  /* A board of photographs has no clock. A shader written to animate would be
     stuck on its first frame, so it gets a dial instead — which on a still
     picture is more use than the animation would have been. */
  it('and a clock becomes a dial you turn', () => {
    const time = spec.controls.find((c) => c.label === 'Time')
    expect(time).toBeTruthy()
    expect(spec.frag).not.toContain('TIME')
  })

  it('but only when the shader asked for one', () => {
    const { spec: s } = fromISF(PLAIN, { id: 'y', name: 'Y', group: 'Map' })
    expect(s.controls.find((c) => c.label === 'Time')).toBeUndefined()
  })
})

describe('what it refuses, and says why', () => {
  const refuse = (header: string, body = 'void main(){ gl_FragColor = vec4(1.0); }') =>
    () => fromISF(shader(header, body), { id: 'x', name: 'X', group: 'Map' })

  it('more than one pass', () => {
    expect(refuse(`"PASSES": [{}, {"TARGET": "buf"}]`)).toThrow(/one pass/)
  })

  it('an image it wants to load itself', () => {
    expect(refuse(`"IMPORTED": { "tex": { "PATH": "a.png" } }`)).toThrow(/nowhere to put/)
  })

  it('audio, which never reaches the renderer', () => {
    expect(refuse(`"INPUTS": [{ "NAME": "band", "TYPE": "audioFFT", "MAX": 16 }]`)).toThrow(/audio/)
  })

  it('a button, because a still picture has no moment for one', () => {
    expect(refuse(`"INPUTS": [{ "NAME": "go", "TYPE": "event" }]`)).toThrow(/moment/)
  })

  /* The slots are the slots. Refusing is the only honest answer: a translator
     that dropped the seventh number would give a control that does nothing. */
  it('more numbers than there are slots', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      `{ "NAME": "a${i}", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 }`
    ).join(',')
    expect(refuse(`"INPUTS": [${many}]`)).toThrow(/six/)
  })

  it('and more colours', () => {
    const many = Array.from({ length: 4 }, (_, i) =>
      `{ "NAME": "c${i}", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] }`
    ).join(',')
    expect(refuse(`"INPUTS": [${many}]`)).toThrow(/three/)
  })

  it('and a shader with no main at all', () => {
    expect(refuse(`"INPUTS": []`, 'float thing(){ return 1.0; }')).toThrow(/main/)
  })
})

describe('what it leaves alone', () => {
  it('helpers declared before main stay at the top level', () => {
    const { spec } = fromISF(
      shader(
        `"INPUTS": [{ "NAME": "inputImage", "TYPE": "image" }]`,
        `float half2(float v){ return v * 0.5; }
         void main(){ gl_FragColor = IMG_THIS_PIXEL(inputImage) * half2(1.0); }`
      ),
      { id: 'x', name: 'X', group: 'Map' }
    )
    expect(spec.frag.indexOf('float half2')).toBeLessThan(spec.frag.indexOf('vec4 fx'))
  })

  /* A name that is part of a longer one is a different name. */
  it('a name inside a longer one is not renamed', () => {
    const { spec } = fromISF(
      shader(
        `"INPUTS": [{ "NAME": "amt", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 }]`,
        'void main(){ float amtTotal = 2.0; gl_FragColor = vec4(amt * amtTotal); }'
      ),
      { id: 'x', name: 'X', group: 'Map' }
    )
    expect(spec.frag).toContain('amtTotal')
    expect(spec.frag).toContain('p0 * amtTotal')
  })
})
