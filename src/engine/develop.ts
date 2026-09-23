/* ---------------------------------------------------------------------------
 * The develop pass.
 *
 * One fragment shader that takes a photograph and the figures from
 * state/develop.ts and gives back the developed picture. It runs before any
 * effect, which is the right way round and not a compromise: developing is
 * what you do to the photograph, and an effect is a look you put on top of the
 * developed thing. The tone that already rode on the compositor goes on riding
 * there, after the effect, because that is where it has always been and a
 * board full of cards saved with it must not move.
 *
 * The order below is Lightroom's, and the order matters more than any single
 * step in it. White balance before exposure, because exposure of a colour cast
 * is a brighter colour cast. The four tone sliders before contrast, because
 * contrast is about the range they just set. Local contrast after global,
 * saturation after both, the curve after that, and colour last — by then the
 * picture is the shape it is going to be and the grading is a decision about
 * mood rather than a fight with the exposure.
 *
 * Everything from white balance to contrast happens in linear light, because
 * that is what light does: +1 stop is twice the photons, and a highlight
 * recovered in sRGB is a highlight that goes grey. Everything from local
 * contrast onwards happens on the display-referred numbers, because clarity,
 * saturation and a tone curve are all judgements about what a thing looks
 * like, and a curve drawn against linear light is a curve nobody can read.
 * ------------------------------------------------------------------------- */

/* The curve is a lookup rather than arithmetic: four curves evaluated per
 * pixel with an arbitrary number of points is a loop with a branch in it, and
 * a 256-wide table is one texture read that is exact at every point the
 * curve was drawn through. Four rows: the composite, then red, green, blue. */
export const CURVE_W = 256
export const CURVE_H = 4

export const DEVELOP_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;      /* the photograph */
uniform sampler2D uBlur;     /* the same, blurred, for local contrast */
uniform sampler2D uCurve;    /* 256x4: composite, r, g, b */
uniform vec2 uRes, uCover, uCoverOff, uBlurScale, uBlurOff;
uniform float uSeed;

/* White balance, tone, presence. Packed as vectors rather than a uniform each
   so the binding side is four calls instead of sixteen. */
uniform vec2 uWB;            /* temp, tint            -1..1 */
uniform vec4 uTone;          /* exposure(EV), contrast, highlights, shadows */
uniform vec4 uTone2;         /* whites, blacks, texture, clarity */
uniform vec4 uPresence;      /* dehaze, vibrance, saturation, hasCurve */
uniform vec4 uSharp;         /* amount, radius, detail, masking */
uniform vec3 uNoise;         /* luminance, detail, colour */
uniform vec4 uVign;          /* amount, midpoint, roundness, feather */
uniform vec3 uGrain;         /* amount, size, roughness */

/* The eight colour bands, and the four grading wheels. */
uniform float uHslH[8], uHslS[8], uHslL[8];
uniform vec3 uGradeS, uGradeM, uGradeH, uGradeG;  /* each: hue, sat, lum */
uniform vec2 uGradeMix;                            /* blending, balance */

in vec2 vUv;
out vec4 outColor;

const float EPS = 1e-5;

/* ---------- colour spaces ----------
 *
 * The real sRGB transfer function rather than a 2.2 power. The difference is
 * only in the bottom two per cent of the range, which is exactly where the
 * shadow slider does its work. */
vec3 toLinear(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSRGB(vec3 c){
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
/* Rec. 709 luminance, which is the right one for linear light. The 601 weights
   elsewhere in this app are there to match a CSS filter and are not this. */
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + EPS)), d / (q.x + EPS), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/* ---------- reading the picture ----------
 *
 * Cropped to fill the card the same way an untreated card is, so developing a
 * picture changes how it looks and never how it is framed. */
vec3 pic(vec2 uv){ return texture(uTex, clamp(uv * uCover + uCoverOff, 0.001, 0.999)).rgb; }
vec3 soft(vec2 uv){ return texture(uBlur, clamp(uv, 0.0, 1.0) * uBlurScale + uBlurOff).rgb; }

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21) + uSeed * 0.137);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/* ---------- white balance ----------
 *
 * A shift along the two axes a photographer names, done as a scale of the
 * three channels in linear light. Not a Kelvin conversion: a Kelvin figure is
 * only meaningful against a raw file's own illuminant, and what arrives on
 * this board is a picture that has already been rendered. The gains are
 * normalised so that moving the slider changes the colour and not the
 * exposure, which is the whole difference between a white balance and a tint.
 */
vec3 whiteBalance(vec3 c, float temp, float tint){
  vec3 g = vec3(1.0 + temp * 0.45, 1.0 + tint * 0.22, 1.0 - temp * 0.45);
  g /= max(lum(g), EPS);
  return c * g;
}

/* ---------- the four tone sliders ----------
 *
 * Highlights and shadows pull the ends of the range in; whites and blacks say
 * where the ends are. Each acts through a weight that is one where it belongs
 * and zero where it does not, so moving the shadows leaves a sky alone.
 *
 * The weights are smooth and they overlap, because a photograph has no line in
 * it where the shadows stop. */
vec3 toneRegions(vec3 c, float hi, float sh, float wh, float bl){
  float L = clamp(lum(c), 0.0, 4.0);
  float t = clamp(L, 0.0, 1.0);
  /* Where each of the four lives, in display terms. */
  float wHi = smoothstep(0.45, 1.0, t);
  float wSh = 1.0 - smoothstep(0.0, 0.55, t);
  float wWh = smoothstep(0.7, 1.4, L);
  float wBl = 1.0 - smoothstep(0.0, 0.25, t);
  /* Recovery is a multiply rather than an add: pulling a highlight down has to
     keep its colour, and adding a negative number to a channel that is already
     at one turns it grey. */
  float k = 1.0;
  k *= 1.0 + hi * 0.75 * wHi;
  k *= 1.0 + sh * 0.9 * wSh;
  k *= 1.0 + wh * 0.5 * wWh;
  k *= 1.0 + bl * 0.6 * wBl;
  return c * max(k, 0.0);
}

/* ---------- contrast ----------
 *
 * About middle grey in linear light, which is 0.18 and not 0.5. A contrast
 * pivoted at half way is a contrast that darkens everything, because half way
 * up the sRGB numbers is nearly three quarters of the light. */
vec3 contrastAbout(vec3 c, float amt){
  float k = amt >= 0.0 ? 1.0 + amt * 1.2 : 1.0 + amt * 0.85;
  return 0.18 * pow(max(c / 0.18, EPS), vec3(k));
}

/* ---------- local contrast ----------
 *
 * Texture, clarity and dehaze are the same idea at three sizes: take the
 * picture, take a softened copy, and push them apart.
 *
 * Texture works at a radius small enough to be about the surface of a thing —
 * skin, fabric, bark — and is taken from neighbouring pixels here rather than
 * from the blur chain, because a blur wide enough for clarity is far too wide
 * to find a pore.
 *
 * Clarity works at the radius the blur chain was run at, and is protected in
 * the highlights and shadows so that it adds body to the midtones instead of
 * putting a halo round every branch against the sky.
 *
 * Dehaze is clarity's big brother plus the thing haze actually is: a veil of
 * light added to everything. So it subtracts a floor as well as adding
 * contrast, and puts back the saturation the veil was hiding. */
float localDetail(vec2 uv){
  vec2 px = 1.0 / max(uRes, 1.0);
  float c = lum(pic(uv));
  float s = 0.0;
  s += lum(pic(uv + vec2( px.x, 0.0)));
  s += lum(pic(uv + vec2(-px.x, 0.0)));
  s += lum(pic(uv + vec2(0.0,  px.y)));
  s += lum(pic(uv + vec2(0.0, -px.y)));
  s += lum(pic(uv + px * 1.4));
  s += lum(pic(uv - px * 1.4));
  s += lum(pic(uv + vec2(px.x, -px.y) * 1.4));
  s += lum(pic(uv + vec2(-px.x, px.y) * 1.4));
  return c - s * 0.125;
}

/* ---------- the curve ----------
 *
 * Read from the table rather than evaluated. Row 0 is the composite and runs
 * on all three channels; rows 1 to 3 are red, green and blue. */
float curveAt(float v, float row){
  return texture(uCurve, vec2(clamp(v, 0.0, 1.0), (row + 0.5) / 4.0)).r;
}
vec3 applyCurve(vec3 c){
  c = vec3(curveAt(c.r, 0.0), curveAt(c.g, 0.0), curveAt(c.b, 0.0));
  return vec3(curveAt(c.r, 1.0), curveAt(c.g, 2.0), curveAt(c.b, 3.0));
}

/* ---------- the eight bands ----------
 *
 * Each band pulls on a pixel by how near its hue is to the band's centre, and
 * the pulls overlap so that an orange between red and yellow is moved by both
 * rather than snapping to one. Weighted by saturation too: a grey pixel has no
 * hue to shift, and shifting it anyway is how a sky gets blotchy. */
float bandWeight(float hue, float centre){
  float d = abs(hue - centre);
  d = min(d, 1.0 - d);
  return smoothstep(0.125, 0.0, d);
}
vec3 applyHSL(vec3 c){
  vec3 hsv = rgb2hsv(max(c, 0.0));
  float centres[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.7778, 0.8889);
  float dh = 0.0, ds = 0.0, dl = 0.0, tot = 0.0;
  for (int i = 0; i < 8; i++){
    float w = bandWeight(hsv.x, centres[i]);
    dh += uHslH[i] * w;
    ds += uHslS[i] * w;
    dl += uHslL[i] * w;
    tot += w;
  }
  if (tot < EPS) return c;
  float sat = smoothstep(0.02, 0.18, hsv.y);
  hsv.x = fract(hsv.x + dh * 0.055 * sat);
  hsv.y = clamp(hsv.y * (1.0 + ds * sat), 0.0, 1.0);
  vec3 out3 = hsv2rgb(hsv);
  return out3 * (1.0 + dl * 0.55 * sat);
}

/* ---------- colour grading ----------
 *
 * Three wheels and a global one. Each wheel is a hue and a strength, thrown at
 * the part of the range it owns, with the balance sliding where midtones give
 * way to the other two and the blending saying how far the three overlap. At
 * zero blending they are three hard bands; at a hundred they are one wash. */
vec3 gradeWith(vec3 c, vec3 wheel, float w){
  if (wheel.y < EPS && abs(wheel.z) < EPS) return c;
  vec3 tint = hsv2rgb(vec3(fract(wheel.x / 360.0), clamp(wheel.y, 0.0, 1.0), 1.0));
  c = mix(c, c * tint * 1.6, wheel.y * w * 0.5);
  return c * (1.0 + wheel.z * w * 0.5);
}
vec3 applyGrading(vec3 c){
  float L = clamp(lum(c), 0.0, 1.0);
  float spread = mix(0.08, 0.55, uGradeMix.x);
  float pivot = 0.5 + uGradeMix.y * 0.35;
  float wS = 1.0 - smoothstep(pivot - spread, pivot + spread, L);
  float wH = smoothstep(pivot - spread, pivot + spread, L);
  float wM = 1.0 - abs(wH - wS);
  c = gradeWith(c, uGradeS, wS);
  c = gradeWith(c, uGradeM, wM);
  c = gradeWith(c, uGradeH, wH);
  return gradeWith(c, uGradeG, 1.0);
}

/* ---------- detail ----------
 *
 * Unsharp masking with the edge mask that makes it usable: at masking zero
 * every pixel is sharpened, including the grain in a flat sky; wound up, only
 * the pixels that sit on an edge are, which is the difference between a
 * sharpened photograph and a noisy one. */
vec3 sharpen(vec3 c, vec2 uv, float detail){
  if (uSharp.x < EPS) return c;
  vec2 px = uSharp.y / max(uRes, 1.0);
  float e = 0.0;
  e += lum(pic(uv + vec2(px.x, 0.0)));
  e += lum(pic(uv - vec2(px.x, 0.0)));
  e += lum(pic(uv + vec2(0.0, px.y)));
  e += lum(pic(uv - vec2(0.0, px.y)));
  float hp = lum(pic(uv)) - e * 0.25;
  /* The edge mask, from the local gradient. */
  float g = abs(dFdx(lum(pic(uv)))) + abs(dFdy(lum(pic(uv))));
  float mask = mix(1.0, smoothstep(0.0, 0.03, g), uSharp.w);
  return c + hp * uSharp.x * mask * mix(0.6, 1.6, uSharp.z) + detail * 0.0;
}

void main(){
  vec2 uv = vUv;
  vec3 c = pic(uv);

  /* -------- linear light -------- */
  c = toLinear(c);
  c = whiteBalance(c, uWB.x, uWB.y);
  c *= pow(2.0, uTone.x);
  c = toneRegions(c, uTone.z, uTone.w, uTone2.x, uTone2.y);
  c = contrastAbout(c, uTone.y);
  c = toSRGB(c);

  /* -------- local contrast -------- */
  float clarity = uTone2.w;
  float dehaze = uPresence.x;
  if (abs(clarity) > EPS || abs(dehaze) > EPS){
    vec3 s = soft(uv);
    float base = lum(s);
    if (abs(clarity) > EPS){
      /* Held off the very top and bottom of the range, which is what stops a
         halo along a skyline. */
      float guard = smoothstep(0.02, 0.25, base) * (1.0 - smoothstep(0.75, 0.98, base));
      c += (c - s) * clarity * 1.1 * guard;
    }
    if (abs(dehaze) > EPS){
      float veil = min(base, 0.6) * dehaze * 0.35;
      c = (c - veil) / max(1.0 - veil, 0.25);
      c += (c - s) * dehaze * 0.4;
    }
  }
  if (abs(uTone2.z) > EPS) c += localDetail(uv) * uTone2.z * 1.8;

  /* -------- saturation -------- */
  float L = lum(c);
  if (abs(uPresence.y) > EPS){
    /* Vibrance leaves the already-saturated alone, which is what keeps a face
       from going orange while a sky comes up. */
    vec3 hsv = rgb2hsv(max(c, 0.0));
    float room = 1.0 - hsv.y;
    c = mix(vec3(L), c, 1.0 + uPresence.y * room * 1.2);
  }
  if (abs(uPresence.z) > EPS) c = mix(vec3(L), c, 1.0 + uPresence.z);

  /* -------- the curve -------- */
  if (uPresence.w > 0.5) c = applyCurve(clamp(c, 0.0, 1.0));

  /* -------- colour -------- */
  c = applyHSL(c);
  c = applyGrading(c);

  /* -------- detail -------- */
  c = sharpen(c, uv, uNoise.y);

  /* -------- effects -------- */
  if (abs(uVign.x) > EPS){
    /* Measured on a circle the card's own shape, so a vignette on a panorama
       is not an oval. Roundness slides between the card's rectangle and a
       circle; feather says how soft the edge is; the midpoint says how far out
       it starts. */
    vec2 d = (uv - 0.5) * 2.0;
    float aspect = uRes.x / max(uRes.y, 1.0);
    vec2 sq = vec2(d.x * mix(aspect, 1.0, clamp(uVign.z * 0.5 + 0.5, 0.0, 1.0)), d.y);
    float r = length(sq) / max(mix(0.6, 1.8, uVign.y), EPS);
    float f = mix(0.02, 1.0, uVign.w);
    float v = 1.0 - smoothstep(1.0 - f, 1.0 + f * 0.25, r) * abs(uVign.x);
    /* Lightroom's sign, not the one that reads more naturally: a negative
       amount darkens the corners and a positive one opens them up. Everybody
       who has ever put a vignette on a photograph learned it that way round. */
    c = uVign.x < 0.0 ? c * v : c / max(v, 0.25);
  }
  if (uGrain.x > EPS){
    /* Ground at a size of its own rather than per output pixel, so a grain set
       on screen is the same grain in the export. Strongest in the midtones,
       the way film is: a blocked shadow and a blown highlight hold no silver. */
    float size = mix(3.0, 0.5, uGrain.y);
    vec2 gp = uv * uRes * size / max(uRes.y / 420.0, 0.25);
    float n = hash(floor(gp)) - 0.5;
    n = mix(n, (hash(floor(gp * 2.17)) - 0.5) * 1.4, uGrain.z);
    float body = 1.0 - abs(clamp(lum(c), 0.0, 1.0) * 2.0 - 1.0);
    c += n * uGrain.x * 0.34 * (0.35 + 0.65 * body);
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`
