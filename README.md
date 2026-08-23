# Ideation Board

A board where you drop ideas and work on them. You can drop images, video,
audio, notes, links and other files. You can apply visual effects to the images
and video, move things around, group them into sections and label them, draw
connections between them, keep checklists in your notes, put a board inside a
board when one canvas is no longer enough, and take any of it out as a
full-resolution picture.

Everything is stored in your own browser. There is no server and no account.

## Running it

You need Node 18 or newer.

```bash
npm install
npm run dev
```

Then open the address that Vite prints, which is usually
`http://localhost:5173`.

To build a copy you can host:

```bash
npm run build
```

The build is written to `dist`.

## Deploying to Vercel

The repository already has a `vercel.json`, so there is nothing to configure.
It sets the framework to Vite, the build command to `npm run build`, the output
folder to `dist`, a catch all rewrite to `index.html`, and long cache headers
for the hashed files under `/assets`.

The simplest way is to let Vercel build from GitHub:

1. Go to https://vercel.com/new.
2. Import `ibrahimweng/Ideation-board`.
3. Accept the settings Vercel reads from `vercel.json` and press Deploy.

Vercel then builds every push. The default branch becomes the production site
and other branches get their own preview links.

If you would rather deploy from your own machine, install the Vercel command
line tool and run it from a clone of the repository:

```bash
npm install -g vercel
vercel login
vercel --prod
```

Nothing in the app runs on a server. The build is a set of static files, and
all the work happens in the browser, so there are no environment variables or
secrets to set.

## The top bar, and the command list

The top bar carries icons rather than words. Every one of them says what it is
and which key runs it when you hover it, and every one of them is also in the
command list, which is the real answer to "where is that thing".

Press Cmd or Ctrl with K, or the ⌘ button in the bar, and type. It searches
everything the board can do, including the things there was never room for in
the bar: tidy up, line a selection up, space it out, export the selected
pictures, open the saved looks, switch the theme. The letters only have to be
in order, so "tdy" finds "Tidy up the whole board", and every entry shows the
shortcut that runs it, so using the list is how you learn to stop using it.

## Light and dark

The button beside the zoom control cycles between following your system,
light, and dark. A dot on it means it is following the system.

This is not decoration. What surrounds a photograph changes what you see in
it — the same picture reads warmer on a pale ground and flatter on a dark one
— and a board is where photographs are judged, so it is worth being able to
say which surround you are judging against.

## Using the board

You add things in several ways:

- Drag files from your computer onto the board.
- Press the picture button in the top bar.
- Paste an image, a block of text or a link.
- Paste or drop the address of a video file and it becomes a video card you can
  play and put effects on. A YouTube or Vimeo link becomes an embedded player.
- Press the nested-frame button for a board inside this one, for work that has
  outgrown a corner of the canvas.

Once something is on the board:

- Drag a card to move it. It lines itself up with the cards around it and
  draws a guide where it has, or hold Shift to snap to a grid instead.
- Drag a corner handle to resize it.
- Drag on empty space to select several cards at once.
- Hover a card and drag one of the four dots on its sides onto another card to
  connect them.
- Select several and use the right click menu to line them up, space them
  evenly, or tidy them onto a grid.
- Hold Alt and drag, or drag with the middle mouse button, to pan the board.
- Hold Ctrl or Cmd and scroll to zoom.
- Double click a note, a label or a section to edit its text.

## Sections

A section is a labelled area you can group work into. It behaves the way a
section does in Figma.

- Drop an item so its middle is inside a section and it joins that section.
  The section lights up while you hold an item over it, so you can see which
  one will take it.
- Move a section by its title bar and everything inside moves with it.
- Drag an item out and it leaves the section.
- Resizing a section never changes what is inside it. Only dragging does. An
  item can therefore stick out past the edge and still belong to the section.
- Duplicating a section copies its contents too, and the copies belong to the
  copy rather than the original.
- Deleting a section deletes what is inside it. One undo brings all of it back.

Sections sit behind the items they hold, and one section cannot go inside
another.

## Searching

Type in the search box to narrow the board. Cards that do not match fade out
and stop taking clicks, but stay where they are, because where you put
something is part of how you recognise it later.

Search looks at the card name, its text, a link's address, its tag and the
kind of card it is. Every word has to match somewhere, in any order, so
"blue note" finds a note tagged blue.

Next to the box is a tag filter. Pick a colour to keep only cards carrying
that tag, or Untagged to find the ones with none. Each entry shows how many
cards it covers. The two controls work together, so a card has to satisfy the
text and the tag to stay lit.

Press Enter to move the board to the next result and select it, Shift and
Enter for the previous one, and Escape to clear. Press / or Cmd and F to put
the cursor in the box.

Each toolbar button shows its shortcut, and hovering one names it in full.
The single key shortcuts only fire when no modifier is held and no text field
has focus, so they never get in the way of typing.

Right click a card for a menu with edit or rename, duplicate, bring to front,
send to back, remove from section, tagging and delete. Right clicking a card
that is part of a selection acts on the whole selection.

Right click bare board for a menu that adds a note, label, section, link or
files at the point you clicked, and that can paste or select everything.

Keyboard shortcuts:

| Keys | What it does |
| --- | --- |
| F | Add files |
| N | New note |
| L | New label |
| S | New section |
| B | New board |
| K | New link |
| E | Show or hide the effects panel |
| / | Search |
| Cmd or Ctrl and S | Export this board and everything in it |
| Cmd or Ctrl and O | Import a board file |
| Cmd or Ctrl and E | Export the selected pictures as PNG |
| Cmd or Ctrl and Z | Undo |
| Shift and Cmd or Ctrl and Z | Redo |
| Cmd or Ctrl and A | Select everything |
| Cmd or Ctrl and D | Duplicate the selection |
| Delete or Backspace | Remove the selection |
| Arrow keys | Nudge the selection, and hold Shift to nudge further |
| Escape | Clear the selection |

## Effects

Select an image or a video and open the Effects panel. There are 31 effects,
grouped by the kind of look they give. Each preview in the panel is a real
render of your own picture through that effect, not a stock sample. Thirty one
previews is more than anyone can scan, so there is a field at the top to find
one by name.

With nothing selected the panel stands down to a narrow rail and gives the
board back the width, since everything it has to say needs a picture to say it
about.

The panel has three tabs:

- Effect. Pick one of the 31 effects and adjust its own settings.
- Adjust. Change exposure, contrast, saturation, warmth, blur and grain. You
  can also zoom, move, rotate and flip the picture inside its card.
- Looks. Save what you have arrived at and put it on other pictures.

You can select several images and apply the same effect to all of them at once.

An effect never changes the shape of what it is applied to. A card that is not
the shape of its picture crops it to fill, exactly as it does with no effect on
it, so turning one on changes the look and nothing else.

Effects work on playing video as well as on stills. When you put an effect on a
video, the card shows the effected picture and gets its own play button, scrub
bar and mute button, because the browser's own controls sit behind the effect
and cannot be reached. Pause anywhere and the card keeps showing the effected
frame you stopped on.

## Saved looks

A board of photographs is rarely a dozen separate decisions. It is usually one
decision made a dozen times, and the Looks tab is where that decision is kept.

Set an effect and a tone on one picture, open Looks and press "Save this look".
It arrives in the grid below under a name taken from what it actually is —
"Halftone mono grain" — which you can type over then or rename later by double
clicking it. Every tile in the grid is a live render of the picture you have
selected through that look, so you are choosing by looking at your own
photograph rather than at a stock sample.

Click a tile to put that look on everything selected, in one step of undo.

A look carries the treatment and not the composition: the effect, its own
settings, and exposure, contrast, saturation, warmth, blur and grain. It leaves
zoom, offset, rotation and flip alone, because those are how one particular
picture is cropped and carrying them across would wreck eleven framings to copy
one.

For a look you want once rather than forever, right click a graded card and
choose "Copy look", then right click another and choose "Paste look". The
clipboard holds one look and survives a reload.

Saved looks are kept in the browser rather than in the board, because a look is
how you work rather than what is on this board. The one you saved last week is
waiting on the board you start today, and it does not travel inside an exported
`.board.zip`.

## Notes

A note holds more than a block of text. Headings, bold, italic, code, quotes,
bullet and numbered lists, links and checkboxes all work, and the buttons above
the editor write them for you — or you can type them, since they are the same
marks people already use in plain text:

```
# A heading
**bold**  *italic*  `code`
- a list
1. a numbered list
> something borrowed
- [ ] still to do
- [x] done
https://example.com
```

Checkboxes can be ticked on the card itself, without opening anything, and the
card's title bar counts how many are done. Cmd or Ctrl with B and I work in the
editor.

The note stays one string. That is what keeps search working on it, keeps the
saved board readable, lets a note pasted in from somewhere else arrive with its
shape intact, and means none of this needed a migration.

## Tidying up

Cards line themselves up as you drag them: edges with edges, middles with
middles. A guide is drawn between the two cards that agree, so it is clear what
has just happened, and Shift asks for the plain grid instead.

Select two or more and the right click menu can line them up by any edge or
through their middles. Three or more can be spaced evenly across or down, with
the outermost two left where they are. "Tidy up" lays the selection out on a
grid, in the order it reads now, keeping roughly the shape it already had: a
row stays a row and a block stays a block. Each is one step of undo.

## Using it with fingers

One finger on empty board pans it, two pinch to zoom, and a finger on a card
drags the card. A tap on empty board clears the selection. Dragging a card with
one finger works because a press that starts on a card never becomes a pan.

## Connecting cards

Hover a card and four dots appear on its sides. Drag one onto another card and
the two are joined by an arrow. The card you are about to land on is outlined,
so it is clear what will be connected before letting go. Selecting exactly two
cards and choosing "Connect" from the right click menu does the same thing
without the drag.

A connection is stored as the two card ids and nothing else. It is drawn from
wherever those cards happen to be, leaving each one from the side that faces
the other, so moving a card takes its connections with it and nothing has to be
tidied up afterwards. Each connection watches only the two cards it joins, so
dragging a card redraws its own arrows and no others.

Click an arrow to select it and Delete to remove it. Deleting a card removes
the connections that reached it, and one undo brings back the card and its
connections together.

## Boards inside boards

A board card opens a board of its own. Double click it to go in, and the trail
at the top left is the way back out: each step is a button that takes you
straight to that level. Boards nest as deep as you like, and the card shows
what is inside — a count and the first few pictures — so a closed board is not
a closed box.

Each board is stored on its own and only the one you are looking at is loaded.
A board holding a thousand cards therefore costs nothing to the board it sits
on, which is the point of putting it in a board rather than a section. The
board you were on is the one you come back to when you reopen the page.

Renaming works from either end: the name field at the top left names the board
you are in, and the card that opens it takes the same name. Duplicating a board
card copies what is inside it, including any boards in there, so the copy is a
copy rather than a second door onto the same room.

Deleting a board card takes the card off this board but leaves what was inside
it alone, so undo brings back the card and everything in it.

One thing to know: search and the tag filter look at the board you are on, not
the ones inside it. Export does take the whole tree.

## Video from a link

Paste the address of a video file and the board loads it, works out its shape
and gives you a video card with everything a dropped file gets.

Whether it can also take an effect is not ours to decide. Running a shader over
a video means reading its picture back out of the player, and a browser only
allows that when the site hosting the file says it may. Many do; some do not.
The board finds out by loading the file both ways when you paste it, so you are
told rather than left guessing:

- If the host allows it, the card behaves exactly like a dropped file.
- If it does not, the video still plays and the card says "Effects unavailable
  for this source". Exposure, contrast, saturation, warmth, blur, grain,
  zoom, rotation and flipping all still work on it, because those are applied
  to the card rather than to the picture's pixels.
- A YouTube or Vimeo link becomes an embedded player. Nothing outside an
  embedded player can read its picture, so those cards take the same
  adjustments but no effects. Click once to select the card, and again to
  reach the player's own controls.

An address that turns out not to be a video stays an ordinary link card.

## Where your work is stored

Everything lives in this browser and nowhere else: the boards in IndexedDB,
the pictures beside them as blobs. Nothing is uploaded, and there is no
account.

That means the only copy of your work is on this machine, in this browser, so
the app takes it seriously:

- It asks the browser to keep the data rather than treat it as a cache it may
  clear when the disk gets tight. Chrome decides on its own, Firefox asks you,
  Safari grants it once you have used the site a few times. Whether it was
  granted is on the tooltip of the counter in the corner.
- It watches how full the storage is and says so in that corner once it is
  past eighty per cent.
- It checks that a drop will fit before starting it, rather than finding out
  half way through.
- If a write does fail, it says so and does not go away until you answer.
  Every write used to swallow its own error, which meant a board that would
  not save looked exactly like one that had — the pictures were still on
  screen because they were still in memory — and you found out on the next
  reload, when they were gone.

The way out of a full disk is the same as the way onto another machine:
"Export" writes the board and everything in it to a file.

## Showing the board

Press P, or pick "Present this board" from the command list, and the board
fills the screen with one thing at a time and nothing else: no toolbar, no
panel, no grid of dots, no other cards around the one being talked about. The
arrow keys and the space bar move through it, clicking the left third goes
back and clicking anywhere else goes on, and Escape leaves.

The order is the one on the board, not the order things were made in. Somebody
who arranged twelve photographs into three rows meant those rows, so it reads
top to bottom in bands and left to right inside each band, the way an eye
crosses a wall of pictures.

Select more than one thing first and it shows only those.

The ground is near black whatever theme you are in, which is what a screening
room and a gallery both arrange for, and what a board cannot be because you
have to work on the board.

## Pulling the colours out

Right click a picture or a video and choose "Pull the colours out", and the
five colours it is made of arrive as swatches in a row underneath it. All five
are one step of undo.

Half of what a moodboard is about is colour, and until now the colour was
locked inside the photographs: you could look at it, but you could not write it
down, hand it to anyone, or hold it beside the colour out of another picture.

A swatch is a note whose paper is the colour and whose text is the hex. That is
not a shortcut. It means a swatch is something the board already knows how to
do everything with — move it, tag it, search it, group it in a section, carry
it into an exported file and back out again — where a tenth kind of card would
have had to learn all of that over again. The writing on a note takes its
colour from the paper, so the hex is readable on a black swatch and on a pale
one.

The colours are counted rather than guessed at: the picture is sampled small,
its colours are bucketed, and the buckets are weighted so that a photograph
which is two thirds pale sky does not spend three of its five swatches on the
sky, and the one red thing in a grey picture still makes the list. No two
swatches are allowed to be the same colour under two names.

## Getting a picture out

Right click a picture or a video and choose "Export as PNG", or press Cmd or
Ctrl with E. Select several and they come out together as a zip of PNGs.

The file is the picture at its own resolution rather than at the size of the
card, cropped the way the card crops it. A card showing a narrow slice of a
wide photograph exports the pixels of that slice, not a stretched copy of the
whole thing.

What comes out is the card, not just the shader. The effect, the tone, the
framing and the grain are all in the file, in the order the card applies them,
because an export carrying only the effect would hand back something you were
never looking at. Exporting a video card exports the frame you are looking at.

## Taking a board out, and putting one back

"Export" writes the board you are on, every board nested inside it, and every
picture, video and file any of them use, into one `.board.zip`. It is an
ordinary zip: a `board.json` describing the tree and a `media` folder beside
it, so anything can open it and a person can read it.

"Import" reads one back. Drop the file on the board, use the button, press Cmd
or Ctrl with O, or pick "Board file…" from the right click menu on empty board.

An imported board arrives as a board card on the board you are on. Nothing is
replaced, everything inside it is renamed on the way in, and so the same file
can be brought in twice as two separate boards, and a board someone sends you
cannot land on top of anything you already have.

Because the storage is local to one browser, your boards do not follow you to
another machine. The storage code sits behind a small set of functions in
`src/store`, so you can add another way to store boards later without changing
the board itself.

## Speed

This version was rebuilt to stay fast when a board holds many images with
effects on them. The short version is that all the graphics work happens on a
separate thread, each picture is sent to the graphics card only once, and
finished frames are handed to the page without being copied.

`docs/PERFORMANCE.md` explains what was slow before, what changed and what the
measurements show. `docs/ARCHITECTURE.md` explains how the code is laid out.

## Tests

Two kinds. The fast ones are arithmetic and run in about a second; the slow
ones drive a real browser and take about twenty minutes.

```bash
npm test            # types, then 107 unit tests — about a second
npm run test:all    # the above, then a build, then every browser suite
```

Both run on every push through `.github/workflows/ci.yml`, as two jobs, so a
typo is reported while you are still looking at the tab.

### The fast ones

```bash
npm run test:unit     # once
npm run test:watch    # and again on every save
```

They cover the arithmetic underneath the interface: how a picture is cropped
to a card and how big the file that comes out of it is, what a note's markup
parses to, which colours come out of an image and whether the hex is legible
on them, where a dragged card snaps to, what a pasted address turns into, what
a saved look carries and what it leaves behind, how the store lines cards up
and spaces them out and joins them, what each kind of card can do, and what
happens when the disk runs out.

They found two real bugs on the day they were written: a palette could offer
the same colour twice under one name, and duplicating two connected cards
dropped the arrow between them, because the code that copies a wire was
looking at a list the wire had already been filtered out of.

### The slow ones

```bash
npm run build
npm run test:browser              # all of them, one after another
npm run test:browser -- ui menu   # or just these
npm run test:browser -- --network # and the one that reaches the internet
```

`test:browser` starts the preview server, runs the suites against it, and puts
it away afterwards. To run one by hand instead, start a server and point a
suite at it:

```bash
npm run dev &
npm run test:ui -- http://localhost:5173
npm run test:sections -- http://localhost:5173
npm run test:boards -- http://localhost:5173
npm run test:wires -- http://localhost:5173
npm run test:notes -- http://localhost:5173
npm run test:transfer -- http://localhost:5173
npm run test:arrange -- http://localhost:5173
npm run test:touch -- http://localhost:5173
npm run test:menu -- http://localhost:5173
npm run test:search -- http://localhost:5173
npm run test:looks -- http://localhost:5173
npm run test:palette -- http://localhost:5173
npm run test:present -- http://localhost:5173
npm run test:smoke -- http://localhost:5173
npm run test:effects -- http://localhost:5173
npm run test:png -- http://localhost:5173
npm run test:aspect -- http://localhost:5173
npm run test:video -- http://localhost:5173
npm run test:urlvideo -- http://localhost:5173
npm run test:load -- http://localhost:5173 60
npm run bench
```

- `test:ui` drives every control on the board, which is 43 checks covering the
  toolbar, selection, dragging, resizing, undo, the effects panel, the editor
  and saving. It clears the board's stored data first, so do not point it at a
  browser holding work you want to keep.
- `test:arrange` drags a card onto a neighbour's edge and checks it is pulled
  exactly onto it with a guide to say so, then lines up, spaces and tidies a
  selection from the menu and checks each is a single step of undo.
- `test:present` puts a picture with five known colours in it on the board,
  pulls the colours out and checks that the five it finds are the five that
  went in, that none of them is the same colour twice, that the hex is legible
  on every swatch, and that all five are one step of undo. Then it shows the
  board and checks the order is the board's reading order, that the arrows
  move through it, and that a selection of two out of three shows two.
- `test:palette` checks that every button in the top bar is an icon that still
  says what it is, that the command list opens, narrows as you type, runs what
  you pick and refuses what has nothing to act on, that a command the toolbar
  never had room for works from it, that the panel collapses to a rail with
  nothing selected, and that an effect can be found by name.
- `test:looks` grades a card, saves the look, puts it on a second card and on a
  whole selection, and checks the treatment carries while the framing does not
  — the second card is zoomed first, and stays zoomed. It also copies and
  pastes a look through the card menu, renames one, deletes one, and reloads
  the page twice to check that a saved look outlives the browser session and
  that a deleted one stays deleted.
- `test:touch` pans with one finger, pinches with two, drags a card with one,
  and taps to clear the selection.
- `test:transfer` builds a board with a picture, an arrow and a board nested
  inside it, exports the lot, wipes the browser and drops the file back on an
  empty board, then checks every piece came back — including the picture, which
  is the part the old export could not carry. It also opens the file with
  Python's own zip reader, so "openable by anything" is checked by something
  that is not the reader that wrote it.
- `test:notes` writes a note with every mark in it and checks each one is drawn
  as what it means, that ticking a box on the card writes the tick back into
  the text and survives a reload, and that the editor's buttons put marks where
  the cursor is and take them off again.
- `test:wires` connects two cards by dragging from a port, checks the arrow
  follows them when they move, that the same pair cannot be joined twice, that
  an arrow can be selected and removed on its own, that deleting a card takes
  its arrows with it, and that undo brings both back.
- `test:boards` makes a board inside a board inside a board and checks that
  what goes in each one stays there, that the trail back out works at depth,
  that a rename reaches the card that opens it, that a reload lands you where
  you were, and that duplicating a board card copies its contents rather than
  pointing at the same board. It also measures the top bar at five widths,
  since the trail has to share a row that was already full.
- `test:sections` checks that items join a section when dropped in, move with
  it, leave when dragged out, survive a reload, and that resizing does not
  change membership while deleting removes the contents.
- `test:menu` opens both right click menus and checks each action, including
  ordering, tagging, acting on a multiple selection, and that the canvas menu
  adds things under the pointer.
- `test:search` checks what search matches on, that non-matches fade and stop
  taking clicks, that Enter steps through results, and that the tag filter
  narrows the board and combines with the text.
- `test:smoke` drops a picture, applies five effects and checks that each one
  actually painted something different.
- `test:effects` applies all 31 to one picture and checks that each paints
  something of its own, that no two paint the same thing, and that none paints
  a flat colour. A shader that fails to compile falls back to Original without
  saying so, which is exactly what that catches. It also checks that ASCII
  finds something to say in the picture's shadows, which is where it used to
  give up. It leaves a contact sheet of every effect in `.smoke` to look at.
- `test:png` exports a card and checks the file is the picture's own
  resolution rather than the card's, that it is the shape of the card, and that
  the effect, the tone, the framing and the grain are each really in it. It
  also exports two cards at once and opens the zip with Python's own reader.
- `test:aspect` puts a circle on a card that is not the shape of its picture
  and checks it is still a circle once an effect is on it, measured on a
  picture of the card rather than on the bitmap behind it.
- `test:video` records a short clip in the page, drops it on the board, applies
  an effect and checks that the picture keeps changing while the video plays.
  It also reloads the page to check the card comes back.
- `test:urlvideo` serves that same clip from a second origin on your machine,
  one path with the cross-origin header and one without, and checks all four
  outcomes: effects on the readable one, a playing card that says so on the
  other, an embedded player for a YouTube link, and a plain link for an address
  that is not a video.
- `test:load` fills a board with images, applies an effect to all of them and
  reports whether the main thread ever blocked.
- `bench` compares the old drawing method with the new one.

## What is in each folder

| Path | What is in it |
| --- | --- |
| `src/engine` | The effects engine, the worker and the job scheduler |
| `src/board` | The board surface, the cards and the pan and zoom code |
| `src/state` | The board contents, undo and redo, the board tree, what each kind of card can do, and reading what is dropped in |
| `src/store` | Saving to IndexedDB and to a folder on disk, and watching how much room is left |
| `src/ui` | The effects panel and the small dialogs |
| `test` | Browser suites and the benchmark |
| `test/unit` | The fast tests, on the arithmetic underneath |
| `scripts` | The runner that drives every browser suite in one command |
