import { takeUpdate, useUpdateReady } from '../app/offline'

/* A new version is here and is not being applied until you say so.
 *
 * Not a toast, which would go away before it was read, and not an alarm, which
 * is for the one state where missing it costs you the work. This can wait as
 * long as it likes: the version on screen is a working one. */
export function UpdateBar() {
  const ready = useUpdateReady()
  if (!ready) return null
  return (
    <div className="update-bar" role="status">
      <span>A new version is ready</span>
      <button onClick={takeUpdate}>Reload</button>
    </div>
  )
}
