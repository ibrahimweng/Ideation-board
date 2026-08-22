/* Shader preamble shared by every effect.
 * Ported verbatim from the original engine: the GLSL is correct and worth keeping.
 * Only the surrounding plumbing changed. */

export const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = vec2(aPos.x*0.5+0.5, 0.5-aPos.y*0.5); gl_Position = vec4(aPos,0.0,1.0); }`

/* Separable gaussian used by the blur-backed effects. */
export const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir, uScale, uOff; in vec2 vUv; out vec4 o;
void main(){
  vec2 p = clamp(vUv,0.0,1.0)*uScale + uOff;
  vec4 s = texture(uTex,p)*0.227027;
  s += (texture(uTex,p+uDir*1.3846154)+texture(uTex,p-uDir*1.3846154))*0.3162162;
  s += (texture(uTex,p+uDir*3.2307692)+texture(uTex,p-uDir*3.2307692))*0.0702703;
  o = s;
}`

/* Prepended to every effect fragment: uniforms, helpers, palettes. */
export const PRE = `#version 300 es
precision highp float;
uniform sampler2D uTex, uBlur, uGlyph;
uniform vec2 uRes, uBlurScale, uBlurOff, uCover, uCoverOff;
uniform float p0,p1,p2,p3,p4,p5,uSeed;
uniform vec3 c0,c1,c2;
in vec2 vUv; out vec4 outColor;
/* The card is not the shape of the picture, so the picture is cropped to fill
   it rather than squashed into it. Same framing an uneffected card gets from
   object-fit: cover, so turning an effect on changes the look and nothing
   else. uv stays the position on the card, which is what the patterned
   effects measure their cells and grids in. */
vec4 T(vec2 uv){ return texture(uTex, clamp(uv*uCover + uCoverOff, 0.001, 0.999)); }
vec4 B(vec2 uv){ return texture(uBlur, clamp(uv,0.0,1.0)*uBlurScale + uBlurOff); }
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)+uSeed*0.137); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
vec2 rot(vec2 v, float a){ float s=sin(a), c=cos(a); return vec2(v.x*c-v.y*s, v.x*s+v.y*c); }
float unit(){ return uRes.y/420.0; }
const float BM[64] = float[64](
 0.,32.,8.,40.,2.,34.,10.,42., 48.,16.,56.,24.,50.,18.,58.,26.,
 12.,44.,4.,36.,14.,46.,6.,38., 60.,28.,52.,20.,62.,30.,54.,22.,
 3.,35.,11.,43.,1.,33.,9.,41., 51.,19.,59.,27.,49.,17.,57.,25.,
 15.,47.,7.,39.,13.,45.,5.,37., 63.,31.,55.,23.,61.,29.,53.,21.);
float bayer8(vec2 p){ int x=int(mod(p.x,8.0)), y=int(mod(p.y,8.0)); return BM[x+y*8]/64.0; }
vec3 pal(int id, float t){
  t = clamp(t,0.0,1.0);
  if(id==0){ vec3 a=vec3(.02,.0,.09),b=vec3(.35,.03,.55),c=vec3(.95,.28,.05),d=vec3(1.,.85,.25),e=vec3(1.,1.,.94);
    return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.78?mix(c,d,(t-.5)/.28):mix(d,e,(t-.78)/.22); }
  if(id==1){ vec3 a=vec3(.05,.03,.53),b=vec3(.57,.05,.63),c=vec3(.9,.36,.32),d=vec3(.99,.65,.16),e=vec3(.94,.98,.13);
    return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.75?mix(c,d,(t-.5)/.25):mix(d,e,(t-.75)/.25); }
  if(id==2){ vec3 a=vec3(.05,.24,.09),b=vec3(.11,.62,.16),c=vec3(.45,.86,.13),d=vec3(.85,.96,.22),e=vec3(.98,1.,.85);
    return t<.28?mix(a,b,t/.28):t<.58?mix(b,c,(t-.28)/.3):t<.82?mix(c,d,(t-.58)/.24):mix(d,e,(t-.82)/.18); }
  if(id==3){ vec3 a=vec3(.02,.09,.13),b=vec3(.05,.36,.45),c=vec3(.13,.62,.6),d=vec3(.96,.6,.13),e=vec3(1.,.87,.3);
    return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.78?mix(c,d,(t-.5)/.28):mix(d,e,(t-.78)/.22); }
  if(id==4){ vec3 a=vec3(.02,.02,.06),b=vec3(.09,.24,.85),c=vec3(.2,.45,.95),d=vec3(1.,.82,.14),e=vec3(1.,.5,.09);
    return t<.22?mix(a,b,t/.22):t<.5?mix(b,c,(t-.22)/.28):t<.8?mix(c,d,(t-.5)/.3):mix(d,e,(t-.8)/.2); }
  if(id==5){ vec3 a=vec3(.01),b=vec3(.28),c=vec3(.62),d=vec3(.88),e=vec3(1.);
    return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.75?mix(c,d,(t-.5)/.25):mix(d,e,(t-.75)/.25); }
  if(id==6){ vec3 a=vec3(.0,.0,.02),b=vec3(.28,.06,.42),c=vec3(.71,.21,.4),d=vec3(.99,.55,.32),e=vec3(.99,.99,.75);
    return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.75?mix(c,d,(t-.5)/.25):mix(d,e,(t-.75)/.25); }
  vec3 a=vec3(.27,.0,.33),b=vec3(.19,.41,.56),c=vec3(.13,.57,.55),d=vec3(.37,.79,.38),e=vec3(.99,.91,.14);
  return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.75?mix(c,d,(t-.5)/.25):mix(d,e,(t-.75)/.25);
}
vec4 fx(vec2 uv);
void main(){ outColor = fx(vUv); }`
