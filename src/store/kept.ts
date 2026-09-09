/* ---------------------------------------------------------------------------
 * What the app holds for itself.
 *
 * Nearly everything in the blob store belongs to a card: a photograph, a
 * render, a picture a material is wearing. The sweep works on exactly that
 * rule — anything no card points at is a file nothing uses any more — and the
 * rule is right, which is why it is worth being careful about the one thing it
 * is wrong about.
 *
 * The depth model is not a card's file. Nobody dropped it and no card names
 * it; it was downloaded because somebody pressed a button, and it is kept so
 * the next press is instant and works offline. Under the sweep's rule that
 * makes it garbage, and the sweep would have thrown away twenty-five megabytes
 * that a person deliberately fetched — not even after a grace period, because
 * the grace is measured from when a key was written in this session and a key
 * written last week has no such time.
 *
 * So the keys the app holds for itself are named here, and the sweep reads
 * this rather than guessing from a prefix. There is exactly one today. Getting
 * the room back is a thing you ask for, which is a different command.
 * ------------------------------------------------------------------------- */

/* The weights for the depth model. Fixed rather than generated, because the
 * whole point is that the next session finds the same one. */
export const DEPTH_MODEL = 'model_depth_anything_v2_small_q8'

export const KEPT_BY_THE_APP: readonly string[] = [DEPTH_MODEL]
