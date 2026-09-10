import { familyOf } from './type'
import type { Family } from './type'

/* ---------------------------------------------------------------------------
 * Fetching a family, and only when one is asked for.
 *
 * The rest of this app is offline by construction: the boards are in the
 * browser, the media is in the browser, and nothing is sent anywhere. A font
 * shelf is the one thing that cannot be — a typeface is a file, the app is not
 * going to ship a hundred of them, and Google is where they are.
 *
 * So the bargain is made as small as it can be. Nothing is fetched when the
 * app starts. Nothing is fetched when the panel is opened, or when the list is
 * scrolled, or when a family is hovered. A stylesheet is asked for at the
 * moment somebody sets some text in that family and never again — one request
 * per family per session, carrying no board content and no identity beyond
 * what any browser sends fetching a stylesheet.
 *
 * A board that stays on the two families the app carries never talks to Google
 * at all, which is the case this is written to protect.
 *
 * ## When it does not arrive
 *
 * On a plane, behind a firewall, or with the request blocked outright, the
 * <link> fails and nothing else happens: every stack in the shelf names a real
 * fallback after the Google name, so the text is set in something already on
 * the machine and stays readable. A font that will not load must never be a
 * board you cannot read.
 * ------------------------------------------------------------------------- */

/* Where the stylesheets come from. One constant so a test can see it and a
 * reader can find it without searching. */
export const GOOGLE_CSS = 'https://fonts.googleapis.com/css2'

/* What has been asked for already, by family id. Asking twice is a duplicate
 * request for a file the browser has, so it is asked once. */
const asked = new Set<string>()

/* For anything that needs to know what has been fetched — the tests, and the
 * line in the panel that says so. */
export const fetched = (): string[] => [...asked]

/* Only for tests: forget what this session has asked for. */
export function forgetFonts() {
  asked.clear()
}

/* The stylesheet URL for a family: its name, the weights it offers, and the
 * italics, in the form the css2 endpoint wants.
 *
 * `display=swap` matters more here than it usually does. Without it the text
 * is invisible for up to three seconds while the file is in flight — and
 * invisible text is the exact bug this whole piece of work exists to fix. */
export function cssUrl(f: Family): string {
  const weights = [...new Set(f.weights)].sort((a, b) => a - b)
  const axis = weights.map((w) => `0,${w}`).concat(weights.map((w) => `1,${w}`)).join(';')
  const name = f.name.trim().replace(/\s+/g, '+')
  return `${GOOGLE_CSS}?family=${name}:ital,wght@${axis}&display=swap`
}

/* Whether asking for this family would mean a request: it is one that has to
 * be fetched, and this session has not fetched it. Pure, so the rule can be
 * checked without a document — which is the whole of the decision, the <link>
 * being the easy half. */
export function needsFetch(id?: string): boolean {
  if (!id) return false
  const f = familyOf(id)
  return !!f.google && !asked.has(f.id)
}

/* Which families a set of cards would have to fetch, in the order they are
 * first met. What `loadFor` asks for, worked out apart from asking. */
export function wanted(items: Array<{ type?: { font?: string } | null }>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const i of items) {
    const font = i.type?.font
    if (!font || seen.has(font)) continue
    seen.add(font)
    if (needsFetch(font)) out.push(familyOf(font).id)
  }
  return out
}

/* Ask for a family, if it is one that has to be asked for and has not been.
 * Returns whether this call is what caused the request, which is what the
 * tests assert on. */
export function loadFamily(id?: string): boolean {
  if (!needsFetch(id) || typeof document === 'undefined') return false
  const f = familyOf(id!)
  asked.add(f.id)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = cssUrl(f)
  link.dataset.font = f.id
  /* A stylesheet that never arrives must not hold up anything else, and a
   * failure here is not an error anybody can act on — the fallback in the
   * stack has already taken over by the time it fires. */
  link.addEventListener('error', () => {
    /* Kept in `asked` on purpose: retrying a family the network has already
     * refused just adds a second failed request. */
  })
  document.head.appendChild(link)
  return true
}

/* Everything a set of cards is written in, asked for at once. Called when a
 * board is opened, so a board that was saved in Playfair comes back in
 * Playfair rather than in the fallback until somebody touches the panel. */
export function loadFor(items: Array<{ type?: { font?: string } | null }>): void {
  for (const id of wanted(items)) loadFamily(id)
}
