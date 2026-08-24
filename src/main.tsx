import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installScreens } from './board/screen'
import './styles.css'

/* The halftone ramps the stylesheet asks for by name. Worked out here rather
 * than written into the CSS by hand, because a screen is a few dozen circles
 * and their radii follow from the coverage they stand for. */
installScreens()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
