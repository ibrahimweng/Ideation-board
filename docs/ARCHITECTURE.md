# How the code is put together

The board is a React app built with Vite. There is no server. Everything runs
in the browser.

There are four parts. The engine draws effects. The board draws cards and
handles pointer input. The state holds the board contents. The store saves
things.

## The engine

The engine is in `src/engine`. It is the only part that touches the graphics
card.

| File | What it does |
| --- | --- |
| `shaders.ts` | The vertex shader, the blur shader and the shared preamble |
| `effects.ts` | The 69 effects, their settings and their shader code |
| `isf.ts` | Translating an ISF shader into the shape `effects.ts` uses |
| `isfEffects.ts` | The handful written as ISF, so the translator is exercised by the running board rather than only by its tests |
| `glyphs.ts` | The characters the ASCII effect spends, as shapes rather than as text in whatever font had loaded |
| `types.ts` | Shared types, the blend modes, the quality levels and the size limits |
| `gl.ts` | The renderer, which owns the WebGL2 context — and notices when it is taken away |
| `worker.ts` | The worker that owns the renderer |
| `protocol.ts` | The messages between the page and the worker |
| `scheduler.ts` | The queue of pending work |
| `client.ts` | What the rest of the app talks to |

### How one render happens

1. A card decides that its effect, its settings, its picture or its size has
   changed. It calls `request` on the engine.
2. The engine puts a job in the queue. There is one pending job per card, so a
   newer request replaces an older one rather than queuing behind it.
3. On each animation frame, the engine takes the best job it can and sends it to
   the worker. The best job is the one closest to the middle of the screen.
   Small draft renders always come before full size ones.
4. The worker draws the effect and calls `transferToImageBitmap()`.
5. The page receives the bitmap and gives it to the card's canvas with
   `transferFromImageBitmap`. No pixels are copied.

If a newer request has been made for the same card in the meantime, the older
result is thrown away rather than shown.

### Video

An effected video card has a canvas on top and the video element underneath at
zero opacity. The element is what decodes and plays. It is kept laid out rather
than hidden, because a browser is allowed to stop decoding a video it is not
painting.

`FxVideoCanvas` takes frames off that element. It uses
`requestVideoFrameCallback` where the browser has it, and animation frames
where it does not. It holds off capturing the next frame until the last one has
come back, and it gives up waiting after 500ms so a dropped frame cannot stall
playback for good.

A paused card is drawn once rather than in a loop, and again after each seek.
Whether a video has a frame ready is read from the element itself rather than
waited on as an event, because a video with a local file can be ready before
React has attached any listener, and an event that has already fired will not
fire again.

The browser's own controls are unreachable behind the canvas, so `VideoCard`
draws its own play button, scrub bar and mute button. They sit outside the
element that carries the tone adjustments. A CSS filter applies to everything
inside it and a child cannot opt out, so controls placed inside would be tinted
along with the picture.

### Quality levels

There are two. `Tier.Proxy` is a small draft, capped at 384 pixels.
`Tier.Full` is capped at 1536 pixels.

The engine tracks whether you are interacting. While you are panning, zooming or
dragging a slider, it serves only draft renders. About 180ms after you stop, it
queues full size renders for the visible cards.

Sizes are rounded to multiples of 128 pixels. Without that rounding, every small
change in zoom would count as a new size and throw away every cached render.

### The texture cache

Pictures are held on the graphics card in a cache limited to about 220MB, with
the least recently used one dropped first. `docs/PERFORMANCE.md` explains why
freed texture objects are kept and reused rather than deleted.

Video frames are not cached. They use one texture that is overwritten each
time, so playback does not fill the cache with frames that will never be needed
again.

A video also has a still of its first frame, saved when the file is dropped.
That still is kept under its own key rather than the video's. Keyed to the
video, the loader would be handed the video file after a reload and asked to
decode it as an image, which fails.

### When there is no worker

`client.ts` starts a worker where it can. Where it cannot, it builds the same
renderer on the main thread and runs it under the same time budget, one job at a
time. The board is slower but behaves the same.

Where OffscreenCanvas is missing entirely, the engine reports that it is
unavailable. Cards then show the plain picture, and tone adjustments still work
because those are CSS filters.

## The board

The board is in `src/board`.

| File | What it does |
| --- | --- |
| `Board.tsx` | The surface, pan and zoom, selection and file drops |
| `Card.tsx` | One card of any kind |
| `FxCanvas.tsx` | The canvases that receive finished renders |
| `VideoCard.tsx` | A video card, its hidden video element and its controls |
| `sources.ts` | Tracks which pictures are on the graphics card |
| `viewport.ts` | Pan and zoom arithmetic, and deciding what is visible |
| `adjust.ts` | Builds the CSS filter and transform for tone and framing |

Two rules keep the board fast whatever it holds.

The first rule is that pan and zoom never go through React. The gesture writes a
transform straight onto the surface element. A pan is therefore one change to
one element.

The second rule is that only cards near the visible area are added to the page.
A loop works out which cards those are on each frame, but it calls `setState`
only when the set has actually changed. Panning across empty space costs
nothing.

## Sections

An item records which section it is in, in a `parent` field holding the
section's id. Membership is worked out when a drag finishes, by asking which
section the item's middle landed in, and is then stored. It is not recomputed
from the geometry afterwards.

That matters for two cases. An item can be resized, or a section shrunk, so the
item pokes out past the edge, and it still belongs. A section can also be moved
under an item without swallowing it.

When a drag starts, `store.dragSet` expands the selection to include the
contents of any section being dragged. Items that came along that way are
marked as carried and are not re-tested against the sections when the drag
ends, because they are still in the section they started in, wherever it went.

Deleting a section deletes its contents, and duplicating one copies its
contents and points the copies at the copy.

Sections are drawn behind the items they hold, so clicking one does not raise
it above its own contents. One section cannot go inside another.

## The state

The state is in `src/state`.

`store.ts` holds the board contents outside React. It has separate lists of
listeners for each item, for the order of items, for the selection and for the
viewport. Each card subscribes only to its own item through
`useSyncExternalStore`, so moving one card re-renders one card.

Every change replaces the item object rather than editing it, so a listener can
compare by reference.

Undo and redo keep up to 60 steps per board, and a step is what changed rather
than a copy of the board.

A step holds the previous value of each item it touched, with a null standing
for an item that did not exist yet, and a copy of the order when it changed
that. Putting a step into effect hands back the step that would put it back, so
undo and redo are one operation run in opposite directions.

A step is opened before a command runs and filled in as the command writes.
That works because every write replaces the item object rather than editing it,
so the value read the first time a step touches an item is the value the step
opened on. It also means the recording lives in two methods rather than in
twenty: nothing may reach `this.items` except `put` and `drop`, which record
first. A write that reaches around them would leave that piece behind on undo,
which is what `test/unit/history.test.ts` exists to catch — it performs a few
dozen arbitrary commands, walks all the way back and all the way forward, and
insists every state matches exactly.

A step is kept only once something has really been recorded into it, so a
command that turns out to change nothing does not cost an undo press.

This used to be a snapshot of the whole board per step. That was correct by
construction, and it meant a step cost what the board weighed rather than what
the change weighed. On five thousand items one step was about 1.8MB, so the
budget shared between all boards held about six of them rather than sixty: undo
got quietly shorter the more a board had on it, with nothing saying so. It also
put a serialisation of every card on the board between the pointer going down
and the first frame of the drag.

A drag, a resize, a keyboard nudge and a slider sweep each call `beginGesture`
once and then write with recording turned off. The step stays open until the
next command opens another, so those writes still record and the whole gesture
is one step. `beginGesture` takes an optional window in milliseconds that merges
a rapid series into one step, which is what stops holding an arrow key from
filling the history.

Before any of this existed, those gestures wrote with recording off and nothing
opened a step at the start, so they left no undo entry at all. One undo after a
drag jumped back past it to whatever was recorded before, which could remove a
card the drag had nothing to do with.

`ingest.ts` turns dropped files into cards. It hands back one card at a time as
each file becomes ready, so a large drop fills in as it goes. For a picture it
decodes the file once and passes that decode straight to the graphics card,
rather than throwing it away and decoding again when the card appears.

`kinds.ts` is the traits table: what each kind of card can do, written down
once. `Item` is one wide type with a kind on it and the code used to ask which
kind in a hundred places, some of them the same question written differently.
The traits are about capability rather than category — not "is it a picture"
but "does it have pixels of its own that can be read" — because that is what
the caller actually wants to know before it tries.

`ids.ts` is the other list of that shape: which fields on a card hold another
card's id. Three places copy cards and have to repoint them — importing a
board, duplicating a selection, cloning a board — and each used to carry its
own list of fields. A field added to one and not the others is a wire that
vanishes when you duplicate the board it is on, which is the bug that made this
file.

`roots.ts` decides which boards are projects: the ones no board card anywhere
points at. Worked out rather than written down, so there is no second list to
disagree with the boards themselves, and a board whose card is deleted turns up
in the tab row rather than becoming a record nothing can reach. `undelete.ts`
then holds a closed project for ten seconds so it can be put back under its own
ids — and holds off the sweep while it does, because those boards' pictures are
now referenced by nothing and collecting them would mean undo brought back a
project of empty frames.

`feeds.ts` is the wire read as an input. When a card is running an effect that
wants a second picture, the card at the other end of the wire is that picture:
this is what keeps the engine told which texture that is, and what redraws the
near card when the far one changes.

`varyGrid.ts` is the twelve-card grid, once, for every medium that has one —
the places under the card, which of them a kept variant holds, filling the
holes the unkept ones leave, and the whole exchange being one step of undo. A
medium supplies only its dice: `variations.ts` for pictures, `soundVary.ts`,
`sketchVary.ts` and `modelVary.ts` for the others. `varying.ts` decides which
dice a selection gets, most particular kind first, since a model and a sketch
both have pixels and asking about pixels first would swallow them.

`sounds.ts`, `staging.ts`, `sketches.ts` and `depth.ts` are the four working
transactions of the media below. `depthModel.ts` is the other way of making a
depth map: a real monocular depth model, fetched once and run in this browser,
with the analytic map standing in until it arrives.

`skins.ts` is what a material is wearing and where — five slots in which a
photograph means something, read off the glTF rather than guessed at.

`exportPage.ts` and `pageHtml.ts` write the board as one HTML file somebody
without this app can open: every picture inside it as data, every board in the
tree with it, and the effects baked in, because the person opening it has no
engine of ours to run them through.

## The store

The store is in `src/store`.

`idb.ts` saves boards and media to IndexedDB. Boards and media are kept in
separate object stores, so reading a board does not read every picture. Where
IndexedDB cannot be opened, which happens in some private windows and embedded
browsers, it falls back to memory so the board still works for that session.

`fs.ts` holds the File System Access code for keeping a board as a real folder
on disk, with the media written next to a `board.json`.

`media.ts` decodes pictures, pulls a still frame out of a video and manages
object URLs.

`audio.ts` reads a sound: the peaks a waveform is drawn from, how long it runs,
and the cover out of an ID3 tag where an mp3 has one. Peaks are kept on the
card as a couple of hundred whole numbers rather than as a picture of a
waveform, which is a few hundred bytes, draws crisply at any size, and costs
nothing to redraw while the track plays.

`design.ts` gets the picture out of a Photoshop, Sketch or Illustrator file.
All three carry one and none of them needs a library for it: a `.sketch` is a
zip with `previews/preview.png` inside and this app already has an unzip, a
`.psd` keeps a flattened copy of the whole document at the end of the file, and
a `.ai` is a PDF, so it goes through the reader that already exists and gets its
artboards as pages for nothing. Whether a `.ai` really is one is settled by
looking at the first five bytes, because an older Illustrator file is
PostScript and the name cannot tell you.

`pdf.ts` draws a page of a document. pdf.js is loaded through a dynamic import
the first time a PDF is dropped, so a board that never holds one never fetches
it, and the legacy build is the one asked for: the modern one calls a Map
method new enough that a browser from last year does not have it, and the
failure arrives as a document that will not open for no stated reason.

`model.ts` renders a `.glb`, with three.js behind the same kind of dynamic
import for the same reason. What comes back is a picture of the model and what
the file says it is made of — the materials, which texture slots each one
fills, which UV sets they read — walked out of the file rather than guessed at,
because a model that was unwrapped twice is worth knowing about before handing
it a new picture.

`sound.ts` renders a chain of effects into a buffer. Some of the chain are node
graphs run through an OfflineAudioContext and some are arithmetic on the
samples — reverse, trim, bit crush — and each step hands on a buffer, so the
two kinds compose without knowing about each other.

`sketch.ts` runs a sketch in a worker made for the run and thrown away after
it, with four seconds to finish and everything that reaches out of the browser
taken off the global first.

`reclaim.ts` is the sweep: every board is read, every media key still pointed at
is collected, and what nothing points at goes. `kept.ts` is the short list of
files the app itself owns rather than a card — the depth model's weights — which
nothing will ever point at and which the sweep therefore has to be told about.

`tabs.ts` tells the other tabs of this browser when a board is written.
`mirror.ts` keeps a copy of a board in a folder on disk, `space.ts` watches how
much room is left, `zip.ts` reads and writes the `.board.zip`, and `anim.ts`
keeps a GIF moving.

## Documents and design files

A PDF card is a picture of a page with the file kept beside it, which is the
same split a video card has: `media` is the document, `poster` is what you
look at. That is what lets everything downstream work with no special case —
the page goes to the graphics card, wears the effects, exports, and gives up
its colours to the palette — because as far as all of that is concerned it is
an image.

A design card is the same shape with one picture instead of a run of pages, so
it shares the card, the traits row pattern and every path a document takes.
What it does not share is the reading: a Photoshop document is parsed here
rather than by a library, which is worth it because the flattened copy inside
is the full size picture rather than the 256 pixel thumbnail beside it.

Three places used to ask "is this a video, and therefore is its picture under
poster?" with the same ternary written out by hand. `pixelKey` in `kinds.ts`
is that question asked once, and adding two more kinds whose file is not a
picture meant changing one line rather than finding all three.

Turning a page renders the new one, writes it under a fresh key and points the
card at it, in one step of undo. The old page is left unreferenced, which is
what the sweep in `store/reclaim.ts` collects, so paging through a long
document does not fill the browser with pictures of pages nobody is looking
at. The card keeps its size while the page changes, because the pages of a
document are the same shape as each other and a card that resized itself on
every turn would walk around the board.

## Media that is not a picture

A model, a sketch, a sound and a depth map are all shaped like the document
card above, and that is the whole reason they cost so little: the card keeps
what arrived, and beside it what the app made from it. For the three that show
a picture, everything downstream then works with no special case at all — the
effects, the export, the palette, being read through by another card, twelve
versions of them. A sound is the exception only in what it shows, which is a
waveform drawn from its peaks; it is written this way for the same reason.

Where each keeps its own material differs, and each difference is deliberate:

- A **model** keeps the `.glb` under `media` and the rendered view under
  `poster`, exactly as a PDF keeps its document and its page.
- A **sketch** has no file at all. The code is on the card, which is the thing
  you edit, and what it drew is under `poster`.
- A **sound** keeps what was dropped under `media` and the rendered chain under
  `heard`, so taking the chain off is not an undo — it is the card pointing back
  at the file that was always there.
- A **depth map** is an ordinary image card with `depthOf` naming the picture it
  was made from, which is what lets it be corrected, wired, varied and exported
  like any other picture.

The transaction is the same one every time: render, write the result under a
fresh key, point the card at it, in one step of undo. The old picture is left
unreferenced, which is what the sweep collects, so turning a model or throwing a
sketch again does not fill the browser with pictures nobody is looking at.

Turning a model adds one rule of its own. A drag asks for a new angle every few
milliseconds and a render takes longer than that, so a queue would fall behind
the hand and go on turning after it stopped. The last angle asked for is kept
and everything before it is dropped, which lands the picture where the hand
actually is.

## Adding an effect

Add one entry to the `EFFECTS` array in `src/engine/effects.ts`. It needs:

- `id`, a short name used as a key.
- `name`, what people see.
- `group`, which heading it appears under in the panel.
- `controls`, built with `N` for a number, `C` for a colour and `E` for a choice
  from a list. Numbers must use the keys `p0` to `p5` and colours `c0` to `c2`,
  because those are the uniform names the shader preamble declares.
- `frag`, a GLSL function `vec4 fx(vec2 uv)`.
- `blurKey`, only if one of the settings should feed the blur that runs before
  the effect.

The panel builds its own controls from that entry. Nothing else needs changing.

Inside `frag` you can use these, which the preamble in `shaders.ts` provides:

- `T(uv)` reads the picture.
- `B(uv)` reads the blurred picture.
- `S(uv)` reads the second picture — whatever card is wired into this one,
  cropped to fill the same way the first one is, so the two line up on the card
  rather than on their own aspect ratios. With nothing wired in it returns the
  card's own pixels, so an effect that wants a partner still does something
  sensible on its own rather than being an error state; `has2()` is there for
  the few that need to know which they got.
- `mirror(uv)` folds a coordinate back on itself instead of clamping it, which
  is what anything that bends coordinates a long way should read the edge
  through.
- `luma(rgb)` gives brightness.
- `hash(p)` and `vnoise(p)` give noise.
- `rot(v, a)` rotates.
- `unit()` scales a size with the height of the render, so an effect looks the
  same at any resolution.
- `pal(id, t)` gives a colour from one of the eight palettes.
- `bayer8(p)` gives a dither threshold.
