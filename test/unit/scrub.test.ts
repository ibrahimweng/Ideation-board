import { describe, expect, it, vi } from 'vitest'
import { startScrub } from '../../src/ui/scrub'

/* Dragging a number's name to change it.
 *
 * All of this is about arithmetic and about restraint: what a pixel is worth,
 * what the modifiers do to that, and the two cases where it must do nothing at
 * all — a press that never moved, which is a click on a label, and a value
 * already at the end of its range. */

/* A pointerdown with just enough of an event on it, and a window that records
 * what was hung on it. */
function harness() {
  const moves: ((e: PointerEvent) => void)[] = []
  const ups: (() => void)[] = []
  const add = vi.fn((type: string, fn: (e: PointerEvent) => void) => {
    if (type === 'pointermove') moves.push(fn)
    else ups.push(fn as () => void)
  })
  const body = { dataset: {} as Record<string, string> }
  vi.stubGlobal('window', { addEventListener: add, removeEventListener: vi.fn() })
  vi.stubGlobal('document', { body })
  const el = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() }
  const press = { button: 0, clientX: 100, pointerId: 1, preventDefault: vi.fn(), currentTarget: el }
  return {
    press: press as unknown as React.PointerEvent,
    /* Drag to `x`, with whatever keys held. */
    drag(x: number, keys: { shiftKey?: boolean; altKey?: boolean } = {}) {
      for (const fn of moves) fn({ clientX: x, shiftKey: false, altKey: false, ...keys } as PointerEvent)
    },
    end() {
      for (const fn of ups) fn()
    },
    body,
  }
}

describe('dragging a number', () => {
  it('moves it one step for every pixel', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 50, step: 1, onChange })
    h.drag(140)
    expect(onChange).toHaveBeenLastCalledWith(90)
  })

  it('and the other way for a drag to the left', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 50, step: 1, onChange })
    h.drag(60)
    expect(onChange).toHaveBeenLastCalledWith(10)
  })

  it('does nothing at all for a press that never moved', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 50, step: 1, onChange })
    h.drag(101)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a step of a hundredth to two decimal places', () => {
    /* Without this it walks into 0.30000000000000004 within a few pixels and
       puts that on screen. */
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 0.2, step: 0.01, onChange })
    h.drag(110)
    expect(onChange).toHaveBeenLastCalledWith(0.3)
  })

  it('moves in tens with shift held', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 0, step: 1, onChange })
    h.drag(110, { shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith(100)
  })

  it('and in tenths with alt, which is what a step of one cannot otherwise do', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 0, step: 0.1, onChange })
    h.drag(110, { altKey: true })
    expect(onChange).toHaveBeenLastCalledWith(0.1)
  })

  it('stops at both ends of the range', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 50, step: 1, min: 0, max: 60, onChange })
    h.drag(400)
    expect(onChange).toHaveBeenLastCalledWith(60)
    h.drag(-400)
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('says nothing twice: a pixel that does not change the figure changes nothing', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub(h.press, { value: 50, step: 1, min: 0, max: 60, onChange })
    h.drag(400)
    h.drag(401)
    h.drag(402)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('ignores anything but the left button, which is on its way to a menu', () => {
    const onChange = vi.fn()
    const h = harness()
    startScrub({ ...(h.press as object), button: 2 } as React.PointerEvent, { value: 50, step: 1, onChange })
    h.drag(400)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks the page while it runs, and stops marking it when it ends', () => {
    const h = harness()
    startScrub(h.press, { value: 50, step: 1, onChange: vi.fn() })
    expect(h.body.dataset.scrubbing).toBe('1')
    h.end()
    expect(h.body.dataset.scrubbing).toBeUndefined()
  })
})
