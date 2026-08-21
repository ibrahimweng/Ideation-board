# Why the old version was slow, and what changed

The first version of this board became very slow once you put effects on more
than a handful of images. This document explains the causes we found, the
changes we made and what we measured.

## What was slow

We found six separate causes. Each one on its own would have been noticeable.
Together they made a board with twenty effected images hard to use.

### 1. Every card copied its pixels back from the graphics card

The old engine drew each card into one shared WebGL canvas. It then copied the
result into that card's own 2D canvas with `drawImage`.

That copy is the expensive part. Reading pixels back out of a WebGL canvas
forces the browser to wait for the graphics card to finish everything it had
queued. With twenty cards on screen, the browser did that twenty times in a
row.

The engine also asked for `preserveDrawingBuffer`, which stops the driver from
throwing the buffer away after each frame and costs more memory and time.

### 2. Only one picture could be on the graphics card at a time

The old engine kept a single cached texture and remembered which picture was in
it. Drawing a second picture replaced the first one.

On a board with twenty different pictures, this meant every card uploaded its
full picture to the graphics card again on every pass. A single large photo can
be tens of megabytes once decoded, so this was the largest cost of all.

### 3. The drawing buffer only ever grew

The shared canvas grew to fit the largest card that had ever been drawn, and it
never shrank again. Small cards were then drawn into one corner of a very large
buffer, and the blur steps were sized to that same large buffer.

### 4. Every frame looked at every item

The old code ran a loop on every animation frame. That loop walked the whole
list of items, and for each one it built a text signature with
`JSON.stringify` to decide whether anything had changed.

This ran whether or not anything had actually changed. On a board with a few
hundred items, that is a few hundred strings created and thrown away sixty
times a second.

### 5. The effect previews were rebuilt with a slow image encoder

The panel of effect previews rendered five effects per frame. For each one it
called `toDataURL('image/jpeg')`, which compresses the image on the main thread
and blocks everything else. It then called `setState` on every frame while the
panel was open.

### 6. One React component held the whole board

All the items lived in the state of a single large component. Moving one card
re-rendered every card and every panel.

## What we changed

### The graphics work moved to a worker

There is now one WebGL2 context, and it lives in a worker on an OffscreenCanvas.
The main thread never touches the graphics card. Shader compilation, texture
upload and drawing cannot block scrolling, dragging or React.

### Finished frames are handed over without being copied

The worker calls `transferToImageBitmap()`, which hands over the drawing buffer
itself. Each card's canvas uses a `bitmaprenderer` context and takes that
bitmap with `transferFromImageBitmap`. No pixels are read back and none are
copied. This replaces the `drawImage` copy described above.

### Pictures stay on the graphics card

Textures are now held in a cache with a memory limit of about 220MB. A picture
is uploaded once and stays there. Changing an effect, or dragging a slider, does
not upload anything again.

When a board holds more pictures than the limit allows, the cache has to drop
older ones. We found in testing that this was worse than the old behaviour,
because creating and freeing texture objects is itself expensive, and a board
that cycles through more pictures than fit will miss the cache every time. Freed
texture objects are now kept and reused, so that worst case costs only the
upload, which is what the old version paid for every picture anyway.

### The drawing buffer is sized to the job

The buffer is now set to the size actually being drawn, and it is allowed to
shrink again.

### Work is pushed, not polled

Nothing walks the item list every frame. A card asks for a render only when its
effect, its settings, its picture or its size have changed. Requests are then
ordered by how close the card is to the middle of the screen, so what you are
looking at is drawn first. Only a few requests are in flight at once, so
dragging a slider replaces stale work instead of queuing behind it.

### Two levels of quality

While you are panning, zooming or dragging a slider, the engine draws a small
version of each card so that something correct appears immediately. When you
stop, it draws the visible cards again at full size. The board keeps its frame
rate under any load, and the picture sharpens a moment later.

### Only visible cards exist

Cards are added to the page only when they are near the visible area. Panning
and zooming are applied straight to one element's transform and never go through
React, so a pan does not re-render any card. React is told about the change only
when a card enters or leaves the visible area.

### Each card listens for its own changes

The board contents are held outside React. Each card subscribes to its own item,
so moving one card re-renders one card.

### The effect previews use the same path as the cards

Each preview is a small render through the same worker, using the same picture
already on the graphics card. Nothing is compressed and nothing calls `setState`
on a loop.

### Pictures are decoded at a sensible size

Pictures are decoded through `createImageBitmap`, which runs off the main
thread, and they are capped at 1600 pixels on the long edge. Nothing on the
board is ever drawn larger than 1536 pixels, so a larger decode would only cost
memory and upload time. A 6000 pixel photo decodes to about 96MB of raw pixels.
The cap brings that down to about 10MB.

### Video effects follow playback without slowing it down

An effected video card is drawn from the video as it plays. Frames are taken
with `requestVideoFrameCallback`, which fires once per decoded frame, so no
frame is captured twice and none is missed. Each frame is scaled down as it is
captured, to 768 pixels on the long edge while playing, so what crosses to the
worker is already the size the render needs.

Only one frame is in flight at a time. A frame is captured only once the
previous one has come back. A queued frame would be out of date by the time it
was drawn, so skipping is better than queuing.

We measured playback with and without an effect. The video advanced at the same
rate in both cases, so capturing frames costs the video nothing.

### Tone adjustments do not redraw anything

Exposure, contrast, saturation, warmth, blur and grain are applied as CSS
filters, and framing is applied as a CSS transform. The browser handles both
without redrawing the effect. Changing exposure therefore costs no graphics
work at all.

## What we measured

### The drawing method, old against new

`test/bench.html` runs both drawing methods side by side in the same page, with
the same shader and the same pictures. Both run on the main thread, so the
comparison is about the drawing method alone and not about the worker.

Two cases are measured:

- Cold. Every card draws a different picture that is not yet on the graphics
  card.
- Warm. The same cards are drawn again, which is what happens when you change an
  effect or drag a slider.

With 40 cards, drawn at 336 by 224 from 1400 pixel sources:

| Case | Old method | New method | Change |
| --- | --- | --- | --- |
| Warm redraw of 40 cards | 362ms | 68ms | 5.4 times faster |
| Warm redraw of 80 cards | 724ms | 264ms | 2.7 times faster |

The warm case is the one that made the old version feel broken. Redrawing 80
cards took 724ms, which is under two frames per second.

On the cold pass the new method is slower in this test. Two things explain it.
The new method allocates a texture for every picture rather than reusing one,
which is the cost of keeping them all available afterwards. The other reason is
that these tests run on SwiftShader, which draws using the processor rather than
a graphics card.

That second point also means the test understates the real gain. The main fault
in the old method is reading pixels back from the graphics card. When the
"graphics card" is really the processor, as it is under SwiftShader, reading
back costs almost nothing. On a real graphics card it stalls the pipeline every
time. We would expect the gap on real hardware to be wider than these numbers
show, on both the cold pass and the warm pass.

You can run it yourself:

```bash
N=40 SRC=1400 npm run bench
```

### Whether the board stays responsive

`test/load.mjs` fills a board with images, applies one effect to all of them and
watches for long tasks. A long task is any piece of work that blocks the main
thread for more than 50ms, which is the point at which a person notices a stall.

With 60 images, each 1200 by 800:

| Measurement | Result |
| --- | --- |
| Cards added to the page | 6 out of 60 |
| Long tasks while applying the effect to all 60 | 0 |
| Long tasks while panning | 0 |
| Errors on the page | none |

The board never blocked the main thread, either while the graphics card worked
through 60 images or while panning across them. Only 6 cards were added to the
page, because only 6 were visible.

You can run it yourself:

```bash
npm run dev &
npm run test:load -- http://localhost:5173 60
```

## Limits we know about

- The texture cache holds about 220MB. A board where more than roughly 40 large
  pictures are visible at the same time will start uploading again. The reuse of
  texture objects keeps that case reasonable, but it is not free. The number of
  pictures on the board does not matter, only how many are visible at once.
- Effects on a playing video are drawn one frame at a time, and a frame is
  captured only after the previous one has been drawn. On a slow machine the
  card therefore shows fewer frames per second than the video is playing at.
  It never falls behind, because a frame that is not captured is skipped rather
  than queued.
- The engine needs WebGL2 and OffscreenCanvas. Where a worker cannot be started,
  the same engine runs on the main thread under the same time budget. Where
  OffscreenCanvas is missing entirely, pictures and tone adjustments still work
  and the board reports that effects are unavailable.
