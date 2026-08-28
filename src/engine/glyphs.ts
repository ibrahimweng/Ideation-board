/* ---------------------------------------------------------------------------
 * The characters the ASCII effect spends, drawn rather than typed.
 *
 * Its own file because the shapes are the argument, and the argument is long.
 *
 * WHY NOT A FONT
 *
 * They were fillText of ` .:-=+*#%@` in a stack beginning `ui-monospace,
 * "JetBrains Mono", …`, and the atlas is built once when the engine starts and
 * kept for the session. So the look of the effect depended on which of those
 * faces the machine happens to have, on whether the webfont among them had
 * finished arriving by that moment, and on how far into the boot that moment
 * fell. The same board came back different after a reload; two machines never
 * agreed; and offline the whole stack fell through to whatever the browser
 * calls monospace. An effect that people bake into exported pictures cannot
 * depend on the weather.
 *
 * The third row was already drawn, for a smaller version of the same reason —
 * a font's block characters sit inside their cell with a margin, which tiled
 * into a grid of seams, and not every platform has them at all. This is that
 * argument carried the rest of the way.
 *
 * WHAT THE SHAPES HAVE TO GET RIGHT
 *
 * The shader picks a glyph by brightness and nothing else, so the ink has to
 * rise step by step along the row. A ramp that dips somewhere in the middle
 * puts a lighter mark on a brighter patch, and the picture stops reading as a
 * picture. That is the one hard requirement, and `test/ascii.mjs` checks it
 * where it matters — on a black-to-white ramp put through the effect itself,
 * rather than on these shapes in isolation. Looking like the character is the
 * other requirement, and it is what makes the result read as type rather than
 * as a field of marks.
 * ------------------------------------------------------------------------- */

/* Both ramps of characters, lightest first. The second is the same idea in
 * five steps rather than ten, for a coarser and cleaner look, and it is made
 * of shapes the first one already has. The shader knows how many steps each
 * has, so neither can be lengthened here alone. */
const RAMPS = [' .:-=+*#%@', ' .:*#'] as const

/* What a glyph is handed: a cell measured in its own 0..1, and the three
 * strokes everything here is made of. `t` is the stem weight. */
export interface Pen {
  t: number
  bar: (u0: number, v0: number, u1: number, v1: number, w?: number) => void
  dot: (u: number, v: number, r: number) => void
  ring: (u: number, v: number, r: number, w?: number, a0?: number, a1?: number) => void
}

type Glyph = (d: Pen, cw: number) => void

/* The proportions are measured rather than guessed — see the test — and a few
 * of them are deliberately not what the character does in a typeface. A dash
 * runs the full width of its cell so that it out-inks a colon, and the plus is
 * a little taller than it is wide for the same reason one step further on. */
const GLYPHS: Record<string, Glyph> = {
  ' ': () => {},
  '.': (d, cw) => d.dot(0.5, 0.74, 0.115 * cw),
  ':': (d, cw) => {
    d.dot(0.5, 0.36, 0.115 * cw)
    d.dot(0.5, 0.68, 0.115 * cw)
  },
  '-': (d) => d.bar(0.14, 0.52, 0.86, 0.52, d.t * 1.1),
  '=': (d) => {
    d.bar(0.18, 0.42, 0.82, 0.42)
    d.bar(0.18, 0.62, 0.82, 0.62)
  },
  '+': (d) => {
    d.bar(0.14, 0.52, 0.86, 0.52)
    d.bar(0.5, 0.24, 0.5, 0.8)
  },
  /* Six spokes from one centre. The vertical reach is scaled by the cell's own
   * shape, or a tall cell would stretch the star into an oval. */
  '*': (d, cw) => {
    const r = 0.36
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 2
      const dx = Math.cos(a) * r
      const dy = (Math.sin(a) * r * cw) / 40
      d.bar(0.5 + dx, 0.44 + dy, 0.5 - dx, 0.44 - dy)
    }
  },
  /* The verticals lean, as they do in type. Upright they read as a window
   * frame rather than as a hash. */
  '#': (d) => {
    d.bar(0.2, 0.4, 0.8, 0.4)
    d.bar(0.2, 0.62, 0.8, 0.62)
    d.bar(0.4, 0.24, 0.32, 0.78)
    d.bar(0.68, 0.24, 0.6, 0.78)
  },
  '%': (d, cw) => {
    d.bar(0.16, 0.8, 0.84, 0.22, d.t * 1.15)
    d.ring(0.29, 0.34, 0.135 * cw, d.t * 0.85)
    d.ring(0.71, 0.68, 0.135 * cw, d.t * 0.85)
  },
  /* The heaviest mark in the ramp, and it has to be: it is where the darkest
   * part of a picture ends up. A ring left open at the lower right, a solid
   * middle where a smaller face would put a bowl, and the tail that tells it
   * apart from a nought. */
  '@': (d, cw) => {
    d.ring(0.5, 0.5, 0.34 * cw, d.t * 1.25, Math.PI * 0.42, Math.PI * 2.12)
    d.dot(0.5, 0.5, 0.145 * cw)
    d.bar(0.8, 0.6, 0.86, 0.72, d.t * 1.1)
  },
}

/* The whole atlas: sixteen cells across, three rows down, white on black. Only
 * the red channel is ever read. */
export function paintGlyphs(x: OffscreenCanvasRenderingContext2D, cw: number, ch: number) {
  x.fillStyle = '#000'
  x.fillRect(0, 0, cw * 16, ch * 3)
  x.fillStyle = '#fff'
  x.strokeStyle = '#fff'
  x.lineCap = 'butt'

  const t = Math.max(2, Math.round(cw * 0.135))
  RAMPS.forEach((ramp, row) => {
    for (let i = 0; i < ramp.length; i++) {
      const g = GLYPHS[ramp[i]]
      if (!g) continue
      x.save()
      x.translate(i * cw, row * ch)
      const X = (u: number) => u * cw
      const Y = (v: number) => v * ch
      g(
        {
          t,
          bar: (u0, v0, u1, v1, w = t) => {
            x.lineWidth = w
            x.beginPath()
            x.moveTo(X(u0), Y(v0))
            x.lineTo(X(u1), Y(v1))
            x.stroke()
          },
          dot: (u, v, r) => {
            x.beginPath()
            x.arc(X(u), Y(v), r, 0, Math.PI * 2)
            x.fill()
          },
          ring: (u, v, r, w = t, a0 = 0, a1 = Math.PI * 2) => {
            x.lineWidth = w
            x.beginPath()
            x.arc(X(u), Y(v), r, a0, a1)
            x.stroke()
          },
        },
        cw
      )
      x.restore()
    }
  })

  /* The third row is blocks. A font's block characters sit inside their cell
   * with a margin, which tiled into a grid of seams across the picture, and
   * not every platform has them at all. These are the same five densities as
   * patterns that meet edge to edge. */
  const step = 4
  for (let i = 1; i < 5; i++) {
    const size = step * Math.sqrt(i / 4)
    const inset = (step - size) / 2
    for (let py = 0; py < ch; py += step) {
      for (let px = 0; px < cw; px += step) {
        x.fillRect(i * cw + px + inset, 2 * ch + py + inset, size, size)
      }
    }
  }
}
