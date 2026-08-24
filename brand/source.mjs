/* Pictures with structure in them, made without a single gradient.
 *
 * The demo boards used to be filled with linear gradients, which is the one
 * thing this app is least about — and the one thing that turns to a flat wash
 * the moment an effect is put on it. These are built from value noise instead:
 * ridges, drifts and grain, the sort of tonal structure a photograph has,
 * which is what gives an ASCII or halftone screen something to bite on.
 *
 *   node brand/source.mjs                 writes brand/src-*.png
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

export const SOURCE = `
/* Deterministic value noise: same seed, same picture, every time. */
function makeNoise(seed) {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const N = 256
  const g = new Float32Array(N * N)
  for (let i = 0; i < g.length; i++) g[i] = rnd()
  const at = (x, y) => g[((y & (N - 1)) * N + (x & (N - 1)))]
  const smooth = (t) => t * t * (3 - 2 * t)
  const val = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = smooth(x - xi), yf = smooth(y - yi)
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1)
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf
  }
  return (x, y, oct = 5) => {
    let sum = 0, amp = 1, tot = 0, f = 1
    for (let o = 0; o < oct; o++) { sum += val(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2 }
    return sum / tot
  }
}

/* Ridged noise sheared into diagonal drifts, the way reeds or brushed grain
 * run one way across a frame. */
function draw(cv, seed, angle) {
  const w = cv.width, h = cv.height
  const x2 = cv.getContext('2d')
  const n = makeNoise(seed)
  const img = x2.createImageData(w, h)
  const ca = Math.cos(angle), sa = Math.sin(angle)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x * ca - y * sa) / w
      const v = (x * sa + y * ca) / h
      /* Stretched along one axis so the structure reads as strokes. */
      let t = n(u * 3.2, v * 15.0, 5)
      t = Math.abs(t - 0.5) * 2
      t = 1 - t
      t = t * t
      /* A second, coarser layer breaks up the regularity. */
      t = t * 0.72 + n(u * 5.5 + 30, v * 5.5 + 30, 4) * 0.38
      /* Pushed to the ends so there are true blacks and true whites for a
         screen to work between, and no smooth middle. */
      t = Math.max(0, Math.min(1, (t - 0.42) * 2.5 + 0.45))
      const g = Math.round(t * 255)
      const i = (y * w + x) * 4
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255
    }
  }
  x2.putImageData(img, 0, 0)
}
`

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
  await page.setContent('<canvas id="c"></canvas>')
  const specs = [
    { name: 'a', seed: 7, angle: -0.62, w: 900, h: 620 },
    { name: 'b', seed: 41, angle: 0.38, w: 640, h: 640 },
    { name: 'c', seed: 93, angle: -1.05, w: 900, h: 520 },
  ]
  for (const s of specs) {
    const data = await page.evaluate(
      ({ src, s }) => {
        // eslint-disable-next-line no-eval
        eval(src)
        const cv = document.getElementById('c')
        cv.width = s.w
        cv.height = s.h
        // eslint-disable-next-line no-undef
        draw(cv, s.seed, s.angle)
        return cv.toDataURL('image/png')
      },
      { src: SOURCE, s }
    )
    fs.writeFileSync(`brand/src-${s.name}.png`, Buffer.from(data.split(',')[1], 'base64'))
  }
  await browser.close()
  console.log('sources written')
}
