import type { EffectSpec } from './types'

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
    id: 'depth', name: 'Depth map', group: 'Map', blurKey: 'p0',
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
  }
]

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
export function defaults(id: string): Record<string, number | string> {
  const spec = BY_ID[id] || BY_ID.none
  const out: Record<string, number | string> = {}
  for (const c of spec.controls) out[c.k] = c.def
  return out
}
