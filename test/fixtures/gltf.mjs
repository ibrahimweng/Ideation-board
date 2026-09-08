/* A model, written by hand.
 *
 * A checked-in binary is a thing nobody can change and nobody can read. This
 * is a hundred lines of a very well documented format and it produces a real
 * glTF that a real loader parses — which is the only way to know the card is
 * reading a model rather than a file that happens to be named like one.
 *
 * The shape is chosen so a render can be asserted on. Two boxes rather than
 * one, in two materials with two different colours and two different names, so
 * a test can check that the materials were read, that they came out in the
 * right order, and that handing a picture to one of them changes that one and
 * not the other. And they are side by side rather than stacked, so turning the
 * camera changes which is in front — the cheapest thing to assert about a
 * camera that actually moved.
 *
 * Written as .gltf with its buffer inline as a data URI rather than as .glb,
 * because a JSON file with one base64 string in it can be read by a person and
 * a binary container cannot.
 */

/* ---------------------------------------------------------------------------
 * One box, as vertices and indices.
 * ------------------------------------------------------------------------- */

/* Eight corners, twelve triangles. Positions only: no normals, so the loader
 * computes flat ones, which is what a box wants anyway. */
function box(cx, cy, cz, r) {
  const p = []
  for (const x of [-r, r]) for (const y of [-r, r]) for (const z of [-r, r]) p.push(cx + x, cy + y, cz + z)
  /* Corner order above is x-major, so the index of (x,y,z) is x*4 + y*2 + z. */
  const at = (x, y, z) => x * 4 + y * 2 + z
  const quad = (a, b, c, d) => [a, b, c, a, c, d]
  const idx = [
    ...quad(at(0, 0, 0), at(0, 1, 0), at(0, 1, 1), at(0, 0, 1)),
    ...quad(at(1, 0, 0), at(1, 0, 1), at(1, 1, 1), at(1, 1, 0)),
    ...quad(at(0, 0, 0), at(0, 0, 1), at(1, 0, 1), at(1, 0, 0)),
    ...quad(at(0, 1, 0), at(1, 1, 0), at(1, 1, 1), at(0, 1, 1)),
    ...quad(at(0, 0, 0), at(1, 0, 0), at(1, 1, 0), at(0, 1, 0)),
    ...quad(at(0, 0, 1), at(0, 1, 1), at(1, 1, 1), at(1, 0, 1)),
  ]
  /* One UV a corner. Crude, and enough: what matters is that the mesh has a UV
     set at all, because a mesh with none cannot wear a picture and the card is
     supposed to say so. */
  const uv = []
  for (let i = 0; i < 8; i++) uv.push((i & 1) ? 1 : 0, (i & 2) ? 1 : 0)
  return { pos: p, idx, uv }
}

const f32 = (list) => {
  const b = new Uint8Array(new Float32Array(list).buffer)
  return b
}
const u16 = (list) => {
  const b = new Uint8Array(new Uint16Array(list).buffer)
  return b
}

/* glTF wants every accessor's bytes aligned to its component size. */
const pad4 = (n) => (4 - (n % 4)) % 4

export function makeGltf({ left = [0.85, 0.2, 0.1], right = [0.15, 0.35, 0.8] } = {}) {
  const a = box(-1.1, 0, 0, 0.9)
  const b = box(1.1, 0, 0, 0.9)

  const parts = []
  const views = []
  let at = 0
  const put = (bytes, target) => {
    const gap = pad4(at)
    if (gap) { parts.push(new Uint8Array(gap)); at += gap }
    views.push({ buffer: 0, byteOffset: at, byteLength: bytes.length, ...(target ? { target } : {}) })
    parts.push(bytes)
    at += bytes.length
    return views.length - 1
  }

  const vPosA = put(f32(a.pos), 34962)
  const vUvA = put(f32(a.uv), 34962)
  const vIdxA = put(u16(a.idx), 34963)
  const vPosB = put(f32(b.pos), 34962)
  const vUvB = put(f32(b.uv), 34962)
  const vIdxB = put(u16(b.idx), 34963)

  const total = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(total)
  let o = 0
  for (const p of parts) { buf.set(p, o); o += p.length }

  const minMax = (pos) => {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k])
        max[k] = Math.max(max[k], pos[i + k])
      }
    }
    return { min, max }
  }
  const mmA = minMax(a.pos)
  const mmB = minMax(b.pos)

  const gltf = {
    asset: { version: '2.0', generator: 'ideation-board test fixture' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0, name: 'LeftBox' }, { mesh: 1, name: 'RightBox' }],
    meshes: [
      { name: 'Left', primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] },
      { name: 'Right', primitives: [{ attributes: { POSITION: 3, TEXCOORD_0: 4 }, indices: 5, material: 1 }] },
    ],
    materials: [
      { name: 'Shell', pbrMetallicRoughness: { baseColorFactor: [...left, 1], metallicFactor: 0.1, roughnessFactor: 0.6 } },
      { name: 'Trim', pbrMetallicRoughness: { baseColorFactor: [...right, 1], metallicFactor: 0.1, roughnessFactor: 0.6 } },
    ],
    accessors: [
      { bufferView: vPosA, componentType: 5126, count: 8, type: 'VEC3', min: mmA.min, max: mmA.max },
      { bufferView: vUvA, componentType: 5126, count: 8, type: 'VEC2' },
      { bufferView: vIdxA, componentType: 5123, count: a.idx.length, type: 'SCALAR' },
      { bufferView: vPosB, componentType: 5126, count: 8, type: 'VEC3', min: mmB.min, max: mmB.max },
      { bufferView: vUvB, componentType: 5126, count: 8, type: 'VEC2' },
      { bufferView: vIdxB, componentType: 5123, count: b.idx.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: buf.length, uri: `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}` }],
  }

  return new TextEncoder().encode(JSON.stringify(gltf))
}
