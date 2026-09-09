import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/* ---------------------------------------------------------------------------
 * What the person sees when the board cannot be drawn.
 *
 * React unmounts the whole tree when a render throws, and until this existed
 * that is exactly what happened: the board, the toolbar, the tabs, all of it
 * replaced by a white page with nothing written on it. For an app that holds
 * the only copy of somebody's work in one browser, that is the worst screen
 * available — because a person looking at it cannot tell a drawing failure
 * from having lost everything, and the difference is total.
 *
 * So this says the one thing that is actually true and actually reassuring:
 * the boards are in this browser's storage, untouched, because nothing here
 * writes to them while it is failing to draw them. Reloading is very often
 * enough, and the words underneath are what a bug report needs.
 *
 * It deliberately depends on nothing: no store, no engine, no styles beyond a
 * handful written inline. Whatever went wrong took the app down with it, and a
 * page that fails to explain that it failed is no better than the blank one.
 * ------------------------------------------------------------------------- */

interface Props {
  children: ReactNode
}

interface State {
  err: Error | null
}

export class Boundary extends Component<Props, State> {
  state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    /* The console is where the stack is worth having, and where a person who
       knows to look will look. */
    console.error('[board] the board could not be drawn', err, info.componentStack)
  }

  render() {
    const { err } = this.state
    if (!err) return this.props.children
    return (
      <div className="boom" role="alert">
        <h1>The board could not be drawn.</h1>
        <p>
          <b>Your work is still here.</b> It is in this browser’s storage, where it always was —
          nothing has been written to it while this went wrong. What failed was the drawing of it.
        </p>
        <p>Reloading fixes most of what causes this.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload the board
        </button>
        <pre>{String(err && err.message ? err.message : err)}</pre>
      </div>
    )
  }
}
