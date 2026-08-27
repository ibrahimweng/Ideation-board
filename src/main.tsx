import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installScreens } from './board/screen'
import { goOffline } from './app/offline'
import './styles.css'

/* The halftone ramps the stylesheet asks for by name. Worked out here rather
 * than written into the CSS by hand, because a screen is a few dozen circles
 * and their radii follow from the coverage they stand for. */
installScreens()

/* The boards were always local. This is what makes the app local too, so an
 * installed copy opens without a network instead of showing the browser's
 * offline page over a machine that has everything on it. */
goOffline()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
