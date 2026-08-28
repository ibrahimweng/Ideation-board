/* ---------------------------------------------------------------------------
 * Finding a command by typing at it.
 *
 * Every letter of the query, in order, somewhere in the text: typing "expic"
 * finds "Export the selected pictures" without anybody having to know where
 * the gaps are, and "tdy" finds "Tidy up the whole board".
 *
 * That looseness needs a floor under it. A subsequence match will happily
 * accept letters scattered across a long sentence — "note" is inside "clear up
 * files nothing uses any more" if you are willing to walk far enough — so
 * every command the app grows makes every query match a little more, and a
 * list that shows half of everything has stopped narrowing anything. The
 * scattered ones were always there and always sorted to the bottom; there were
 * simply few enough of them not to notice.
 *
 * The floor is relative rather than absolute. A cutoff of "at least this many
 * points" would throw away everything on a query that is a weak but honest
 * match for the whole list; a cutoff of "at least this fraction of the best
 * one" keeps the good answers whatever the query, and drops the ones that are
 * only in the list because their letters happen to appear in that order.
 *
 * Its own file because it is the one part of the command list that is worth
 * checking without a browser, and because this is the second time its
 * behaviour has mattered.
 * ------------------------------------------------------------------------- */

export interface Findable {
  name: string
  keywords?: string
}

/* The score prefers matches that start words and matches that are close
 * together, so the exact thing you meant sorts above the thing that merely
 * contains the same letters. Zero means the letters are not all there. */
export function score(text: string, q: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  let ti = 0
  let points = 0
  let streak = 0
  let first = -1
  let last = 0
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return 0
    if (first < 0) first = at
    last = at
    const startsWord = at === 0 || t[at - 1] === ' ' || t[at - 1] === '-'
    points += startsWord ? 6 : 1
    points += at === ti ? (streak += 2) : (streak = 0)
    ti = at + 1
  }
  /* A short name matching is a better match than a long one. */
  const raw = points + Math.max(0, 24 - text.length) / 8

  /* How much of what it matched the query actually accounts for.
   *
   * The bonuses above are all local — this letter starts a word, this letter
   * follows the last one — and a coincidence can collect them: "note" takes
   * "not" out of the middle of "nothing" and scores it as a tight,
   * word-starting match, which locally it is. What tells that apart from the
   * real answer is the span. "note" is the whole of "Note" and four letters
   * spread over eleven of "clear up files nothing uses". Thin matches are
   * still matches, so this scales rather than rejects. */
  const span = last - first + 1
  const covered = span > 0 ? q.length / span : 1
  return raw * (0.35 + 0.65 * Math.min(1, covered))
}

/* Is the query a word of this, or the start of one?
 *
 * Everything above is a subsequence match, which is what lets "expic" find
 * "Export the selected pictures" — and which cannot tell that apart from
 * "help" walking through "export tHe sELected Pictures", four letters in the
 * right order and nothing more. Typing a whole word is not a coincidence, and
 * it was losing to one: the command called Help came second to exporting a
 * PNG. So a word you really typed counts for more than any number of letters
 * that happen to be in order. */
function wordHit(text: string, q: string): boolean {
  const t = text.toLowerCase()
  for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + 1)) {
    if (at === 0 || t[at - 1] === ' ' || t[at - 1] === '-') return true
  }
  return false
}

/* Keywords count, at a discount: they are there so a word nobody put in a
 * name still finds the thing, not so they can outrank the name itself. The
 * same order holds for a word hit — in the name it is worth more than in the
 * keywords, and either is worth more than letters merely appearing in order. */
export function rate<T extends Findable>(c: T, q: string): number {
  const all = `${c.name} ${c.keywords || ''}`
  const s = Math.max(score(c.name, q), score(all, q) * 0.7)
  if (!q || !s) return s
  return s * (wordHit(c.name, q) ? 3 : wordHit(all, q) ? 2 : 1)
}

/* How far below the best a match may be and still be worth showing. Low
 * enough that a real second choice survives, high enough that letters merely
 * appearing in order do not. */
export const FLOOR = 0.4

/* At most this many, so a query that matches nearly everything is still a list
 * rather than the whole app again. */
export const MOST = 40

export function findCommands<T extends Findable>(commands: T[], raw: string): T[] {
  const q = raw.trim().toLowerCase()
  const rated = commands.map((c) => ({ c, s: rate(c, q) })).filter((r) => r.s > 0)
  if (!rated.length) return []
  rated.sort((a, b) => b.s - a.s)
  /* With no query everything scores the same and everything is shown, which is
   * the list of what the board can do and is meant to be complete. */
  if (!q) return rated.slice(0, MOST).map((r) => r.c)
  const keep = rated[0].s * FLOOR
  return rated.filter((r) => r.s >= keep).slice(0, MOST).map((r) => r.c)
}
