import { headsFor, pathFor, settingOf } from '../state/shapes'
import type { ShapeSpec } from '../state/shapes'

/* ---------------------------------------------------------------------------
 * A shape, drawn.
 *
 * One <svg> holding one <path>, plus a filled triangle at either end where
 * the shape wears one. Everything is in board units and the board's own
 * transform does the scaling, so the browser draws the shape afresh at
 * whatever zoom it is being looked at rather than blowing up a picture of it.
 *
 * The same component draws the card, the draft under the pointer while a
 * shape is being dragged out, the board poster and the exported page — four
 * places that must not drift, which is what one component is for.
 * ------------------------------------------------------------------------- */

/* How wide a line has to be before it is its own target. */
const HIT = 14

/* A dash pattern is written in stroke widths, so a dash keeps its proportion
 * on a hairline and on a twenty-pixel rule alike. SVG wants lengths. */
export const dashFor = (dash: string, width: number): string | undefined =>
  dash ? dash.trim().split(/\s+/).map((v) => Number(v) * width).join(' ') : undefined

export function ShapeArt({
  spec, w, h, className, hit,
}: {
  spec?: ShapeSpec
  w: number
  h: number
  className?: string
  /* Draw an invisible fat line under the real one, so a hairline can be
     grabbed. Without it a one-pixel rule is a one-pixel target, and with it
     the shape is still hit where it is painted rather than anywhere in its
     box — which is what lets you press through the hole in a ring. */
  hit?: boolean
}) {
  if (!spec) return null
  const fill = settingOf(spec, 'fill')
  const stroke = settingOf(spec, 'stroke')
  const width = settingOf(spec, 'width')
  const heads = headsFor(spec, w, h)
  return (
    <svg
      className={className || 'shape-art'}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      /* The stroke straddles the path, so half of a thick one hangs outside
         the box it was drawn in. Clipping it would make a shape that gets
         thinner at its own edges. */
      style={{ overflow: 'visible' }}
      aria-hidden
    >
      {hit && (
        <path
          className="shape-hit"
          d={pathFor(spec, w, h)}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(width, HIT)}
          strokeLinecap={settingOf(spec, 'cap')}
          strokeLinejoin={settingOf(spec, 'join')}
        />
      )}
      <path
        d={pathFor(spec, w, h)}
        fill={fill || 'none'}
        stroke={stroke || 'none'}
        strokeWidth={width}
        strokeDasharray={dashFor(settingOf(spec, 'dash'), width)}
        strokeLinecap={settingOf(spec, 'cap')}
        strokeLinejoin={settingOf(spec, 'join')}
      />
      {/* An arrowhead is solid, and takes the colour of the line it is on —
          a hollow head on a dashed line is a head made of dashes. */}
      {heads.map((d, i) => (
        <path key={i} d={d} fill={stroke || fill || 'currentColor'} />
      ))}
    </svg>
  )
}
