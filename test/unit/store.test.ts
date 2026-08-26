import { beforeEach, describe, expect, it } from 'vitest'
import { store } from '../../src/state/store'
import { FX_0 } from '../../src/engine/types'
import type { Item } from '../../src/state/types'

/* The board itself, without a browser around it. Lining cards up, spacing them
 * out, tidying them onto a grid, joining them, taking them away and putting
 * them back are all arithmetic on a map of items, and none of it needs a
 * screen to be checked. */

const add = (p: Partial<Item>): Item =>
  store.add({
    id: p.id || `i${Math.random().toString(36).slice(2, 8)}`,
    kind: p.kind || 'image',
    x: 0, y: 0, w: 100, h: 100,
    fx: { ...FX_0 }, tag: null,
    ...p,
  } as Item)

const boxes = () => store.all().map((i) => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }))
const byId = (id: string) => store.getItem(id)!

beforeEach(() => {
  store.load({ id: 'b', name: 'test', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
})

describe('align', () => {
  it('puts every left edge on the leftmost one', () => {
    const a = add({ id: 'a', x: 100, y: 0 })
    const b = add({ id: 'b', x: 40, y: 200 })
    const c = add({ id: 'c', x: 300, y: 400 })
    store.align([a.id, b.id, c.id], 'left')
    expect(boxes().map((n) => n.x)).toEqual([40, 40, 40])
  })

  it('puts every right edge on the rightmost one, whatever the widths', () => {
    const a = add({ id: 'a', x: 0, w: 100 })
    const b = add({ id: 'b', x: 50, w: 300 })
    store.align([a.id, b.id], 'right')
    expect(byId(a.id).x + byId(a.id).w).toBe(350)
    expect(byId(b.id).x + byId(b.id).w).toBe(350)
  })

  it('centres on the middle of what is there', () => {
    const a = add({ id: 'a', x: 0, w: 100 })
    const b = add({ id: 'b', x: 200, w: 100 })
    store.align([a.id, b.id], 'hcentre')
    expect(byId(a.id).x + 50).toBe(byId(b.id).x + 50)
  })

  it('leaves one card alone, since there is nothing to line it up with', () => {
    const a = add({ id: 'a', x: 77, y: 33 })
    store.align([a.id], 'left')
    expect(byId(a.id)).toMatchObject({ x: 77, y: 33 })
  })
})

describe('distribute', () => {
  it('leaves the ends where they are and evens out the gaps', () => {
    add({ id: 'a', x: 0, w: 100 })
    add({ id: 'b', x: 120, w: 100 })
    add({ id: 'c', x: 500, w: 100 })
    store.distribute(['a', 'b', 'c'], 'x')
    expect(byId('a').x).toBe(0)
    expect(byId('c').x).toBe(500)
    const gap1 = byId('b').x - (byId('a').x + byId('a').w)
    const gap2 = byId('c').x - (byId('b').x + byId('b').w)
    expect(Math.abs(gap1 - gap2)).toBeLessThanOrEqual(1)
  })

  it('needs three to have anything to even out', () => {
    add({ id: 'a', x: 0 })
    add({ id: 'b', x: 500 })
    store.distribute(['a', 'b'], 'x')
    expect([byId('a').x, byId('b').x]).toEqual([0, 500])
  })
})

describe('tidy', () => {
  it('lays everything on a grid with nothing overlapping', () => {
    for (let i = 0; i < 7; i++) add({ id: `t${i}`, x: 5 * i, y: 3 * i, w: 100, h: 80 })
    store.tidy(store.all().map((i) => i.id))
    const all = boxes()
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const p = all[i]
        const q = all[j]
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
        expect(overlap).toBe(false)
      }
    }
  })

  /* How many columns it uses comes from how wide the cards already are spread,
   * so tidying keeps roughly the footprint you had. Six cards in a pile stay a
   * column; six cards across the screen come back as rows. */
  it('keeps the footprint: a wide spread comes back as rows', () => {
    for (let i = 0; i < 6; i++) add({ id: `t${i}`, x: i * 130, y: (i % 2) * 30, w: 100, h: 80 })
    store.tidy(store.all().map((i) => i.id))
    const tops = boxes().map((b) => b.y)
    expect(new Set(tops).size).toBeLessThan(6)
  })

  it('and a pile stays a column', () => {
    for (let i = 0; i < 5; i++) add({ id: `p${i}`, x: 4 * i, y: 4 * i, w: 100, h: 80 })
    store.tidy(store.all().map((i) => i.id))
    expect(new Set(boxes().map((b) => b.x)).size).toBe(1)
  })
})

describe('connecting two cards', () => {
  it('makes one arrow between them', () => {
    add({ id: 'a' })
    add({ id: 'b', x: 400 })
    const edge = store.connect('a', 'b')
    expect(edge).toBeTruthy()
    expect(store.all().filter((i) => i.kind === 'edge')).toHaveLength(1)
  })

  /* Asking again hands back the arrow that is already there rather than
   * drawing a second one on top of it, so a second drag between the same pair
   * is a no-op the caller can treat as a success. */
  it('joins a pair once however many times it is asked', () => {
    add({ id: 'a' })
    add({ id: 'b', x: 400 })
    const first = store.connect('a', 'b')
    expect(store.connect('a', 'b')).toBe(first)
    expect(store.connect('b', 'a')).toBe(first)
    expect(store.all().filter((i) => i.kind === 'edge')).toHaveLength(1)
  })

  it('refuses to join a card to itself', () => {
    add({ id: 'a' })
    expect(store.connect('a', 'a')).toBeNull()
    expect(store.all().filter((i) => i.kind === 'edge')).toHaveLength(0)
  })

  it('takes the arrows away with the card they were tied to', () => {
    add({ id: 'a' })
    add({ id: 'b', x: 400 })
    store.connect('a', 'b')
    store.remove(['a'])
    expect(store.all().filter((i) => i.kind === 'edge')).toHaveLength(0)
  })
})

describe('undo', () => {
  it('puts back what one step took away, however many cards it was', () => {
    add({ id: 'a' })
    add({ id: 'b', x: 400 })
    add({ id: 'c', x: 800 })
    store.remove(['a', 'b', 'c'])
    expect(store.all()).toHaveLength(0)
    store.undo()
    expect(store.all()).toHaveLength(3)
  })

  it('treats lining up as one step, not one per card', () => {
    add({ id: 'a', x: 0 })
    add({ id: 'b', x: 100 })
    add({ id: 'c', x: 200 })
    store.align(['a', 'b', 'c'], 'left')
    store.undo()
    expect([byId('a').x, byId('b').x, byId('c').x]).toEqual([0, 100, 200])
  })

  it('redoes what it undid', () => {
    add({ id: 'a', x: 0 })
    add({ id: 'b', x: 100 })
    store.align(['a', 'b'], 'left')
    store.undo()
    store.redo()
    expect(byId('b').x).toBe(0)
  })
})

describe('duplicate', () => {
  it('makes a copy offset from the original, with an identity of its own', () => {
    const a = add({ id: 'a', x: 10, y: 20, name: 'one' })
    const made = store.duplicate([a.id])
    expect(made).toHaveLength(1)
    expect(made[0]).not.toBe(a.id)
    const copy = byId(made[0])
    expect(copy.x).toBeGreaterThan(a.x)
    expect(copy.name).toBe('one')
  })

  it('copies an arrow only when both of its ends are being copied', () => {
    add({ id: 'a' })
    add({ id: 'b', x: 400 })
    store.connect('a', 'b')
    const half = store.duplicate(['a'])
    expect(store.all().filter((i) => i.kind === 'edge')).toHaveLength(1)
    store.remove(half)
    const both = store.duplicate(['a', 'b'])
    expect(both.length).toBeGreaterThanOrEqual(2)
    expect(store.all().filter((i) => i.kind === 'edge')).toHaveLength(2)
  })
})

describe('applyLook', () => {
  it('puts the treatment on every picture and none of the framing', () => {
    const a = add({ id: 'a', kind: 'image', fx: { ...FX_0, zoom: 1.6 } })
    const b = add({ id: 'b', kind: 'note' })
    const n = store.applyLook([a.id, b.id], {
      fxid: 'halftone', ep: null, exp: 0, con: 0, sat: 0, warm: 0, blur: 0, grain: 40, preset: 'custom',
    })
    expect(n).toBe(1)
    expect(byId('a').fx).toMatchObject({ fxid: 'halftone', sat: 0, grain: 40, zoom: 1.6 })
    expect(byId('b').fx.fxid).toBe('none')
  })
})

/* ---------------------------------------------------------------------------
 * Gathering, and moving cards between boards.
 * ------------------------------------------------------------------------- */

describe('gather', () => {
  it('makes a section with a name on it', () => {
    add({ id: 'a', x: 0, y: 0 })
    add({ id: 'b', x: 900, y: 700 })
    const made = store.gather(['a', 'b'], 'Shortlist')!
    expect(made).toBeTruthy()
    const section = byId(made)
    expect(section.kind).toBe('section')
    expect(section.name).toBe('Shortlist')
  })

  it('puts what was gathered inside it, and says so', () => {
    add({ id: 'a', x: 0, y: 0 })
    add({ id: 'b', x: 900, y: 700 })
    const made = store.gather(['a', 'b'])!
    const section = byId(made)
    for (const id of ['a', 'b']) {
      const it = byId(id)
      expect(it.parent).toBe(made)
      expect(it.x).toBeGreaterThanOrEqual(section.x)
      expect(it.y).toBeGreaterThanOrEqual(section.y)
      expect(it.x + it.w).toBeLessThanOrEqual(section.x + section.w)
      expect(it.y + it.h).toBeLessThanOrEqual(section.y + section.h)
    }
  })

  /* On ground of its own, so gathering never lands on the board it came from. */
  it('puts it clear of everything that was already there', () => {
    const before = [add({ id: 'a', x: 0, y: 0 }), add({ id: 'b', x: 900, y: 700 }), add({ id: 'c', x: 400, y: 300 })]
    const made = store.gather(['a', 'b'])!
    const section = byId(made)
    const stayed = byId('c')
    expect(section.y).toBeGreaterThan(stayed.y + stayed.h)
    void before
  })

  it('is one step of undo', () => {
    add({ id: 'a', x: 0, y: 0 })
    add({ id: 'b', x: 900, y: 700 })
    const n = store.all().length
    store.gather(['a', 'b'])
    expect(store.all().length).toBe(n + 1)
    store.undo()
    expect(store.all().length).toBe(n)
    expect(byId('a').parent ?? null).toBe(null)
  })

  it('gathers nothing when there is nothing to gather', () => {
    expect(store.gather([])).toBe(null)
  })
})

describe('taking cards off one board and putting them on another', () => {
  it('takes them off', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    add({ id: 'c' })
    expect(store.cut(['a', 'b'])).toBe(2)
    expect(store.all().map((i) => i.id)).toEqual(['c'])
  })

  it('and a cut with nothing after it is one step of undo', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    store.cut(['a', 'b'])
    store.undo()
    expect(store.all()).toHaveLength(2)
  })

  it('puts them on the board that is loaded now', () => {
    add({ id: 'a', x: 10, y: 20 })
    add({ id: 'b', x: 110, y: 220 })
    store.cut(['a', 'b'])
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    const made = store.paste({ x: 500, y: 500 })
    expect(made).toHaveLength(2)
    expect(store.all()).toHaveLength(2)
  })

  it('keeps the shape they were in', () => {
    add({ id: 'a', x: 10, y: 20 })
    add({ id: 'b', x: 110, y: 220 })
    store.cut(['a', 'b'])
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    store.paste({ x: 500, y: 500 })
    const [p, q] = store.all().sort((x, y) => x.x - y.x)
    expect(q.x - p.x).toBe(100)
    expect(q.y - p.y).toBe(200)
  })

  it('keeps the picture, which never moved: a card names a blob every board shares', () => {
    add({ id: 'a', media: 'img_1', name: 'shot.jpg' })
    store.cut(['a'])
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    store.paste({ x: 0, y: 0 })
    expect(store.all()[0].media).toBe('img_1')
    expect(store.all()[0].name).toBe('shot.jpg')
  })

  it('gives them new ids, so nothing claims to be a card that is elsewhere', () => {
    add({ id: 'a' })
    store.cut(['a'])
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    store.paste({ x: 0, y: 0 })
    expect(store.all()[0].id).not.toBe('a')
  })

  it('leaves behind the section it used to be in, which is not on this board', () => {
    add({ id: 'a', parent: 'sec_1' })
    store.cut(['a'])
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    store.paste({ x: 0, y: 0 })
    expect(store.all()[0].parent ?? null).toBe(null)
  })

  /* A wire joins two cards. Both travelling means it travels; one staying
   * behind means it was a line to nowhere. */
  it('carries an arrow whose two ends are both going', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    store.connect('a', 'b')
    store.cut(['a', 'b'])
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    store.paste({ x: 0, y: 0 })
    const wire = store.all().find((i) => i.kind === 'edge')!
    expect(wire).toBeTruthy()
    const ids = store.all().map((i) => i.id)
    expect(ids).toContain(wire.from)
    expect(ids).toContain(wire.to)
  })

  it('leaves behind one that points at something staying put', () => {
    add({ id: 'a' })
    add({ id: 'b' })
    store.connect('a', 'b')
    store.cut(['a'])
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    store.paste({ x: 0, y: 0 })
    expect(store.all().some((i) => i.kind === 'edge')).toBe(false)
  })

  /* Taking away and putting down is a move, so it happens once. */
  it('is emptied by putting them down', () => {
    add({ id: 'a' })
    store.cut(['a'])
    expect(store.clipped()).toHaveLength(1)
    store.load({ id: 'other', name: 'other', items: [], view: { x: 0, y: 0, z: 1 }, updated: 0 })
    store.paste({ x: 0, y: 0 })
    expect(store.clipped()).toHaveLength(0)
    expect(store.paste({ x: 0, y: 0 })).toEqual([])
  })
})
