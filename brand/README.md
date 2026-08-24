# The mark

A disc that breaks into halftone.

Halftone is the first effect in the panel and the one the engine was built to
do well, and a dot is already what the app puts in its corner — so the mark is
the product's own signature rather than a shape picked to look like a logo.

It has to survive two things. At sixteen pixels a tab strip gets four hundred
times less of it than an app icon does, so the solid half carries the whole
reading and the dots only soften one edge. And the composition is not the
circle: the dots have mass too, so the whole thing is measured and centred
rather than the disc being centred and the dots left to trail off one side.

| | |
| --- | --- |
| Accent | `#ff5a1f` — the same one the interface uses for selection |
| Ground | `#0b0b0d` on the social card, `#0d0d0f` on a dark board |
| Type | Instrument Sans, 600 |

## Rebuilding it

Everything in `public/` is generated. Nothing here is hand-drawn, so a change
to `build.py` is a change to every size at once.

```bash
python3 brand/build.py                                     # the SVGs
node brand/render.mjs public/favicon.svg '[16,32,48,180,192,512]' 'brand/icon-SIZE.png'
node brand/render.mjs brand/maskable.svg '[512]' 'brand/maskable-SIZE.png'
node brand/render.mjs brand/apple.svg '[180]' 'brand/apple-SIZE.png'
# then copy the sizes into public/, and pack 16/32/48 into favicon.ico
```

The PNGs are rendered by the same browser the test suite already drives, rather
than adding an image library for six files.

`brand/og.mjs` builds the social card from `brand/board-shot.png`, which is a
real screenshot of the app rather than a mockup of it — a card that is only a
logo tells you nothing the URL did not.

`test/unit/brand.test.ts` checks that everything `index.html` and the manifest
point at is actually there, and that the card is the size the tags promise.
Both of these fail silently in the wild: a missing icon is a blank page glyph
and a missing card is a link with nothing beside it, and neither appears in any
log.
