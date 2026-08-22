/* The grain overlay, in one place.
 *
 * A card lays this over itself as a background image and an export paints the
 * same thing on top of the finished picture. It used to live only in the
 * stylesheet, where the export could not reach it, and a copy in each would
 * drift the moment either was touched. */

export const GRAIN_TILE = 120

export const GRAIN_SVG =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'>" +
  "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter>" +
  "<rect width='120' height='120' filter='url(%23n)' opacity='0.55'/></svg>"

export const GRAIN_URL = `url("${GRAIN_SVG}")`
