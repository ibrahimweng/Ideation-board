import { describe, expect, it } from 'vitest'
import {
  bareId, bodiesFor, explainNoImage, findImage, imageModels, methodFor, sniffMime, type AiModel,
} from '../../src/ai/gemini'

/* Reading a reply from an API whose shapes are not ours to fix.
 *
 * The bytes of a generated picture arrive at a different depth under a
 * different name depending on which family of model answered, and the names
 * have moved before. So nothing here walks a path: an image is recognised by
 * being an image. These tests hold that line, and hold the far more dangerous
 * one underneath it — that a base64 field which is *not* a picture must never
 * be mistaken for one. */

/* A one pixel PNG, and a real JPEG header. Short enough to read, long enough
 * to clear the minimum. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

describe('finding the picture', () => {
  it('reads the shape generateContent answers with', () => {
    const reply = {
      candidates: [{ content: { parts: [{ text: 'Here you go' }, { inlineData: { mimeType: 'image/png', data: PNG } }] } }],
    }
    expect(findImage(reply)).toEqual({ mime: 'image/png', data: PNG })
  })

  it('reads the shape predict answers with', () => {
    const reply = { predictions: [{ mimeType: 'image/jpeg', bytesBase64Encoded: JPEG }] }
    expect(findImage(reply)).toEqual({ mime: 'image/jpeg', data: JPEG })
  })

  it('finds one under a name nobody has used yet', () => {
    /* The point of searching rather than indexing: a field renamed next year
     * still works, because the bytes still start with the same eight. */
    const reply = { result: { outputs: [{ picture_bytes_v2: PNG }] } }
    expect(findImage(reply)).toEqual({ mime: 'image/png', data: PNG })
  })

  it('prefers a declared image to one it had to sniff', () => {
    const reply = {
      a: { something: JPEG },
      b: { mimeType: 'image/png', data: PNG },
    }
    /* Both are real pictures. The declared one is the answer, because a reply
     * that says which field is the picture is telling the truth about itself
     * and should not be second-guessed by a scan. */
    expect(findImage(reply)?.mime).toBe('image/png')
  })

  it('is not fooled by a thought signature', () => {
    /* This is the trap. `thoughtSignature` is base64, it is long, and it sits
     * in a part right beside the text — exactly where a naive scan looks.
     * Turning it into a Blob would produce a card holding 400 bytes of
     * nothing that no decoder can open. */
    const reply = {
      candidates: [{ content: { parts: [{ text: 'no', thoughtSignature: 'Cq4BAdHtim9K'.repeat(12) }] } }],
    }
    expect(findImage(reply)).toBeNull()
  })

  it('is not fooled by any other long base64 that is not a picture', () => {
    const reply = { usageMetadata: { trace: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='.repeat(4) } }
    expect(findImage(reply)).toBeNull()
  })

  it('will not take a short string, whatever it is called', () => {
    expect(findImage({ predictions: [{ bytesBase64Encoded: 'iVBORw0KGgo=' }] })).toBeNull()
  })

  it('will not take prose that happens to sit under an image mime type', () => {
    /* Base64 has no spaces in it. A sentence declared as a picture is a bug
     * in whatever wrote the reply, not a picture. */
    const reply = { inlineData: { mimeType: 'image/png', data: 'this is not a picture at all, it is a sentence about one' } }
    expect(findImage(reply)).toBeNull()
  })

  it('does not fall into a reply that refers to itself', () => {
    const loop: Record<string, unknown> = { candidates: [] }
    loop.self = loop
    expect(() => findImage(loop)).not.toThrow()
  })

  it('has nothing to say about an empty reply', () => {
    expect(findImage({})).toBeNull()
    expect(findImage(null)).toBeNull()
  })
})

describe('what a file says it is', () => {
  it('knows the four that matter', () => {
    expect(sniffMime(PNG)).toBe('image/png')
    expect(sniffMime(JPEG)).toBe('image/jpeg')
    expect(sniffMime('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')).toBe('image/gif')
    expect(sniffMime('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA')).toBe('image/webp')
  })

  it('says nothing about something that is not a picture', () => {
    expect(sniffMime('QUJDREVGRw==')).toBe('')
  })
})

describe('saying why nothing came back', () => {
  it('repeats the model back when it answered in words', () => {
    const reply = { candidates: [{ content: { parts: [{ text: 'I cannot generate images.' }] }, finishReason: 'STOP' }] }
    expect(explainNoImage(reply)).toContain('I cannot generate images.')
  })

  it('says when the prompt itself was refused', () => {
    expect(explainNoImage({ promptFeedback: { blockReason: 'SAFETY' } })).toContain('safety')
  })

  it('says when the picture was refused rather than the prompt', () => {
    expect(explainNoImage({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] })).toContain('refused')
  })

  it('falls back to something a person can act on', () => {
    expect(explainNoImage({})).toMatch(/settings/)
  })
})

describe('which method a model answers to', () => {
  const model = (id: string, methods: string[]): AiModel => ({ id, name: id, description: '', methods })

  it('takes the listing at its word', () => {
    expect(methodFor(model('x', ['predict']), 'x')).toBe('predict')
    expect(methodFor(model('x', ['generateContent']), 'x')).toBe('generateContent')
  })

  it('guesses from the name only when there is no listing', () => {
    expect(methodFor(undefined, 'imagen-4.0-generate-001')).toBe('predict')
    expect(methodFor(undefined, 'gemini-3-pro-image')).toBe('generateContent')
  })

  it('drops "models/" wherever it appears', () => {
    expect(bareId('models/gemini-x')).toBe('gemini-x')
    expect(bareId('gemini-x')).toBe('gemini-x')
  })
})

describe('which models to offer', () => {
  const m = (id: string, methods: string[], description = ''): AiModel => ({ id, name: id, description, methods })

  it('always offers one that answers to predict', () => {
    const out = imageModels([m('imagen-4.0-generate-001', ['predict'])])
    expect(out.map((x) => x.id)).toEqual(['imagen-4.0-generate-001'])
  })

  it('leaves out a model that only writes', () => {
    const out = imageModels([m('gemini-2.5-flash', ['generateContent'], 'Fast text model'), m('text-embedding-004', ['embedContent'])])
    expect(out).toEqual([])
  })

  it('keeps one that says it makes pictures', () => {
    const out = imageModels([m('gemini-3-pro-image-preview', ['generateContent'], 'Generates images')])
    expect(out).toHaveLength(1)
  })

  it('puts a generator ahead of an editor', () => {
    const out = imageModels([
      m('imagen-3.0-capability-001', ['predict']),
      m('imagen-4.0-generate-001', ['predict']),
    ])
    expect(out[0].id).toBe('imagen-4.0-generate-001')
  })
})

describe('the requests to try', () => {
  it('asks for the aspect ratio first and gives it up second', () => {
    const bodies = bodiesFor('predict', 'a pot', '16:9') as any[]
    expect(bodies[0].parameters.aspectRatio).toBe('16:9')
    expect(bodies[1].parameters.aspectRatio).toBeUndefined()
    expect(bodies[0].instances[0].prompt).toBe('a pot')
  })

  it('does not ask twice when there was no ratio to give up', () => {
    expect(bodiesFor('predict', 'a pot', '')).toHaveLength(1)
  })

  it('steps down through the ways a model may want to be asked', () => {
    const bodies = bodiesFor('generateContent', 'a pot', '1:1') as any[]
    /* Both modality combinations, each with and without the image config,
     * because neither is knowable from the listing and being wrong about
     * either is a 400 rather than a picture. */
    expect(bodies).toHaveLength(4)
    expect(bodies[0].generationConfig.responseModalities).toEqual(['TEXT', 'IMAGE'])
    expect(bodies[0].generationConfig.imageConfig.aspectRatio).toBe('1:1')
    expect(bodies[1].generationConfig.imageConfig).toBeUndefined()
    expect(bodies[3].generationConfig.responseModalities).toEqual(['IMAGE'])
    expect(bodies[0].contents[0].parts[0].text).toBe('a pot')
  })

  it('does not try the same thing twice with no ratio asked for', () => {
    expect(bodiesFor('generateContent', 'a pot', '')).toHaveLength(2)
  })
})
