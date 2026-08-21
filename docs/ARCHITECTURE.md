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
| `effects.ts` | The 24 effects, their settings and their shader code |
| `types.ts` | Shared types, the quality levels and the size limits |
| `gl.ts` | The renderer, which owns the WebGL2 context |
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

## The state

The state is in `src/state`.

`store.ts` holds the board contents outside React. It has separate lists of
listeners for each item, for the order of items, for the selection and for the
viewport. Each card subscribes only to its own item through
`useSyncExternalStore`, so moving one card re-renders one card.

Every change replaces the item object rather than editing it, so a listener can
compare by reference.

Undo and redo keep up to 60 snapshots of the item list. A drag records one
snapshot at the start and then writes positions with recording turned off, so a
drag is one step of undo and not hundreds.

`ingest.ts` turns dropped files into cards. It hands back one card at a time as
each file becomes ready, so a large drop fills in as it goes. For a picture it
decodes the file once and passes that decode straight to the graphics card,
rather than throwing it away and decoding again when the card appears.

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
- `luma(rgb)` gives brightness.
- `hash(p)` and `vnoise(p)` give noise.
- `rot(v, a)` rotates.
- `unit()` scales a size with the height of the render, so an effect looks the
  same at any resolution.
- `pal(id, t)` gives a colour from one of the eight palettes.
- `bayer8(p)` gives a dither threshold.
