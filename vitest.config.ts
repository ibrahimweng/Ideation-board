import { defineConfig } from 'vitest/config'

/* ---------------------------------------------------------------------------
 * The fast tests.
 *
 * Everything in test/*.mjs drives a real browser, which is the only honest way
 * to check that a drag lands where it should — and it means the whole suite
 * needs a server, a GPU stand-in and several minutes. Nothing was checking the
 * arithmetic underneath: how a picture is cropped to a card, what a note's
 * markup parses to, which colours come out of an image, where a dragged card
 * snaps to. Those are pure functions, and pure functions deserve tests that
 * run in a second.
 *
 * Node rather than a fake DOM on purpose: if a test here needs a document, the
 * thing it is testing belongs in the browser suite instead.
 * ------------------------------------------------------------------------- */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    reporters: 'dot',
  },
})
