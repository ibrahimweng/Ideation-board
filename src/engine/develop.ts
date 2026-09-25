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
/* One when this pass has to clamp what it writes, nought when it is writing
   into a buffer that can hold more than eight bits a channel. */
uniform float uClamp;

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
uniform vec4 uOptics;        /* distortion, chromatic aberration, violet, green */

/* The eight colour bands, and the four grading wheels. */
uniform float uHslH[8], uHslS[8], uHslL[8];
uniform vec3 uGradeS, uGradeM, uGradeH, uGradeG;  /* each: hue, sat, lum */
uniform vec2 uGradeMix;                            /* blending, balance */

/* ---------- the mask ----------
 *
 * One mask per pass, so only one mask's worth of numbers is ever in flight and
 * the develop chain below does not have to know that masks exist at all: it
 * develops the colour it is given, and main() decides how much of that lands.
 *
 * uMask.x  on at all
 * uMask.y  how many parts
 * uMask.z  the whole mask's strength
 * uMask.w  1 to draw the mask itself in red instead of the picture */
uniform vec4 uMask;
uniform vec4 uPartA[4];      /* kind, op, invert, feather */
uniform vec4 uPartB[4];      /* the part's own geometry */
uniform vec4 uPartC[4];
uniform sampler2D uBrush;    /* the painted parts, baked */
/* The blur this mask carries: kind, amount, angle, spare — and the point a
   spin turns around or a zoom runs out from. */
uniform vec4 uBlurFx;
uniform vec2 uBlurAt;
/* Taking something out: where the good pixels come from, whether to do it at
   all, and whether to keep the tone of where they are going. */
uniform vec4 uClone;
uniform sampler2D uDepth;    /* a depth map, when one is wired in */
/* Cropped to fill the card the way the photograph is. Its own numbers,
   because the depth map is a different card and need not be the same shape:
   without these a depth range read the right distances off the wrong part of
   the picture the moment the two aspects disagreed. */
uniform vec2 uCover2, uCoverOff2;
uniform vec2 uDepthOn;       /* x: a depth map is bound. y: spare */

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
/* ---------- what the lens did ----------
 *
 * Distortion is a radial warp about the middle of the frame: a wide lens bends
 * a straight wall outwards and a long one bends it in, and undoing either is
 * the same arithmetic with the sign the other way. At nought the expression is
 * exactly uv, so a picture nobody has corrected reads the pixels it always
 * read — not nearly the same ones. */
vec2 lens(vec2 uv){
  if (abs(uOptics.x) < EPS) return uv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  float r2 = dot(d, d);
  /* Normalised so the correction is worth the same on any shape of card:
     r2 at the corner is a quarter of one plus the aspect squared. */
  float k = uOptics.x * 0.45;
  d *= 1.0 + k * r2 * 4.0 / (1.0 + aspect * aspect);
  return 0.5 + d / vec2(aspect, 1.0);
}

vec3 tex0(vec2 uv){ return texture(uTex, clamp(uv * uCover + uCoverOff, 0.001, 0.999)).rgb; }

/* The photograph, as the lens correction says it should have been. Everything
   below reads it through here and nothing below knows the correction exists —
   including the sharpening, the local contrast and the blur gallery, which
   would otherwise be working on a picture the screen never shows.
   Chromatic aberration is the three colours not landing at the same size, so
   undoing it is reading red and blue at two slightly different scales. */
vec3 pic(vec2 uv){
  vec2 p = lens(uv);
  if (abs(uOptics.y) < EPS) return tex0(p);
  vec2 d = p - 0.5;
  float k = uOptics.y * 0.0075;
  return vec3(tex0(0.5 + d * (1.0 - k)).r, tex0(p).g, tex0(0.5 + d * (1.0 + k)).b);
}

/* And defringe, for the violet and green edges the last of it leaves on a
   branch against a bright sky. Held to where the picture actually has an edge,
   because a violet flower is not a fringe and desaturating it would be the
   cure being worse than the illness. */
float hueNear(float h, float want){
  float d = abs(h - want);
  return min(d, 1.0 - d);
}
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
  /* Written the way round the specification defines: smoothstep with its
     first edge above its second is undefined, and reads as a falling ramp on
     most drivers and as anything at all on the rest. */
  return 1.0 - smoothstep(0.0, 0.125, d);
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
vec3 sharpen(vec3 c, vec2 uv){
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
  return c + hp * uSharp.x * mask * mix(0.6, 1.6, uSharp.z);
}

/* ---------- noise reduction ----------
 *
 * A bilateral average over five by five: the neighbours that look like this
 * pixel are averaged into it and the ones that do not are an edge, so grain
 * goes and the edge stays. Which is the whole difference between reducing
 * noise and blurring.
 *
 * Luminance and colour are two sliders because they are two faults. Sensor
 * grain is mostly luminance and can only be smoothed a little before the
 * photograph turns to wax; the blotches a high ISO leaves are colour, and
 * colour can be smoothed hard before anybody sees it go. Detail holds the
 * edges: at nought the neighbourhood is averaged flat, wound up only the
 * neighbours that really do match are let in.
 *
 * Twenty-five taps is not free, so it is not paid for unless it was asked
 * for — and the two amounts are nought on every card that never opened the
 * panel, which is all of them. */
vec3 denoise(vec3 c, vec2 uv){
  float amt = clamp(uNoise.x, 0.0, 1.0);
  float col = clamp(uNoise.z, 0.0, 1.0);
  if (amt < EPS && col < EPS) return c;
  /* How far the neighbourhood reaches, which goes with how much was asked
     for: a light reduction looks at the pixels next door, a heavy one has to
     reach past the grain to find anything different from it. */
  vec2 px = (1.0 + 2.0 * max(amt, col)) / max(uRes, 1.0);
  /* How unlike this pixel a neighbour may be and still count. */
  float sigma = mix(0.30, 0.02, clamp(uNoise.y, 0.0, 1.0));
  float k = 1.0 / (sigma * sigma + EPS);
  float lc = lum(c);
  vec3 sum = c;
  float wsum = 1.0;
  for (int y = -2; y <= 2; y++){
    for (int x = -2; x <= 2; x++){
      if (x == 0 && y == 0) continue;
      vec3 s = pic(uv + vec2(float(x), float(y)) * px);
      float d = lum(s) - lc;
      float w = exp(-d * d * k);
      sum += s * w;
      wsum += w;
    }
  }
  vec3 avg = sum / max(wsum, EPS);
  /* The colour slider moves the whole pixel towards the average and the
     luminance slider then decides how much of the brightness came with it, so
     smoothing the colour hard leaves the detail exactly where it was. */
  vec3 out3 = mix(c, avg, col);
  return out3 + (mix(lc, lum(avg), amt) - lum(out3));
}

/* ---------- where a mask is ----------
 *
 * Each part answers "how much of me is here" for a point, between nothing and
 * all of it, and the parts fold together in order. The first part is the mask;
 * every one after it adds to what is there, takes itself out of it, or keeps
 * only what both of them cover. Which is the whole of Lightroom's masking
 * model, and enough to say "the sky, but not the building in front of it". */

float lin(int i, vec2 uv){
  /* A gradient along a line: all of it behind the first point, none of it past
     the second, and a smooth ramp between. That way round because of how the
     thing is used — you drag from the sky you want darkened towards where you
     want it to stop, so the edge you started at is the edge that gets the
     edit. Lightroom's sense, and everybody's muscle memory. */
  vec2 a = uPartB[i].xy;
  vec2 b = uPartB[i].zw;
  vec2 d = b - a;
  float len2 = max(dot(d, d), EPS);
  float t = dot(uv - a, d) / len2;
  /* And feather says how much of that drag is the fade. At one the whole
     length of it ramps, which is the gradient you dragged and what a linear
     mask has always done here; wound down, the fade tightens about the middle
     of the drag until it is an edge. The narrow end is what you want against
     a hard horizon, and there was no other way to ask for it. */
  float f = max(uPartA[i].w, EPS);
  t = clamp((t - 0.5) / f + 0.5, 0.0, 1.0);
  return 1.0 - smoothstep(0.0, 1.0, t);
}

float rad(int i, vec2 uv){
  /* An ellipse, turned by its own angle, with the feather saying how much of
     the radius the edge takes up. Measured against the card's proportions so a
     circle drawn on a wide card is still a circle. */
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (uv - uPartB[i].xy) * vec2(aspect, 1.0);
  float a = uPartC[i].x;
  float ca = cos(a), sa = sin(a);
  p = vec2(p.x * ca + p.y * sa, -p.x * sa + p.y * ca);
  vec2 rr = max(uPartB[i].zw * vec2(aspect, 1.0), vec2(EPS));
  float r = length(p / rr);
  float f = max(uPartA[i].w, 0.01);
  return 1.0 - smoothstep(1.0 - f, 1.0, clamp(r, 0.0, 2.0));
}

float colourRange(int i, vec3 c){
  /* Distance in hue first and then in saturation and brightness, because two
     colours people would call "the same blue" can be a long way apart in RGB
     and are always close in hue. */
  vec3 a = rgb2hsv(max(c, 0.0));
  vec3 b = rgb2hsv(max(uPartB[i].xyz, 0.0));
  float dh = abs(a.x - b.x);
  dh = min(dh, 1.0 - dh) * 2.0;
  float ds = abs(a.y - b.y);
  float dv = abs(a.z - b.z);
  /* A grey has no hue worth comparing, so for an unsaturated pick the answer
     is about brightness instead. */
  float w = smoothstep(0.02, 0.15, b.y);
  float d = mix(sqrt(ds * ds + dv * dv), sqrt(dh * dh * 1.6 + ds * ds * 0.5 + dv * dv * 0.25), w);
  float tol = max(uPartB[i].w, 0.01);
  return 1.0 - smoothstep(tol * 0.5, tol, d);
}

float band(float v, float lo, float hi, float soft){
  /* Inside the band is all of it, and it falls away over the softness on each side.
     One function for luminance and for depth, which are the same question
     asked of two different pictures. */
  float f = max(soft, 0.005);
  return smoothstep(lo - f, lo + f, v) * (1.0 - smoothstep(hi - f, hi + f, v));
}

float partAt(int i, vec2 uv, vec3 c){
  int kind = int(uPartA[i].x + 0.5);
  float f = 0.0;
  if (kind == 0) f = lin(i, uv);
  else if (kind == 1) f = rad(i, uv);
  /* The painted parts are baked into one strip, a tile per part: this part's
     tile number and how many tiles there are. A mask can hold a brush that
     paints an area in and a second that rubs a hole out of it, and they must
     not be reading the same strokes. */
  else if (kind == 2) f = texture(uBrush, vec2(uv.x, (clamp(uv.y, 0.0, 1.0) + uPartB[i].x) / max(uPartB[i].y, 1.0))).a;
  else if (kind == 3) f = colourRange(i, c);
  else if (kind == 4) f = band(clamp(lum(c), 0.0, 1.0), uPartB[i].x, uPartB[i].y, uPartB[i].z);
  else if (kind == 5){
    /* Without a depth map there is no answer, and covering the whole picture
       would be a worse one than covering none of it. */
    if (uDepthOn.x < 0.5) return 0.0;
    /* Through the lens correction as well, so that what the mask calls far
       away is where the corrected picture actually shows it. */
    float d = lum(texture(uDepth, clamp(lens(uv) * uCover2 + uCoverOff2, 0.001, 0.999)).rgb);
    f = band(d, uPartB[i].x, uPartB[i].y, uPartB[i].z);
  }
  /* All of it. Worth having as a part of its own rather than as an ellipse
     wound up until it covers the corners: it is what "everything except this"
     starts from, and what a blur over the whole picture is. */
  else if (kind == 6) f = 1.0;
  /* A kind this version does not know — a board saved by a later one. Nowhere
     rather than everywhere: an edit that has gone missing is a thing somebody
     can see and put back, and an edit smeared over the whole photograph is a
     thing they would have to work out. */
  else return 0.0;
  if (uPartA[i].z > 0.5) f = 1.0 - f;
  return clamp(f, 0.0, 1.0);
}

vec3 defringe(vec3 c, vec2 uv){
  if (uOptics.z < EPS && uOptics.w < EPS) return c;
  vec3 hsv = rgb2hsv(max(c, 0.0));
  /* An edge, measured the same way the texture slider measures one. */
  float edge = clamp(abs(localDetail(uv)) * 11.0, 0.0, 1.0);
  float violet = (1.0 - smoothstep(0.045, 0.14, hueNear(hsv.x, 0.79))) * uOptics.z;
  float green = (1.0 - smoothstep(0.040, 0.12, hueNear(hsv.x, 0.33))) * uOptics.w;
  float k = clamp((violet + green) * smoothstep(0.08, 0.45, hsv.y) * edge, 0.0, 1.0);
  return mix(c, vec3(lum(c)), k);
}

/* ---------- the blur gallery ----------
 *
 * Defocus is the gaussian chain, which is already built and already bound —
 * a real separable blur at a real radius, not a handful of taps pretending.
 * The other three cannot be got by softening evenly, so they are their own
 * arithmetic: twelve samples along a line, an arc or a ray. Twelve because
 * that is where the banding stops being visible on a photograph and every
 * tap after it costs the whole picture.
 *
 * Measured against the card's proportions, so a spin on a wide card is a
 * circle rather than an oval. */
vec3 blurry(vec2 uv){
  int k = int(uBlurFx.x + 0.5);
  float amt = uBlurFx.y;
  if (k == 0) return soft(uv);
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 12; i++){
    float t = float(i) / 11.0 - 0.5;
    vec2 p = uv;
    if (k == 3){
      vec2 dir = vec2(cos(uBlurFx.z), sin(uBlurFx.z));
      p += dir * t * amt * 0.28 / vec2(1.0, aspect);
    } else {
      vec2 d = (uv - uBlurAt) * vec2(aspect, 1.0);
      if (k == 1){
        float a = t * amt * 0.9;
        float ca = cos(a), sa = sin(a);
        d = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
      } else {
        d *= 1.0 + t * amt * 0.7;
      }
      p = uBlurAt + d / vec2(aspect, 1.0);
    }
    sum += pic(p);
  }
  return sum / 12.0;
}

/* ---------- taking something out ----------
 *
 * Clone puts the pixels from over there down as they are. Heal puts down their
 * texture and this place's own tone: the difference between a blurred copy of
 * here and a blurred copy of there is exactly the lighting that separates the
 * two, so adding it back is what makes a patch stop looking like a patch. */
vec3 cloned(vec2 uv){
  vec2 from = uv + uClone.xy;
  vec3 there = pic(from);
  if (uClone.w < 0.5) return there;
  return there + (soft(uv) - soft(from));
}

float maskAt(vec2 uv, vec3 c){
  if (uMask.x < 0.5) return 1.0;
  int n = int(uMask.y + 0.5);
  float m = 0.0;
  for (int i = 0; i < 4; i++){
    if (i >= n) break;
    float f = partAt(i, uv, c);
    if (i == 0){ m = f; continue; }
    int op = int(uPartA[i].y + 0.5);
    if (op == 0) m = max(m, f);            /* add */
    else if (op == 1) m = min(m, 1.0 - f); /* subtract */
    else m = min(m, f);                    /* intersect */
  }
  return clamp(m, 0.0, 1.0) * uMask.z;
}

vec3 developed(vec3 c, vec2 uv){

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
  c = sharpen(c, uv);
  c = defringe(c, uv);

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

  return c;
}

void main(){
  vec2 uv = vUv;
  /* The lens correction is the one thing that happens before anything else,
     because it is about where the light landed rather than what colour it
     was. Masks and the vignette stay in the frame as it is displayed, which is
     where somebody put them. */
  vec3 base = pic(uv);
  /* The mask is asked about the picture as it arrived, not about a blurred
     copy of it: a colour range that read the blur would spread itself over
     everything next to the colour it was given. */
  /* Show me where it is. Lightroom's red, over a picture drained to grey so
     the overlay reads on a red jumper as clearly as on a white wall — and the
     one thing anybody needs while a mask is being built.
     
     Two things it has to get right. It shows the developed photograph, not the
     file, because that is the picture the mask is asked about: a colour range
     compares against what the global develop left. And where the mask is not,
     it shows that picture untouched — so what is on screen outside the red is
     the real colour, which is what the colour picker reads when somebody
     clicks the photograph to build a range out of it. */
  if (uMask.w > 0.5){
    vec3 shown = developed(denoise(base, uv), uv);
    float mm = maskAt(uv, shown);
    float g = lum(shown);
    vec3 tint = mix(mix(vec3(g), shown, 0.25), vec3(0.94, 0.19, 0.24), 0.62);
    outColor = vec4(clamp(mix(shown, tint, mm), 0.0, 1.0), 1.0);
    return;
  }

  float m = maskAt(uv, base);
  vec3 c = uBlurFx.y > EPS ? blurry(uv) : base;
  /* Before the develop, because what is being repaired is the photograph and
     whatever this mask then does to it applies to the repair as well. */
  if (uClone.z > 0.5) c = cloned(uv);
  /* Out here rather than inside developed(), because the noise has to be taken
     off this pass's own pixel and left on everything the mask does not cover.
     Inside it, base would have been denoised too and the reduction would have
     spread over the whole photograph however small the mask was. */
  c = denoise(c, uv);

  vec3 d = developed(c, uv);
  /* A mask pass lands only where the mask is; a global pass lands everywhere,
     and maskAt has already returned 1 for it. */
  vec3 out3 = mix(base, d, m);
  outColor = vec4(uClamp > 0.5 ? clamp(out3, 0.0, 1.0) : out3, 1.0);
}`
