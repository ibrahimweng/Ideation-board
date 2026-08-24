/* ---------------------------------------------------------------------------
 * Ramps made of dots, not of gradient.
 *
 * A scrim over a photograph has one job: make white words legible without
 * hiding what is underneath. A smooth ramp does that and looks like every
 * other scrim on the web. A halftone screen does the same job by the method
 * this app is actually about — coverage, not opacity — so the dark end is a
 * field of touching dots and the clear end is nothing at all, with the dots
 * shrinking between.
 *
 * Built as an SVG data URI for the same reason the grain is: one tile, tiled
 * by the compositor, no canvas, no image request, and the same recipe wherever
 * it is used.
 * ------------------------------------------------------------------------- */

/* The printer's screen: cell size in CSS pixels. Small enough to read as tone
 * at arm's length, big enough that you can see it is dots. */
const CELL = 3.2

export interface Ramp {
  /* Which end is solid. */
  from: 'top' | 'bottom'
  /* How tall the ramp is, in CSS pixels. */
  height: number
  /* The ink. White scrims exist too: a plate under dark words on a picture. */
  ink?: string
  /* Coverage at the solid end, 0 to 1. Never quite 1, or the dots merge into
   * the flat fill this is here to avoid. */
  max?: number
  /* How fast the dots shrink. Above 1 the clear end clears sooner. */
  bias?: number
  /* How much of the solid end stays at full coverage before the ramp starts.
   * The words sit in that band, and white letters on a half covered screen are
   * white letters on salt and pepper. */
  hold?: number
}

/* One tile: as wide as two cells so the stagger repeats, as tall as the ramp. */
export function screenRamp({ from, height, ink = '#000', max = 0.9, bias = 1.35, hold = 0 }: Ramp): string {
  const w = CELL * 2
  const rows = Math.max(2, Math.round(height / CELL))
  const dots: string[] = []
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * CELL
    /* Distance from the solid end, 0 at the edge that is dark. */
    const raw = from === 'bottom' ? 1 - (r + 0.5) / rows : (r + 0.5) / rows
    /* Nothing happens across the held band; the ramp uses what is left. */
    const t = hold >= 1 ? 0 : Math.max(0, (raw - hold) / (1 - hold))
    const cov = Math.max(0, Math.min(1, (1 - t) ** bias)) * max
    if (cov <= 0.002) continue
    /* Coverage is area, so the radius goes as its root — which is what makes a
     * halftone read as an even ramp rather than as a sudden wall of ink. */
    const rad = CELL * 0.72 * Math.sqrt(cov)
    if (rad < 0.12) continue
    const stagger = r % 2 ? CELL : 0
    for (const cx of [CELL * 0.5 + stagger, CELL * 1.5 + stagger]) {
      if (cx > w) continue
      dots.push(`<circle cx="${cx.toFixed(2)}" cy="${y.toFixed(2)}" r="${rad.toFixed(2)}"/>`)
    }
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${height}'>` +
    `<g fill='${ink}'>${dots.join('')}</g></svg>`
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23').replace(/"/g, "'")}")`
}

/* The two the interface uses, worked out once. Heights match the chrome they
 * sit in: a card's name plate, and the bar across a board being shown. */
export const SCREENS = {
  cardUp: screenRamp({ from: 'bottom', height: 38, max: 0.97, hold: 0.44, bias: 1.5 }),
  cardDown: screenRamp({ from: 'top', height: 38, max: 0.97, hold: 0.44, bias: 1.5 }),
  presentUp: screenRamp({ from: 'bottom', height: 96, max: 0.97, hold: 0.4, bias: 1.15 }),
}

/* A field of dots at even coverage, for a card whose picture has not arrived.
 * It used to be a gradient sliding across, which is the web's way of saying
 * "loading" and this app's way of saying nothing at all. */
export function screenFlat(cov = 0.5, ink = '#000'): string {
  const rad = CELL * 0.72 * Math.sqrt(cov)
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${CELL * 2}' height='${CELL * 2}'>` +
    `<g fill='${ink}'>` +
    `<circle cx='${(CELL * 0.5).toFixed(2)}' cy='${(CELL * 0.5).toFixed(2)}' r='${rad.toFixed(2)}'/>` +
    `<circle cx='${(CELL * 1.5).toFixed(2)}' cy='${(CELL * 1.5).toFixed(2)}' r='${rad.toFixed(2)}'/>` +
    `</g></svg>`
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23').replace(/"/g, "'")}")`
}

/* Put on :root once, so the stylesheet can use them by name. Everything that
 * needs a ramp then reads like every other rule rather than being set inline
 * on each element that happens to want one. */
export function installScreens(root: HTMLElement = document.documentElement) {
  root.style.setProperty('--screen-up', SCREENS.cardUp)
  root.style.setProperty('--screen-down', SCREENS.cardDown)
  root.style.setProperty('--screen-present', SCREENS.presentUp)
  root.style.setProperty('--screen-flat', screenFlat(0.34, '#8b8b95'))
}
