# Ideation Board

A board where you drop ideas and work on them. You can drop images, video,
audio, notes, links and other files. You can apply visual effects to the images
and video, move things around, group them into sections and label them.

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

## Using the board

You add things in several ways:

- Drag files from your computer onto the board.
- Press the "Add files" button in the top bar.
- Paste an image, a block of text or a link.

Once something is on the board:

- Drag a card to move it. Hold Shift while dragging to snap to a grid.
- Drag a corner handle to resize it.
- Drag on empty space to select several cards at once.
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
| K | New link |
| E | Show or hide the effects panel |
| / | Search |
| Cmd or Ctrl and S | Export |
| Cmd or Ctrl and Z | Undo |
| Shift and Cmd or Ctrl and Z | Redo |
| Cmd or Ctrl and A | Select everything |
| Cmd or Ctrl and D | Duplicate the selection |
| Delete or Backspace | Remove the selection |
| Arrow keys | Nudge the selection, and hold Shift to nudge further |
| Escape | Clear the selection |

## Effects

Select an image or a video and open the Effects panel. There are 24 effects,
grouped by the kind of look they give. Each preview in the panel is a real
render of your own picture through that effect, not a stock sample.

The panel has two tabs:

- Effect. Pick one of the 24 effects and adjust its own settings.
- Adjust. Change exposure, contrast, saturation, warmth, blur and grain. You
  can also zoom, move, rotate and flip the picture inside its card.

You can select several images and apply the same effect to all of them at once.

Effects work on playing video as well as on stills. When you put an effect on a
video, the card shows the effected picture and gets its own play button, scrub
bar and mute button, because the browser's own controls sit behind the effect
and cannot be reached. Pause anywhere and the card keeps showing the effected
frame you stopped on.

## Where your work is stored

The board saves itself to IndexedDB in your browser a moment after each change.
It loads again when you reopen the page. Media files are stored separately from
the board layout, so opening a board does not load every picture at once.

The "Export" button writes the board out as a JSON file.

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

The tests drive a real browser with Playwright, so a server must already be
running.

```bash
npm run dev &
npm run test:ui -- http://localhost:5173
npm run test:sections -- http://localhost:5173
npm run test:menu -- http://localhost:5173
npm run test:search -- http://localhost:5173
npm run test:smoke -- http://localhost:5173
npm run test:video -- http://localhost:5173
npm run test:load -- http://localhost:5173 60
npm run bench
```

- `test:ui` drives every control on the board, which is 43 checks covering the
  toolbar, selection, dragging, resizing, undo, the effects panel, the editor
  and saving. It clears the board's stored data first, so do not point it at a
  browser holding work you want to keep.
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
- `test:video` records a short clip in the page, drops it on the board, applies
  an effect and checks that the picture keeps changing while the video plays.
  It also reloads the page to check the card comes back.
- `test:load` fills a board with images, applies an effect to all of them and
  reports whether the main thread ever blocked.
- `bench` compares the old drawing method with the new one.

## What is in each folder

| Path | What is in it |
| --- | --- |
| `src/engine` | The effects engine, the worker and the job scheduler |
| `src/board` | The board surface, the cards and the pan and zoom code |
| `src/state` | The board contents, undo and redo, and reading dropped files |
| `src/store` | Saving to IndexedDB and to a folder on disk |
| `src/ui` | The effects panel and the small dialogs |
| `test` | Browser tests and the benchmark |
