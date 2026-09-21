/* ---------------------------------------------------------------------------
 * Shapes: the vector layer.
 *
 * Everything else on this board is pixels — a photograph, a frame of video, a
 * page, a render. A shape is not. It is a handful of numbers that say what to
 * draw, and it is drawn afresh at whatever size and zoom it is being looked
 * at, so it is exact at 4% and exact at 400%.
 *
 * ## One record for every shape
 *
 * A rectangle, a fifteen-pointed star and a hand-drawn squiggle are the same
 * kind of card holding the same kind of record. What differs is which fields
 * mean anything: `radius` on a rectangle, `sides` on a polygon, `nodes` on a
 * path. That is what lets the panel, the poster, the exported page and the
 * hit testing each have one code path rather than seven.
 *
 * ## Everything is in the box
 *
 * Points are held as fractions of the card's width and height rather than as
 * pixels: 0 is the left edge, 1 the right. So scaling the card scales the
 * drawing, for nothing, and the same record draws correctly at any size. It
 * also means a path costs the same handful of bytes however big it is drawn.
 *
 * ## Nothing here touches the DOM
 *
 * This file turns numbers into a `d` string. It does not know what an element
 * is, which is what lets the awkward parts — the corner radius that has to be
 * clamped, the star whose points must alternate, the smoothing that turns
 * forty sampled points into eight curves — be checked without a browser.
 * ------------------------------------------------------------------------- */

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow' | 'path'

/* One point on a path.
 *
 * `x` and `y` are fractions of the card. The two handles are offsets from the
 * point, in the same fractions: `i` is the one the curve arrives along and `o`
 * the one it leaves along. A point with neither is a corner. */
export interface Node {
  x: number
  y: number
  ix?: number
  iy?: number
  ox?: number
  oy?: number
}

export type Cap = 'butt' | 'round' | 'square'
export type Join = 'miter' | 'round' | 'bevel'
export type Heads = 'none' | 'start' | 'end' | 'both'

export interface ShapeSpec {
  kind: ShapeKind
  /* A rectangle's corners, as a fraction of its shortest side, so a rounded
     rectangle stays rounded the same way at any size. */
  radius?: number
  /* How many a polygon has, and how many points a star has. */
  sides?: number
  /* How far in a star's inner points sit, as a fraction of the outer ones. */
  inner?: number
  /* A path's points, and whether it joins back up. */
  nodes?: Node[]
  closed?: boolean
  /* Which ends of a line or a path wear an arrowhead. */
  heads?: Heads
  /* Paint. Null fill means no fill at all, which is not the same as white. */
  fill?: string | null
  stroke?: string | null
  width?: number
  /* A dash pattern in the same units as the stroke width, so a dash stays in
     proportion to the line it is on. Empty is a solid line. */
  dash?: string
  cap?: Cap
  join?: Join
  /* Turned about its own middle, in degrees. */
  turn?: number
}

/* What the rail offers, in the order it offers them. */
export const SHAPES: { kind: ShapeKind; name: string; drawn: 'box' | 'ends' | 'points' | 'free' }[] = [
  { kind: 'rect', name: 'Rectangle', drawn: 'box' },
  { kind: 'ellipse', name: 'Ellipse', drawn: 'box' },
  { kind: 'polygon', name: 'Polygon', drawn: 'box' },
  { kind: 'star', name: 'Star', drawn: 'box' },
  { kind: 'line', name: 'Line', drawn: 'ends' },
  { kind: 'arrow', name: 'Arrow', drawn: 'ends' },
  { kind: 'path', name: 'Pen', drawn: 'points' },
]

/* The dash patterns worth having as a press rather than a number to type.
 * Written in stroke widths, so they hold their proportion on a hairline and on
 * a twenty pixel rule alike. */
export const DASHES: { id: string; name: string; dash: string }[] = [
  { id: 'solid', name: 'Solid', dash: '' },
  { id: 'dash', name: 'Dashed', dash: '4 2.5' },
  { id: 'long', name: 'Long', dash: '8 3' },
  { id: 'dot', name: 'Dotted', dash: '0.1 2.2' },
  { id: 'dashdot', name: 'Dash-dot', dash: '6 2 0.1 2' },
]

/* The least a shape's box can be, in board units.
 *
 * Room for a stroke to sit in and for a corner to be grabbed. A line drawn
 * dead horizontal has a box of no height at all, and a card of no height is
 * one nobody can ever pick up again — so the box is opened out around it and
 * the line runs through the middle of what it opened out to. */
export const MIN_BOX = 12

export const DEFAULTS: Required<Pick<ShapeSpec, 'fill' | 'stroke' | 'width' | 'dash' | 'cap' | 'join' | 'radius' | 'sides' | 'inner' | 'heads' | 'turn'>> = {
  fill: '#2F6FEB',
  stroke: null,
  width: 2,
  dash: '',
  cap: 'round',
  join: 'round',
  radius: 0,
  sides: 6,
  inner: 0.5,
  heads: 'none',
  turn: 0,
}

/* ---------------------------------------------------------------------------
 * The line's colour, which is not a colour.
 *
 * This app has made this mistake once already and wrote a whole file about it.
 * A label used to be made with `#111114` written into the record — a
 * near-black, sensible on a pale board and invisible on a dark one, which is
 * where it was imported. Text you cannot see is indistinguishable from text
 * that did not arrive. See state/type.ts, which says all of this at length.
 *
 * Then the shapes arrived and every line, arrow and pen stroke was made with
 * `#18181B` written into the record — which is not merely a near-black, it is
 * the light theme's own `--ink`, copied out of the stylesheet by hand. A line
 * you cannot see is indistinguishable from a line nobody drew.
 *
 * So the rule is the one that file already settled. A stroke nobody has
 * chosen is not a colour at all: it is the absence of one, and the answer to
 * it is the theme's own ink, which is right on either ground. A stroke
 * somebody chose is kept exactly. And `null` stays a real answer, different
 * from both: no line at all.
 * ------------------------------------------------------------------------- */

/* What every line was made with before the colour became a choice. Read as
 * "nobody picked this" for the same reason `WAS_BAKED_IN` is: it costs
 * anybody who deliberately wanted that near-black one press to say so again,
 * and it means every line already on a dark board becomes visible the moment
 * it is opened. */
export const WAS_BAKED_IN = '#18181B'

/* The kinds that are nothing but a line, so that having no stroke would be
 * having nothing. Everything else is a shape with a fill, and no line round
 * it is an ordinary thing to want. */
const STROKED = new Set<ShapeKind>(['line', 'arrow', 'path'])

/* Whether a kind is nothing but a line, so that saying nothing about its
 * stroke means the theme's ink rather than no line at all. On everything
 * else the two answers are the same and only one of them is worth offering. */
export const inksByDefault = (kind: ShapeKind): boolean => STROKED.has(kind)

/* The stroke to draw in, or null for no line at all.
 *
 * `ink` is what the caller draws its own text in. On the board that is
 * `currentColor` and the browser works it out; anything making a picture —
 * the bake, the board's poster — has to say, because a picture has no theme
 * to follow afterwards. */
export function strokeOf(spec: ShapeSpec, ink = 'currentColor'): string | null {
  const said = spec.stroke
  if (said === null) return null
  if (said === undefined || said.toLowerCase() === WAS_BAKED_IN.toLowerCase()) {
    return STROKED.has(spec.kind) ? ink : null
  }
  return said
}

/* Whether the stroke on this one is a colour somebody chose, which is what
 * the swatch in the panel shows as selected. */
export const strokeChosen = (spec: ShapeSpec): boolean =>
  spec.stroke !== undefined && spec.stroke !== null &&
  spec.stroke.toLowerCase() !== WAS_BAKED_IN.toLowerCase()

/* A shape of this kind, with nothing said about it yet.
 *
 * A line and a path have no fill — a fill on an open squiggle is a shape
 * nobody drew — and an arrow has a head on it, since that is the only thing
 * that makes it an arrow rather than a line. Neither says what colour its
 * line is, because that is not a thing anybody has said yet. */
export function specFor(kind: ShapeKind): ShapeSpec {
  if (kind === 'line') return { kind, fill: null, width: 2 }
  if (kind === 'arrow') return { kind, fill: null, width: 2, heads: 'end' }
  if (kind === 'path') return { kind, fill: null, width: 2, nodes: [], closed: false }
  if (kind === 'polygon') return { kind, sides: 6 }
  if (kind === 'star') return { kind, sides: 5, inner: 0.45 }
  if (kind === 'rect') return { kind, radius: 0 }
  return { kind }
}

/* Read a setting, falling back to what the kind is made with. */
export const settingOf = <K extends keyof typeof DEFAULTS>(s: ShapeSpec | undefined, k: K): (typeof DEFAULTS)[K] =>
  (s && s[k] !== undefined ? (s[k] as (typeof DEFAULTS)[K]) : DEFAULTS[k])

/* Two decimal places. A `d` string is written on every render and saved with
 * the board, and nobody can see the third. */
const n = (v: number) => {
  const r = Math.round(v * 100) / 100
  /* -0 reads as "-0" and is the same number as 0. */
  return Object.is(r, -0) ? 0 : r
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/* Negated, without the negative zero. A handle of no length points nowhere,
 * and two records of the same shape should compare equal. */
const neg = (v: number) => (v === 0 ? 0 : -v)

/* ---------------------------------------------------------------------------
 * The shapes themselves.
 * ------------------------------------------------------------------------- */

/* A rectangle, with corners.
 *
 * The radius is a fraction of the shortest side rather than a length, which is
 * what keeps a rounded rectangle the same shape when it is scaled — and it
 * cannot be asked for more than half, because past half the two corners on a
 * side have met and the rectangle is a stadium. */
export function rectPath(w: number, h: number, radius = 0): string {
  const r = clamp(radius, 0, 0.5) * Math.min(w, h)
  if (r <= 0) return `M0 0H${n(w)}V${n(h)}H0Z`
  return [
    `M${n(r)} 0`,
    `H${n(w - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(r)}`,
    `V${n(h - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)}`,
    `H${n(r)}`,
    `A${n(r)} ${n(r)} 0 0 1 0 ${n(h - r)}`,
    `V${n(r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(r)} 0`,
    'Z',
  ].join('')
}

/* An ellipse that fills the box, as two arcs. Written as a path rather than as
 * an <ellipse> so that every shape on this board is one element with one `d`,
 * which is what the poster and the exported page both want. */
export function ellipsePath(w: number, h: number): string {
  const rx = w / 2
  const ry = h / 2
  return `M0 ${n(ry)}A${n(rx)} ${n(ry)} 0 1 0 ${n(w)} ${n(ry)}A${n(rx)} ${n(ry)} 0 1 0 0 ${n(ry)}Z`
}

/* The corners of a regular polygon inscribed in the box, first one at the top.
 *
 * Inscribed in the box rather than in a circle, so a polygon drawn in a wide
 * box is wide — the box is what was drawn, and a shape that ignored it would
 * be a shape that refused to be scaled. */
export function polyPoints(sides: number, w: number, h: number, turn = 0): [number, number][] {
  const count = Math.max(3, Math.round(sides))
  const cx = w / 2
  const cy = h / 2
  const start = -Math.PI / 2 + (turn * Math.PI) / 180
  const out: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const a = start + (i * 2 * Math.PI) / count
    out.push([cx + Math.cos(a) * cx, cy + Math.sin(a) * cy])
  }
  return out
}

/* A star's points, alternating out and in. `inner` is how far the inner ones
 * sit from the middle as a fraction of the outer ones. */
export function starPoints(points: number, inner: number, w: number, h: number, turn = 0): [number, number][] {
  const count = Math.max(3, Math.round(points))
  const k = clamp(inner, 0.05, 0.95)
  const cx = w / 2
  const cy = h / 2
  const start = -Math.PI / 2 + (turn * Math.PI) / 180
  const out: [number, number][] = []
  for (let i = 0; i < count * 2; i++) {
    const a = start + (i * Math.PI) / count
    const f = i % 2 === 0 ? 1 : k
    out.push([cx + Math.cos(a) * cx * f, cy + Math.sin(a) * cy * f])
  }
  return out
}

const polyPath = (pts: [number, number][]) =>
  pts.length ? `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z` : ''

/* A path from its points.
 *
 * Coordinates come in as fractions of the box and go out as lengths. A point
 * with no handles is a corner and gets a straight line to it; a point with
 * them gets a curve, and the two handles either side of a segment are the ones
 * that shape it. */
export function nodesPath(nodes: Node[], closed: boolean, w: number, h: number): string {
  if (!nodes.length) return ''
  const at = (p: Node) => [p.x * w, p.y * h] as const
  const [x0, y0] = at(nodes[0])
  if (nodes.length === 1) return `M${n(x0)} ${n(y0)}`
  let d = `M${n(x0)} ${n(y0)}`
  const last = closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < last; i++) {
    const a = nodes[i]
    const b = nodes[(i + 1) % nodes.length]
    const [ax, ay] = at(a)
    const [bx, by] = at(b)
    const hasOut = a.ox !== undefined || a.oy !== undefined
    const hasIn = b.ix !== undefined || b.iy !== undefined
    if (!hasOut && !hasIn) {
      d += `L${n(bx)} ${n(by)}`
      continue
    }
    /* A segment with a handle at one end only still curves: the end without
     * one keeps its own point as its control, which is a straight departure
     * into a curved arrival. */
    const c1x = ax + (a.ox ?? 0) * w
    const c1y = ay + (a.oy ?? 0) * h
    const c2x = bx + (b.ix ?? 0) * w
    const c2y = by + (b.iy ?? 0) * h
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(bx)} ${n(by)}`
  }
  return closed ? `${d}Z` : d
}

/* The whole shape, as one `d`. */
export function pathFor(spec: ShapeSpec, w: number, h: number): string {
  const turn = settingOf(spec, 'turn')
  switch (spec.kind) {
    case 'rect':
      return rectPath(w, h, settingOf(spec, 'radius'))
    case 'ellipse':
      return ellipsePath(w, h)
    case 'polygon':
      return polyPath(polyPoints(settingOf(spec, 'sides'), w, h, turn))
    case 'star':
      return polyPath(starPoints(settingOf(spec, 'sides'), settingOf(spec, 'inner'), w, h, turn))
    case 'line':
    case 'arrow':
      return spec.nodes?.length ? nodesPath(spec.nodes, false, w, h) : `M0 0L${n(w)} ${n(h)}`
    case 'path':
      return nodesPath(spec.nodes || [], !!spec.closed, w, h)
    default:
      return ''
  }
}

/* ---------------------------------------------------------------------------
 * Paint.
 *
 * One answer for the four places a shape is drawn — the card, the draft under
 * the pointer while it is being dragged out, the board's poster and the
 * exported page. They must not drift, which is what one function is for.
 * ------------------------------------------------------------------------- */

/* A dash pattern is written in stroke widths, so a dash keeps its proportion
 * on a hairline and on a twenty-pixel rule alike. SVG wants lengths. */
export const dashFor = (dash: string, width: number): string | undefined =>
  dash ? dash.trim().split(/\s+/).map((v) => Number(v) * width).join(' ') : undefined

/* The attributes the path wants, as SVG names them. `ink` is what an unsaid
 * stroke comes out as — see `strokeOf`. */
export function paintOf(spec: ShapeSpec, ink?: string): Record<string, string> {
  const width = settingOf(spec, 'width')
  const fill = settingOf(spec, 'fill')
  const stroke = strokeOf(spec, ink)
  const dash = dashFor(settingOf(spec, 'dash'), width)
  return {
    fill: fill || 'none',
    stroke: stroke || 'none',
    'stroke-width': String(width),
    'stroke-linecap': settingOf(spec, 'cap'),
    'stroke-linejoin': settingOf(spec, 'join'),
    ...(dash ? { 'stroke-dasharray': dash } : null),
  }
}

/* How far the paint reaches outside the box.
 *
 * A stroke straddles the line it is on, so half of it is outside; a mitred
 * corner runs out further than that, and an arrowhead is a triangle sitting
 * on the end of a line and reaches further still. Anything that has to draw
 * a shape into a picture of its own has to know: a picture of the box alone
 * is a circle with four flat sides. */
export function outsetOf(spec: ShapeSpec): number {
  const width = settingOf(spec, 'width')
  const half = strokeOf(spec) ? width / 2 : 0
  const head = settingOf(spec, 'heads') !== 'none' ? Math.max(4, width * 3.2) : 0
  return Math.ceil(Math.max(half * (settingOf(spec, 'join') === 'miter' ? 2.5 : 1), head))
}

/* A colour comes off a record that could have been written by anything, and
 * this markup is handed to an <img>, to a canvas and into an exported page.
 * None of those should ever see a bracket that was not meant as one. */
const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const attrs = (map: Record<string, string>) =>
  Object.entries(map).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')

/* The whole shape as a standalone SVG document.
 *
 * `pad` opens the picture out round the drawing by `outsetOf` so nothing is
 * cut off at the edges. What the caller does about the extra is the caller's
 * business — the picture says where the drawing is inside it by putting the
 * origin at the padding. */
export function svgFor(spec: ShapeSpec, w: number, h: number, pad = 0, ink?: string): string {
  const paint = paintOf(spec, ink)
  const head = paint.stroke !== 'none' ? paint.stroke : paint.fill
  const heads = headsFor(spec, w, h)
    .map((d) => `<path d="${d}" fill="${esc(head)}"/>`)
    .join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w + pad * 2)}" height="${n(h + pad * 2)}"`,
    ` viewBox="${n(-pad)} ${n(-pad)} ${n(w + pad * 2)} ${n(h + pad * 2)}">`,
    `<path d="${pathFor(spec, w, h)}" ${attrs(paint)}/>`,
    heads,
    '</svg>',
  ].join('')
}

/* ---------------------------------------------------------------------------
 * Arrowheads.
 *
 * Drawn as their own little paths rather than as SVG markers. A marker is a
 * second element with its own units and its own id, and an id has to be unique
 * across a document — which is exactly the thing that breaks the moment forty
 * cards are drawn on one board and again when they are all written into one
 * exported page.
 * ------------------------------------------------------------------------- */

/* Where the path starts and ends, and which way it is going there. */
function ends(spec: ShapeSpec, w: number, h: number) {
  const nodes = spec.nodes?.length ? spec.nodes : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  const p = (i: number) => [nodes[i].x * w, nodes[i].y * h] as const
  const first = p(0)
  const second = p(Math.min(1, nodes.length - 1))
  const last = p(nodes.length - 1)
  const penult = p(Math.max(0, nodes.length - 2))
  return { first, second, last, penult }
}

/* One head, as a filled triangle sitting on the end of the line. */
function head(tipX: number, tipY: number, fromX: number, fromY: number, size: number): string {
  const dx = tipX - fromX
  const dy = tipY - fromY
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  /* Across the line, for the two back corners. */
  const px = -uy
  const py = ux
  const back = size
  const half = size * 0.55
  const bx = tipX - ux * back
  const by = tipY - uy * back
  return `M${n(tipX)} ${n(tipY)}L${n(bx + px * half)} ${n(by + py * half)}L${n(bx - px * half)} ${n(by - py * half)}Z`
}

/* The heads this shape wears, if any. Sized off the stroke, because an
 * arrowhead that does not grow with its line stops being the same arrow. */
export function headsFor(spec: ShapeSpec, w: number, h: number): string[] {
  const which = settingOf(spec, 'heads')
  if (which === 'none') return []
  if (spec.kind !== 'line' && spec.kind !== 'arrow' && spec.kind !== 'path') return []
  const size = Math.max(4, settingOf(spec, 'width') * 3.2)
  const { first, second, last, penult } = ends(spec, w, h)
  const out: string[] = []
  if (which === 'end' || which === 'both') out.push(head(last[0], last[1], penult[0], penult[1], size))
  if (which === 'start' || which === 'both') out.push(head(first[0], first[1], second[0], second[1], size))
  return out
}

/* ---------------------------------------------------------------------------
 * Freehand.
 * ------------------------------------------------------------------------- */

/* Throw away the points that were on the way.
 *
 * A finger or a mouse reports a couple of hundred positions for one stroke and
 * nearly all of them sit on a line between their neighbours. Ramer–Douglas–
 * Peucker keeps the ones that change the shape: the furthest point from the
 * line between the two ends, recursively, until nothing is further off than
 * the tolerance. Forty points become eight, the stroke looks the same, and the
 * record is a tenth of the size. */
export function simplify(points: [number, number][], tol = 0.004): [number, number][] {
  if (points.length < 3) return points.slice()
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let worst = 0
  let at = 0
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]
    /* Distance to the segment, not to the infinite line: a stroke that comes
     * back on itself has both ends in the same place, and the line through
     * them is not a line. */
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
    t = clamp(t, 0, 1)
    const qx = ax + t * dx
    const qy = ay + t * dy
    const d = Math.hypot(px - qx, py - qy)
    if (d > worst) {
      worst = d
      at = i
    }
  }
  if (worst <= tol) return [points[0], points[points.length - 1]]
  return [
    ...simplify(points.slice(0, at + 1), tol).slice(0, -1),
    ...simplify(points.slice(at), tol),
  ]
}

/* Points to nodes, with the corners taken off.
 *
 * Each point gets two handles pointing along the line between its neighbours,
 * a fixed fraction of the way there — Catmull-Rom, which is the cheapest curve
 * that actually passes through the points it is given. A smoothing that only
 * comes near them is no use for a drawing, because the points are where the
 * hand went. */
export function smoothNodes(points: [number, number][], tension = 0.25, closed = false): Node[] {
  const p = points
  if (p.length < 2) return p.map(([x, y]) => ({ x, y }))
  const wrap = (i: number) => p[(i + p.length) % p.length]
  return p.map(([x, y], i) => {
    /* On an open stroke the two ends have only one neighbour and take
       themselves as the other, which is the standard way to end a
       Catmull-Rom. On a closed one they have two like everybody else, or the
       curve would come back round to a corner at the join. */
    const prev = closed ? wrap(i - 1) : p[Math.max(0, i - 1)]
    const next = closed ? wrap(i + 1) : p[Math.min(p.length - 1, i + 1)]
    const tx = (next[0] - prev[0]) * tension
    const ty = (next[1] - prev[1]) * tension
    const node: Node = { x, y }
    if (closed || i > 0) {
      node.ix = neg(tx)
      node.iy = neg(ty)
    }
    if (closed || i < p.length - 1) {
      node.ox = tx
      node.oy = ty
    }
    return node
  })
}

/* ---------------------------------------------------------------------------
 * Editing a path's points.
 * ------------------------------------------------------------------------- */

/* Which segment a point on the path is nearest, and how far along it.
 *
 * Used to put a new point where somebody clicked on the line. Measured against
 * the straight line between each pair, which is near enough on a curve to pick
 * the right segment — and picking the segment is the whole question. */
export function nearestSegment(nodes: Node[], closed: boolean, x: number, y: number) {
  let best = { at: -1, t: 0, d: Infinity }
  const last = closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < last; i++) {
    const a = nodes[i]
    const b = nodes[(i + 1) % nodes.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = clamp(len2 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0, 0, 1)
    const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy))
    if (d < best.d) best = { at: i, t, d }
  }
  return best
}

/* A point added to a segment, with the ends' handles cut back so the line does
 * not jump when it gains a point. */
export function addNode(nodes: Node[], closed: boolean, x: number, y: number): Node[] {
  if (nodes.length < 2) return [...nodes, { x, y }]
  const { at } = nearestSegment(nodes, closed, x, y)
  if (at < 0) return nodes
  const out = nodes.slice()
  const a = out[at]
  const b = out[(at + 1) % out.length]
  const smooth = a.ox !== undefined || b.ix !== undefined
  const node: Node = { x, y }
  if (smooth) {
    const tx = (b.x - a.x) * 0.18
    const ty = (b.y - a.y) * 0.18
    node.ix = neg(tx)
    node.iy = neg(ty)
    node.ox = tx
    node.oy = ty
  }
  out.splice(at + 1, 0, node)
  return out
}

/* One point taken out. A path needs two points to be a path, so the last two
 * cannot be removed. */
export function dropNode(nodes: Node[], at: number): Node[] {
  if (nodes.length <= 2 || at < 0 || at >= nodes.length) return nodes
  const out = nodes.slice()
  out.splice(at, 1)
  return out
}

/* A corner turned smooth, or a smooth point turned back into a corner. */
export function toggleSmooth(nodes: Node[], at: number): Node[] {
  if (at < 0 || at >= nodes.length) return nodes
  const out = nodes.slice()
  const node = { ...out[at] }
  const smooth = node.ox !== undefined || node.ix !== undefined
  if (smooth) {
    delete node.ix
    delete node.iy
    delete node.ox
    delete node.oy
  } else {
    const prev = out[(at - 1 + out.length) % out.length]
    const next = out[(at + 1) % out.length]
    const tx = (next.x - prev.x) * 0.25
    const ty = (next.y - prev.y) * 0.25
    node.ix = neg(tx)
    node.iy = neg(ty)
    node.ox = tx
    node.oy = ty
  }
  out[at] = node
  return out
}

/* A point moved, taking its handles with it — they are offsets from it, so
 * they come along for nothing. */
export function moveNode(nodes: Node[], at: number, dx: number, dy: number): Node[] {
  if (at < 0 || at >= nodes.length) return nodes
  const out = nodes.slice()
  out[at] = { ...out[at], x: out[at].x + dx, y: out[at].y + dy }
  return out
}

/* One handle put somewhere, as an offset from its own point.
 *
 * Its opposite follows it round unless it is being broken off, which is how
 * a point gets a curve on one side of it and a corner on the other. */
export function moveHandle(nodes: Node[], at: number, side: 'in' | 'out', x: number, y: number, together = true): Node[] {
  if (at < 0 || at >= nodes.length) return nodes
  const out = nodes.slice()
  const node = { ...out[at] }
  if (side === 'out') {
    node.ox = x
    node.oy = y
    if (together) {
      node.ix = neg(x)
      node.iy = neg(y)
    }
  } else {
    node.ix = x
    node.iy = y
    if (together) {
      node.ox = neg(x)
      node.oy = neg(y)
    }
  }
  out[at] = node
  return out
}

/* A segment pulled out of shape.
 *
 * Dragging the line itself is how somebody who has never held a pen bends a
 * curve, and it is the whole of the curvature tool. The two controls either
 * side of the segment take the movement between them — the least each of
 * them can move and still put the curve under the pointer, which is what
 * keeps a small pull from throwing the rest of the line about.
 *
 * A straight segment gets handles at the thirds first, because a straight
 * line has nowhere to put a bend. And the grab is held away from the two
 * ends, where neither control has any say in where the curve goes and the
 * arithmetic for "move it there" divides by nothing. */
export function bendSegment(nodes: Node[], closed: boolean, at: number, t: number, dx: number, dy: number): Node[] {
  const n = nodes.length
  if (at < 0 || at >= (closed ? n : n - 1)) return nodes
  const out = nodes.slice()
  const a = { ...out[at] }
  const b = { ...out[(at + 1) % n] }
  const hasA = isSmoothOut(a)
  const hasB = isSmoothIn(b)
  const ax = hasA ? a.ox ?? 0 : (b.x - a.x) / 3
  const ay = hasA ? a.oy ?? 0 : (b.y - a.y) / 3
  const bx = hasB ? b.ix ?? 0 : (a.x - b.x) / 3
  const by = hasB ? b.iy ?? 0 : (a.y - b.y) / 3
  const k = clamp(t, 0.12, 0.88)
  const w1 = 3 * k * (1 - k) * (1 - k)
  const w2 = 3 * k * k * (1 - k)
  const sum = w1 * w1 + w2 * w2
  a.ox = ax + (dx * w1) / sum
  a.oy = ay + (dy * w1) / sum
  b.ix = bx + (dx * w2) / sum
  b.iy = by + (dy * w2) / sum
  out[at] = a
  out[(at + 1) % n] = b
  return out
}

/* Where a segment is at a given fraction along it — the cubic itself, so
 * that "how far along did I grab" and "where is the line now" are the same
 * question answered the same way.
 *
 * The controls are the ones `nodesPath` draws with, with one exception: a
 * segment with a handle at neither end is a straight line, and a cubic whose
 * controls sit on its own endpoints runs along that line at an easing pace —
 * fast in the middle, slow at the ends. Put the controls at the thirds and
 * it is the same line travelled evenly, which is what "half way along" has
 * to mean to somebody dragging it. It is also exactly where `bendSegment`
 * puts them the moment that line is bent. */
export function pointOnSegment(nodes: Node[], at: number, t: number): { x: number; y: number } {
  const n = nodes.length
  const a = nodes[at]
  const b = nodes[(at + 1) % n]
  const bare = !isSmoothOut(a) && !isSmoothIn(b)
  const c1x = bare ? a.x + (b.x - a.x) / 3 : a.x + (a.ox ?? 0)
  const c1y = bare ? a.y + (b.y - a.y) / 3 : a.y + (a.oy ?? 0)
  const c2x = bare ? b.x - (b.x - a.x) / 3 : b.x + (b.ix ?? 0)
  const c2y = bare ? b.y - (b.y - a.y) / 3 : b.y + (b.iy ?? 0)
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * t * u * u
  const w2 = 3 * t * t * u
  const w3 = t * t * t
  return {
    x: w0 * a.x + w1 * c1x + w2 * c2x + w3 * b.x,
    y: w0 * a.y + w1 * c1y + w2 * c2y + w3 * b.y,
  }
}

const isSmoothOut = (p: Node) => p.ox !== undefined || p.oy !== undefined
const isSmoothIn = (p: Node) => p.ix !== undefined || p.iy !== undefined

/* The place on the path nearest a point, as a segment and how far along it.
 *
 * Sampled along the curve rather than measured against the straight line
 * between each pair. On a path that bends those are not the same place, and
 * the whole of bending is putting the line where the pointer is. */
export function nearestOn(nodes: Node[], closed: boolean, x: number, y: number, steps = 24) {
  let best = { at: -1, t: 0, d: Infinity }
  const last = closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < last; i++) {
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const p = pointOnSegment(nodes, i, t)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < best.d) best = { at: i, t, d }
    }
  }
  return best
}

/* Which point of a path a press landed on, or -1. In the same units as the
 * points, and with the reach handed in because how near counts is a question
 * about the pointer rather than about the path. */
export function nodeAt(nodes: Node[], x: number, y: number, reach: number): number {
  let best = -1
  let near = reach
  nodes.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= near) {
      near = d
      best = i
    }
  })
  return best
}

/* Whether a point is a smooth one. */
export const isSmooth = (node: Node) =>
  node.ix !== undefined || node.iy !== undefined || node.ox !== undefined || node.oy !== undefined

/* The box a set of points really occupies.
 *
 * A path drawn with the pen is placed by its points rather than by a box, so
 * the box has to be worked out from them afterwards and the points rewritten
 * to fill it. Without that a squiggle in the corner of a huge invisible card
 * has handles nowhere near itself.
 *
 * The handles count as well as the points. A curve bulges out past the line
 * between the two points it joins, and never out past the box round its four
 * control points — so a box that stopped at the points would be a box a
 * stroke leans out of and gets clipped at the edge of its own card.
 *
 * In whatever units it is handed. Fractions, from `normalise`; board units,
 * from the pen, which does not know what box it is in until this says. */
export function boundsOfNodes(nodes: Node[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 1, h: 1 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const see = (x: number, y: number) => {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  for (const p of nodes) {
    see(p.x, p.y)
    if (p.ix !== undefined || p.iy !== undefined) see(p.x + (p.ix ?? 0), p.y + (p.iy ?? 0))
    if (p.ox !== undefined || p.oy !== undefined) see(p.x + (p.ox ?? 0), p.y + (p.oy ?? 0))
  }
  return { x: x0, y: y0, w: Math.max(1e-6, x1 - x0), h: Math.max(1e-6, y1 - y0) }
}

/* The same points written as fractions of a box. Handles scale with them. */
export function intoBox(nodes: Node[], box: { x: number; y: number; w: number; h: number }): Node[] {
  return nodes.map((p) => {
    const q: Node = { x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h }
    if (p.ix !== undefined) q.ix = p.ix / box.w
    if (p.iy !== undefined) q.iy = p.iy / box.h
    if (p.ox !== undefined) q.ox = p.ox / box.w
    if (p.oy !== undefined) q.oy = p.oy / box.h
    return q
  })
}

/* The same path, rewritten to fill its own box. */
export function normalise(nodes: Node[]): { nodes: Node[]; box: { x: number; y: number; w: number; h: number } } {
  const box = boundsOfNodes(nodes)
  return { nodes: intoBox(nodes, box), box }
}
