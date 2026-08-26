/* ---------------------------------------------------------------------------
 * Your key, on your machine.
 *
 * The board has no server. Nothing it holds ever leaves the browser, and the
 * key that pays for generated pictures is held to the same rule: it lives in
 * this browser's local storage, it is read only at the moment a request is
 * built, and it goes straight to Google from your machine.
 *
 * That is a deliberate trade and worth saying plainly. A key kept on a server
 * would mean one key paying for everybody who finds the address — a free image
 * generator for strangers, billed to whoever deployed it. A key kept here can
 * only ever spend your own quota, and the deployment is a static site that
 * knows nothing.
 *
 * What follows from that:
 *   - It is per browser. A second machine needs the key entered again.
 *   - Anything with a debugger open on this page can read it, so it belongs on
 *     a machine you trust, and the key should be one you can revoke.
 *   - It is not in the board record, so it is not in an export, not in the
 *     folder mirror, and not in anything that travels to another tab. The
 *     board is data about pictures; this is a credential, and the two never
 *     touch. `test/unit/aikey.test.ts` holds that line.
 * ------------------------------------------------------------------------- */

const KEY = 'ideation.ai.key'
const MODEL = 'ideation.ai.model'
const METHOD = 'ideation.ai.method'
const BASE = 'ideation.ai.base'

/* Google's own address. Overridable so that a proxy of your own — or the fake
 * endpoint the browser tests run against — can stand in for it. */
export const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/* localStorage throws rather than returning null in a browser set to block
 * site data, and in Safari's private mode. A missing key is a state the app
 * already handles; a thrown one would take the sheet down with it. */
function read(name: string): string {
  try {
    return localStorage.getItem(name) || ''
  } catch {
    return ''
  }
}

function write(name: string, value: string) {
  try {
    if (value) localStorage.setItem(name, value)
    else localStorage.removeItem(name)
  } catch {
    /* Nothing to be done, and nothing worth interrupting the person for. */
  }
}

export const apiKey = () => read(KEY)
export const hasKey = () => apiKey().length > 0
export const setApiKey = (k: string) => write(KEY, k.trim())
export const forgetApiKey = () => write(KEY, '')

export const modelId = () => read(MODEL)

/* Which of the two request shapes the chosen model takes.
 *
 * Written down when a model is picked from the list, because the listing is
 * the only thing that actually knows and it is not fetched again on a reload.
 * Cleared when a model id is typed by hand, where there is nothing to know it
 * from and the name has to be guessed at instead. */
export function setModelId(m: string, method: 'predict' | 'generateContent' | '' = '') {
  write(MODEL, m.trim())
  write(METHOD, method)
}

export function modelMethod(): 'predict' | 'generateContent' | '' {
  const v = read(METHOD)
  return v === 'predict' || v === 'generateContent' ? v : ''
}

export const apiBase = () => read(BASE) || DEFAULT_BASE
export const setApiBase = (b: string) => write(BASE, b.trim() === DEFAULT_BASE ? '' : b.trim())

/* Enough of the key to recognise it by, and not enough to use. Shown in place
 * of the key once it is saved, so the field never holds the secret again after
 * the moment it was typed. */
export function maskKey(k = apiKey()): string {
  if (!k) return ''
  if (k.length <= 8) return '••••'
  return k.slice(0, 4) + '••••••••' + k.slice(-4)
}
