import { fromISF } from './isf'
import type { EffectSpec } from './types'

/* ---------------------------------------------------------------------------
 * Effects written as ISF, and translated on the way in.
 *
 * These could have been written in the engine's own shape like the other
 * sixty-one. Writing them in ISF instead means the translator is exercised
 * by the running board rather than only by its tests: if a rename breaks, the
 * board does not start, which is the only way a translator nobody is looking
 * at stays working.
 *
 * It also means the shape of an addition is now "find a good shader" rather
 * than "write one". The list stays curated — nothing here reads a shader from
 * anywhere but this file — and the cost of growing it has gone from an
 * afternoon to a paste.
 * ------------------------------------------------------------------------- */

/* Streaks pulled out of a point, which is the look of a camera zoomed during
 * the exposure. Nothing on the list did it: every blur here spreads evenly or
 * along a line, and none of them points at anything. */
const ZOOM = `/*{
  "DESCRIPTION": "Streaks pulled out of a point, as a camera zoomed during the exposure",
  "CATEGORIES": ["Blur"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "LABEL": "Amount", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.55 },
    { "NAME": "centre", "TYPE": "point2D", "LABEL": "From", "MIN": [0.0, 0.0], "MAX": [1.0, 1.0], "DEFAULT": [0.5, 0.5] },
    { "NAME": "hold", "TYPE": "float", "LABEL": "Still middle", "MIN": 0.0, "MAX": 0.9, "DEFAULT": 0.12 },
    { "NAME": "fringe", "TYPE": "float", "LABEL": "Colour fringe", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25 }
  ]
}*/
void main() {
  vec2 d = isf_FragNormCoord - centre;
  float r = length(d);
  /* Nothing moves inside the held middle, and the pull grows from its edge —
     which is what makes the centre read as the thing being looked at. */
  float k = clamp((r - hold) / max(0.001, 1.0 - hold), 0.0, 1.0) * amount;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 16; i++) {
    float t = float(i) / 15.0;
    float w = 1.0 - t * 0.75;
    /* The three channels are pulled by slightly different amounts, so the
       streaks split into colour at their far end the way a real lens does. */
    vec2 at = isf_FragNormCoord - d * k * t;
    vec2 rr = isf_FragNormCoord - d * k * t * (1.0 + fringe * 0.12);
    vec2 bb = isf_FragNormCoord - d * k * t * (1.0 - fringe * 0.12);
    sum += vec4(IMG_NORM_PIXEL(inputImage, rr).r,
                IMG_NORM_PIXEL(inputImage, at).g,
                IMG_NORM_PIXEL(inputImage, bb).b, 1.0) * w;
    total += w;
  }
  gl_FragColor = sum / total;
}`

/* A picture beaten into metal. The classic relief filter, and the one that
 * turns a wordmark into a stamped plate in one move. */
const EMBOSS = `/*{
  "DESCRIPTION": "The picture beaten into a sheet of metal",
  "CATEGORIES": ["Paint"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "depth", "TYPE": "float", "LABEL": "Depth", "MIN": 0.0, "MAX": 8.0, "DEFAULT": 2.2 },
    { "NAME": "light", "TYPE": "float", "LABEL": "Light from", "MIN": -180.0, "MAX": 180.0, "DEFAULT": 135.0 },
    { "NAME": "spread", "TYPE": "float", "LABEL": "Spread", "MIN": 0.5, "MAX": 8.0, "DEFAULT": 1.5 },
    { "NAME": "keep", "TYPE": "float", "LABEL": "Keep the colour", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 },
    { "NAME": "metal", "TYPE": "color", "LABEL": "Metal", "DEFAULT": [0.68, 0.66, 0.62, 1.0] }
  ]
}*/
float grey(vec2 p) {
  vec4 c = IMG_NORM_PIXEL(inputImage, p);
  return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  vec2 px = spread / RENDERSIZE;
  float a = radians(light);
  vec2 off = vec2(cos(a), sin(a)) * px;
  /* One reading with the light and one against it: the difference is the
     slope of the picture in that direction, which is the whole effect. */
  float slope = (grey(isf_FragNormCoord + off) - grey(isf_FragNormCoord - off)) * depth;
  float face = clamp(0.5 + slope, 0.0, 1.0);
  vec3 plate = metal * (0.35 + face * 1.1);
  vec3 tinted = IMG_THIS_PIXEL(inputImage).rgb * (0.35 + face * 1.1);
  gl_FragColor = vec4(mix(plate, tinted, keep), 1.0);
}`

/* Thread rather than ink. The board can already screen a picture into dots and
 * cross-hatch it into lines; this stitches it, which is a different material
 * and reads as one on anything to do with garments or packaging. */
const STITCH = `/*{
  "DESCRIPTION": "The picture worked in cross stitch",
  "CATEGORIES": ["Grid"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "gauge", "TYPE": "float", "LABEL": "Stitch", "MIN": 4.0, "MAX": 40.0, "DEFAULT": 12.0 },
    { "NAME": "thread", "TYPE": "float", "LABEL": "Thread", "MIN": 0.05, "MAX": 0.6, "DEFAULT": 0.26 },
    { "NAME": "levels", "TYPE": "float", "LABEL": "Colours", "MIN": 2.0, "MAX": 24.0, "DEFAULT": 8.0 },
    { "NAME": "slack", "TYPE": "float", "LABEL": "Wobble", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35 },
    { "NAME": "cloth", "TYPE": "color", "LABEL": "Cloth", "DEFAULT": [0.93, 0.91, 0.85, 1.0] }
  ]
}*/
void main() {
  vec2 grid = RENDERSIZE / max(4.0, gauge);
  vec2 cell = floor(isf_FragNormCoord * grid);
  vec2 f = fract(isf_FragNormCoord * grid);
  /* One colour a stitch, taken from the middle of the cell and stepped down to
     the number of threads asked for — a stitched picture has a palette
     because a shop sells a finite number of colours. */
  vec3 col = IMG_NORM_PIXEL(inputImage, (cell + 0.5) / grid).rgb;
  float steps = max(2.0, floor(levels));
  col = floor(col * steps + 0.5) / steps;
  /* Two diagonals, each a band about the line, so the cell reads as a cross
     rather than as a square of colour. */
  float w = thread * 0.5;
  float d1 = abs(f.x - f.y);
  float d2 = abs(f.x + f.y - 1.0);
  /* The wobble moves each stitch a little on its own, which is what keeps a
     field of them from reading as a printed grid. */
  float jitter = (fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * slack * 0.18;
  float on = max(1.0 - smoothstep(w, w + 0.06, d1 + jitter),
                 1.0 - smoothstep(w, w + 0.06, d2 - jitter));
  gl_FragColor = vec4(mix(cloth, col, on), 1.0);
}`

const SOURCES: { id: string; name: string; group: string; src: string }[] = [
  { id: 'zoomblur', name: 'Zoom blur', group: 'Blur', src: ZOOM },
  { id: 'emboss', name: 'Emboss', group: 'Paint', src: EMBOSS },
  { id: 'stitch', name: 'Cross stitch', group: 'Grid', src: STITCH },
]

/* Translated once, at load. A shader that fails to translate is a mistake in
 * this file rather than something a person did, so it is left out and said
 * loudly rather than crashing the board on the way up — one missing effect is
 * survivable and a blank page is not. */
export const ISF_EFFECTS: EffectSpec[] = SOURCES.flatMap((s) => {
  try {
    return [fromISF(s.src, { id: s.id, name: s.name, group: s.group }).spec]
  } catch (e) {
    console.error(`[isf] ${s.name} did not translate: ${(e as Error).message}`)
    return []
  }
})
