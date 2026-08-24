/* Builds public/og.png, the picture that appears beside the link.
 *
 *   node brand/og.mjs        (needs brand/board-shot.png)
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

/* The picture that goes beside the link.
 *
 * A card that is only a logo tells you nothing the URL did not. This one shows
 * the app: a board of photographs, one of them screened into halftone, and the
 * colours pulled out of another sitting underneath as swatches. Whoever sees
 * the link in a message can tell what it is without opening it. */
const shot = fs.readFileSync('brand/board-shot.png').toString('base64')
const icon = fs.readFileSync('public/favicon.svg', 'utf8')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(`
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden; position: relative;
    font-family: 'Instrument Sans', system-ui, sans-serif;
    background: #0b0b0d;
  }
  /* A little of the accent bled into the ground, so the card is not a black
     rectangle in a feed of black rectangles. */
  .glow {
    position: absolute; left: -220px; top: -260px; width: 900px; height: 900px;
    background: radial-gradient(circle, rgba(255,90,31,0.20), rgba(255,90,31,0) 62%);
  }
  .text {
    position: absolute; left: 68px; top: 0; bottom: 0; width: 500px; z-index: 2;
    display: flex; flex-direction: column; justify-content: center; gap: 22px;
  }
  .top { display: flex; align-items: center; gap: 16px; }
  .top svg { width: 56px; height: 56px; }
  h1 { font-size: 52px; font-weight: 600; color: #fff; letter-spacing: -0.022em; line-height: 1; }
  p { font-size: 24px; line-height: 1.45; color: rgba(255,255,255,0.72); }
  .tags { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 2px; }
  .tags span {
    font-size: 16px; color: rgba(255,255,255,0.78);
    border: 1px solid rgba(255,255,255,0.20); border-radius: 999px; padding: 6px 14px;
  }
  /* The app itself, bleeding off the right edge so the card reads as a window
     onto something bigger than the card. */
  .panel {
    position: absolute; left: 600px; top: 66px; width: 760px; height: 498px;
    border-radius: 16px; overflow: hidden;
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 40px 90px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.5);
    background: #0d0d0f;
  }
  .panel img { width: 1180px; height: auto; display: block; margin: 0 0 0 -18px; }
  /* Fades into the ground rather than stopping at a hard edge. */
  .fade {
    position: absolute; right: 0; top: 0; bottom: 0; width: 120px; z-index: 3;
    background: linear-gradient(to left, rgba(11,11,13,0.9), rgba(11,11,13,0));
  }
</style>
<div class="glow"></div>
<div class="panel"><img src="data:image/png;base64,${shot}"></div>
<div class="fade"></div>
<div class="text">
  <div class="top">${icon}<h1>Ideation Board</h1></div>
  <p>Drop pictures on a board and put thirty one GPU effects on them. Everything stays on your machine.</p>
  <div class="tags"><span>31 effects</span><span>Saved looks</span><span>Nothing uploaded</span></div>
</div>`)
await page.waitForTimeout(2200)
fs.writeFileSync('public/og.png', await page.screenshot({ type: 'png' }))
await browser.close()
console.log('og.png', (fs.statSync('public/og.png').size / 1024).toFixed(0), 'kB')
