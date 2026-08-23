import { useEffect, useState } from 'react'
import { setTheme, subscribeTheme, themeNow, themeWant, watchSystemTheme } from './theme'

/* One button that cycles system → light → dark. Three states is few enough
 * that a menu would be more clicks than the thing itself, and the icon always
 * shows what you are actually looking at rather than what you asked for. */

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const

export function ThemeButton() {
  const [, bump] = useState(0)
  useEffect(() => subscribeTheme(() => bump((n) => n + 1)), [])
  useEffect(() => watchSystemTheme(), [])

  const want = themeWant()
  const now = themeNow()
  const label = want === 'system' ? `Following the system (${now})` : want === 'light' ? 'Light' : 'Dark'

  return (
    <button
      className="icon-btn"
      onClick={() => setTheme(NEXT[want])}
      title={`${label} — click for ${NEXT[want]}`}
      aria-label={`Theme: ${label}`}
      data-theme-want={want}
    >
      {now === 'dark' ? <MoonIcon /> : <SunIcon />}
      {want === 'system' && <i className="icon-auto" aria-hidden="true" />}
    </button>
  )
}

const SunIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8" cy="8" r="3.1" />
    <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" />
  </svg>
)

const MoonIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <path d="M13.4 9.8A5.8 5.8 0 0 1 6.2 2.6a5.9 5.9 0 1 0 7.2 7.2Z" />
  </svg>
)
