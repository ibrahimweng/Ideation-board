import { beforeEach, describe, expect, it } from 'vitest'
import { store } from '../../src/state/store'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* ---------------------------------------------------------------------------
 * Undo and redo.
 *
 * A step used to be the whole board serialised, which was correct by
 * construction: putting a step back replaced everything, so it could not
 * possibly leave a piece behind. It was also why undo got shorter the more a
 * board had on it, and why picking a card up on a large board cost a
 * serialisation of every other card first.
 *
 * A step is now what changed. That is cheap and it is no longer correct by
 * construction: it is correct only while every write records what it touched.
 * A path that reaches the items directly would leave that piece behind, and
 * the symptom would not be an error — it would be an undo that puts most of a
 * change back, noticed by somebody a week later with no idea what they did.
 *
 * So the important test here is the last one, and it is a round trip rather
 * than a list of cases: do a few dozen arbitrary things, remember the whole
 * board before each, then walk all the way back and all the way forward again
 * and insist every state matches exactly. Anything a write forgets to record
 * shows up as a difference, whichever write it was.
 * ------------------------------------------------------------------------- */

const add = (p: Partial<Item> = {}): Item =>
  store.add({
    id: p.id || `i${Math.random().toString(36).slice(2, 8)}`,
    kind: p.kind || 'image',
    x: 0, y: 0, w: 100, h: 100,
    fx: { ...FX_0 }, tag: null,
    ...p,
  } as Item)

/* The whole board, in order, as one comparable value. `all()` walks the order
 * and reads each item, so this catches a lost item, a changed item and a
 * reordered board alike. */
const boardNow = () => JSON.stringify(store.all())

/* A board nobody has used before. The store is a singleton and it keeps a
   history per board id for as long as it lives, so reusing an id would carry
   the previous test's undo into this one. */
let boards = 0
const fresh = (id = `board${++boards}`) => {
  store.load({ id, name: 'test', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
  return id
}

beforeEach(() => void fresh())

describe('one step at a time', () => {
  it('puts back an edit', () => {
    add({ id: 'a', x: 10 })
    const before = boardNow()
    store.update('a', { x: 400, w: 250 })
    expect(boardNow()).not.toBe(before)
    store.undo()
    expect(boardNow()).toBe(before)
  })

  it('puts back an addition, and the order with it', () => {
    add({ id: 'a' })
    const before = boardNow()
    add({ id: 'b' })
    expect(store.count()).toBe(2)
    store.undo()
    expect(boardNow()).toBe(before)
    expect(store.getItem('b')).toBeUndefined()
    expect(store.getOrder()).toEqual(['a'])
  })

  it('puts back a deletion', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    const before = boardNow()
    store.remove(['a'])
    expect(store.count()).toBe(1)
    store.undo()
    expect(boardNow()).toBe(before)
  })

  it('puts back a section and everything that went with it', () => {
    const s = add({ id: 's', kind: 'section', w: 500, h: 500 })
    add({ id: 'a', parent: s.id })
    add({ id: 'b', parent: s.id })
    const before = boardNow()
    store.remove([s.id])
    expect(store.count()).toBe(0)
    store.undo()
    expect(boardNow()).toBe(before)
  })

  it('puts back a duplicate', () => {
    add({ id: 'a' })
    const before = boardNow()
    expect(store.duplicate(['a'])).toHaveLength(1)
    store.undo()
    expect(boardNow()).toBe(before)
  })

  it('puts back a cut and a paste as the two things they are', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    const start = boardNow()
    store.cut(['a'])
    const afterCut = boardNow()
    store.paste({ x: 300, y: 300 })
    store.undo()
    expect(boardNow()).toBe(afterCut)
    store.undo()
    expect(boardNow()).toBe(start)
  })

  it('puts back a gather, section and all', () => {
    add({ id: 'a', x: 0 })
    add({ id: 'b', x: 300 })
    const before = boardNow()
    expect(store.gather(['a', 'b'], 'Keep')).toBeTruthy()
    store.undo()
    expect(boardNow()).toBe(before)
  })

  it('puts back a wire without leaving an end behind', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    const before = boardNow()
    store.connect('a', 'b')
    expect(store.all().some((i) => i.kind === 'edge')).toBe(true)
    store.undo()
    expect(boardNow()).toBe(before)
  })
})

describe('redo', () => {
  it('goes forward again, exactly', () => {
    add({ id: 'a' })
    store.update('a', { x: 90 })
    const after = boardNow()
    store.undo()
    store.redo()
    expect(boardNow()).toBe(after)
  })

  it('is dropped the moment something new is done', () => {
    add({ id: 'a' })
    store.update('a', { x: 90 })
    store.undo()
    expect(store.canRedo).toBe(true)
    store.update('a', { y: 50 })
    expect(store.canRedo).toBe(false)
  })
})

describe('a gesture is one press', () => {
  it('collapses a whole drag into one step', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    const before = boardNow()
    /* What a drag really does: one gesture, then a write per pointer move with
       recording off. */
    store.beginGesture()
    for (let i = 0; i < 50; i++) store.moveMany(['a', 'b'], 3, 2, false)
    expect(store.getItem('a')!.x).toBe(150)
    store.undo()
    expect(boardNow()).toBe(before)
    /* One press, not fifty: the next one goes past the drag to the add before
       it rather than back through the pointer moves. */
    store.undo()
    expect(store.count()).toBe(1)
  })

  it('merges a rapid series when asked to', () => {
    add({ id: 'a' })
    /* A boundary of its own first. Coalescing merges into whatever step was
       opened last, and without this the run would merge into the add. That is
       the same thing a pause in front of the keyboard does. */
    store.beginGesture()
    const before = boardNow()
    /* Holding an arrow key: many gestures inside the coalescing window. */
    for (let i = 0; i < 20; i++) {
      store.beginGesture(500)
      store.moveMany(['a'], 8, 0, false)
    }
    expect(store.getItem('a')!.x).toBe(160)
    store.undo()
    expect(boardNow()).toBe(before)
    /* And it really was one step, not twenty. */
    store.undo()
    expect(store.count()).toBe(0)
  })

  it('does not spend a press on a command that changed nothing', () => {
    const s = add({ id: 's', kind: 'section', w: 400, h: 400 })
    const before = boardNow()
    /* Sections are not raised or lowered, so this touches nothing at all. */
    store.bringToFront([s.id])
    expect(boardNow()).toBe(before)
    /* One press goes back past the add, because the command that changed
       nothing never became a step to spend a press on. */
    store.undo()
    expect(store.count()).toBe(0)
  })
})

describe('depth no longer follows the size of the board', () => {
  const fill = (n: number) => {
    const ids: string[] = []
    for (let i = 0; i < n; i++) ids.push(add({ id: `i${i}`, x: i * 7, y: i * 11 }).id)
    return ids
  }

  it('keeps all sixty steps on a board of five thousand', () => {
    const ids = fill(5000)
    /* Sixty separate edits, each touching one card, on a board where one old
       whole-board snapshot was about 1.8MB and only six of them fitted. */
    const states: string[] = []
    for (let n = 0; n < 60; n++) {
      states.push(boardNow())
      store.update(ids[n], { x: 9000 + n })
    }
    for (let n = 59; n >= 0; n--) {
      store.undo()
      expect(boardNow()).toBe(states[n])
    }
    expect(store.canUndo).toBe(false)
  })

  it('still stops at sixty', () => {
    add({ id: 'a' })
    for (let n = 0; n < 90; n++) store.update('a', { x: n })
    let steps = 0
    while (store.canUndo) {
      store.undo()
      steps++
      if (steps > 200) break
    }
    expect(steps).toBe(60)
  })

  it('costs what the change costs, not what the board costs', () => {
    fill(2000)
    /* Nothing here reads a private field: the claim is about behaviour, so it
       is measured the way the app would feel it. Sixty one-card edits on a two
       thousand card board have to remain undoable, which they could not be if
       a step still weighed the whole board. */
    const first = boardNow()
    for (let n = 0; n < 60; n++) store.update(`i${n}`, { y: 5000 + n })
    for (let n = 0; n < 60; n++) store.undo()
    expect(boardNow()).toBe(first)
  })
})

describe('one history per board', () => {
  it('does not reach across a switch', () => {
    add({ id: 'a', x: 1 })
    fresh()
    add({ id: 'b', x: 2 })
    store.undo()
    expect(store.getItem('b')).toBeUndefined()
    /* The other board's step must not be reachable from here. */
    expect(store.canUndo).toBe(false)
  })

  it('is still there when you come back', () => {
    const first = fresh()
    add({ id: 'a' })
    store.update('a', { x: 77 })
    const away = store.all()
    /* Off to another board and back, the way stepping into a nested board and
       out again does it. The board comes back off the disk with the same id
       and the same stamp, which is what its history is keyed to. */
    fresh()
    add({ id: 'b' })
    store.load({ id: first, name: 'test', items: away, view: { x: 0, y: 0, z: 1 }, updated: 0 })
    expect(store.canUndo).toBe(true)
    store.undo()
    expect(store.getItem('a')!.x).toBe(0)
  })

  it('drops a history whose board was written by somebody else', () => {
    const first = fresh()
    add({ id: 'a' })
    const away = store.all()
    fresh()
    /* Back, but the record carries a stamp this history was not built on:
       another tab wrote it while we were away. Undoing onto their work would
       be a quiet overwrite rather than an undo. */
    store.load({ id: first, name: 'test', items: away, view: { x: 0, y: 0, z: 1 }, updated: 999 })
    expect(store.canUndo).toBe(false)
  })

  it('leaves a step open on the board it belongs to', () => {
    add({ id: 'a' })
    store.beginGesture()
    store.moveMany(['a'], 10, 0, false)
    /* Switching away mid-gesture, then writing on the new board. The write
       must not be filed into the first board's open step. */
    fresh()
    add({ id: 'b' })
    store.undo()
    expect(store.getItem('b')).toBeUndefined()
    expect(store.canUndo).toBe(false)
  })
})

/* ---------------------------------------------------------------------------
 * The round trip.
 *
 * Every write path, mixed at random, walked all the way back and all the way
 * forward. A write that forgets to record what it touched cannot pass this,
 * whichever write it is and whatever it forgot.
 * ------------------------------------------------------------------------- */
describe('a few dozen arbitrary things, undone and redone', () => {
  /* Seeded, so a failure is a failure anybody can reproduce rather than one
     that shows up in CI once a fortnight. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const roundTrip = (seed: number) => {
    fresh(`seed${seed}`)
    const rand = rng(seed)
    const pick = <T,>(list: T[]): T | undefined =>
      list.length ? list[Math.floor(rand() * list.length)] : undefined
    const some = () => {
      const ids = store.all().filter((i) => i.kind !== 'edge').map((i) => i.id)
      return ids.filter(() => rand() < 0.5).slice(0, 6)
    }

    /* Something to work on, so the early operations are not all no-ops. */
    for (let i = 0; i < 8; i++) {
      add({ id: `s${i}`, x: Math.floor(rand() * 900), y: Math.floor(rand() * 900) })
    }

    const ops: (() => void)[] = [
      () => void add({ x: Math.floor(rand() * 900), y: Math.floor(rand() * 900) }),
      () => void add({ kind: 'note', text: 'a note' }),
      () => void add({ kind: 'section', w: 600, h: 400 }),
      () => { const id = pick(store.all().map((i) => i.id)); if (id) store.update(id, { x: Math.floor(rand() * 900) }) },
      () => { const s = some(); if (s.length) store.moveMany(s, 13, -7) },
      () => { const s = some(); if (s.length) store.remove(s) },
      () => { const s = some(); if (s.length) store.duplicate(s) },
      () => { const s = some(); if (s.length) store.bringToFront(s) },
      () => { const s = some(); if (s.length) store.sendToBack(s) },
      () => { const s = some(); if (s.length) store.clearParent(s) },
      () => { const s = some(); if (s.length > 1) store.align(s, 'left') },
      () => { const s = some(); if (s.length > 2) store.distribute(s, 'x') },
      () => { const s = some(); if (s.length > 1) store.tidy(s) },
      () => { const s = some(); if (s.length) store.setTag(s, rand() < 0.5 ? 'red' : null) },
      () => { const s = some(); if (s.length) store.setPick(s, rand() < 0.5 ? 'in' : 'out') },
      () => { const s = some(); if (s.length) store.applyLook(s, { fxid: 'halftone', ep: null } as never) },
      () => { const s = some(); if (s.length > 1) store.gather(s, 'Kept') },
      () => {
        const ids = store.all().filter((i) => i.kind !== 'edge').map((i) => i.id)
        const a = pick(ids); const b = pick(ids)
        if (a && b && a !== b) store.connect(a, b)
      },
      () => { const s = some(); if (s.length) store.cut(s) },
      () => void store.paste({ x: 40, y: 40 }),
      () => {
        /* A drag: one gesture, many writes with recording off. */
        const s = some()
        if (!s.length) return
        store.beginGesture()
        for (let i = 0; i < 5; i++) store.moveMany(s, 4, 3, false)
      },
    ]

    /* Under the sixty step limit, so every one of them stays undoable.
       A state is remembered only when the operation actually changed the
       board, because a command that changed nothing is not a step and must
       not be expected to cost a press. */
    const STEPS = 40
    const states: string[] = []
    for (let n = 0; n < STEPS; n++) {
      const was = boardNow()
      ops[Math.floor(rand() * ops.length)]()
      if (boardNow() !== was) states.push(was)
    }
    const end = boardNow()
    /* Worth knowing the run did something, or a round trip over nothing would
       pass and prove nothing. */
    expect(states.length).toBeGreaterThan(12)

    /* All the way back. Every recorded state has to be passed through, in
       order, and landed on exactly.
       
       Not one press per state, because a command can write a value equal to
       the one already there — setting the tag a card already wears, marking
       what is already marked — and that is a step whose undo changes nothing
       visible. Those are wasteful rather than wrong, and insisting on a one to
       one count here would be testing that quirk rather than the thing that
       matters, which is that nothing is lost or left behind on the way back. */
    for (let n = states.length - 1; n >= 0; n--) {
      let presses = 0
      while (boardNow() !== states[n] && store.canUndo) {
        store.undo()
        expect(presses++).toBeLessThan(8)
      }
      expect(boardNow()).toBe(states[n])
    }

    /* And all the way forward, landing exactly where the run finished. This is
       the half that proves the inverse of every step is the step itself read
       the other way. */
    while (store.canRedo) store.redo()
    expect(boardNow()).toBe(end)

    /* Undo runs out rather than running on. */
    let guard = 0
    while (store.canUndo && guard < 500) { store.undo(); guard++ }
    expect(guard).toBeLessThan(500)
    expect(store.count()).toBe(0)
  }

  for (const seed of [1, 2, 3, 7, 11, 42, 99, 1234, 20260907]) {
    it(`round trips exactly, seed ${seed}`, () => roundTrip(seed))
  }
})

/* ---------------------------------------------------------------------------
 * The cost of picking something up.
 *
 * Opening a step used to mean serialising the whole board, so the first frame
 * of every drag paid for every card that was not being dragged: about 8ms on
 * five thousand items, before anything had moved. A step now records what the
 * gesture touches, so the cost follows the gesture rather than the board.
 *
 * Asserted as a ratio rather than as milliseconds. A wall clock number would
 * mean this test failing on a loaded CI runner and passing on a fast laptop,
 * which is a test that reports the machine rather than the code. What is
 * actually claimed here is that the cost stopped scaling, and a ratio is that
 * claim written down.
 * ------------------------------------------------------------------------- */
describe('picking a card up does not read the whole board', () => {
  const boardOf = (n: number) => {
    fresh()
    for (let i = 0; i < n; i++) add({ id: `i${i}`, x: i * 7, y: i * 11 })
    return `i0`
  }

  /* One gesture and one card moved, which is what the first frame of a drag
     really costs. Repeated, and the middle taken, so one unlucky garbage
     collection does not decide the result. */
  const costOf = (n: number, runs = 60) => {
    const id = boardOf(n)
    const times: number[] = []
    for (let r = 0; r < runs; r++) {
      const t = performance.now()
      store.beginGesture()
      store.moveMany([id], 1, 1, false)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    return times[Math.floor(runs / 2)]
  }

  it('costs about the same on five thousand cards as on five hundred', () => {
    /* Warm, so the first measurement is not paying for the code being compiled
       for the first time. */
    costOf(200)

    const small = costOf(500)
    const large = costOf(5000)

    /* Ten times the board. Serialising it was ten times the work; recording
       one card is the same work either way. Four is loose enough to survive a
       busy runner and far under the ten this used to be. */
    const ratio = large / Math.max(small, 0.0005)
    expect(ratio).toBeLessThan(4)
  })

  it('leaves the whole board undoable afterwards', () => {
    /* The point of the cheap step is that it is still a real step. */
    const id = boardOf(5000)
    const before = store.getItem(id)!.x
    store.beginGesture()
    for (let i = 0; i < 30; i++) store.moveMany([id], 3, 0, false)
    expect(store.getItem(id)!.x).toBe(before + 90)
    store.undo()
    expect(store.getItem(id)!.x).toBe(before)
    expect(store.count()).toBe(5000)
  })
})
