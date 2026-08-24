/* Builds public/og.png, the picture that appears beside the link.
 *
 *   node brand/board.mjs http://localhost:4173   (the shot it is built from)
 *   node brand/og.mjs
 *
 * No gradients anywhere in it. Where a card like this would normally put a
 * soft glow behind the title and a soft fade at the edge, this puts a halftone
 * screen — coverage rather than opacity — which is the method the app itself
 * is about and the reason the pictures on the board are screened into ASCII.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const shot = fs.readFileSync('brand/board-shot.png').toString('base64')
const icon = fs.readFileSync('public/favicon.svg', 'utf8')

/* A screen: dots on a square grid whose coverage falls from one edge. Written
 * out here rather than imported, so this script stands on its own. */
const screen = ({ w, h, from = 'left', cell = 5, max = 0.5, bias = 1.5, ink = '#ff5a1f' }) => {
  const dots = []
  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const t = from === 'left' ? c / cols : from === 'right' ? 1 - c / cols : r / rows
      const cov = Math.max(0, Math.min(1, (1 - t) ** bias)) * max
      const rad = cell * 0.7 * Math.sqrt(cov)
      if (rad < 0.25) continue
      const x = (c + 0.5) * cell + (r % 2 ? cell / 2 : 0)
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${((r + 0.5) * cell).toFixed(1)}" r="${rad.toFixed(2)}"/>`)
    }
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><g fill='${ink}'>${dots.join('')}</g></svg>`
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23').replace(/"/g, "'")}")`
}

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
  /* A screened bar down the left edge, the way a proof sheet carries one.
     Not behind the words: a field of dots under text is a field of dots
     between you and the text. */
  .screen {
    position: absolute; left: 0; top: 0; width: 34px; height: 630px;
    background-image: ${screen({ w: 34, h: 630, from: 'left', cell: 5, max: 0.85, bias: 2.4 })};
  }
  .text {
    position: absolute; left: 68px; top: 0; bottom: 0; width: 500px; z-index: 2;
    display: flex; flex-direction: column; justify-content: center; gap: 22px;
  }
  .top { display: flex; align-items: center; gap: 16px; }
  .top svg { width: 56px; height: 56px; }
  h1 { font-size: 52px; font-weight: 600; color: #fff; letter-spacing: -0.022em; line-height: 1; }
  p { font-size: 24px; line-height: 1.45; color: rgba(255,255,255,0.74); }
  .tags { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 2px; }
  .tags span {
    font-size: 16px; color: rgba(255,255,255,0.8);
    border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; padding: 6px 14px;
  }
  /* The app itself, bleeding off the right edge so the card reads as a window
     onto something bigger than the card. */
  .panel {
    position: absolute; left: 600px; top: 66px; width: 760px; height: 498px;
    border-radius: 16px; overflow: hidden;
    border: 1px solid rgba(255,255,255,0.15);
    box-shadow: 0 40px 90px rgba(0,0,0,0.75);
    background: #0d0d0f;
  }
  .panel img { width: 1180px; height: auto; display: block; margin: 0 0 0 -18px; }
  /* The edge is screened back into the ground rather than faded into it. */
  .edge {
    position: absolute; right: 0; top: 0; bottom: 0; width: 150px; z-index: 3;
    background-color: transparent;
    background-image: ${screen({ w: 150, h: 630, from: 'right', cell: 4, max: 1, bias: 1.25, ink: '#0b0b0d' })};
  }
</style>
<div class="screen"></div>
<div class="panel"><img src="data:image/png;base64,${shot}"></div>
<div class="edge"></div>
<div class="text">
  <div class="top">${icon}<h1>Ideation Board</h1></div>
  <p>Drop pictures on a board and put thirty one GPU effects on them. Everything stays on your machine.</p>
  <div class="tags"><span>31 effects</span><span>Saved looks</span><span>Nothing uploaded</span></div>
</div>`)
await page.waitForTimeout(2200)
fs.writeFileSync('public/og.png', await page.screenshot({ type: 'png' }))
await browser.close()
console.log('og.png', (fs.statSync('public/og.png').size / 1024).toFixed(0), 'kB')
