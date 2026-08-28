/* ---------------------------------------------------------------------------
 * The page a board comes out as.
 *
 * One file, opened by double-clicking it, with no network behind it. So this
 * is a string: the markup, the styling and the small amount of script that
 * makes it pan, zoom and walk into the boards inside — all of it inline,
 * because there is nowhere for a second file to be.
 *
 * It is deliberately not the app. The app is for making a board and this is
 * for looking at one, so what is here is what a reader needs: the board as it
 * was laid out, a picture that opens at full size when you click it, the
 * boards inside reachable, and a way back. No editing, no effects panel, no
 * store, no React.
 *
 * The board's own data goes in as JSON rather than as markup, because a note
 * can say anything at all — including the characters that would end a script
 * tag — and a document that can be broken by its own contents is not a
 * document. It is escaped on the way in and parsed on the way out.
 * ------------------------------------------------------------------------- */

export interface PageItem {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  z: number
  name: string
  tag: string | null
  pick: 'in' | 'out' | null
  color: string
  /* A baked picture, as data. */
  img?: string
  alt?: string
  /* A note, already turned into markup. */
  html?: string
  text?: string
  url?: string
  board?: string
  from?: string
  to?: string
  missing?: boolean
}

export interface PageBoard {
  id: string
  name: string
  items: PageItem[]
}

export interface PageData {
  root: string
  boards: PageBoard[]
  made: number
}

/* JSON that cannot end the script it is inside, and cannot start an HTML
 * comment either. Both are the same class of bug and both are one line. */
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, (c) =>
    c === '\u2028' ? '\\u2028' : '\\u2029'
  )

const escText = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const CSS = `
:root{
  color-scheme:light dark;
  --bg:#f6f6f7;--surface:#fff;--line:#e4e4e7;--ink:#18181b;--ink-2:#52525b;--muted:#7c7c86;
  --dot:#dcdce1;--accent:#ff5a1f;--scrim:rgba(24,24,27,.86);--sh:0 1px 2px rgba(24,24,27,.06),0 6px 16px rgba(24,24,27,.07);
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0d0d0f;--surface:#191a1d;--line:#2a2b31;--ink:#f4f4f5;--ink-2:#c3c3ca;--muted:#8b8b95;
  --dot:#232429;--scrim:rgba(0,0,0,.9);--sh:0 1px 2px rgba(0,0,0,.4),0 6px 16px rgba(0,0,0,.45);
}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans)}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#top{
  position:fixed;inset:0 0 auto 0;height:48px;z-index:20;display:flex;align-items:center;gap:10px;
  padding:0 16px;background:var(--surface);border-bottom:1px solid var(--line)
}
#top h1{font-size:15px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#crumbs{display:flex;align-items:center;gap:4px;font-size:13px;color:var(--muted);min-width:0}
#crumbs button{padding:3px 7px;border-radius:6px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
#crumbs button:hover{background:var(--bg);color:var(--ink)}
#crumbs i{font-style:normal;opacity:.5}
#tools{margin-left:auto;display:flex;align-items:center;gap:4px;flex:none}
#tools button{padding:6px 10px;border-radius:6px;font-size:13px;color:var(--muted)}
#tools button:hover{background:var(--bg);color:var(--ink)}
#stage{position:fixed;inset:48px 0 0 0;overflow:hidden;cursor:grab;
  background-image:radial-gradient(var(--dot) 1px,transparent 1px);background-size:24px 24px}
#stage[data-drag]{cursor:grabbing}
#world{position:absolute;transform-origin:0 0;will-change:transform}
.c{position:absolute;border-radius:10px}
.thing{background:var(--surface);box-shadow:var(--sh);overflow:hidden}
.thing img{display:block;width:100%;height:100%;object-fit:cover;cursor:zoom-in}
.note{padding:12px 14px;overflow:hidden;font-size:13px;line-height:1.55;
  background:#fffdf5;color:#18181b}
.note h1{font-size:17px;margin:.2em 0 .3em}.note h2{font-size:15px;margin:.2em 0 .3em}
.note h3{font-size:14px;margin:.2em 0 .3em}
.note p{margin:0 0 .5em}.note ul,.note ol{margin:0 0 .5em;padding-left:1.2em}
.note blockquote{margin:0 0 .5em;padding-left:.7em;border-left:2px solid rgba(0,0,0,.15);color:#52525b}
.note hr{border:0;border-top:1px solid rgba(0,0,0,.12);margin:.6em 0}
.note code{font:12px var(--mono);background:rgba(0,0,0,.06);padding:1px 4px;border-radius:4px}
.note .todo span{margin-right:5px}
.note .todo[data-done="1"]{color:#7c7c86;text-decoration:line-through}
.note a{color:#b3400f}
.label{display:flex;align-items:center;font-weight:600;font-size:19px;letter-spacing:-.01em;
  overflow:hidden;color:var(--ink)}
.section{border:1px solid var(--line);border-radius:14px;background:rgba(127,127,140,.06)}
.section>span{position:absolute;top:-9px;left:14px;padding:0 6px;background:var(--bg);
  font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.link,.file,.audio,.board,.missing{
  display:flex;flex-direction:column;justify-content:center;gap:4px;padding:14px;
  border:1px solid var(--line);text-decoration:none;color:inherit}
.link:hover,.board:hover{border-color:var(--accent)}
.board{align-items:center;text-align:center;cursor:pointer}
.kindmark{font:11px var(--mono);letter-spacing:.08em;color:var(--muted)}
.cname{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.curl{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{position:absolute;top:8px;left:8px;width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 2px var(--surface)}
.pick{position:absolute;top:6px;right:8px;font-size:12px;line-height:1;padding:2px 5px;border-radius:5px;
  background:var(--surface);box-shadow:var(--sh);color:var(--muted)}
.c[data-pick="out"]{opacity:.45}
#wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
#wires path{fill:none;stroke:var(--muted);stroke-width:2;opacity:.7}
#big{position:fixed;inset:0;z-index:40;display:none;place-items:center;background:var(--scrim);cursor:zoom-out}
#big[data-on]{display:grid}
#big img{max-width:94vw;max-height:92vh;box-shadow:0 20px 60px rgba(0,0,0,.5);border-radius:4px}
#big figcaption{position:fixed;left:0;right:0;bottom:16px;text-align:center;color:#fff;font-size:13px;opacity:.85}
#empty{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);color:var(--muted);
  font-size:14px;display:none}
#made{position:fixed;left:14px;bottom:12px;font-size:11px;color:var(--muted);z-index:15}
`

const SCRIPT = `
const D = window.__BOARD__
const byId = Object.fromEntries(D.boards.map(b => [b.id, b]))
const world = document.getElementById('world')
const stage = document.getElementById('stage')
const wires = document.getElementById('wires')
const big = document.getElementById('big')
let trail = [D.root]
let view = { x: 0, y: 0, z: 1 }

const el = (tag, cls, into) => { const n = document.createElement(tag); if (cls) n.className = cls; if (into) into.appendChild(n); return n }
const here = () => byId[trail[trail.length - 1]] || D.boards[0]

/* A line between two cards, leaving each of them at a right angle from
   whichever side faces the other. Centre to centre is the obvious version and
   it is invisible: the whole line is behind the two cards it joins. */
function wirePath(a, b) {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const side = (from, to) => Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? (to.x >= from.x ? 'e' : 'w')
    : (to.y >= from.y ? 's' : 'n')
  const port = (box, s) =>
    s === 'n' ? { x: box.x + box.w / 2, y: box.y } :
    s === 's' ? { x: box.x + box.w / 2, y: box.y + box.h } :
    s === 'w' ? { x: box.x, y: box.y + box.h / 2 } :
                { x: box.x + box.w, y: box.y + box.h / 2 }
  const out = (s, d) =>
    s === 'n' ? { x: 0, y: -d } : s === 's' ? { x: 0, y: d } : s === 'w' ? { x: -d, y: 0 } : { x: d, y: 0 }
  const sa = side(ca, cb), sb = side(cb, ca)
  const p1 = port(a, sa), p2 = port(b, sb)
  const d = Math.max(36, Math.min(140, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.42))
  const o1 = out(sa, d), o2 = out(sb, d)
  return 'M ' + p1.x + ' ' + p1.y + ' C ' + (p1.x + o1.x) + ' ' + (p1.y + o1.y) + ', ' +
         (p2.x + o2.x) + ' ' + (p2.y + o2.y) + ', ' + p2.x + ' ' + p2.y
}

function apply() {
  world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.z + ')'
  stage.style.backgroundSize = (24 * view.z) + 'px ' + (24 * view.z) + 'px'
  stage.style.backgroundPosition = view.x + 'px ' + view.y + 'px'
}

/* Everything on the board, so a fit knows what it is fitting. */
function bounds(items) {
  const things = items.filter(i => i.kind !== 'edge')
  if (!things.length) return null
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const i of things) { a = Math.min(a, i.x); b = Math.min(b, i.y); c = Math.max(c, i.x + i.w); d = Math.max(d, i.y + i.h) }
  return { x: a, y: b, w: c - a, h: d - b }
}

function fit() {
  const r = bounds(here().items)
  const box = stage.getBoundingClientRect()
  if (!r) { view = { x: box.width / 2, y: box.height / 2, z: 1 }; return apply() }
  const pad = 60
  const z = Math.min(3, Math.max(0.05, Math.min((box.width - pad * 2) / r.w, (box.height - pad * 2) / r.h)))
  view = { z, x: box.width / 2 - (r.x + r.w / 2) * z, y: box.height / 2 - (r.y + r.h / 2) * z }
  apply()
}

function show(id, keepView) {
  const board = byId[id]
  if (!board) return
  world.textContent = ''
  wires.innerHTML = ''
  world.appendChild(wires)
  const at = {}
  for (const it of board.items) if (it.kind !== 'edge') at[it.id] = it

  for (const it of [...board.items].sort((p, q) => (p.kind === 'section' ? -1 : q.kind === 'section' ? 1 : (p.z || 0) - (q.z || 0)))) {
    if (it.kind === 'edge') {
      const a = at[it.from], b = at[it.to]
      if (!a || !b) continue
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', wirePath(a, b))
      wires.appendChild(p)
      continue
    }
    const n = el('div', 'c', world)
    n.style.cssText = 'left:' + it.x + 'px;top:' + it.y + 'px;width:' + it.w + 'px;height:' + it.h + 'px'
    if (it.pick) n.dataset.pick = it.pick

    if (it.img) {
      n.classList.add('thing')
      const img = el('img', null, n)
      img.src = it.img
      img.alt = it.alt || ''
      img.loading = 'lazy'
      img.addEventListener('click', (e) => { e.stopPropagation(); open(it) })
    } else if (it.kind === 'note') {
      n.classList.add('thing', 'note')
      if (it.color) n.style.background = it.color
      n.innerHTML = it.html || ''
    } else if (it.kind === 'label') {
      n.classList.add('label')
      n.textContent = it.text || ''
      if (it.color) n.style.color = it.color
    } else if (it.kind === 'section') {
      n.classList.add('section')
      el('span', null, n).textContent = it.text || 'Section'
    } else if (it.kind === 'board') {
      n.classList.add('thing', 'board')
      el('span', 'kindmark', n).textContent = 'BOARD'
      el('span', 'cname', n).textContent = it.name || 'Board'
      const inside = byId[it.board]
      el('span', 'curl', n).textContent = inside
        ? (inside.items.filter(x => x.kind !== 'edge').length + ' inside')
        : 'not in this file'
      if (inside) n.addEventListener('click', () => { trail.push(it.board); show(it.board) })
    } else if (it.kind === 'link') {
      const a = el('a', 'thing link', world)
      a.style.cssText = n.style.cssText
      a.href = /^https?:\\/\\//i.test(it.url || '') ? it.url : '#'
      a.target = '_blank'
      a.rel = 'noreferrer noopener'
      el('span', 'kindmark', a).textContent = 'LINK'
      el('span', 'cname', a).textContent = it.text || it.name || it.url || 'Link'
      el('span', 'curl', a).textContent = it.url || ''
      world.removeChild(n)
      continue
    } else {
      n.classList.add('thing', it.missing ? 'missing' : 'file')
      el('span', 'kindmark', n).textContent = (it.kind || 'card').toUpperCase()
      el('span', 'cname', n).textContent = it.name || it.text || it.kind
      if (it.missing) el('span', 'curl', n).textContent = 'not in this file'
    }

    if (it.tag) {
      const t = el('span', 'tag', n)
      t.style.background = { red: '#E5484D', amber: '#EFA31D', green: '#46A758', blue: '#3E63DD', violet: '#8E4EC6' }[it.tag] || it.tag
    }
    if (it.pick) el('span', 'pick', n).textContent = it.pick === 'in' ? '✓' : '✕'
  }
  /* A board with nothing on it should say so rather than look like a page
     that failed to load. */
  document.getElementById('empty').style.display = board.items.length ? 'none' : 'block'
  crumbs()
  if (!keepView) fit()
}

/* Where you are inside the board, and nothing at all while you are at the top
   of it — one crumb saying the same thing as the title above it is not a
   trail, it is the title twice. */
function crumbs() {
  const bar = document.getElementById('crumbs')
  bar.textContent = ''
  if (trail.length < 2) return
  trail.forEach((id, i) => {
    if (i) el('i', null, bar).textContent = '/'
    const b = el('button', null, bar)
    b.textContent = (byId[id] || {}).name || 'Board'
    b.addEventListener('click', () => { trail = trail.slice(0, i + 1); show(id) })
  })
}

function open(it) {
  big.querySelector('img').src = it.img
  big.querySelector('figcaption').textContent = it.name || ''
  big.dataset.on = '1'
}
big.addEventListener('click', () => { delete big.dataset.on })

/* Pan and zoom. Nothing here is the app's own viewport code — a page that
   only ever looks at a board needs a tenth of it.
 *
 * The pointer is captured only once the hand has actually moved. Capturing on
 * the way down is the obvious version and it is wrong: a captured pointer
 * retargets everything that follows, so the click never reaches the card
 * underneath and a board inside the page could not be opened at all. Past a
 * few pixels it is a drag and swallowing the click is right; below that it is
 * a press, and the card should have it. */
let drag = null
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, live: false, id: e.pointerId }
})
stage.addEventListener('pointermove', (e) => {
  if (!drag) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.live) {
    if (Math.abs(dx) + Math.abs(dy) < 5) return
    drag.live = true
    stage.dataset.drag = '1'
    try { stage.setPointerCapture(drag.id) } catch (err) { /* nothing to hold */ }
  }
  view.x = drag.vx + dx
  view.y = drag.vy + dy
  apply()
})
const stop = () => { drag = null; delete stage.dataset.drag }
stage.addEventListener('pointerup', stop)
stage.addEventListener('pointercancel', stop)
stage.addEventListener('wheel', (e) => {
  e.preventDefault()
  const box = stage.getBoundingClientRect()
  const px = e.clientX - box.left, py = e.clientY - box.top
  if (e.ctrlKey || e.metaKey) {
    const z = Math.min(4, Math.max(0.05, view.z * Math.exp(-e.deltaY / 260)))
    view = { z, x: px - ((px - view.x) / view.z) * z, y: py - ((py - view.y) / view.z) * z }
  } else {
    view.x -= e.deltaX
    view.y -= e.deltaY
  }
  apply()
}, { passive: false })

const zoomBy = (f) => {
  const box = stage.getBoundingClientRect()
  const px = box.width / 2, py = box.height / 2
  const z = Math.min(4, Math.max(0.05, view.z * f))
  view = { z, x: px - ((px - view.x) / view.z) * z, y: py - ((py - view.y) / view.z) * z }
  apply()
}
document.getElementById('in').addEventListener('click', () => zoomBy(1.25))
document.getElementById('out').addEventListener('click', () => zoomBy(0.8))
document.getElementById('all').addEventListener('click', fit)

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (big.dataset.on) delete big.dataset.on; else if (trail.length > 1) { trail.pop(); show(trail[trail.length - 1]) } }
  if (e.key === '1' || e.key === '0') fit()
})
window.addEventListener('resize', () => { if (view.z) apply() })

show(D.root)
`

export function pageHtml(data: PageData): string {
  const root = data.boards.find((b) => b.id === data.root)
  const title = escText(root?.name || 'Board')
  const made = new Date(data.made).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<header id="top">
  <h1>${title}</h1>
  <nav id="crumbs"></nav>
  <div id="tools">
    <button id="out" title="Zoom out">−</button>
    <button id="in" title="Zoom in">+</button>
    <button id="all" title="Fit the board on screen">Fit</button>
  </div>
</header>
<div id="stage">
  <div id="world"><svg id="wires"></svg></div>
  <div id="empty">Nothing on this board</div>
</div>
<figure id="big"><img alt=""><figcaption></figcaption></figure>
<div id="made">Exported ${escText(made)}</div>
<script>window.__BOARD__=${safeJson(data)}</script>
<script>${SCRIPT}</script>
</body>
</html>`
}
