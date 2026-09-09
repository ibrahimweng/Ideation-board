import { ISF_EFFECTS } from './isfEffects'
import type { EffectSpec, FxState } from './types'

/* Control constructors. N = numeric slider, C = colour, E = enum/segmented. */
const N = (k: string, label: string, min: number, max: number, step: number, def: number, unit?: string) =>
  ({ k, label, min, max, step, def, unit: unit || '' })
const C = (k: string, label: string, def: string) => ({ k, label, def, color: true as const })
const E = (k: string, label: string, def: number, options: string[]) => ({ k, label, def, options })

const PALS = ['Iron', 'Plasma', 'Acid', 'Teal/Gold', 'Cobalt', 'Mono', 'Magma', 'Viridis']

/* The 24 effects, ported verbatim from the original engine.
 * `blurKey` names the control whose value feeds the pre-blur chain, so the
 * scheduler knows which effects need the extra downsample passes. */
export const EFFECTS: EffectSpec[] = [
  { id: 'none', name: 'Original', group: 'Base', controls: [], frag: `vec4 fx(vec2 uv){ return T(uv); }` },

  {
    id: 'ascii', name: 'ASCII', group: 'Type', blurKey: 'p4',
    controls: [N('p0', 'Cell width', 3, 24, 0.5, 8, 'px'), N('p1', 'Contrast', -0.5, 2.5, 0.05, 0.3),
      E('p2', 'Glyphs', 0, ['Dense', 'Simple', 'Blocks']), E('p3', 'Ink', 0, ['Flat', 'From image']),
      N('p4', 'Soften', 0, 20, 1, 2), N('p5', 'Auto tone', 0, 1, 0.02, 0.75),
      C('c0', 'Ink', '#F2EFE6'), C('c1', 'Paper', '#111114')],
    /* Cells are the shape of a character, not squares, so the picture reads as
     * lines of type rather than as a field of dots.
     *
     * Auto tone is what makes it work on a photograph. The glyph ramp has ten
     * steps and a picture that is mostly dark spends all of them on the first
     * one: the card comes back nearly blank. Centring the picture's own
     * average on the middle of the ramp spends the glyphs where the detail
     * actually is, which is what a person doing this by hand would do. */
    frag: `vec4 fx(vec2 uv){
      float cw = max(3.0, p0*unit());
      vec2 cs = vec2(cw, cw*1.667);
      vec2 g = uRes/cs, cell = floor(uv*g), f = fract(uv*g);
      vec3 src = B((cell+0.5)/g).rgb;
      float v = luma(src);
      float mean = 0.0;
      for(float y=0.0;y<3.0;y+=1.0){
        for(float x=0.0;x<3.0;x+=1.0){
          mean += luma(T(vec2((x*2.0+1.0)/6.0, (y*2.0+1.0)/6.0)).rgb);
        }
      }
      mean /= 9.0;
      /* Ink on paper is not symmetric. A cell that falls below the first
       * glyph is simply not drawn, so tone lost at the bottom is lost for
       * good, while tone crowded at the top still shows as a heavier
       * character. So a dark picture is lifted firmly and a bright one is
       * let down gently. */
      float shift = 0.46 - mean;
      if(shift < 0.0) shift *= 0.35;
      v = clamp(v + shift*p5*1.2, 0.0, 1.0);
      v = clamp((v-0.5)*(1.0+p1)+0.5, 0.0, 1.0);
      int row = int(p2+0.5);
      float count = row==0 ? 10.0 : 5.0;
      float gi = floor(v*(count-0.001));
      /* Kept a fraction of a cell away from the edges of the glyph in the
       * atlas: sampling right on the border blends in the character next to it
       * and drew a faint grid over the whole picture. */
      vec2 gf = clamp(f, 0.03, 0.97);
      float ink = texture(uGlyph, vec2((gi+gf.x)/16.0, (float(row)+gf.y)/3.0)).r;
      vec3 col = p3<0.5 ? c0 : src;
      return vec4(mix(c1, col, ink), 1.0); }`
  },
  {
    id: 'edges', name: 'Contour', group: 'Type', blurKey: 'p2',
    controls: [N('p0', 'Line width', 0.5, 5, 0.1, 1.4), N('p1', 'Threshold', 0.02, 1.2, 0.01, 0.22),
      N('p2', 'Soften', 0, 20, 1, 2), C('c0', 'Ink', '#101014'), C('c1', 'Paper', '#F4F1E9')],
    frag: `vec4 fx(vec2 uv){
      float e = p0/uRes.y;
      float tl=luma(B(uv+vec2(-e,-e)).rgb), t0=luma(B(uv+vec2(0.0,-e)).rgb), tr=luma(B(uv+vec2(e,-e)).rgb);
      float l0=luma(B(uv+vec2(-e,0.0)).rgb), r0=luma(B(uv+vec2(e,0.0)).rgb);
      float bl=luma(B(uv+vec2(-e,e)).rgb), b0=luma(B(uv+vec2(0.0,e)).rgb), br=luma(B(uv+vec2(e,e)).rgb);
      float gx = -tl-2.0*l0-bl+tr+2.0*r0+br, gy = -tl-2.0*t0-tr+bl+2.0*b0+br;
      float ink = smoothstep(p1, p1+0.18, length(vec2(gx,gy)));
      return vec4(mix(c1,c0,ink),1.0); }`
  },

  {
    id: 'hatch', name: 'Cross-hatch', group: 'Type', blurKey: 'p5',
    controls: [N('p0', 'Spacing', 3, 30, 0.5, 8, 'px'), N('p1', 'Line width', 0.05, 0.9, 0.01, 0.34),
      N('p2', 'Angle', 0, 180, 1, 35, '°'), N('p3', 'Layers', 1, 4, 1, 3),
      N('p4', 'Contrast', -0.5, 2.5, 0.05, 0.6), N('p5', 'Soften', 0, 20, 1, 3),
      C('c0', 'Ink', '#16161A'), C('c1', 'Paper', '#F5F2EA')],
    /* Tone by how many sets of lines have been laid over each other, which is
     * how an engraver builds a shadow: one direction for the mid tones, a
     * second across it for the darks, a third for the darkest. */
    frag: `vec4 fx(vec2 uv){
      float v = clamp((luma(B(uv).rgb)-0.5)*(1.0+p4)+0.5, 0.0, 1.0);
      float sp = max(2.0, p0*unit());
      float layers = clamp(floor(p3), 1.0, 4.0);
      float ink = 0.0;
      for(float i=0.0;i<4.0;i+=1.0){
        if(i>=layers) break;
        float t = 1.0 - (i+1.0)/(layers+1.0);
        if(v>t) continue;
        float y = rot(uv*uRes, radians(p2 + i*43.0)).y;
        float d = abs(fract(y/sp)-0.5)*2.0;
        float w = clamp(p1*(1.0 + (t-v)*1.5), 0.02, 0.98);
        ink = max(ink, 1.0-smoothstep(w, w+0.28, d));
      }
      return vec4(mix(c1,c0,ink),1.0); }`
  },

  {
    id: 'halftone', name: 'Halftone', group: 'Print', blurKey: 'p4',
    controls: [N('p0', 'Dot pitch', 3, 26, 0.5, 7, 'px'), N('p1', 'Angle', 0, 90, 1, 45, '°'),
      N('p2', 'Contrast', -0.5, 2.5, 0.05, 0.5), E('p3', 'Shape', 0, ['Dot', 'Line', 'Square']),
      N('p4', 'Soften', 0, 16, 1, 1), C('c0', 'Ink', '#141416'), C('c1', 'Paper', '#F5F2EA')],
    frag: `vec4 fx(vec2 uv){
      float cs = max(2.5, p0*unit()), a = radians(p1);
      vec2 r = rot(uv*uRes, a), cell = floor(r/cs), f = fract(r/cs)-0.5;
      vec3 src = B(rot((cell+0.5)*cs, -a)/uRes).rgb;
      float v = clamp((luma(src)-0.5)*(1.0+p2)+0.5, 0.0, 1.0);
      float d = p3<0.5 ? length(f)*2.0 : (p3<1.5 ? abs(f.y)*2.0 : max(abs(f.x),abs(f.y))*2.0);
      float rad = sqrt(1.0-v)*1.25;
      float ink = 1.0-smoothstep(rad-0.16, rad+0.16, d);
      return vec4(mix(c1,c0,ink),1.0); }`
  },
  {
    id: 'riso', name: 'Risograph', group: 'Print',
    controls: [N('p0', 'Grain', 0, 0.8, 0.01, 0.3), N('p1', 'Misregister', 0, 14, 0.2, 3, 'px'),
      N('p2', 'Contrast', -0.4, 2.5, 0.05, 0.6), N('p3', 'Spread', 0.05, 0.9, 0.01, 0.35),
      C('c0', 'Ink A', '#6B2BC9'), C('c1', 'Ink B', '#F2C14E'), C('c2', 'Paper', '#F7EFE0')],
    frag: `vec4 fx(vec2 uv){
      vec2 m = vec2(p1,0.0)/uRes;
      float a = luma(T(uv+m).rgb), b = luma(T(uv-m*0.7).rgb);
      float n = (hash(uv*uRes)-0.5)*p0 + (vnoise(uv*uRes*0.4)-0.5)*p0*0.7;
      a = clamp((a-0.5)*(1.0+p2)+0.5+n, 0.0, 1.0);
      b = clamp((b-0.5)*(1.0+p2)+0.5+n, 0.0, 1.0);
      float ia = 1.0-smoothstep(0.12, 0.12+p3, a);
      float ib = 1.0-smoothstep(0.42, 0.42+p3*1.4, b);
      vec3 col = mix(c2, c1, clamp(ib,0.0,1.0)*0.92);
      col = mix(col, c0, clamp(ia,0.0,1.0));
      return vec4(col,1.0); }`
  },
  {
    id: 'duotone', name: 'Duotone', group: 'Print',
    controls: [N('p0', 'Contrast', -0.5, 3, 0.05, 0.8), N('p1', 'Posterize', 0, 12, 1, 0),
      N('p2', 'Grain', 0, 0.6, 0.01, 0.08), C('c0', 'Shadow', '#B3271E'), C('c1', 'Highlight', '#3BE0D0')],
    frag: `vec4 fx(vec2 uv){
      float v = luma(T(uv).rgb);
      v = clamp((v-0.5)*(1.0+p0)+0.5, 0.0, 1.0);
      if(p1>1.5) v = floor(v*p1)/max(1.0,p1-1.0);
      v = clamp(v + (hash(uv*uRes)-0.5)*p2, 0.0, 1.0);
      return vec4(mix(c0,c1,v),1.0); }`
  },
  {
    id: 'dither', name: 'Dither', group: 'Print', blurKey: 'p4',
    controls: [N('p0', 'Pixel size', 1, 12, 0.5, 2, 'px'), N('p1', 'Levels', 2, 8, 1, 2),
      N('p2', 'Contrast', -0.5, 2.5, 0.05, 0.45), E('p3', 'Pattern', 0, ['Bayer', 'Noise']),
      N('p4', 'Soften', 0, 12, 1, 0), C('c0', 'Ink', '#111116'), C('c1', 'Paper', '#F6F3EB')],
    frag: `vec4 fx(vec2 uv){
      float cs = max(1.0, p0*unit());
      vec2 px = floor(uv*uRes/cs);
      float v = clamp((luma(B((px*cs+cs*0.5)/uRes).rgb)-0.5)*(1.0+p2)+0.5, 0.0, 1.0);
      float th = p3<0.5 ? bayer8(px) : hash(px);
      float lv = max(2.0, floor(p1));
      float q = clamp(floor(v*(lv-1.0)+th)/(lv-1.0), 0.0, 1.0);
      return vec4(mix(c0,c1,q),1.0); }`
  },

  {
    id: 'threshold', name: 'Threshold', group: 'Print', blurKey: 'p2',
    controls: [N('p0', 'Level', 0.05, 0.95, 0.01, 0.5), N('p1', 'Softness', 0, 0.5, 0.01, 0.03),
      N('p2', 'Soften', 0, 24, 1, 2), E('p3', 'Read', 0, ['Dark is ink', 'Light is ink']),
      N('p4', 'Grain', 0, 0.5, 0.01, 0), C('c0', 'Ink', '#111114'), C('c1', 'Paper', '#F5F2EA')],
    frag: `vec4 fx(vec2 uv){
      float v = luma(B(uv).rgb) + (hash(uv*uRes)-0.5)*p4;
      float ink = 1.0-smoothstep(p0-p1*0.5-0.004, p0+p1*0.5+0.004, v);
      if(p3>0.5) ink = 1.0-ink;
      return vec4(mix(c1,c0,ink),1.0); }`
  },

  {
    /* Called "Depth map" until this board could make a real one. It never was:
     * it blurs the picture, takes its brightness and paints that through a
     * palette, which is a false-colour map of light and not of distance. The
     * id stays what it was, because every board ever saved says it. */
    id: 'depth', name: 'Elevation', group: 'Map', blurKey: 'p0',
    controls: [N('p0', 'Falloff', 0, 90, 1, 34), N('p1', 'Contrast', -0.5, 3, 0.05, 0.9),
      E('p2', 'Palette', 2, PALS), N('p3', 'Bands', 0, 12, 1, 0), E('p4', 'Read', 0, ['Light = near', 'Dark = near'])],
    frag: `vec4 fx(vec2 uv){
      float v = luma(B(uv).rgb);
      if(p4>0.5) v = 1.0-v;
      v = clamp((v-0.5)*(1.0+p1)+0.5, 0.0, 1.0);
      if(p3>1.5) v = floor(v*p3)/max(1.0,p3-1.0);
      return vec4(pal(int(p2+0.5), clamp(v,0.0,1.0)),1.0); }`
  },
  {
    /* ---------------------------------------------------------------------
     * Distance, guessed from one photograph.
     *
     * A single picture does not contain its own depth, and nothing here
     * pretends otherwise. What it contains is the evidence a person uses
     * before they have thought about it, and those cues are arithmetic:
     *
     *   - Detail. A lens has one focal plane and air has none, so what is
     *     near carries fine texture and what is far does not. This is the
     *     strongest cue in a photograph and the one that survives most
     *     subjects. Measured over a neighbourhood rather than at a point,
     *     because a single sharp difference is an edge and a field of them
     *     is a surface — an outline map is the classic wrong answer here.
     *
     *   - Haze. Air between you and a thing washes out its colour and lifts
     *     it towards the sky. Pale and flat reads as far, which is why a
     *     mountain range is drawn in five greys.
     *
     *   - Ground. Photographs are taken standing up, so the bottom of the
     *     frame is usually the floor at your feet and the middle is the
     *     horizon. A weak prior, and weighted like one.
     *
     * Two things it is not. It is not a measurement, so a dark near thing
     * against a bright far one will read wrong and no amount of weighting
     * fixes it. And it is not the only answer this board has: the panel can
     * hand the same picture to a real depth model, which sees what these
     * three cues only imply. This one costs nothing and is instant, which is
     * why it is the one that runs first.
     * ------------------------------------------------------------------- */
    id: 'depthfrom', name: 'Depth map', group: 'Map', blurKey: 'p0',
    controls: [N('p0', 'Detail radius', 2, 90, 1, 24), N('p1', 'Detail', 0, 1, 0.01, 0.6),
      N('p2', 'Haze', 0, 1, 0.01, 0.5), N('p3', 'Ground', 0, 1, 0.01, 0.3),
      N('p4', 'Contrast', 0, 3, 0.05, 1), E('p5', 'Near is', 0, ['White', 'Black'])],
    frag: `vec4 fx(vec2 uv){
      vec3 bc = B(uv).rgb;
      float lb = luma(bc);

      /* Nine taps of high-frequency energy over a small disc. One difference
         is an edge; a neighbourhood of them is a textured surface. */
      float e = 0.0;
      vec2 r = (2.0 + p0 * 0.35) / uRes;
      for(int i = -1; i <= 1; i++){
        for(int j = -1; j <= 1; j++){
          vec2 o = vec2(float(i), float(j)) * r;
          e += abs(luma(T(uv + o).rgb) - luma(B(uv + o).rgb));
        }
      }
      float detail = clamp(e * 2.4, 0.0, 1.0);

      /* Washed out and lifted towards the sky: the signature of air. */
      float mx = max(bc.r, max(bc.g, bc.b));
      float mn = min(bc.r, min(bc.g, bc.b));
      float sat = mx > 0.001 ? (mx - mn) / mx : 0.0;
      float far = clamp(lb * 0.55 + (1.0 - sat) * 0.45, 0.0, 1.0);

      /* uv.y is 0 at the top of the card, so the floor is 1. */
      float w = p1 + p2 + p3;
      float v = w > 0.001
        ? (detail * p1 + (1.0 - far) * p2 + uv.y * p3) / w
        : 0.5;
      v = clamp((v - 0.5) * (1.0 + p4) + 0.5, 0.0, 1.0);
      if(p5 > 0.5) v = 1.0 - v;
      return vec4(vec3(v), 1.0); }`
  },
  {
    id: 'thermal', name: 'Thermal', group: 'Map', blurKey: 'p0',
    controls: [N('p0', 'Diffuse', 0, 90, 1, 18), N('p1', 'Gain', 0.3, 3.5, 0.05, 1.5),
      N('p2', 'Floor', -0.4, 0.7, 0.01, 0.06), E('p3', 'Palette', 0, PALS), N('p4', 'Grain', 0, 0.4, 0.01, 0.02)],
    frag: `vec4 fx(vec2 uv){
      float v = luma(B(uv).rgb);
      v = clamp((v-p2)*p1, 0.0, 1.0);
      v = clamp(v + (hash(uv*uRes)-0.5)*p4, 0.0, 1.0);
      return vec4(pal(int(p3+0.5), v),1.0); }`
  },
  {
    id: 'solarize', name: 'Solarize', group: 'Map',
    controls: [N('p0', 'Threshold', 0.05, 0.95, 0.01, 0.45), N('p1', 'Palette mix', 0, 1, 0.02, 0.7),
      E('p2', 'Palette', 4, PALS), N('p3', 'Grain', 0, 0.4, 0.01, 0.05), N('p4', 'Contrast', -0.4, 2.5, 0.05, 0.5)],
    frag: `vec4 fx(vec2 uv){
      vec3 c = T(uv).rgb;
      vec3 inv = mix(c, 1.0-c, step(vec3(p0), c));
      inv = clamp((inv-0.5)*(1.0+p4)+0.5, 0.0, 1.0);
      float v = luma(inv);
      vec3 col = mix(inv, pal(int(p2+0.5), v), p1);
      col += (hash(uv*uRes)-0.5)*p3;
      return vec4(clamp(col,0.0,1.0),1.0); }`
  },
  {
    id: 'posterize', name: 'Posterize', group: 'Map',
    controls: [N('p0', 'Levels', 2, 12, 1, 4), N('p1', 'Softness', 0, 1, 0.02, 0.1),
      N('p2', 'Saturation', 0, 2.5, 0.05, 1.2), N('p3', 'Contrast', -0.4, 2.5, 0.05, 0.4)],
    frag: `vec4 fx(vec2 uv){
      vec3 c = clamp((T(uv).rgb-0.5)*(1.0+p3)+0.5, 0.0, 1.0);
      float lv = max(2.0, floor(p0));
      vec3 q = mix(floor(c*lv)/(lv-1.0), c, p1);
      float v = luma(q);
      return vec4(clamp(mix(vec3(v), q, p2),0.0,1.0),1.0); }`
  },

  {
    id: 'splittone', name: 'Split tone', group: 'Map',
    controls: [N('p0', 'Strength', 0, 1.4, 0.02, 0.6), N('p1', 'Balance', -0.4, 0.4, 0.01, 0),
      N('p2', 'Contrast', -0.4, 1.6, 0.02, 0.15), N('p3', 'Saturation', 0, 2, 0.02, 0.9),
      C('c0', 'Shadows', '#2E5A72'), C('c1', 'Highlights', '#E8B06A')],
    /* The picture keeps its own colour; only the two ends of the range are
     * pushed, which is what separates this from a duotone. */
    frag: `vec4 fx(vec2 uv){
      vec3 c = T(uv).rgb;
      float v = luma(c);
      c = mix(vec3(v), c, p3);
      c = clamp((c-0.5)*(1.0+p2)+0.5, 0.0, 1.0);
      v = luma(c);
      float sh = 1.0-smoothstep(0.0, 0.55+p1, v);
      float hl = smoothstep(0.45+p1, 1.0, v);
      c *= mix(vec3(1.0), c0*2.0, sh*p0);
      c *= mix(vec3(1.0), c1*2.0, hl*p0);
      return vec4(clamp(c,0.0,1.0),1.0); }`
  },

  {
    id: 'film', name: 'Film grain', group: 'Grain',
    controls: [N('p0', 'Grain', 0, 1.2, 0.01, 0.42), N('p1', 'Contrast', -0.4, 3, 0.05, 0.85),
      N('p2', 'Lift', -0.3, 0.4, 0.01, 0.02), N('p3', 'Tint', 0, 1, 0.02, 0.55), C('c0', 'Tint', '#1E3A38')],
    frag: `vec4 fx(vec2 uv){
      float v = luma(T(uv).rgb);
      v = clamp((v-0.5)*(1.0+p1)+0.5+p2, 0.0, 1.0);
      float n = (hash(uv*uRes*1.9)-0.5) + (vnoise(uv*uRes*0.3)-0.5)*0.7;
      v = clamp(v + n*p0, 0.0, 1.0);
      return vec4(mix(vec3(v), mix(c0, vec3(1.0), v), p3),1.0); }`
  },
  {
    id: 'stipple', name: 'Dispersion', group: 'Grain', blurKey: 'p4',
    controls: [N('p0', 'Density', 0.3, 3, 0.05, 1.1), N('p1', 'Dot size', 1, 8, 0.5, 1.5, 'px'),
      N('p2', 'Contrast', -0.4, 3, 0.05, 0.9), N('p3', 'Spread', 0, 60, 1, 14),
      N('p4', 'Soften', 0, 20, 1, 3), C('c0', 'Ink', '#16161A'), C('c1', 'Paper', '#F2F0EA')],
    frag: `vec4 fx(vec2 uv){
      float cs = max(1.0, p1*unit());
      vec2 px = floor(uv*uRes/cs);
      vec2 d = (vec2(vnoise(px*0.05), vnoise(px*0.05+11.3))-0.5)*p3/uRes*4.0;
      float v = luma(B(uv+d).rgb);
      v = clamp((v-0.5)*(1.0+p2)+0.5, 0.0, 1.0);
      float ink = step(hash(px), pow(1.0-v, 1.0/max(0.25,p0)));
      return vec4(mix(c1,c0,ink),1.0); }`
  },

  {
    id: 'pixelate', name: 'Pixelate', group: 'Grid', blurKey: 'p5',
    controls: [N('p0', 'Cell size', 3, 90, 1, 18, 'px'), N('p1', 'Colours', 0, 10, 1, 0),
      N('p2', 'Gap', 0, 0.6, 0.02, 0), N('p3', 'Brick offset', 0, 1, 0.05, 0),
      N('p5', 'Soften', 0, 12, 1, 0), C('c0', 'Gap', '#F2F0EA')],
    frag: `vec4 fx(vec2 uv){
      float cs = max(2.0, p0*unit());
      vec2 g = uRes/cs;
      float row = floor(uv.y*g.y);
      float sh = mod(row,2.0)*p3*0.5;
      vec2 cell = vec2(floor(uv.x*g.x+sh), row);
      vec2 f = fract(vec2(uv.x*g.x+sh, uv.y*g.y));
      vec3 c = B((cell+0.5-vec2(sh,0.0))/g).rgb;
      if(p1>1.5){ float lv=floor(p1); c = floor(c*lv)/max(1.0,lv-1.0); }
      float gp = p2*0.5;
      float m = step(gp,f.x)*step(gp,f.y)*step(f.x,1.0-gp)*step(f.y,1.0-gp);
      return vec4(mix(c0, clamp(c,0.0,1.0), m),1.0); }`
  },
  {
    id: 'checker', name: 'Checker grid', group: 'Grid',
    controls: [N('p0', 'Cell size', 8, 120, 1, 42, 'px'), N('p1', 'Shuffle', 0, 3, 0.05, 0.9),
      N('p2', 'Knock out', 0, 1, 0.02, 0.25), N('p3', 'Gap', 0, 0.4, 0.01, 0.03),
      N('p4', 'Seed', 0, 40, 1, 3), C('c0', 'Blank', '#111114')],
    frag: `vec4 fx(vec2 uv){
      float cs = max(6.0, p0*unit());
      vec2 g = uRes/cs, cell = floor(uv*g), f = fract(uv*g);
      float chk = mod(cell.x+cell.y, 2.0);
      float h = hash(cell+p4);
      float gp = p3*0.5;
      float m = step(gp,f.x)*step(gp,f.y)*step(f.x,1.0-gp)*step(f.y,1.0-gp);
      if(chk>0.5 && h<p2) return vec4(c0,1.0);
      vec2 off = chk>0.5 ? (vec2(hash(cell+3.1+p4), hash(cell+9.7+p4))-0.5)*p1*cs/uRes : vec2(0.0);
      return vec4(mix(c0, T(uv+off).rgb, m),1.0); }`
  },
  {
    id: 'crystal', name: 'Crystallise', group: 'Grid',
    controls: [N('p0', 'Cell size', 6, 90, 1, 26, 'px'), N('p1', 'Irregularity', 0, 1, 0.02, 0.85),
      N('p2', 'Outline', 0, 0.5, 0.01, 0.06), N('p3', 'Flatten', 0, 1, 0.02, 1),
      N('p4', 'Seed', 0, 40, 1, 4), C('c0', 'Outline', '#14141A')],
    /* Each pixel takes the colour of the nearest scattered point, which breaks
     * the picture into facets rather than the squares a pixelate gives. The
     * second nearest gives the seam between two of them. */
    frag: `vec4 fx(vec2 uv){
      float cs = max(4.0, p0*unit());
      vec2 g = uRes/cs, p = uv*g, ip = floor(p), fp = fract(p);
      float d1 = 9.0, d2 = 9.0; vec2 best = vec2(0.5);
      for(float y=-1.0;y<=1.0;y+=1.0){
        for(float x=-1.0;x<=1.0;x+=1.0){
          vec2 o = vec2(x,y);
          vec2 j = vec2(hash(ip+o+p4), hash(ip+o+p4+31.7));
          vec2 pt = o + 0.5 + (j-0.5)*p1;
          float d = length(pt-fp);
          if(d<d1){ d2=d1; d1=d; best=ip+o+0.5+(j-0.5)*p1; }
          else if(d<d2){ d2=d; }
        }
      }
      vec3 c = mix(T(uv).rgb, T(best/g).rgb, p3);
      float edge = smoothstep(0.0, max(0.004,p2), d2-d1);
      return vec4(mix(c0, c, edge),1.0); }`
  },

  {
    id: 'weave', name: 'Weave', group: 'Grid',
    controls: [N('p0', 'Cell size', 8, 140, 1, 46, 'px'), N('p1', 'Row shift', 0, 2, 0.02, 0.55),
      N('p2', 'Column shift', 0, 2, 0.02, 0.3), N('p3', 'Gap', 0, 0.4, 0.01, 0.02), C('c0', 'Gap', '#F4F2EC')],
    frag: `vec4 fx(vec2 uv){
      float cs = max(6.0, p0*unit());
      vec2 g = uRes/cs, cell = floor(uv*g), f = fract(uv*g);
      float rs = (mod(cell.y,2.0)*2.0-1.0)*p1*cs/uRes.x;
      float cshift = (mod(cell.x,2.0)*2.0-1.0)*p2*cs/uRes.y;
      float gp = p3*0.5;
      float m = step(gp,f.x)*step(gp,f.y)*step(f.x,1.0-gp)*step(f.y,1.0-gp);
      return vec4(mix(c0, T(uv+vec2(rs,cshift)).rgb, m),1.0); }`
  },
  {
    id: 'slices', name: 'Slices', group: 'Grid',
    controls: [N('p0', 'Count', 2, 40, 1, 9), N('p1', 'Displace', 0, 0.6, 0.01, 0.12),
      E('p2', 'Direction', 0, ['Vertical', 'Horizontal']), N('p3', 'Gap', 0, 0.5, 0.01, 0.06),
      N('p4', 'Seed', 0, 40, 1, 5), C('c0', 'Paper', '#F4F2EC')],
    frag: `vec4 fx(vec2 uv){
      float n = max(2.0, floor(p0));
      bool vert = p2 < 0.5;
      float t = vert ? uv.x : uv.y;
      float idx = floor(t*n), f = fract(t*n);
      float d = (hash(vec2(idx, 3.0+p4))-0.5)*2.0*p1;
      vec2 uv2 = uv + (vert ? vec2(0.0,d) : vec2(d,0.0));
      float gp = p3*0.5;
      float m = step(gp,f)*step(f,1.0-gp);
      float inside = step(0.0,uv2.x)*step(uv2.x,1.0)*step(0.0,uv2.y)*step(uv2.y,1.0);
      return vec4(mix(c0, T(uv2).rgb, m*inside),1.0); }`
  },

  {
    id: 'wave', name: 'Liquify', group: 'Distort',
    controls: [N('p0', 'Amplitude', 0, 0.35, 0.005, 0.06), N('p1', 'Frequency', 0.5, 40, 0.5, 7),
      N('p2', 'Quantize', 0, 120, 1, 0), E('p3', 'Direction', 0, ['Horizontal', 'Vertical']),
      N('p4', 'Seed', 0, 40, 1, 2)],
    frag: `vec4 fx(vec2 uv){
      float t = p3<0.5 ? uv.y : uv.x;
      float q = p2>1.0 ? floor(t*p2)/p2 : t;
      float d = (sin(q*p1*6.2831+p4)*0.55 + (vnoise(vec2(q*p1*0.6, p4))-0.5)*0.9)*p0;
      return T(p3<0.5 ? uv+vec2(d,0.0) : uv+vec2(0.0,d)); }`
  },
  {
    id: 'glitch', name: 'Glitch', group: 'Distort',
    controls: [N('p0', 'Band height', 2, 60, 1, 12, 'px'), N('p1', 'Shift', 0, 0.5, 0.01, 0.09),
      N('p2', 'RGB split', 0, 30, 0.5, 5, 'px'), N('p3', 'Scanlines', 0, 1, 0.02, 0.2), N('p4', 'Seed', 0, 40, 1, 7)],
    frag: `vec4 fx(vec2 uv){
      float bs = max(2.0, p0*unit());
      float row = floor(uv.y*uRes.y/bs);
      float h = hash(vec2(row, 13.0+p4));
      float sh = h<0.32 ? (hash(vec2(row,7.0+p4))-0.5)*p1 : 0.0;
      vec2 uv2 = uv + vec2(sh, 0.0);
      float rs = p2/uRes.x;
      vec3 c = vec3(T(uv2+vec2(rs,0.0)).r, T(uv2).g, T(uv2-vec2(rs,0.0)).b);
      c *= 1.0 - p3*0.55*step(0.5, fract(uv.y*uRes.y*0.5));
      return vec4(c,1.0); }`
  },

  {
    id: 'oil', name: 'Oil paint', group: 'Paint',
    controls: [N('p0', 'Brush', 1, 6, 1, 4, 'px'), N('p1', 'Spread', 0.5, 4, 0.1, 2.4),
      N('p2', 'Saturation', 0, 2, 0.02, 1.15), N('p3', 'Contrast', -0.4, 1.6, 0.02, 0.1),
      N('p4', 'Edge ink', 0, 1, 0.02, 0), C('c0', 'Edge', '#1A1712')],
    /* Kuwahara: four squares meeting at the pixel, and the flattest of them
     * wins. Flat areas turn into strokes of one colour while edges stay put,
     * which is what makes it read as paint rather than blur. */
    frag: `vec4 fx(vec2 uv){
      float r = clamp(floor(p0), 1.0, 6.0);
      vec2 px = p1/uRes;
      vec3 best = T(uv).rgb; float bestVar = 1e9;
      for(float q=0.0;q<4.0;q+=1.0){
        vec2 dir = vec2(q==0.0||q==3.0 ? 1.0 : -1.0, q<2.0 ? 1.0 : -1.0);
        vec3 sum = vec3(0.0), sum2 = vec3(0.0); float n = 0.0;
        for(float i=0.0;i<=6.0;i+=1.0){
          if(i>r) break;
          for(float j=0.0;j<=6.0;j+=1.0){
            if(j>r) break;
            vec3 c = T(uv + vec2(i*dir.x, j*dir.y)*px).rgb;
            sum += c; sum2 += c*c; n += 1.0;
          }
        }
        vec3 m = sum/n;
        vec3 va = abs(sum2/n - m*m);
        float v = va.r+va.g+va.b;
        if(v < bestVar){ bestVar = v; best = m; }
      }
      float lv = luma(best);
      best = mix(vec3(lv), best, p2);
      best = clamp((best-0.5)*(1.0+p3)+0.5, 0.0, 1.0);
      /* The variance that lost is where the strokes meet. */
      float edge = smoothstep(0.0006, 0.02, bestVar)*p4;
      return vec4(mix(best, c0, edge),1.0); }`
  },

  {
    id: 'bloom', name: 'Bloom', group: 'Light', blurKey: 'p0',
    controls: [N('p0', 'Spread', 4, 140, 1, 54), N('p1', 'Threshold', 0, 1, 0.01, 0.5),
      N('p2', 'Amount', 0, 2, 0.02, 1.15), N('p3', 'Diffusion', 0, 1, 0.02, 0.22),
      N('p4', 'Contrast', -0.4, 1.6, 0.02, 0), C('c0', 'Glow', '#FFF0D6')],
    /* Only the bright parts of the blurred copy are screened back over the
     * picture, which is what a lens does with a highlight and what a print
     * does with a light source. */
    frag: `vec4 fx(vec2 uv){
      vec3 c = T(uv).rgb;
      vec3 b = B(uv).rgb;
      c = mix(c, b, p3);
      c = clamp((c-0.5)*(1.0+p4)+0.5, 0.0, 1.0);
      float lb = smoothstep(p1, min(1.0, p1+0.28), luma(b));
      vec3 glow = clamp(b*lb*c0*p2, 0.0, 1.0);
      return vec4(1.0-(1.0-c)*(1.0-glow), 1.0); }`
  },
  {
    id: 'lens', name: 'Lens', group: 'Light',
    controls: [N('p0', 'Fringing', 0, 30, 0.5, 6, 'px'), N('p1', 'Vignette', 0, 1.2, 0.02, 0.45),
      N('p2', 'Distortion', -0.4, 0.6, 0.01, 0.08), N('p3', 'Falloff', 0.1, 1, 0.02, 0.55),
      N('p4', 'Edge softness', 0, 1, 0.02, 0.35)],
    /* Everything a lens does at its edges and nothing at its middle: the
     * colours part, the corners fall away, the frame bows. */
    frag: `vec4 fx(vec2 uv){
      vec2 d = uv-0.5;
      float r2 = dot(d,d);
      vec2 w = uv + d*r2*p2;
      vec2 dir = d*(0.4+r2*4.0)*(p0/uRes.x);
      vec3 c = vec3(T(w+dir).r, T(w).g, T(w-dir).b);
      /* Soft at the edges the way an open aperture is, sharp in the middle. */
      float soft = smoothstep(0.12, 0.5, length(d))*p4;
      if(soft>0.001){
        vec2 e = soft*2.5/uRes;
        c = mix(c, (T(w+e).rgb + T(w-e).rgb + T(w+vec2(e.x,-e.y)).rgb + T(w-vec2(e.x,-e.y)).rgb)*0.25, soft);
      }
      float rad = length(d*vec2(uRes.x/uRes.y, 1.0))*1.4;
      c *= 1.0 - p1*smoothstep(p3*0.6, 1.0, rad);
      return vec4(clamp(c,0.0,1.0),1.0); }`
  },

  {
    id: 'gaussian', name: 'Soft blur', group: 'Blur', blurKey: 'p0',
    controls: [N('p0', 'Radius', 0, 120, 1, 26), N('p1', 'Amount', 0, 1, 0.02, 1)],
    frag: `vec4 fx(vec2 uv){ return vec4(mix(T(uv).rgb, B(uv).rgb, p1),1.0); }`
  },
  {
    id: 'motion', name: 'Fast blur', group: 'Blur',
    controls: [N('p0', 'Length', 0, 260, 1, 60, 'px'), N('p1', 'Angle', 0, 360, 1, 0, '°'),
      N('p2', 'Samples', 4, 24, 1, 16)],
    frag: `vec4 fx(vec2 uv){
      vec2 dir = vec2(cos(radians(p1)), sin(radians(p1)))*p0/uRes;
      float n = clamp(floor(p2), 3.0, 24.0);
      vec3 acc = vec3(0.0);
      for(float i=0.0;i<24.0;i+=1.0){ if(i>=n) break; acc += T(uv+dir*(i/(n-1.0)-0.5)).rgb; }
      return vec4(acc/n,1.0); }`
  },
  {
    id: 'echo', name: 'Echo', group: 'Blur',
    controls: [N('p0', 'Copies', 2, 8, 1, 4), N('p1', 'Offset', 2, 200, 1, 40, 'px'),
      N('p2', 'Angle', 0, 360, 1, 0, '°'), N('p3', 'Falloff', 0.2, 1, 0.02, 0.7)],
    frag: `vec4 fx(vec2 uv){
      float n = clamp(floor(p0),1.0,8.0);
      vec2 dir = vec2(cos(radians(p2)), sin(radians(p2)))*p1/uRes;
      vec3 acc = vec3(0.0); float w = 0.0;
      for(float i=0.0;i<8.0;i+=1.0){ if(i>=n) break; float k = pow(p3,i); acc += T(uv+dir*i).rgb*k; w += k; }
      return vec4(acc/w,1.0); }`
  },
  {
    id: 'tilt', name: 'Tilt blur', group: 'Blur', blurKey: 'p0',
    controls: [N('p0', 'Radius', 0, 120, 1, 40), N('p1', 'Focus', 0, 1, 0.01, 0.5),
      N('p2', 'Band', 0, 0.5, 0.01, 0.12), N('p3', 'Angle', 0, 180, 1, 0, '°'), N('p4', 'Feather', 0.01, 0.5, 0.01, 0.14)],
    frag: `vec4 fx(vec2 uv){
      float a = radians(p3);
      float d = abs(dot(uv-0.5, vec2(-sin(a), cos(a))) - (p1-0.5));
      float m = smoothstep(p2, p2+max(0.01,p4), d);
      return vec4(mix(T(uv).rgb, B(uv).rgb, m),1.0); }`
  },
  {
    id: 'radial', name: 'Isolated blur', group: 'Blur', blurKey: 'p0',
    controls: [N('p0', 'Radius', 0, 120, 1, 46), N('p1', 'Centre X', 0, 1, 0.01, 0.5),
      N('p2', 'Centre Y', 0, 1, 0.01, 0.45), N('p3', 'Clear zone', 0.02, 0.8, 0.01, 0.22),
      N('p4', 'Feather', 0.01, 0.6, 0.01, 0.18)],
    frag: `vec4 fx(vec2 uv){
      float d = length((uv-vec2(p1,p2))*vec2(uRes.x/uRes.y, 1.0));
      float m = smoothstep(p3, p3+max(0.01,p4), d);
      return vec4(mix(T(uv).rgb, B(uv).rgb, m),1.0); }`
  },

  /* ---- five the board did not have ---- */

  {
    id: 'kaleido', name: 'Kaleidoscope', group: 'Distort',
    controls: [N('p0', 'Segments', 2, 24, 1, 6), N('p1', 'Turn', -180, 180, 1, 0, '\u00b0'),
      N('p2', 'Zoom', 0.2, 3, 0.01, 1), N('p3', 'Centre X', -1, 1, 0.01, 0),
      N('p4', 'Centre Y', -1, 1, 0.01, 0), N('p5', 'Amount', 0, 1, 0.01, 1)],
    /* A wedge of the picture, mirrored round a circle. The one effect here that
     * turns a photograph into a pattern, which is a different kind of answer
     * from every other effect on the list: you stop looking at the subject and
     * start looking at what it is made of. */
    frag: `vec4 fx(vec2 uv){
      float asp = uRes.x/uRes.y;
      vec2 c = vec2(0.5) + vec2(p3,p4)*0.5;
      vec2 d = (uv - c) * vec2(asp, 1.0);
      float seg = 6.2831853 / max(2.0, floor(p0));
      float a = atan(d.y, d.x) + radians(p1);
      /* Folded into one wedge and then mirrored inside it, which is what makes
         the seams meet rather than butt against each other. */
      a = abs(mod(a, seg) - seg*0.5);
      vec2 q = vec2(cos(a), sin(a)) * length(d) * max(0.05, p2);
      q.x /= asp;
      return vec4(mix(T(uv).rgb, T(mirror(q + c)).rgb, p5), 1.0); }`
  },

  {
    id: 'warp', name: 'Warp', group: 'Distort',
    controls: [N('p0', 'Ripples', 1, 24, 1, 8), N('p1', 'Amount', -1, 1, 0.01, 0.5),
      N('p2', 'Radius', 0.05, 1.5, 0.01, 0.6), N('p3', 'Centre X', -1, 1, 0.01, 0),
      N('p4', 'Centre Y', -1, 1, 0.01, 0),
      E('p5', 'Kind', 0, ['Twirl', 'Bulge', 'Pinch', 'Ripple', 'Unroll'])],
    /* The classic warp family, which the board only half had: Liquify pushes
     * pixels about with noise, and none of these five do. Unroll is the odd one
     * — it reads the picture in polar coordinates, so a circle becomes a line
     * and a face becomes a landscape. */
    frag: `vec4 fx(vec2 uv){
      float asp = uRes.x/uRes.y;
      vec2 c = vec2(0.5) + vec2(p3,p4)*0.5;
      vec2 d = (uv - c) * vec2(asp, 1.0);
      float r = length(d), a = atan(d.y, d.x);
      float R = max(0.001, p2);
      /* Falls off to nothing at the edge of the radius, squared so the middle
         moves and the rim stays put. */
      float t = clamp(1.0 - r/R, 0.0, 1.0); t *= t;
      int m = int(p5 + 0.5);
      if(m == 4){ return T(mirror(vec2(a/6.2831853 + 0.5, r*2.0))); }
      if(m == 0) a += p1 * t * 3.1415926;
      else if(m == 1) r *= 1.0 - p1 * t * 0.85;
      else if(m == 2) r *= 1.0 + p1 * t * 0.85;
      else r += p1 * 0.05 * t * sin(r * floor(p0) * 12.566);
      vec2 q = vec2(cos(a), sin(a)) * r;
      q.x /= asp;
      return T(mirror(q + c)); }`
  },

  {
    id: 'sort', name: 'Pixel sort', group: 'Distort',
    controls: [N('p0', 'Run length', 8, 80, 1, 56, 'px'), N('p1', 'Threshold', 0, 1, 0.01, 0.34),
      N('p2', 'Angle', -1, 1, 0.01, 0), N('p3', 'Amount', 0, 1, 0.01, 1),
      E('p4', 'Sorts', 0, ['The light', 'The dark']), N('p5', 'Softness', 0, 1, 0.01, 0)],
    /* The most recognisable mark in glitch art, and the one this board most
     * conspicuously lacked.
     *
     * A fragment shader can gather and cannot scatter, so it cannot write a
     * sorted run out. What it can do is work out where this pixel would have
     * come from: count how many pixels in the run are brighter, and read from
     * that position. Wherever the run climbs or falls steadily the two are the
     * same answer; where it does not, what comes out is the melted smear pixel
     * sorting is actually known for.
     *
     * Three passes over the run, so the run length is the cost, and eighty is
     * the ceiling for that reason. It has to be that long: sorting across
     * eighteen pixels is a texture, and the streaks people mean by pixel
     * sorting run across a good part of the picture. */
    frag: `vec4 fx(vec2 uv){
      vec4 src = T(uv);
      float me = luma(src.rgb);
      bool up = p4 < 0.5;
      float thr = p1;
      bool inRun = up ? me >= thr : me <= thr;
      if(!inRun) return src;
      float N = floor(p0);
      /* Named walk rather than step, because step is a builtin: shadowing one
         works and reads like a bug to anyone who knows GLSL. */
      vec2 walk = vec2(cos(p2*3.1415926), sin(p2*3.1415926)) / uRes;
      float s = 0.0;
      for(float i=1.0;i<=80.0;i+=1.0){
        if(i > N) break;
        float l = luma(T(uv - walk*i).rgb);
        if(up ? l < thr : l > thr) break;
        s = i;
      }
      float e = 0.0;
      for(float i=1.0;i<=80.0;i+=1.0){
        if(i > N) break;
        float l = luma(T(uv + walk*i).rgb);
        if(up ? l < thr : l > thr) break;
        e = i;
      }
      float len = s + e;
      if(len < 2.0) return src;
      float rank = 0.0;
      for(float i=0.0;i<=160.0;i+=1.0){
        if(i > len) break;
        if(luma(T(uv + walk*(i - s)).rgb) > me) rank += 1.0;
      }
      /* Softness reads a little either side of where it landed, which takes the
         staircase off the streaks without taking the streaks off. */
      float soft = p5 * 1.5;
      vec3 got = T(uv + walk*(rank - s)).rgb;
      if(soft > 0.01){
        got = (got + T(uv + walk*(rank - s + soft)).rgb + T(uv + walk*(rank - s - soft)).rgb) / 3.0;
      }
      return vec4(mix(src.rgb, got, p3), src.a); }`
  },

  {
    id: 'signal', name: 'Channel shift', group: 'Signal',
    controls: [N('p0', 'Split', 0, 30, 0.5, 16, 'px'), N('p1', 'Angle', -1, 1, 0.01, 0),
      N('p2', 'Wobble', 0, 40, 0.5, 6, 'px'), N('p3', 'Wobble scale', 0.2, 8, 0.1, 2),
      N('p4', 'Line spacing', 1, 12, 1, 3, 'px'), N('p5', 'Lines', 0, 1, 0.01, 0.4)],
    /* Red one way, blue the other, and the picture stops being a photograph and
     * starts being a signal that went wrong on the way. The wobble is what
     * keeps it from reading as a ruler: a clean split looks like a mistake in
     * the software, and a drifting one looks like a mistake in the wire. */
    frag: `vec4 fx(vec2 uv){
      vec2 d = vec2(cos(p1*3.1415926), sin(p1*3.1415926)) * (p0/max(1.0,uRes.x));
      float w = (vnoise(vec2(uv.y * p3 * 40.0, uSeed*7.0)) - 0.5) * (p2/max(1.0,uRes.x)) * 2.0;
      vec2 o = d + vec2(w, 0.0);
      vec3 col = vec3(T(uv + o).r, T(uv).g, T(uv - o).b);
      float lines = mix(1.0, 0.55 + 0.45*sin(uv.y * uRes.y * 3.1415926 / max(1.0, floor(p4))), p5);
      return vec4(col * lines, 1.0); }`
  },

  {
    id: 'gradmap', name: 'Gradient map', group: 'Map',
    controls: [N('p0', 'Midpoint', 0.05, 0.95, 0.01, 0.5), N('p1', 'Contrast', -1, 1, 0.01, 0),
      N('p2', 'Keep detail', 0, 1, 0.01, 0.35), N('p3', 'Amount', 0, 1, 0.01, 1),
      C('c0', 'Shadows', '#101A2E'), C('c1', 'Midtones', '#C4553A'), C('c2', 'Highlights', '#F2E7CE')],
    /* Three colours across the range of the picture, which is how a duotone
     * becomes a tritone and how a photograph is put into a palette rather than
     * merely tinted. Keep detail holds some of the original luminance back, so
     * a portrait does not flatten into three flat shapes unless that is what
     * was wanted. */
    frag: `vec4 fx(vec2 uv){
      vec4 src = T(uv);
      float l = clamp((luma(src.rgb) - p0) * (1.0 + p1*2.0) + 0.5, 0.0, 1.0);
      vec3 g = l < 0.5 ? mix(c0, c1, l*2.0) : mix(c1, c2, (l-0.5)*2.0);
      vec3 col = mix(g, g * (0.55 + l*0.9), p2);
      return vec4(mix(src.rgb, col, p3), src.a); }`
  },

  /* ---- and three that read two pictures ----
   *
   * Everything above this line treats one picture. These treat two: the card
   * itself, and whatever card is wired into it. Draw a line from one card to
   * another and the one at the start of the line is what S reads.
   *
   * With nothing wired, S gives back the card's own pixels — so Displace
   * pushes a picture around by its own brightness, Stencil cuts it out of
   * itself, and Through reads its own colours. All three are real effects in
   * that state rather than an error, which is what lets them sit in the list
   * beside everything else instead of being greyed out until you understand
   * them. */

  {
    id: 'displace', name: 'Displace', group: 'Pair',
    controls: [N('p0', 'Amount', 0, 100, 1, 45, 'px'), N('p1', 'Map scale', 0.25, 4, 0.01, 1),
      N('p2', 'Angle', -180, 180, 1, 0, '\u00b0'), E('p3', 'Reads', 2, ['Colour', 'Brightness', 'Along the angle']),
      N('p4', 'Map turn', -180, 180, 1, 0, '\u00b0'), N('p5', 'Amount', 0, 1, 0.01, 1)],
    /* The oldest two-picture effect there is: one image's brightness decides
     * how far the other one's pixels move. A crumpled paper scan over a
     * wordmark and the wordmark is printed on crumpled paper. */
    frag: `vec4 fx(vec2 uv){
      vec2 m = rot((uv - 0.5) / max(0.05, p1), radians(p4)) + 0.5;
      vec4 map = S(mirror(m));
      vec2 d;
      int k = int(p3 + 0.5);
      /* Colour reads red across and green down, which is what a displacement
         map written for anywhere else will be. Brightness is the one you get
         from a photograph. */
      if(k == 0) d = map.rg - 0.5;
      else if(k == 1) d = vec2(luma(map.rgb) - 0.5);
      else d = vec2(cos(radians(p2)), sin(radians(p2))) * (luma(map.rgb) - 0.5);
      vec2 push = d * p0 * 2.0 / uRes;
      return vec4(mix(T(uv).rgb, T(mirror(uv + push)).rgb, p5), 1.0); }`
  },

  /* -----------------------------------------------------------------------
   * The four that read a depth map.
   *
   * Every one of them takes the wired card as distance rather than as a
   * picture, which is the whole reason a depth map is a card here and not a
   * hidden buffer: it can be made from a photograph, corrected by hand with
   * any effect on the list, drawn from scratch as a sketch, or brought in
   * from somewhere else, and all four of these read it the same way.
   *
   * They share three controls on purpose. `Map scale` because a map made at
   * one size has to line up with a picture at another, `Near is` because half
   * the world writes near as white and half as black, and `Amount` because
   * every one of them is worth having at less than full strength.
   * --------------------------------------------------------------------- */
  {
    id: 'parallax', name: 'Parallax', group: 'Pair',
    controls: [N('p0', 'Shift', 0, 200, 1, 44, 'px'), N('p1', 'Focus', 0, 1, 0.01, 0.5),
      N('p2', 'Direction', -180, 180, 1, 0, '°'), N('p3', 'Map scale', 0.25, 4, 0.01, 1),
      E('p4', 'Near is', 0, ['White', 'Black']), N('p5', 'Amount', 0, 1, 0.01, 1)],
    /* A flat photograph moved as though it had layers: what is near travels
     * and what is far holds still, which is the cue the eye reads as space
     * before it reads anything else.
     *
     * Walked three times rather than shifted once. A single step samples the
     * map where the pixel ends up rather than where it came from, which
     * smears every edge in the direction of travel; three passes settle on
     * the place the depth actually agrees with, and cost three lookups. */
    frag: `vec4 fx(vec2 uv){
      vec2 dir = vec2(cos(radians(p2)), sin(radians(p2))) * p0 * 2.0 / uRes;
      vec2 p = uv;
      for(int i = 0; i < 3; i++){
        vec2 m = (p - 0.5) / max(0.05, p3) + 0.5;
        float d = luma(S(mirror(m)).rgb);
        if(p4 > 0.5) d = 1.0 - d;
        p = uv + dir * (d - p1);
      }
      return vec4(mix(T(uv).rgb, T(mirror(p)).rgb, p5), 1.0); }`
  },

  {
    id: 'dof', name: 'Depth of field', group: 'Pair', blurKey: 'p0',
    controls: [N('p0', 'Blur', 0, 90, 1, 42), N('p1', 'Focus', 0, 1, 0.01, 0.45),
      N('p2', 'Falloff', 0.2, 6, 0.05, 2.2), N('p3', 'Map scale', 0.25, 4, 0.01, 1),
      E('p4', 'Near is', 0, ['White', 'Black']), N('p5', 'Amount', 0, 1, 0.01, 1)],
    /* A fast lens, after the fact. One plane stays sharp and everything on
     * either side of it goes, which is the difference between a photograph of
     * a thing and a photograph of a thing among other things.
     *
     * Both sides of the plane, not just behind it — a lens blurs what is too
     * close as readily as what is too far, and a depth of field that only
     * softened the background would be a background blur wearing the name. */
    frag: `vec4 fx(vec2 uv){
      vec2 m = (uv - 0.5) / max(0.05, p3) + 0.5;
      float d = luma(S(mirror(m)).rgb);
      if(p4 > 0.5) d = 1.0 - d;
      float k = clamp(abs(d - p1) * p2, 0.0, 1.0);
      return vec4(mix(T(uv).rgb, mix(T(uv).rgb, B(uv).rgb, k), p5), 1.0); }`
  },

  {
    id: 'fog', name: 'Fog', group: 'Pair',
    controls: [N('p0', 'Map scale', 0.25, 4, 0.01, 1), N('p1', 'Starts at', 0, 1, 0.01, 0.25),
      N('p2', 'Full at', 0, 1, 0.01, 0.95), N('p3', 'Density', 0, 1, 0.01, 0.8),
      N('p4', 'Washes out', 0, 1, 0.01, 0.6), E('p5', 'Near is', 0, ['White', 'Black']),
      C('c0', 'Air', '#C7D3DE')],
    /* Atmospheric perspective as a control rather than an accident. Distance
     * takes the colour out of a thing before it takes the thing away, so the
     * wash happens first and the air comes in over it — a fog that only
     * blended towards grey would flatten a red roof and a green field into
     * the same grey at the same rate, which is not what air does. */
    frag: `vec4 fx(vec2 uv){
      vec2 m = (uv - 0.5) / max(0.05, p0) + 0.5;
      float d = luma(S(mirror(m)).rgb);
      if(p5 > 0.5) d = 1.0 - d;
      float t = smoothstep(min(p1, p2 - 0.001), max(p2, p1 + 0.001), 1.0 - d);
      vec3 base = T(uv).rgb;
      vec3 pale = mix(base, vec3(luma(base)), t * p4);
      return vec4(mix(pale, c0, t * p3), 1.0); }`
  },

  {
    id: 'relight', name: 'Relight', group: 'Pair',
    controls: [N('p0', 'Relief', 0, 4, 0.05, 1.6), N('p1', 'Light from', -180, 180, 1, -45, '°'),
      N('p2', 'Height', 0, 90, 1, 40, '°'), N('p3', 'Strength', 0, 2, 0.05, 1),
      N('p4', 'Ambient', 0, 1, 0.01, 0.35), E('p5', 'Near is', 0, ['White', 'Black']),
      C('c0', 'Light', '#FFF3E0')],
    /* A depth map is a height field, and a height field has a surface. The
     * slope at each point is the difference between its neighbours, which
     * gives a normal, and a normal plus a direction gives light — so a
     * photograph can be lit again from somewhere it never was.
     *
     * The most striking of the four on anything with a shape in it, and the
     * most obviously wrong on anything without one, which is fair: it is
     * showing you exactly what the map claims the surface is. */
    frag: `vec4 fx(vec2 uv){
      vec2 t = 1.5 / uRes;
      float s = p5 > 0.5 ? -1.0 : 1.0;
      float dl = luma(S(uv - vec2(t.x, 0.0)).rgb) * s;
      float dr = luma(S(uv + vec2(t.x, 0.0)).rgb) * s;
      float du = luma(S(uv - vec2(0.0, t.y)).rgb) * s;
      float dd = luma(S(uv + vec2(0.0, t.y)).rgb) * s;
      vec3 n = normalize(vec3((dl - dr) * p0 * 8.0, (du - dd) * p0 * 8.0, 1.0));
      float a = radians(p1), e = radians(p2);
      vec3 L = normalize(vec3(cos(a) * cos(e), sin(a) * cos(e), sin(e)));
      float lam = clamp(dot(n, L), 0.0, 1.0);
      vec3 base = T(uv).rgb;
      /* Scaled so that a surface facing the camera with the light where it
         starts comes back about as bright as it went in. A relight whose
         middle setting blows a photograph to white is a relight nobody can
         judge the direction on. */
      vec3 lit = base * (p4 + lam * p3) * mix(vec3(1.0), c0, 0.8);
      /* A glance off the surface where it faces the light squarely. */
      float spec = pow(lam, 22.0) * p3 * 0.28;
      return vec4(clamp(lit + spec, 0.0, 1.0), 1.0); }`
  },

  {
    id: 'stencil', name: 'Stencil', group: 'Pair',
    controls: [N('p0', 'Cut at', 0, 1, 0.01, 0.5), N('p1', 'Softness', 0, 1, 0.01, 0.12),
      N('p2', 'Map scale', 0.25, 4, 0.01, 1), E('p3', 'Keeps', 0, ['The light', 'The dark']),
      E('p4', 'Behind', 0, ['A colour', 'The other picture']), C('c0', 'Behind', '#F2EFE6')],
    /* One picture decides where the other one shows. A shape knocked out of a
     * photograph, a photograph poured into a letterform — the thing every
     * designer opens something else to do. */
    frag: `vec4 fx(vec2 uv){
      vec2 m = (uv - 0.5) / max(0.05, p2) + 0.5;
      float l = luma(S(mirror(m)).rgb);
      float e = max(0.005, p1) * 0.5;
      float k = smoothstep(p0 - e, p0 + e, l);
      if(p3 > 0.5) k = 1.0 - k;
      vec3 back = p4 > 0.5 ? S(uv).rgb : c0;
      return vec4(mix(back, T(uv).rgb, k), 1.0); }`
  },

  {
    id: 'through', name: 'Through', group: 'Pair',
    controls: [N('p0', 'Midpoint', 0.05, 0.95, 0.01, 0.5), N('p1', 'Contrast', -1, 1, 0.01, 0),
      N('p2', 'Read at', 0, 1, 0.01, 0.5), E('p3', 'Reads', 0, ['Across', 'Down']),
      N('p4', 'Amount', 0, 1, 0.01, 1), N('p5', 'Keep detail', 0, 1, 0.01, 0.25)],
    /* This picture's range of light, coloured by a line taken across the other
     * one. A gradient map whose gradient is a photograph — which is how a
     * palette pulled off one image gets put onto another without anybody
     * naming a single colour. */
    frag: `vec4 fx(vec2 uv){
      vec4 src = T(uv);
      float l = clamp((luma(src.rgb) - p0) * (1.0 + p1*2.0) + 0.5, 0.0, 1.0);
      vec2 at = p3 > 0.5 ? vec2(p2, l) : vec2(l, p2);
      vec3 col = S(at).rgb;
      col = mix(col, col * (0.55 + l*0.9), p5);
      return vec4(mix(src.rgb, col, p4), src.a); }`
  },

  /* ---------------------------------------------------------------------
   * The second batch.
   *
   * The first thirty-eight were the ones the board needed to be a board. These
   * are the ones a designer keeps reaching for and had to leave to go and find
   * somewhere else: the paints, the print processes, the analogue faults, the
   * coordinate tricks. Curated rather than open — nothing here is loaded from
   * anywhere, and adding one is a commit — but there are a lot more of them
   * now, because a list you can exhaust in an afternoon stops being a place to
   * look for ideas.
   * ------------------------------------------------------------------- */

  {
    id: 'watercolour', name: 'Watercolour', group: 'Paint', blurKey: 'p5',
    controls: [N('p0', 'Bleed', 0, 1, 0.01, 0.45), N('p1', 'Wash size', 1, 14, 0.5, 4),
      N('p2', 'Washes', 2, 14, 1, 8), N('p3', 'Pigment edge', 0, 1, 0.01, 0.3),
      N('p4', 'Paper', 0, 1, 0.01, 0.5), N('p5', 'Soften', 0, 20, 1, 5),
      C('c0', 'Paper', '#F7F3E8')],
    /* Three things make a wash read as a wash, and none of them is blur.
     * Colour is drawn from a little way off in a direction that wanders, so
     * the boundaries wobble; it settles into a few flat steps, because a wash
     * is one loading of the brush; and pigment gathers at the edge as the
     * water dries, which is the dark rim that says watercolour more than the
     * colour ever does. The paper shows through the light end rather than
     * being painted over. */
    frag: `vec4 fx(vec2 uv){
      vec2 px = 1.0/uRes;
      vec2 w = vec2(vnoise(uv*p1*2.5+11.0), vnoise(uv*p1*2.5+31.0)) - 0.5;
      vec3 col = B(uv + w*p0*0.05).rgb;
      float steps = max(2.0, floor(p2));
      /* The wobble goes in before the step, not after. Quantising a gradient
         sky straight gives ruled horizontal bands, which is the one thing a
         wash never does; dithering the value by not quite one step first turns
         those band edges into the ragged boundary a drying wash leaves. */
      float wob = (vnoise(uv*p1*2.0 + 3.0) - 0.5) * 0.9 / steps;
      col = floor((col + wob)*steps + 0.5)/steps;
      float e = abs(luma(B(uv+vec2(px.x*2.0,0.0)).rgb) - luma(B(uv-vec2(px.x*2.0,0.0)).rgb))
              + abs(luma(B(uv+vec2(0.0,px.y*2.0)).rgb) - luma(B(uv-vec2(0.0,px.y*2.0)).rgb));
      col *= 1.0 - clamp(e*p3*7.0, 0.0, 0.55);
      float tooth = vnoise(uv*uRes.y/2.5)*0.6 + vnoise(uv*uRes.y/8.0)*0.4;
      col = mix(col, col*(0.86+tooth*0.28), p4);
      float wash = clamp((1.0-luma(col))*1.7 + 0.22, 0.0, 1.0);
      return vec4(mix(c0, col, wash), 1.0); }`
  },
  {
    id: 'pointil', name: 'Pointillism', group: 'Paint', blurKey: 'p5',
    controls: [N('p0', 'Dot', 3, 30, 0.5, 9, 'px'), N('p1', 'Scatter', 0, 1, 0.01, 0.6),
      N('p2', 'Size by light', 0, 1, 0.01, 0.7), N('p3', 'Colour spread', 0, 1, 0.01, 0.22),
      N('p4', 'Coverage', 0.3, 1.6, 0.02, 1), N('p5', 'Soften', 0, 20, 1, 3),
      C('c0', 'Paper', '#EFEADC')],
    /* Nine dabs a cell rather than one, each pulled off its grid position and
     * each taking its colour from where it actually landed — a field of dots
     * on a lattice reads as a screen, and the whole point of this one is that
     * it does not. */
    frag: `vec4 fx(vec2 uv){
      float cw = max(3.0, p0*unit());
      vec2 g = uRes/cw;
      vec2 cell = floor(uv*g);
      vec3 out0 = c0;
      for(float y=-1.0;y<=1.0;y+=1.0){
        for(float x=-1.0;x<=1.0;x+=1.0){
          vec2 id = cell + vec2(x,y);
          vec2 jitter = (vec2(hash(id), hash(id+7.7)) - 0.5) * p1;
          vec2 at = (id + 0.5 + jitter)/g;
          vec3 col = B(at).rgb;
          float r = mix(0.5, 0.22 + (1.0-luma(col))*0.55, p2) * p4;
          float d = length((uv - at) * g);
          float ink = 1.0 - smoothstep(r-0.18, r+0.18, d);
          /* Each dab is one pigment, not an average — a pointillist picture is
             made of colours that never touched each other on the palette. */
          vec3 hue = mix(col, clamp(col + (vec3(hash(id+3.1), hash(id+5.3), hash(id+9.1))-0.5)*0.9, 0.0, 1.0), p3);
          out0 = mix(out0, hue, ink);
        }
      }
      return vec4(out0, 1.0); }`
  },
  {
    id: 'charcoal', name: 'Charcoal', group: 'Paint', blurKey: 'p5',
    controls: [N('p0', 'Pressure', 0.2, 3, 0.05, 1), N('p1', 'Tooth', 0, 1, 0.01, 0.5),
      N('p2', 'Smudge', 0, 1, 0.01, 0.5), N('p3', 'Edges', 0, 2, 0.02, 0.8),
      N('p4', 'Lift', 0, 1, 0.01, 0.35), N('p5', 'Soften', 0, 20, 1, 4),
      C('c0', 'Paper', '#EDE7DA'), C('c1', 'Charcoal', '#17161A')],
    /* Charcoal is subtractive: the paper is white and every mark takes light
     * away, so this works from darkness rather than from colour. The smudge is
     * a read taken along the direction the tone is falling, which is what a
     * thumb does to a stick of charcoal. */
    frag: `vec4 fx(vec2 uv){
      vec2 px = 1.0/uRes;
      float gx = luma(B(uv+vec2(px.x*2.0,0.0)).rgb) - luma(B(uv-vec2(px.x*2.0,0.0)).rgb);
      float gy = luma(B(uv+vec2(0.0,px.y*2.0)).rgb) - luma(B(uv-vec2(0.0,px.y*2.0)).rgb);
      vec2 along = vec2(-gy, gx);
      float len = max(1e-4, length(along));
      vec3 smudged = B(uv + (along/len) * p2 * 0.012).rgb;
      /* Pressure is contrast about the middle grey, not a gamma curve. As a
         curve it pushed everything into the midtones and the card came back a
         flat grey sheet with the picture only just visible in it — charcoal is
         a black stick on white paper and it should reach both ends. */
      float base = 1.0 - luma(mix(B(uv).rgb, smudged, p2));
      float dark = clamp((base - 0.5) * (0.7 + p0*1.7) + 0.5, 0.0, 1.0);
      dark += clamp(len*p3*4.0, 0.0, 0.8);
      float tooth = vnoise(uv*uRes.y/2.0)*0.55 + vnoise(uv*uRes.y/6.0)*0.45;
      dark *= mix(1.0, 0.55 + tooth*0.9, p1);
      dark -= p4 * smoothstep(0.55, 1.0, luma(B(uv).rgb));
      return vec4(mix(c0, c1, clamp(dark, 0.0, 1.0)), 1.0); }`
  },
  {
    id: 'marker', name: 'Marker', group: 'Paint', blurKey: 'p5',
    controls: [N('p0', 'Nib', 4, 40, 0.5, 14, 'px'), N('p1', 'Angle', -90, 90, 1, 35, '°'),
      N('p2', 'Inks', 2, 10, 1, 5), N('p3', 'Overlap', 0, 1, 0.01, 0.55),
      N('p4', 'Streak', 0, 1, 0.01, 0.4), N('p5', 'Soften', 0, 20, 1, 4),
      C('c0', 'Paper', '#FFFDF6')],
    /* A chisel nib lays a band of one flat ink, and where two passes cross the
     * ink doubles. That doubling is the whole look — it is what makes a marker
     * drawing read as strokes rather than as a flat fill. */
    frag: `vec4 fx(vec2 uv){
      float a = radians(p1);
      vec2 r = rot(uv*uRes/uRes.y, a);
      float band = max(4.0, p0*unit())/uRes.y;
      float lane = floor(r.y/band);
      float within = fract(r.y/band);
      float steps = max(2.0, floor(p2));
      vec3 ink = floor(B(uv).rgb*steps + 0.5)/steps;
      /* The nib runs dry along the stroke. */
      float dry = 1.0 - p4 * (0.35 + 0.65*vnoise(vec2(r.x*40.0, lane*3.1)));
      /* Edges of the band are where the ink pools. */
      float edge = smoothstep(0.0, 0.12, within) * smoothstep(1.0, 0.88, within);
      /* A marker is opaque. The paper is what is left where the nib did not
         go, not a tint showing through everywhere. */
      float lay = clamp((0.35 + (1.0 - luma(ink))*0.9) * (0.75 + edge*0.45) * dry, 0.0, 1.0);
      vec3 laid = mix(c0, ink, clamp(lay*1.5, 0.0, 1.0));
      /* A second pass, crossed, which is where the ink doubles. */
      vec2 r2 = rot(uv*vec2(uRes.x/uRes.y, 1.0), a + 1.5708);
      float lane2 = floor(r2.y/band);
      float dry2 = 1.0 - p4 * (0.35 + 0.65*vnoise(vec2(r2.x*40.0, lane2*2.7)));
      float lay2 = clamp((1.0 - luma(ink)) * dry2 - 0.35, 0.0, 1.0) * p3;
      return vec4(mix(laid, ink*0.72, lay2), 1.0); }`
  },
  {
    id: 'blueprint', name: 'Blueprint', group: 'Type', blurKey: 'p4',
    controls: [N('p0', 'Line', 0.4, 4, 0.1, 1.2), N('p1', 'Threshold', 0.01, 0.6, 0.01, 0.1),
      N('p2', 'Grid', 0, 60, 1, 22, 'px'), N('p3', 'Grid weight', 0, 1, 0.01, 0.3),
      N('p4', 'Soften', 0, 20, 1, 1), N('p5', 'Fade', 0, 1, 0.01, 0.15),
      C('c0', 'Paper', '#123A6B'), C('c1', 'Line', '#DDEBFF')],
    /* Edges in white on process blue with the drawing grid still on the sheet.
     * Not a colour swap: a blueprint is a drawing, so what survives is the
     * lines and the grid they were drawn on, and everything else goes. */
    frag: `vec4 fx(vec2 uv){
      vec2 e = p0/uRes;
      float l = luma(B(uv).rgb);
      float gx = luma(B(uv+vec2(e.x,0.0)).rgb) - luma(B(uv-vec2(e.x,0.0)).rgb);
      float gy = luma(B(uv+vec2(0.0,e.y)).rgb) - luma(B(uv-vec2(0.0,e.y)).rgb);
      float edge = smoothstep(p1, p1*2.2, length(vec2(gx,gy)));
      float g = 0.0;
      if(p2 >= 1.0){
        vec2 cell = uv*uRes/max(1.0, p2*unit());
        vec2 f = abs(fract(cell) - 0.5);
        g = (1.0 - smoothstep(0.44, 0.5, max(f.x, f.y))) * 0.0 + smoothstep(0.46, 0.5, max(f.x, f.y));
      }
      float ink = clamp(edge + g*p3 + l*p5, 0.0, 1.0);
      return vec4(mix(c0, c1, ink), 1.0); }`
  },
  {
    id: 'woodcut', name: 'Woodcut', group: 'Type', blurKey: 'p5',
    controls: [N('p0', 'Gouge', 3, 40, 0.5, 10, 'px'), N('p1', 'Angle', -90, 90, 1, 0, '°'),
      N('p2', 'Bite', 0.2, 3, 0.05, 1.1), N('p3', 'Wobble', 0, 1, 0.01, 0.4),
      N('p4', 'Solids', 0, 1, 0.01, 0.35), N('p5', 'Soften', 0, 20, 1, 3),
      C('c0', 'Paper', '#F2E9D8'), C('c1', 'Ink', '#141210')],
    /* One long cut a lane, thick where the block is dark and thinning to
     * nothing where it is light — the tone is carried by the width of the
     * line rather than by its colour, which is the whole discipline. Below a
     * point the cuts close up and the block prints solid. */
    frag: `vec4 fx(vec2 uv){
      float a = radians(p1);
      vec2 r = rot(uv*vec2(uRes.x/uRes.y, 1.0), a);
      float pitch = max(3.0, p0*unit())/uRes.y;
      float lane = r.y/pitch;
      float wob = (vnoise(vec2(r.x*22.0, floor(lane)*1.7)) - 0.5) * p3 * 0.5;
      float within = abs(fract(lane + wob) - 0.5) * 2.0;
      float dark = pow(clamp(1.0 - luma(B(uv).rgb), 0.0, 1.0), 1.0/max(0.2, p2));
      float w = clamp(dark, 0.0, 1.0);
      float ink = 1.0 - smoothstep(w - 0.12, w + 0.12, within);
      ink = max(ink, smoothstep(1.0 - p4, 1.0 - p4*0.5, dark));
      return vec4(mix(c0, c1, ink), 1.0); }`
  },
  {
    id: 'barcode', name: 'Barcode', group: 'Type', blurKey: 'p5',
    controls: [N('p0', 'Bar', 1, 20, 0.5, 4, 'px'), N('p1', 'Read from', 0, 1, 0.01, 0.5),
      N('p2', 'Bite', 0.2, 3, 0.05, 1), E('p3', 'Run', 0, ['Down', 'Across']),
      N('p4', 'Keep the picture', 0, 1, 0.01, 0), N('p5', 'Soften', 0, 20, 1, 2),
      C('c0', 'Paper', '#FFFFFF'), C('c1', 'Ink', '#000000')],
    /* A picture read as one line of it, printed as bar widths. It throws away
     * nearly everything, which is the point: what is left is the rhythm of the
     * thing, and a wordmark or a skyline survives it in a way a face does not.
     * Read from says which line across the picture is the one being read. */
    frag: `vec4 fx(vec2 uv){
      bool across = p3 > 0.5;
      float along = across ? uv.y : uv.x;
      float pitch = max(1.0, p0*unit())/(across ? uRes.y : uRes.x);
      float col = floor(along/pitch);
      float at = (col + 0.5) * pitch;
      vec2 sample0 = across ? vec2(p1, at) : vec2(at, p1);
      float dark = pow(clamp(1.0 - luma(B(sample0).rgb), 0.0, 1.0), 1.0/max(0.2, p2));
      float within = abs(fract(along/pitch) - 0.5) * 2.0;
      float ink = 1.0 - smoothstep(dark - 0.1, dark + 0.1, within);
      vec3 paper = mix(c0, T(uv).rgb, p4);
      return vec4(mix(paper, c1, ink), 1.0); }`
  },

  {
    id: 'cmyk', name: 'CMYK', group: 'Print', blurKey: 'p5',
    controls: [N('p0', 'Screen', 2, 24, 0.5, 6, 'px'), N('p1', 'Ink', 0, 1.5, 0.02, 0.2),
      N('p2', 'Black', 0, 1.5, 0.02, 0.1), N('p3', 'Angle', -45, 45, 1, 0, '°'),
      N('p4', 'Misregister', 0, 1, 0.01, 0), N('p5', 'Soften', 0, 20, 1, 1),
      C('c0', 'Paper', '#FFFFFF')],
    /* Four screens at the angles a press actually uses — fifteen, seventy-five,
     * nought and forty-five — which is what makes the rosette. Halftone here
     * is one screen in one colour; this is the process, and it is a different
     * picture: the dots sit in four separate lattices and the colour comes
     * from how they overlap rather than from any of them.
     *
     * Misregister is the reason to have it. Nudging the plates apart is the
     * single most recognisable print fault there is, and it is worth a slider
     * rather than an accident. */
    frag: `float dotAt(vec2 uv, float ang, float amt, float pitch, vec2 slip){
      vec2 r = rot((uv + slip)*uRes/pitch, radians(ang));
      vec2 f = fract(r) - 0.5;
      float rad = sqrt(clamp(amt, 0.0, 1.0)) * 0.78;
      return 1.0 - smoothstep(rad - 0.09, rad + 0.09, length(f));
    }
    vec4 fx(vec2 uv){
      float pitch = max(2.0, p0*unit());
      float slip = p4 * pitch / uRes.y;
      vec3 src = B(uv).rgb;
      float k = 1.0 - max(src.r, max(src.g, src.b));
      vec3 cmy = (vec3(1.0) - src - k) / max(1e-3, 1.0 - k);
      cmy = clamp(cmy * (1.0 + p1), 0.0, 1.0);
      float kk = clamp(k * (1.0 + p2), 0.0, 1.0);
      float c = dotAt(uv, p3 + 15.0, cmy.r, pitch, vec2( slip, 0.0));
      float m = dotAt(uv, p3 + 75.0, cmy.g, pitch, vec2(-slip*0.6, slip*0.8));
      float y = dotAt(uv, p3,        cmy.b, pitch, vec2( slip*0.3, -slip));
      float b = dotAt(uv, p3 + 45.0, kk,    pitch, vec2(0.0));
      vec3 col = c0;
      col *= mix(vec3(1.0), vec3(0.0, 0.68, 0.94), c);
      col *= mix(vec3(1.0), vec3(0.93, 0.0, 0.55), m);
      col *= mix(vec3(1.0), vec3(1.0, 0.94, 0.0), y);
      col *= mix(vec3(1.0), vec3(0.07), b);
      return vec4(col, 1.0); }`
  },
  {
    id: 'newsprint', name: 'Newsprint', group: 'Print', blurKey: 'p5',
    controls: [N('p0', 'Screen', 3, 30, 0.5, 9, 'px'), N('p1', 'Gain', 0, 1, 0.01, 0.12),
      N('p2', 'Contrast', -0.5, 2, 0.05, 0.45), N('p3', 'Rough', 0, 1, 0.01, 0.5),
      N('p4', 'Angle', -45, 45, 1, 45, '°'), N('p5', 'Soften', 0, 20, 1, 2),
      C('c0', 'Paper', '#E8E2D2'), C('c1', 'Ink', '#1B1A19')],
    /* Cheap paper and too much ink. The dot is coarse, it spreads into the
     * paper — dot gain, the thing every printer complains about — and the
     * paper is not white and never was. */
    frag: `vec4 fx(vec2 uv){
      float pitch = max(3.0, p0*unit());
      vec2 r = rot(uv*uRes/pitch, radians(p4));
      vec2 f = fract(r) - 0.5;
      float v = luma(B(uv).rgb);
      v = clamp((v - 0.5)*(1.0 + p2) + 0.5, 0.0, 1.0);
      float amt = clamp(1.0 - v + p1*0.35, 0.0, 1.0);
      float rad = sqrt(amt) * 0.8;
      /* The edge of a dot on absorbent paper is not a circle. */
      float bite = (vnoise(r*3.0) - 0.5) * p3 * 0.22;
      float d = length(f) + bite;
      float ink = 1.0 - smoothstep(rad - 0.12, rad + 0.12, d);
      vec3 paper = c0 * (0.94 + vnoise(uv*uRes.y/2.0)*0.1);
      return vec4(mix(paper, c1, ink), 1.0); }`
  },
  {
    id: 'screenprint', name: 'Screenprint', group: 'Print', blurKey: 'p5',
    controls: [N('p0', 'Inks', 2, 8, 1, 4), N('p1', 'Misregister', 0, 1, 0.01, 0.35),
      N('p2', 'Spread', 0, 1, 0.01, 0.4), N('p3', 'Tooth', 0, 1, 0.01, 0.3),
      N('p4', 'Ink weight', 0, 1, 0.01, 0.85), N('p5', 'Soften', 0, 20, 1, 4),
      C('c0', 'Paper', '#F4F0E6')],
    /* One flat colour a pass, each pass laid down slightly out of place. Every
     * layer is opaque, so what you get is not a blend of the picture but a
     * stack of solid shapes — which is why a screenprint reads as a poster
     * and a posterised photograph does not. */
    frag: `vec4 fx(vec2 uv){
      float inks = max(2.0, floor(p0));
      vec3 col = c0;
      for(float i = 0.0; i < 8.0; i += 1.0){
        if(i >= inks) break;
        /* Each pass is pulled in its own direction, by a hand. */
        vec2 slip = (vec2(hash(vec2(i, 1.7)), hash(vec2(i, 9.3))) - 0.5) * p1 * 0.035;
        vec3 src = B(uv + slip).rgb;
        float v = 1.0 - luma(src);
        /* This pass covers everything darker than its own step. */
        float lo = (i + 0.5) / inks;
        float edge = 0.02 + p2*0.16 + (vnoise((uv+slip)*uRes.y/6.0) - 0.5)*p3*0.2;
        float on = smoothstep(lo - edge, lo + edge, v);
        vec3 ink = floor(src*inks + 0.5)/inks;
        col = mix(col, ink, on * p4);
      }
      return vec4(col, 1.0); }`
  },
  {
    id: 'mosaic', name: 'Mosaic', group: 'Grid', blurKey: 'p5',
    controls: [N('p0', 'Tile', 4, 60, 1, 16, 'px'), N('p1', 'Grout', 0, 0.5, 0.01, 0.12),
      N('p2', 'Bevel', 0, 1, 0.01, 0.45), N('p3', 'Vary', 0, 1, 0.01, 0.25),
      N('p4', 'Jitter', 0, 1, 0.01, 0.2), N('p5', 'Soften', 0, 20, 1, 2),
      C('c0', 'Grout', '#2A2825')],
    /* Not pixelation with lines drawn on it: each tile is lit from one side,
     * sits a little off true, and is a slightly different colour from its
     * neighbour, because it was cut by hand and fired in a batch. */
    frag: `vec4 fx(vec2 uv){
      float t = max(4.0, p0*unit());
      vec2 g = uRes/t;
      vec2 cell = floor(uv*g);
      vec2 f = fract(uv*g);
      vec2 wob = (vec2(hash(cell), hash(cell+3.3)) - 0.5) * p4 * 0.35;
      vec3 col = B((cell + 0.5 + wob)/g).rgb;
      col *= 1.0 + (hash(cell + 7.1) - 0.5) * p3 * 0.6;
      /* Lit from the top left, like every mosaic photographed in a book. */
      float bevel = (smoothstep(0.0, 0.35, f.x) * smoothstep(0.0, 0.35, f.y)) * 0.5
                  + (smoothstep(1.0, 0.65, f.x) * smoothstep(1.0, 0.65, f.y)) * 0.5;
      col *= mix(1.0, 0.72 + bevel*0.7, p2);
      float grout = 1.0 - smoothstep(p1*0.5, p1*0.5 + 0.04, min(min(f.x, f.y), min(1.0-f.x, 1.0-f.y)));
      return vec4(mix(col, c0, grout), 1.0); }`
  },
  {
    id: 'bricks', name: 'Bricks', group: 'Grid', blurKey: 'p5',
    controls: [N('p0', 'Course', 6, 80, 1, 22, 'px'), N('p1', 'Ratio', 1, 5, 0.1, 2.2),
      N('p2', 'Mortar', 0, 0.4, 0.01, 0.08), N('p3', 'Offset', 0, 1, 0.01, 0.5),
      N('p4', 'Vary', 0, 1, 0.01, 0.3), N('p5', 'Soften', 0, 20, 1, 2),
      C('c0', 'Mortar', '#D9D2C4')],
    /* Rows offset by half a brick, which is the one thing that stops a grid
     * reading as a grid. Long cells rather than square ones, so a picture laid
     * into it comes back as a wall rather than as large pixels. */
    frag: `vec4 fx(vec2 uv){
      float h = max(6.0, p0*unit());
      vec2 t = vec2(h*max(1.0, p1), h);
      vec2 g = uRes/t;
      float row = floor(uv.y*g.y);
      float shift = mod(row, 2.0) * p3;
      vec2 at = vec2(uv.x*g.x + shift, uv.y*g.y);
      vec2 cell = floor(at);
      vec2 f = fract(at);
      vec3 col = B(vec2((cell.x + 0.5 - shift)/g.x, (cell.y + 0.5)/g.y)).rgb;
      col *= 1.0 + (hash(cell + 2.9) - 0.5) * p4 * 0.7;
      float m = min(min(f.x, f.y), min(1.0-f.x, 1.0-f.y));
      float mortar = 1.0 - smoothstep(p2*0.5, p2*0.5 + 0.03, m);
      return vec4(mix(col, c0, mortar), 1.0); }`
  },
  {
    id: 'concentric', name: 'Concentric', group: 'Grid', blurKey: 'p5',
    controls: [N('p0', 'Rings', 4, 90, 1, 26), N('p1', 'Sectors', 3, 120, 1, 40),
      N('p2', 'Centre X', 0, 1, 0.01, 0.5), N('p3', 'Centre Y', 0, 1, 0.01, 0.5),
      N('p4', 'Twist', -2, 2, 0.02, 0), N('p5', 'Soften', 0, 20, 1, 2)],
    /* Pixelation in the round. The cells are rings and sectors rather than
     * squares, so the picture reorganises itself about a point — which is what
     * a record label, a seal, or anything else drawn on a lathe looks like. */
    frag: `vec4 fx(vec2 uv){
      vec2 c = vec2(p2, p3);
      vec2 d = (uv - c) * vec2(uRes.x/uRes.y, 1.0);
      float r = length(d);
      float a = atan(d.y, d.x) + r * p4 * 6.2831;
      float rings = max(4.0, floor(p0));
      float sect = max(3.0, floor(p1));
      float rq = (floor(r*rings) + 0.5)/rings;
      float aq = (floor((a/6.2831 + 0.5)*sect) + 0.5)/sect * 6.2831 - 3.14159 - rq*p4*6.2831;
      vec2 at = c + vec2(cos(aq), sin(aq)) * rq * vec2(uRes.y/uRes.x, 1.0);
      return vec4(B(clamp(at, 0.0, 1.0)).rgb, 1.0); }`
  },
  {
    id: 'ripple', name: 'Ripple', group: 'Distort',
    controls: [N('p0', 'Rings', 1, 60, 0.5, 10), N('p1', 'Depth', 0, 0.2, 0.002, 0.07),
      N('p2', 'Centre X', 0, 1, 0.01, 0.5), N('p3', 'Centre Y', 0, 1, 0.01, 0.5),
      N('p4', 'Falloff', 0, 3, 0.05, 0.6), N('p5', 'Phase', 0, 6.28, 0.02, 0)],
    /* A stone in it. The rings die away from the centre rather than carrying
     * on to the edge of the card, because the version that does not looks like
     * a pattern rather than like water. */
    frag: `vec4 fx(vec2 uv){
      vec2 c = vec2(p2, p3);
      vec2 d = (uv - c) * vec2(uRes.x/uRes.y, 1.0);
      float r = length(d);
      float fall = 1.0 / (1.0 + r * p4 * 4.0);
      float wave = sin(r * p0 * 6.2831 - p5) * p1 * fall;
      vec2 at = uv + normalize(d + 1e-6) * wave * vec2(uRes.y/uRes.x, 1.0);
      return vec4(T(mirror(at)).rgb, 1.0); }`
  },
  {
    id: 'polar', name: 'Polar', group: 'Distort',
    controls: [E('p0', 'Direction', 0, ['To polar', 'To rectangular']),
      N('p1', 'Turns', 0.25, 4, 0.05, 1), N('p2', 'Centre X', 0, 1, 0.01, 0.5),
      N('p3', 'Centre Y', 0, 1, 0.01, 0.5), N('p4', 'Zoom', 0.2, 3, 0.02, 1),
      N('p5', 'Spin', -180, 180, 1, 0, '°')],
    /* The oldest trick in the coordinate box and still the most surprising: a
     * horizon becomes a circle, a column of type becomes a spiral, a face
     * becomes something nobody would have drawn. Both ways round, because the
     * inverse is a different picture rather than an undo. */
    frag: `vec4 fx(vec2 uv){
      vec2 c = vec2(p2, p3);
      float spin = radians(p5);
      if(p0 < 0.5){
        vec2 d = (uv - c) * vec2(uRes.x/uRes.y, 1.0) / max(0.2, p4);
        float a = (atan(d.y, d.x) + spin) / 6.2831 + 0.5;
        float r = clamp(length(d) * 2.0, 0.0, 1.0);
        return vec4(T(mirror(vec2(fract(a * p1), r))).rgb, 1.0);
      }
      vec2 q = (uv - 0.5) / max(0.2, p4);
      float a = (q.x * 6.2831 * p1) + spin;
      float r = (q.y + 0.5) * 0.5;
      vec2 at = c + vec2(cos(a), sin(a)) * r * vec2(uRes.y/uRes.x, 1.0);
      return vec4(T(mirror(at)).rgb, 1.0); }`
  },
  {
    id: 'melt', name: 'Melt', group: 'Distort', blurKey: 'p5',
    controls: [N('p0', 'Run', 0, 1, 0.01, 0.4), N('p1', 'Column', 1, 60, 0.5, 12, 'px'),
      N('p2', 'Holds', 0, 1, 0.01, 0.5), N('p3', 'Smear', 0, 1, 0.01, 0.6),
      N('p4', 'From', 0, 1, 0.01, 0.35), N('p5', 'Soften', 0, 20, 1, 1)],
    /* Paint running down a wall: each column lets go at a different height and
     * drags the colour it was holding down with it. The dark ones run further,
     * because the dark ones are the wet ones. */
    frag: `vec4 fx(vec2 uv){
      float cw = max(1.0, p1*unit())/uRes.x;
      float col = floor(uv.x/cw);
      float start = p4 + (hash(vec2(col, 4.2)) - 0.5) * p2 * 0.7;
      if(uv.y <= start) return vec4(T(uv).rgb, 1.0);
      float wet = 1.0 - luma(B(vec2((col + 0.5)*cw, start)).rgb);
      float run = (uv.y - start) * p0 * (0.35 + wet*1.3) * (0.4 + hash(vec2(col, 8.8)));
      float at = mix(uv.y - run, start, p3);
      return vec4(T(vec2(uv.x, clamp(at, 0.0, 1.0))).rgb, 1.0); }`
  },
  {
    id: 'bulge', name: 'Bulge', group: 'Distort',
    controls: [N('p0', 'Amount', -1, 1, 0.01, 0.45), N('p1', 'Size', 0.05, 1.2, 0.01, 0.45),
      N('p2', 'Centre X', 0, 1, 0.01, 0.5), N('p3', 'Centre Y', 0, 1, 0.01, 0.5),
      N('p4', 'Edge', 0, 1, 0.01, 0.5), N('p5', 'Fringe', 0, 1, 0.01, 0.15)],
    /* A lens held over the picture. Negative pinches instead, which is the
     * same control and a completely different face. The fringe is what a real
     * piece of glass does at its edge and it is the difference between this
     * looking like optics and looking like a filter. */
    frag: `vec4 fx(vec2 uv){
      vec2 c = vec2(p2, p3);
      vec2 d = (uv - c) * vec2(uRes.x/uRes.y, 1.0);
      float r = length(d) / max(0.05, p1);
      float k = 1.0 - clamp(r, 0.0, 1.0);
      k = mix(k, k*k*(3.0 - 2.0*k), p4);
      float push = 1.0 - p0 * k;
      vec2 at = c + d * push * vec2(uRes.y/uRes.x, 1.0);
      vec2 spread = (at - uv) * p5 * 0.35;
      return vec4(T(mirror(at + spread)).r, T(mirror(at)).g, T(mirror(at - spread)).b, 1.0); }`
  },
  {
    id: 'rays', name: 'God rays', group: 'Light', blurKey: 'p5',
    controls: [N('p0', 'Length', 0, 1, 0.01, 0.55), N('p1', 'Threshold', 0, 1, 0.01, 0.65),
      N('p2', 'Centre X', 0, 1, 0.01, 0.5), N('p3', 'Centre Y', 0, 1, 0.01, 0.25),
      N('p4', 'Strength', 0, 2, 0.02, 0.9), N('p5', 'Soften', 0, 20, 1, 3),
      C('c0', 'Light', '#FFE9C4')],
    /* Only the bright parts are dragged, which is what makes this light rather
     * than a zoom blur: the picture stays where it is and something shines
     * through it. Threshold decides what counts as a source, and on most
     * photographs the answer is the sky and nothing else. */
    frag: `vec4 fx(vec2 uv){
      vec2 c = vec2(p2, p3);
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for(int i = 0; i < 20; i++){
        float t = float(i)/19.0;
        vec2 at = mix(uv, c, t * p0);
        vec3 s = B(at).rgb;
        float lit = smoothstep(p1, min(1.0, p1 + 0.25), luma(s));
        float w = 1.0 - t*0.85;
        sum += s * lit * w;
        total += w;
      }
      vec3 rays = (sum/total) * c0 * p4 * 2.2;
      vec3 src = T(uv).rgb;
      return vec4(1.0 - (1.0 - src)*(1.0 - clamp(rays, 0.0, 1.0)), 1.0); }`
  },
  {
    id: 'halation', name: 'Halation', group: 'Light', blurKey: 'p5',
    controls: [N('p0', 'Strength', 0, 2, 0.02, 1.3), N('p1', 'Threshold', 0, 1, 0.01, 0.45),
      N('p2', 'Warmth', 0, 1, 0.01, 0.7), N('p3', 'Spread', 0, 1, 0.01, 0.85),
      N('p4', 'Grain', 0, 1, 0.01, 0.15), N('p5', 'Soften', 0, 20, 1, 12),
      C('c0', 'Halo', '#FF6B33')],
    /* Bloom happens in the lens; halation happens in the film — light passes
     * through the emulsion, bounces off the back of the base and comes up
     * again, and because the red layer is on the bottom it comes up red. It is
     * why a bright window on film has a warm edge and on a digital sensor does
     * not, and it is the single most film-like thing you can do to a picture. */
    frag: `vec4 fx(vec2 uv){
      vec3 src = T(uv).rgb;
      vec3 wide = B(uv).rgb;
      float lit = smoothstep(p1, min(1.0, p1 + 0.3), luma(wide));
      vec3 halo = mix(vec3(lit), vec3(lit) * c0 * 1.6, p2) * p0 * p3 * 1.4;
      halo *= 1.0 - p4 * (hash(uv*uRes) * 0.6);
      return vec4(clamp(src + halo * (0.4 + luma(src)*0.8), 0.0, 1.0), 1.0); }`
  },
  {
    id: 'crt', name: 'CRT', group: 'Signal',
    controls: [N('p0', 'Scanline', 1, 8, 0.5, 3, 'px'), N('p1', 'Curve', 0, 1, 0.01, 0.35),
      N('p2', 'Triads', 0, 1, 0.01, 0.6), N('p3', 'Glow', 0, 1, 0.01, 0.4),
      N('p4', 'Vignette', 0, 1, 0.01, 0.5), N('p5', 'Roll', -1, 1, 0.01, 0)],
    /* The glass is curved, the beam draws every other line, and the phosphors
     * are three stripes rather than one dot. Doing only the scanlines gives
     * something that reads as a filter; doing all three gives something that
     * reads as a screen being photographed. */
    frag: `vec4 fx(vec2 uv){
      vec2 q = uv - 0.5;
      float r2 = dot(q, q);
      vec2 at = 0.5 + q * (1.0 + r2 * p1 * 0.55);
      at.y = fract(at.y + p5);
      if(at.x < 0.0 || at.x > 1.0) return vec4(vec3(0.02), 1.0);
      vec3 col = T(clamp(at, 0.0, 1.0)).rgb;
      float line = 0.5 + 0.5*cos(at.y * uRes.y / max(1.0, p0) * 3.14159);
      col *= 1.0 - line*0.45;
      float tri = mod(floor(at.x * uRes.x / 3.0), 3.0);
      vec3 mask = tri < 0.5 ? vec3(1.0, 0.55, 0.55) : (tri < 1.5 ? vec3(0.55, 1.0, 0.55) : vec3(0.55, 0.55, 1.0));
      col *= mix(vec3(1.0), mask, p2);
      col += col * p3 * 0.6;
      col *= mix(1.0, 1.0 - r2*1.6, p4);
      return vec4(clamp(col, 0.0, 1.0), 1.0); }`
  },
  {
    id: 'vhs', name: 'VHS', group: 'Signal',
    controls: [N('p0', 'Jitter', 0, 1, 0.01, 0.4), N('p1', 'Chroma bleed', 0, 1, 0.01, 0.55),
      N('p2', 'Tracking', 0, 1, 0.01, 0.35), N('p3', 'Noise', 0, 1, 0.01, 0.3),
      N('p4', 'Band', 0, 1, 0.01, 0.4), N('p5', 'Wobble', 0, 1, 0.01, 0.5)],
    /* Tape, not a screen. Each line starts in slightly the wrong place, the
     * colour lags behind the brightness because it was recorded at a quarter
     * of the bandwidth, and somewhere in the frame there is a band the head is
     * not tracking. */
    frag: `vec4 fx(vec2 uv){
      float line = floor(uv.y * uRes.y);
      float jit = (hash(vec2(line, 1.3)) - 0.5) * p0 * 0.03;
      jit += sin(uv.y * 40.0 + hash(vec2(line, 5.5))*6.0) * p5 * 0.004;
      float band = smoothstep(0.03, 0.0, abs(fract(uv.y * 1.0 + 0.31) - 0.5) - 0.46);
      jit += band * p2 * 0.09;
      vec2 at = vec2(clamp(uv.x + jit, 0.0, 1.0), uv.y);
      /* Luma is sharp, chroma is smeared sideways. */
      float y = luma(T(at).rgb);
      float bleed = p1 * 0.02;
      vec3 c = (T(vec2(clamp(at.x - bleed, 0.0, 1.0), at.y)).rgb
              + T(vec2(clamp(at.x - bleed*0.5, 0.0, 1.0), at.y)).rgb
              + T(at).rgb) / 3.0;
      vec3 col = vec3(y) + (c - vec3(luma(c)));
      col += (hash(vec2(uv.x*uRes.x, line)) - 0.5) * p3 * 0.4;
      col = mix(col, vec3(0.75), band * p4 * 0.7);
      return vec4(clamp(col, 0.0, 1.0), 1.0); }`
  },
  {
    id: 'topo', name: 'Topographic', group: 'Map', blurKey: 'p5',
    controls: [N('p0', 'Contours', 3, 40, 1, 9), N('p1', 'Line', 0.2, 4, 0.1, 1.2),
      N('p2', 'Fill', 0, 1, 0.01, 0.35), N('p3', 'Index every', 0, 10, 1, 5),
      N('p4', 'Keep the colour', 0, 1, 0.01, 0), N('p5', 'Soften', 0, 20, 1, 11),
      C('c0', 'Paper', '#F3EEE0'), C('c1', 'Line', '#4A3B22')],
    /* Brightness read as height. The lines are where the picture crosses a
     * level, and every fifth one is drawn heavier — which is what a map does,
     * and the reason a contour map is readable at all. */
    frag: `vec4 fx(vec2 uv){
      float steps = max(3.0, floor(p0));
      float h = luma(B(uv).rgb) * steps;
      float band = floor(h);
      float f = fract(h);
      float w = p1 * 0.5 / max(1.0, uRes.y/420.0) * 0.06;
      float thick = 1.0;
      if(p3 >= 1.0 && mod(band, max(1.0, floor(p3))) < 0.5) thick = 2.0;
      float line = 1.0 - smoothstep(w*thick, w*thick + 0.02, min(f, 1.0 - f));
      vec3 paper = mix(c0, c0 * (0.72 + band/steps*0.5), p2);
      paper = mix(paper, B(uv).rgb, p4);
      return vec4(mix(paper, c1, line), 1.0); }`
  },
  {
    id: 'threeink', name: 'Three inks', group: 'Map', blurKey: 'p5',
    controls: [N('p0', 'Mix', 0, 1, 0.01, 1), N('p1', 'Dither', 0, 1, 0.01, 0.35),
      N('p2', 'Weight', 0.2, 3, 0.05, 1), N('p3', 'Keep the light', 0, 1, 0.01, 0.15),
      N('p4', 'Grain', 0, 1, 0.01, 0.1), N('p5', 'Soften', 0, 20, 1, 2),
      C('c0', 'First', '#12263F'), C('c1', 'Second', '#E4572E'), C('c2', 'Third', '#F2E8DC')],
    /* Every pixel goes to whichever of three colours it is nearest. Not a
     * gradient map, which reads brightness along a ramp and keeps the
     * ordering: this reads the colour itself, so a red thing goes to the red
     * ink even where it is darker than the sky.
     *
     * The dither is what makes it usable. Nearest-colour on a photograph gives
     * hard blocks; dithering the decision spreads the boundary into a mix of
     * the two inks, which is what a two-colour press does anyway. */
    frag: `vec4 fx(vec2 uv){
      vec3 src = B(uv).rgb;
      float n = (bayer8(uv*uRes) - 0.5) * p1 * 0.5;
      vec3 s = clamp(src + n, 0.0, 1.0);
      float d0 = distance(s, c0) * (2.0 - p2);
      float d1 = distance(s, c1) * (2.0 - p2);
      float d2 = distance(s, c2);
      vec3 ink = d0 < d1 ? (d0 < d2 ? c0 : c2) : (d1 < d2 ? c1 : c2);
      ink = mix(ink, c2, p3 * smoothstep(0.7, 1.0, luma(src)));
      ink *= 1.0 + (hash(uv*uRes) - 0.5) * p4 * 0.35;
      return vec4(mix(src, clamp(ink, 0.0, 1.0), p0), 1.0); }`
  }
]

/* And the ones written as ISF and translated on the way in. Appended rather
 * than woven in, so the file above stays the list of effects written here and
 * this stays the list of effects that came from somewhere else. */
EFFECTS.push(...ISF_EFFECTS)

export const BY_ID: Record<string, EffectSpec> = EFFECTS.reduce(
  (m, e) => ((m[e.id] = e), m),
  {} as Record<string, EffectSpec>
)

export const GROUPS: { name: string; items: EffectSpec[] }[] = (() => {
  const order: string[] = []
  const by: Record<string, EffectSpec[]> = {}
  for (const e of EFFECTS) {
    if (!by[e.group]) { by[e.group] = []; order.push(e.group) }
    by[e.group].push(e)
  }
  return order.map((name) => ({ name, items: by[name] }))
})()

/* Default parameter block for an effect. */
/* The tone presets: a starting point rather than a destination, which is why
 * the panel keeps every slider live after one is pressed. Kept here with the
 * effects rather than in the panel because they are settings the app knows
 * about, and two things now read them — the buttons, and the roller that makes
 * a batch of variations. */
export const PRESETS: { id: string; name: string; vals: Partial<FxState> }[] = [
  { id: 'none', name: 'Original', vals: {} },
  { id: 'bw', name: 'B&W', vals: { sat: 0, con: 12 } },
  { id: 'noir', name: 'Noir', vals: { sat: 0, con: 36, exp: -8 } },
  { id: 'faded', name: 'Faded', vals: { sat: 74, con: -18, exp: 10, warm: 12 } },
  { id: 'warm', name: 'Warm', vals: { warm: 28, sat: 112, exp: 4 } },
  { id: 'cool', name: 'Cool', vals: { warm: -26, sat: 106, con: 8 } },
  { id: 'punch', name: 'Punch', vals: { con: 28, sat: 134 } },
  { id: 'print', name: 'Print', vals: { sat: 86, con: 12, grain: 30, warm: 8 } },
]

export function defaults(id: string): Record<string, number | string> {
  const spec = BY_ID[id] || BY_ID.none
  const out: Record<string, number | string> = {}
  for (const c of spec.controls) out[c.k] = c.def
  return out
}
