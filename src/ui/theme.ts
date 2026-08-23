/* ---------------------------------------------------------------------------
 * Light, dark, or whatever the machine is set to.
 *
 * A board is where pictures are judged, and what surrounds a picture changes
 * what you see in it: the same photograph reads warmer on a pale ground and
 * flatter on a dark one. So this is not decoration, and "follow the system" is
 * not enough on its own — you want to be able to say which surround you are
 * grading against, whatever the rest of the machine is doing.
 *
 * index.html resolves the choice to an explicit data-theme before the first
 * paint. Everything here only has to keep that attribute honest afterwards.
 * ------------------------------------------------------------------------- */

export type ThemeWant = 'system' | 'light' | 'dark'

const KEY = 'ideation.theme'
const listeners = new Set<() => void>()
let want: ThemeWant | null = null

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function themeWant(): ThemeWant {
  if (want) return want
  try {
    const raw = localStorage.getItem(KEY)
    want = raw === 'light' || raw === 'dark' ? raw : 'system'
  } catch {
    want = 'system'
  }
  return want
}

/* What is actually on screen, which is what a control should show. */
export function themeNow(): 'light' | 'dark' {
  const w = themeWant()
  if (w !== 'system') return w
  return media().matches ? 'dark' : 'light'
}

function paint() {
  document.documentElement.dataset.theme = themeNow()
  for (const fn of listeners) fn()
}

export function setTheme(next: ThemeWant) {
  want = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* a session with no storage keeps the choice for as long as it lasts */
  }
  paint()
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/* Following the system means following it as it changes, not only as it was
   when the tab was opened. */
export function watchSystemTheme() {
  const m = media()
  const onChange = () => {
    if (themeWant() === 'system') paint()
  }
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}
