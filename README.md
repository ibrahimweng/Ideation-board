<img src="brand/mark.svg" width="72" alt="">

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

## Screens, not gradients

There is not a gradient anywhere in the interface.

Where a name sits over a photograph, or a bar sits over a board being
presented, the thing that makes the words legible is a halftone screen: dots
whose coverage falls off, densest where the words are and gone a few pixels
above them. A smooth ramp would do the same job and look like every other scrim
on the web; a screen does it by the method this app is actually about, which is
coverage rather than opacity. A picture that has not loaded yet is a still
field of dots rather than a gradient sliding across.

`src/board/screen.ts` builds them. The radii follow from the coverage they
stand for — area, so the radius goes as its square root, which is what makes a
halftone read as an even ramp instead of a sudden wall of ink.

The dot grid on the board is the same idea and always was.

## Light and dark

The button beside the zoom control cycles between following your system,
light, and dark. A dot on it means it is following the system.

This is not decoration. What surrounds a photograph changes what you see in
it — the same picture reads warmer on a pale ground and flatter on a dark one
— and a board is where photographs are judged, so it is worth being able to
say which surround you are judging against.

## Using the board

You add things in several ways:

- Drag files from your computer onto the board. A folder of twenty arrives as
  a block shaped like your window rather than a column marching off the bottom
  of it, and the board moves to show you what landed — unless all of it landed
  in front of you already, in which case nothing moves. That is the whole
  question, and it holds for a single photograph too: a card is capped at 420
  across, which is wider than a phone.
- Press the picture button in the top bar.
- Paste an image, a block of text or a link.
- Paste or drop the address of a video file and it becomes a video card you can
  play and put effects on. A YouTube or Vimeo link becomes an embedded player.
- Drag a picture out of another browser tab, or paste its address, and it
  becomes a picture rather than a link.
- Press the nested-frame button for a board inside this one, for work that has
  outgrown a corner of the canvas.

Once something is on the board:

- Drag a card to move it. It lines itself up with the cards around it and
  draws a guide where it has, or hold Shift to snap to a grid instead.
- Drag a corner handle to resize it.
- Drag on empty space to select several cards at once. Shift and a click adds
  one to the selection or takes it out again, and a click on a card that is
  already one of several keeps just that one — but only once the button comes
  back up without having moved, so a group can still be dragged by any card
  in it.
- Hover a card and drag one of the four dots on its sides onto another card to
  connect them.
- Select several and use the right click menu to line them up, space them
  evenly, or tidy them onto a grid.
- Hold Alt and drag, or drag with the middle mouse button, to pan the board.
- Hold Ctrl or Cmd and scroll to zoom.
- Press 1 to fit the whole board on screen and 2 to fit what is selected.
- Double click a note, a label or a section to edit its text.
- Double click a picture, a video or a board card to see it big.

## On a phone

The row across the top holds eleven buttons on a laptop and four on a phone:
add a file, undo, the command list, and the effects panel. The seven that stand
down are all reachable from the command list, from the menu a held finger opens
on the board, and from the empty board's own buttons — the row clips rather
than wraps, so anything that will not fit has to be taken out deliberately
rather than pushed off the edge where nobody can see it went.

Every button grows when the pointer is a finger rather than a mouse. The row
was built at 28 by 26 pixels, which is under both of the sizes the platforms
ask for, and that was true at every window size and not only on a small one.

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

The search box reaches into the boards nested on this one. A board card holds
a whole board and opening one loads only that record, which is what makes
nesting free — and what used to make everything you filed invisible to the
thing that exists to find it. A count beside the box says how many matches are
below; pressing it lists them with the board each is in, and picking one opens
that board and puts the view on the card. Nesting is meant to be how you put
work away, not how you lose it.

Narrowing a board is only half of it. Cmd or Ctrl with Enter takes the whole
result set as the selection, and so does clicking the count beside the box.
While a search or a tag filter is running, everything that acts on "this
board" acts on what you can see instead: Select all takes the results, Present
shows only them, and exporting exports only them — the command list says which
it is about to do rather than leaving you to find out. Search for `kept` or
`cut` and the board narrows to one side of a decision, which is what makes
marking one up worth the trouble.

Each toolbar button shows its shortcut, and hovering one names it in full.
The single key shortcuts only fire when no modifier is held and no text field
has focus, so they never get in the way of typing.

Right click a card for a menu with edit or rename, duplicate, bring to front,
send to back, remove from section, keep or cut, tagging and delete. Right
clicking a card that is part of a selection acts on the whole selection.

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
| P | Present the board |
| 1 | Fit the whole board on screen |
| 2 | Fit the selection on screen |
| I | Mark the selection as kept |
| O | Mark the selection as cut |
| G | Put the selection together in one place |
| C | Hold the selection up against each other |
| / | Search |
| Cmd or Ctrl and Enter | Select every search result (in the search box) |
| Cmd or Ctrl and S | Export this board and everything in it |
| Cmd or Ctrl and O | Import a board file |
| Cmd or Ctrl and X | Take the selection off this board |
| Cmd or Ctrl and V | Paste — cards taken off another board, or whatever is on the clipboard |
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

One finger pans the board and drags a card. Two pinch to zoom and pan
together. A tap on empty board clears the selection.

Hold one finger still on a card for half a second and its menu opens, which is
where export, pull the colours out, copy a look, tag, and send to back all
live. Hold on empty board and the add menu opens. Without that, half the app
was unreachable on a tablet: iOS fires no context menu event for a long press
and Android fires one at a moment of its own choosing, so the press is timed by
the board itself and behaves the same on both.

## Using it without a mouse

Tab moves through the cards in the order the board reads — across each row,
then down — and brings whatever it lands on into view. Shift with it goes back.
Everything the board can do to a card is behind a selection, so before this
none of it could be reached without a pointer.

- **Tab** / **Shift Tab** — the next card, the previous one
- **Enter** — open what is selected
- **Arrows** — move the selection, Shift for a bigger step
- **Escape** — select nothing
- **⌘K** — everything else, searchable, with the key for each

The selection is read out as it moves, with its position: "Autumn light.jpg,
image, 3 of 12". A card is a box on a canvas, and nothing about its border
changing colour would otherwise be announced.
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

## Drawing a picture from a prompt

Press **D**, or the frame button in the top bar, and describe something. A card
goes down where you are looking, at the shape you asked for, and fills in when
the picture arrives. After that it is an ordinary picture card: effects run on
it, it exports with the board, it goes into the poster, it can be compared
against the others.

Ask for two or four at once and they arrive side by side, all selected, so
**C** holds them up against each other straight away. That is usually the point
of asking more than once.

The whole prompt stays on the card, so a board of generated pictures still says
what each one was asked for six months later, and the search box finds one by a
word from its prompt.

### Your key, on your machine

This is a static site with no server, so it has no key of its own and no way to
pay for anything. You bring a [Google AI Studio](https://aistudio.google.com/apikey)
key, and it is kept in this browser's local storage.

That is a deliberate choice rather than a shortcut. A key held on a server would
mean one key paying for everybody who finds the address — a free image generator
for strangers, billed to whoever deployed it — and it would need a server to
hold it, which this does not have. A key held here can only ever spend your own
quota.

What follows from that is worth knowing:

- It is per browser. A second machine needs the key entered again.
- Anything with a debugger open on this page can read it, so use a machine you
  trust and a key you can revoke.
- It never touches a board. Not the record in IndexedDB, not the `.board.zip`
  export, not the folder mirror, not what travels to another tab. The board is
  data about pictures; the key is a credential, and the two do not mix.
  `test/draw.mjs` proves it against real storage and a real exported file.
- The request goes straight from your browser to Google, with the key in the
  `x-goog-api-key` header rather than in the address, because a URL is the one
  part of a request that gets written down — in a referrer, in a devtools list,
  in the text of an error somebody pastes into a chat.

### Which model

No model name is written into this app. Open the key and model line, and the
list is fetched with your key: whatever your key can see, filtered down to the
ones that make pictures. Pick one, or type an id the list has not heard of.

Two families live behind the same address and take different requests. Imagen
answers to `predict`; Gemini answers to `generateContent`. Which one a model is
is not guessed — the listing says, and the request is built from that.

The reply is read by looking for a picture in it rather than by walking a path.
Both families bury the bytes at a different depth under a different name, the
shapes have moved before, and a search that recognises an image by its own first
bytes cannot be broken by a rename. It is careful about the opposite mistake
too: several fields in a Gemini reply are base64 and are not pictures — a
thought signature most of all — so a string has to either sit beside an `image/*`
mime type or begin with the first bytes of a real image format before it is
believed.

Some request fields are an error on models that do not support them, and there
is nothing in the listing that says which. So the adapter asks, and when the
answer is that the request was malformed it asks again with less: the aspect
ratio config first, then the combination of response types. A refused key or an
exhausted quota is not retried — it would say the same thing four times.

When nothing comes back you are told what happened rather than that something
went wrong. A model that writes rather than draws hands back its own sentence. A
refused prompt says it was refused and why. A key that is not accepted says so.
The empty card removes itself either way.

The address is a setting too, so a proxy of your own can stand in for Google's —
which is also how the browser test runs the whole path against a fake endpoint
on this machine, with no key and no internet.

## Letting Claude at the board

The board has no server, so an agent cannot be handed a database to read.
Everything it knows lives in one browser's IndexedDB. What it can be handed is
the tab: a small relay runs on your machine, Claude talks to it, and it asks the
tab — which is the only thing that has ever known what is on your board. That is
the same shape Figma uses, where the local process is a relay and the
application is the thing that actually holds the document.

```bash
claude mcp add ideation -- node /path/to/ideation-board/mcp/server.mjs
```

Then, in the board: **⌘K → Connect to Claude**. The corner says "Claude" for as
long as something other than you can move the cards.

Running Claude Code from inside this repo needs none of that — `.mcp.json` is
already here.

If you are using the deployed site rather than a local one, the relay has to be
told about it, once:

```bash
claude mcp add ideation -- node .../mcp/server.mjs --origin https://your.vercel.app
```

The sheet fills that address in for you.

### What Claude can do

`get_board` first — card ids come from there and from nowhere else. Then
`list_boards`, `add_card`, `draw_image`, `update_card`, `move_card`,
`delete_cards`, `connect_cards`, `arrange`, `select_cards`, `fit_view`.

Everything goes through the same store the interface goes through. An arrow
drawn by Claude and an arrow drawn by hand are the same arrow, one press of undo
takes either back, and the board is saved by the machinery that was already
saving it. `select_cards` is worth more than it looks: you are watching the
board while Claude works, and pointing beats describing.

`draw_image` spends your own key, from your own browser. Nothing about that
changes because an agent asked.

### Who is allowed to connect

The relay listens on the loopback address, and **every page in your browser can
reach loopback**. Without a check, any site you happened to be visiting could
open the stream and read — or rewrite — your board.

The check is the `Origin` header. A browser sets it on every cross-origin
request and a page cannot forge it, so a list of allowed origins is a real
boundary rather than a polite one. Loopback origins are allowed by default,
because that is what you develop against; the address you deployed to has to be
named with `--origin`. A missing or `null` origin is refused outright — that
means a sandboxed frame, or something that is not a browser at all.

`--token` adds a shared secret on top. It is off by default and it is not the
boundary; it is there for a machine where something else untrusted is already
running.

`test/mcp.mjs` proves this rather than asserting it: it conjures a second origin
with Chrome's host resolver and, from inside a real browser, tries to open the
stream and tries to write to it. Both are refused, the relay records who it
turned away, and the board carries on untouched.

### What it is made of

`mcp/server.mjs` has no dependencies. MCP over stdio is JSON-RPC in
newline-delimited JSON, and the bridge is an event stream out and a POST back,
so the whole relay is Node's own `http` and nothing else. A tool for looking at
pictures should not drag a dependency tree behind it.

It knows the names of the tools and the shape of their arguments, and nothing
whatever about what a card is. `src/mcp/tools.ts`, in the app, is the half that
knows — so adding a kind of card means editing one program, not two.

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

### Two tabs on one board

Everything is kept in one browser, and a browser has tabs. Open the app twice
and both copies used to load the same record and both write it back, neither
knowing the other was there: whichever saved last won, and whatever the other
had added in the meantime was gone, with no warning and no undo.

The tabs tell each other when they write. A tab that is only looking picks the
change up and is no longer holding a stale copy to overwrite with, so the
ordinary case — you edit in one tab, then the other — keeps everything. And
every write checks the record it is about to replace, in case that message was
missed or the browser has no way to send one, so a save that would clobber a
newer version does not happen.

When both tabs really have been edited before either wrote, there is no answer
that is not somebody's loss, so the app does not pick one. Saving stops, both
versions still exist — theirs on disk, yours on screen — and a message that
does not go away asks which. It also offers the third way out: export this
version first, and lose neither.

This is one browser on one machine, which is the scope of the problem. Two
machines on one folder is a different question, and the folder copy above
already says it does not answer it.

### Keeping a copy in a folder

The stronger answer to all of that: point the board at a folder on disk and it
writes itself there and keeps writing. `⌘K` → "Keep a copy in a folder".

It writes a `board.json` and a `media` folder — the same shape the exported zip
has, so the folder can be zipped by hand and imported back. Put that folder in
Dropbox, iCloud, a network drive or a git repository and the work is on more
than one machine, backed up, and outside the browser that made it. Nothing here
talks to a server.

It is a copy, not a synchronisation. Nothing is ever read back out of the
folder, and two browsers pointed at one folder will overwrite each other.
Conflict resolution is the hard part of syncing and this deliberately does not
attempt it — saying so is better than pretending otherwise.

Chrome and Edge can do this. Safari and Firefox cannot yet, and say so rather
than failing quietly. The folder is remembered between sessions; a browser will
not hand the permission back without a click, so it is offered rather than
silently reopened.

The other way out of a full disk is the way onto another machine: "Export"
writes the board and everything in it to a single file.

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

Select more than one thing first and it shows only those. Double clicking a
picture, a video or a board card opens the same view at that card, which is
the short way to look at one thing properly without meaning to run a slideshow.

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

## Putting the best in one place

Deciding is only half of it. Mark six of forty as kept and they are still
exactly where you dropped them, scattered over four screens among the
thirty-four you did not keep — and a shortlist that is only a mark on a card is
not somewhere you can look at, present or hand over.

Select what you picked and press G, or use "Put the selection together in one
place" from the command list. It makes a section named Shortlist on clear
ground below the board, lays what you chose out as a block and moves it in, in
one step of undo. The name is why it is a section and not a heap: what comes
out is a group you can select, present and export as one thing.

The usual way in is through the search box: type `kept`, press Cmd or Ctrl with
Enter to take the whole result set, then G.

## Moving cards between boards

A board card holds a whole board, and for a long time nothing could travel
between them: you could nest boards, and search inside them, and never bring
anything up or send anything down. The only way to move a photograph one level
was to find the original file and drop it again.

Cmd or Ctrl with X takes the selection off the board and holds it. Open the
board where it belongs and paste. There is no list of boards to pick from,
because the boards are a tree you can already walk — cut here, walk there,
paste.

The pictures themselves never move. A card names a file in a store every board
in this browser shares, so what travels is the record. Arrows travel when both
of the cards they join are travelling; a section the card used to sit in stays
behind, because it is not on the board it is going to. Taking away and putting
down is a move, so it happens once. A board will not be put inside itself, and
says so rather than making a loop.

## Holding two things up against each other

Deciding is nearly always between two things — this one or that one — and the
show could not help with it, because it puts one thing on the screen at a time
and the question when you are choosing is what the other one looked like. On
the board they are cards among thirty. Neither is a comparison.

Select two, three or four and press C. They go up together on the same near
black ground the show uses, each as large as the room allows, with nothing else
on screen. The arrangement is worked out rather than fixed: four wide
photographs want two rows and four tall ones want four columns, and which is
which depends on the shape of the window as much as on the pictures.

The decision is made from inside it, because that is the moment you have made
up your mind. I keeps whichever one the keys are on and O cuts it, the same two
keys the board uses, and the mark appears on the picture rather than only after
you have left. The arrows move between them, and so do their numbers, which are
written on them. Escape leaves, and what you decided is on the board.

Four is the most it will hold up at once, because past that they are too small
to be honestly compared — at that point what you want is the board. Select more
and it takes the first four in the board's own reading order and says how many
it left out.

## Deciding

A board only ever grew. Everything that went on it stayed on it, and there was
nothing to record that three of the thirty were the ones and the rest were not.

Select anything and press I to keep it or O to cut it. A kept card wears a
green tick in its top left corner and a cut one wears a red cross and steps
back to a fifth of its weight — it stays exactly where it is, because where
something sits on a board is part of how you recognise it, and a decision whose
consequences you cannot see is not much of a decision. Pressing the same key
again takes the mark off; a decision you can only make and never unmake is a
trap. The same two are in the right click menu and in the command list.

This is not a tag. A tag says what something is, and the five of them are
colours with no meaning attached. This says what you decided about it, so the
two are on separate corners of the card and neither one disturbs the other.
Searching for "kept" or "cut" narrows the board to one side of the decision.

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

## The board as one picture

Everything else here exports a piece of a board: one card as a PNG, the whole
board as a zip only this app can open. Neither of those is the thing you are
asked for at the end of a week of collecting, which is the board itself — flat,
in one file, that opens anywhere and can go in an email.

Pick "Export this board as one picture" from the command list for a PNG, or
"Export this board as a PDF" for a page. Select more than one card first, or
narrow the board with the search box, and it exports only those — the command
says which before you run it.

Two lines at the top say what the sheet is: the board's name, and then how many
things are on it, how many were kept and cut, and the date. Each card carries
its own name along the bottom, drawn the way the card draws it when you hover
one — over a screen on a photograph, on a plate on anything paler. The board
shows that only on hover, which is right for a board: a wall of photographs
should look like a wall of photographs and not like a list of filenames. A
sheet is not a board. It is the thing you send somebody, usually of the few you
chose out of the many, and six pictures with nothing written on them are six
pictures and not an argument. A picture of a
board with nothing on it to say whose board it is becomes an anonymous file in
somebody's downloads a week later, and a sheet that is only part of a board
says "5 of 20" rather than passing itself off as the whole thing.

It is painted rather than photographed. The board is bigger than the window, it
is spread across a WebGL canvas per card and a hundred DOM nodes, and half of
it is scrolled out of sight, so there is nothing to take a picture of. The
sheet is drawn card by card in the order the board stacks them, using the same
geometry, the same type and the same colours the stylesheet uses — read out of
the live custom properties, so a board worked on in the dark theme comes out
dark. Photographs go through the same path a single-card export takes, so a
picture that is halftoned and cropped and warmed on the board is halftoned and
cropped and warmed on the sheet. A cut card comes out faded, exactly as far as
it fades on the board.

The PNG is the sheet at its own size, however large that is: a board four
screens wide comes out four screens wide, which is what you want on a monitor.

The PDF is that sheet on paper somebody owns. It picks A4 or Letter from your
locale, turns the page to whichever way round suits the board, and centres the
board inside a margin. The first version of this wrote a page 1386 points by
972 — fine to email, impossible to print, and nobody owns that paper.

It is written by hand: one page, one image on it, and five objects to say so.
The picture goes in as JPEG because a PDF understands JPEG bytes directly, so
nothing here has to carry a compressor around. The only fiddly part is the
cross-reference table, which is a list of byte offsets into the file itself,
each entry exactly twenty bytes long — wrong in a way nothing on screen would
show, which is why it is unit tested.

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

**Every number in `docs/PERFORMANCE.md` was measured on SwiftShader**, which
draws with the processor instead of a graphics card, because that is what the
machine the work was done on had. The shape of the result should hold on real
hardware and the gap should be wider — the main fault in the old method was
reading pixels back off the graphics card, which costs almost nothing when the
"graphics card" is the processor — but that is a reasoned expectation and not a
measurement, and it should not be repeated as though it were one.

Panning a large board costs what it costs to draw the pixels, not what it
costs to keep track of the cards. On SwiftShader, panning 150 photographs runs
at about 34 frames a second and 40 photographs at about 47; the same 150 with
an effect on every one of them runs at about 11, because a shaded card is a
canvas rather than an image and a software rasteriser has no fast path for one.
On a real graphics card both are texture blits and the gap should close.

Until recently every card also asked for a compositor layer of its own, all the
time, whether or not anything was moving — three hundred layers on a board of a
hundred and fifty, reserved against the moment one of them might be dragged.
The hint now goes only to the cards actually being dragged, for as long as the
drag lasts. It did not move the frame rate on a software renderer, where fill
is the whole cost; it gives back a large amount of graphics memory on a machine
that has any.

Measure it on your own machine rather than taking the table on trust:

```bash
npm run dev &
N=40 SRC=1400 npm run bench                    # cold and warm redraws
npm run test:load -- http://localhost:5173 60  # whether it stays responsive
```

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
npm run test:decide -- http://localhost:5173
npm run test:fit -- http://localhost:5173
npm run test:drop -- http://localhost:5173
npm run test:tabs -- http://localhost:5173
npm run test:curate -- http://localhost:5173
npm run test:compare -- http://localhost:5173
npm run test:draw -- http://localhost:5173
npm run test:mcp -- http://localhost:5173
npm run test:access -- http://localhost:5173
npm run test:smoke -- http://localhost:5173
npm run test:effects -- http://localhost:5173
npm run test:png -- http://localhost:5173
npm run test:poster -- http://localhost:5173
npm run test:urlimage -- http://localhost:5173
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
- `test:access` checks the three ways in that were missing: that an empty board
  says what to do with it, that Tab walks every card once in the board's own
  order and brings each into view, that Enter opens what is selected and the
  selection is spoken with its position, and that holding a finger on a card
  opens its menu while a tap and a drag do not.
- `test:present` puts a picture with five known colours in it on the board,
  pulls the colours out and checks that the five it finds are the five that
  went in, that none of them is the same colour twice, that the hex is legible
  on every swatch, and that all five are one step of undo. Then it shows the
  board and checks the order is the board's reading order, that the arrows
  move through it, and that a selection of two out of three shows two.
- `test:decide` marks cards kept and cut from the keyboard, the card menu and
  the command list, checks that the same key takes a mark off again, that a
  whole selection is decided together, that a cut card fades but stays put and
  a marked card gains no tag, that "kept" and "cut" can be searched for, and
  that a decision survives a reload and can be undone.
- `test:fit` scrolls a board of four pictures right off the screen, presses 1
  and checks every card is back on it and that nothing has been blown up past
  life size, presses 2 on a selection and checks it comes closer, checks that
  fitting nothing says so rather than appearing to do nothing, and that double
  clicking a picture opens it big at that picture while a note still opens its
  editor.
- `test:compare` holds two wide-and-tall photographs up against each other and
  checks they are laid out side by side and far larger than a card, that I and
  O decide from inside without going back to the board, that the arrows and the
  numbers move between them, that four is the most it shows and it says what it
  left out, and that the board underneath is not moved or nudged by any of it.
- `test:draw` stands up a fake Gemini on its own origin, speaking the shapes
  Google's discovery document describes, and drives the whole path through a
  real browser: the sheet with no key, a key that is refused, a key that works
  and the model list it can see filtered to the ones that draw, a card on the
  board before the picture arrives and the picture in it afterwards, both
  families of model, four at once laid out in a row and all four selected, a
  model that writes rather than draws handing back its own words, a refused
  prompt, and everything still there after a reload. Then the part that matters
  most: that the key is in local storage under its own name and nowhere else,
  in none of the boards this browser holds, and in no part of an exported
  `.board.zip` — read back out of the file with Python's `zipfile`. No key and
  no internet are needed to run it.
- `test:mcp` starts the real relay as a real subprocess and speaks to it the
  way Claude does — JSON-RPC on its stdin and stdout — while a real browser
  holds the board at the other end. Nothing stands in for anything: a note put
  down over the wire is really on the board, its words are on screen, undo takes
  it back, and `draw_image` produces real pictures. Then the half that matters
  most: a second origin is conjured with Chrome's host resolver and made to try,
  from inside a real browser, exactly what a hostile page would.
- `test:curate` runs the job the whole app is for, end to end: gather twelve
  references, keep five, put those five in a place of their own, move them to a
  board where they belong, and check they arrive with their pictures and their
  marks intact. It also checks that gathering is one step of undo, that putting
  cards down happens once rather than making copies, and that a board refuses
  to be put inside itself.
- `test:tabs` opens the app twice in one browser, which is what two tabs are,
  and checks that a tab picks up what the other one wrote without being
  touched, that a later write keeps both tabs' work, and that a write which
  would replace a newer record stops and asks instead — with that tab's own
  work still on screen and the other version still on disk while it does.
- `test:drop` drops a folder of twenty on the board and checks that all twenty
  arrive, that they are laid out as a block rather than a column, and that the
  board moves to show them. Then it checks the other half: a single picture
  dropped in front of you moves nothing, and a drop made while zoomed in never
  zooms you in further than you were.
- `test:poster` exports a board wider than the window as one picture and reads
  the file back: both far-apart photographs are on it and in different places,
  the writing on a note is really painted, a section and a wire are drawn, a
  cut card comes out faded, the two lines at the top are there, and a board
  exported in the dark theme comes out dark. It checks that a narrowed board
  exports only what it narrowed to. Then it exports the same board as a PDF and
  checks the page is a paper size somebody owns, turned to suit the board, with
  the board inside a margin and its own shape kept.
- `test:urlimage` serves a PNG from a second origin on your machine, once with
  the cross-origin header and once without, and checks that dragging the first
  in makes a picture this board holds and can shade, that pasting the second
  makes a picture shown from its own address, that a page is still a link, and
  that all three survive a reload.
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
  and taps to clear the selection. It also checks that every button
  in the top row and the zoom bar is big enough to hit with a finger.
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
  since the trail has to share a row that was already full. It also puts a note two boards
  down, comes back to the top, and checks that searching for a word in it finds
  it, says which board it is in, and that picking the result opens that board
  and brings the card into view.
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

## The icon, and the picture beside the link

`public/` holds the icon at every size something asks for it in — an SVG for
modern browsers, a `favicon.ico` carrying 16, 32 and 48 for the ones that still
ask for that file by name, a square full-bleed touch icon because iOS puts its
own mask on it, and a maskable one for Android.

`og.png` is what appears beside the link wherever it is pasted. It is a real
screenshot of the app with the name over it, not a logo on a colour: a card
that is only a logo tells you nothing the URL did not. It is made by driving
the app — dropping the pictures in, putting ASCII on them, pulling the colours
out of one — so it cannot show a feature that is broken.

Both fail silently in the wild — a missing icon is a blank page glyph and a
missing card is a link with nothing beside it, and neither appears in any log —
so `test/unit/brand.test.ts` checks that everything `index.html` and the
manifest point at is actually there and the right size.

The absolute address the card needs is filled in at build time from the host's
environment, so it is right on production and right in a preview deploy without
anyone typing a domain. `SITE_URL=https://your.domain npm run build` pins it.

`brand/` holds the generator and explains the mark.

## What is in each folder

| Path | What is in it |
| --- | --- |
| `src/engine` | The effects engine, the worker and the job scheduler |
| `src/board` | The board surface, the cards and the pan and zoom code |
| `src/state` | The board contents, undo and redo, the board tree, what each kind of card can do, where things go when they are lined up, and reading what is dropped in |
| `src/store` | Saving to IndexedDB, keeping a copy in a folder on disk, and watching how much room is left |
| `src/ui` | The top bar, the panels, the command list and the small dialogs |
| `src/ai` | Your key, and asking Google for a picture with it |
| `src/mcp` | The wire to the relay, and what an agent may do to the board |
| `src/app` | The keyboard, in one place |
| `test` | Browser suites and the benchmark |
| `test/unit` | The fast tests, on the arithmetic underneath |
| `mcp` | The relay Claude talks to. No dependencies |
| `scripts` | The runner that drives every browser suite in one command |
| `public` | The icon at every size, the social card, the manifest |
| `brand` | What generates all of that, and why the mark is what it is |
