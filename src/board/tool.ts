import { useSyncExternalStore } from 'react'
import type { ShapeKind } from '../state/shapes'

/* ---------------------------------------------------------------------------
 * The tool that is armed.
 *
 * Almost everything on this board is made by pressing a button and having the
 * thing appear in the middle of the view. That is right for a note, which is
 * the size it is, and wrong for everything whose size and place are the point:
 * a section is a region, a piece of text is however wide you want the line to
 * be, and a shape is whatever you drew. All of those you draw.
 *
 * So those arm instead of firing. The rail shows which one is armed, the
 * board takes the cursor for it, and the next drag on empty board draws the
 * box. One press, one thing made, and the tool stands down — a tool that stays
 * armed is a tool you make four sections with by accident.
 *
 * Kept out of React state because the board's pointer handlers read it inside
 * a gesture, where a re-render is a frame late and a stale closure is a bug
 * you cannot see.
 * ------------------------------------------------------------------------- */

/* The tools that draw a shape.
 *
 * Nine of them and one record type between them: what differs is the gesture
 * that gets the numbers in. Four are dragged out as a box, two as a pair of
 * ends, two place points one press at a time, and one follows the hand. */
export type ShapeTool =
  | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow' | 'pen' | 'curve' | 'pencil'

export type Tool = 'section' | 'text' | ShapeTool | null

/* How each one is drawn. The board reads this to know which gesture to run;
 * everything else about the shape is settled by the record it makes. */
export const DRAWS: Record<ShapeTool, 'box' | 'ends' | 'points' | 'free'> = {
  rect: 'box', ellipse: 'box', polygon: 'box', star: 'box',
  line: 'ends', arrow: 'ends',
  pen: 'points', curve: 'points',
  pencil: 'free',
}

/* Which shape each one makes. The three pens all make a path — a clicked
 * outline, a curve through the points and a freehand stroke are the same
 * record with different points in it, which is the whole reason there is one
 * path kind rather than three. */
export const KIND_OF: Record<ShapeTool, ShapeKind> = {
  rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', star: 'star',
  line: 'line', arrow: 'arrow',
  pen: 'path', curve: 'path', pencil: 'path',
}

export const isShapeTool = (t: Tool): t is ShapeTool => !!t && t in DRAWS

/* What each one is called. A button with no words in it has to be called
 * something: it is the accessible name, so it is what a screen reader says
 * and what a test asks for. */
export const TOOL_NAME: Record<ShapeTool, string> = {
  rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star',
  line: 'Line', arrow: 'Arrow',
  pen: 'Pen', curve: 'Curvature', pencil: 'Pencil',
}

/* And what it does, which is the tooltip. Every one of them says what Shift
 * does, because Shift is the half of a drawing tool nobody discovers. */
export const TOOL_HINT: Record<ShapeTool, string> = {
  rect: 'Drag out a rectangle. Shift for a square',
  ellipse: 'Drag out an ellipse. Shift for a circle',
  polygon: 'Drag out a polygon. Shift to keep it regular',
  star: 'Drag out a star. Shift to keep it even',
  line: 'Drag a line. Shift holds it to an eighth of a turn',
  arrow: 'Drag an arrow. Shift holds it to an eighth of a turn',
  pen: 'Click to place points. Enter or Escape finishes',
  curve: 'Click to place points and the line curves through them',
  pencil: 'Draw freehand and it is tidied up after you',
}

/* ---------------------------------------------------------------------------
 * Groups.
 *
 * Nine more buttons down the rail is not a rail. So they are two: the one you
 * used last sits on it, and the rest are a press on its corner away — which
 * is how every drawing program has grouped its tools since the first one.
 * ------------------------------------------------------------------------- */

export type Group = 'shape' | 'pen'

export const GROUPS: Record<Group, ShapeTool[]> = {
  shape: ['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow'],
  pen: ['pen', 'curve', 'pencil'],
}

export const groupOf = (t: ShapeTool): Group => (GROUPS.pen.includes(t) ? 'pen' : 'shape')

/* Replaced rather than written into, so a component reading one member out of
 * it gets a stable answer between changes. */
let picked: Record<Group, ShapeTool> = { shape: 'rect', pen: 'pen' }

export const pickedIn = (g: Group): ShapeTool => picked[g]

/* Arm one by name, and remember it as its group's. Pressing the armed one
 * again puts it down, the same as every other tool on the rail. */
export function armShape(t: ShapeTool) {
  picked = { ...picked, [groupOf(t)]: t }
  armed = armed === t ? null : t
  tell()
}

/* The group's key: it walks the group and then puts it down.
 *
 * One press arms the one you had, the next moves along, and after the last
 * one the tool is down again — so the key that picks a shape is also the key
 * that stops, and six shapes cost one letter rather than six. */
export function walkGroup(g: Group) {
  const list = GROUPS[g]
  const at = isShapeTool(armed) ? list.indexOf(armed) : -1
  if (at < 0) {
    armed = picked[g]
  } else {
    const next = list[at + 1]
    picked = { ...picked, [g]: next || list[0] }
    armed = next || null
  }
  tell()
}

let armed: Tool = null
const subs = new Set<() => void>()

const tell = () => { for (const f of subs) f() }
const listen = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

/* What is armed right now, read inside a gesture. */
export const toolNow = (): Tool => armed

/* Arm one, or press the armed one again to put it down. */
export function armTool(t: Tool) {
  armed = armed === t ? null : t
  tell()
}

/* Used up, or given up. */
export function disarm() {
  if (!armed) return
  armed = null
  tell()
}

export function useTool(): Tool {
  return useSyncExternalStore(listen, () => armed, () => null)
}

/* Which member of a group is on the rail. */
export function usePicked(g: Group): ShapeTool {
  return useSyncExternalStore(listen, () => picked[g], () => GROUPS[g][0])
}

/* What each one draws when the drag was a click rather than a drag — a press
 * on the board should still make something, and this is the size it would
 * have arrived at from the button. */
export const FALLBACK: Record<'section' | 'text' | ShapeTool, { w: number; h: number }> = {
  section: { w: 720, h: 480 },
  text: { w: 320, h: 64 },
  rect: { w: 240, h: 160 },
  ellipse: { w: 200, h: 200 },
  polygon: { w: 200, h: 200 },
  star: { w: 200, h: 200 },
  /* A line pressed rather than dragged runs across, because that is what a
     line is if you do not say otherwise. Its box is only as tall as the
     stroke needs, and the line runs through the middle of it. */
  line: { w: 240, h: 16 },
  arrow: { w: 240, h: 16 },
  pen: { w: 200, h: 200 },
  curve: { w: 200, h: 200 },
  pencil: { w: 200, h: 200 },
}

/* Under this, a drag was a click. Four pixels is the same figure the marquee
 * uses to tell a selection from a stray press. */
export const DRAWN = 8
