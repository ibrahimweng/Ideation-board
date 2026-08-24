/* Renders an SVG to PNGs at whatever sizes are asked for, using the browser
 * that is already a dependency of the test suite rather than adding an image
 * library for six files.
 *
 *   node brand/render.mjs public/favicon.svg '[16,32,48]' 'brand/icon-SIZE.png'
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
const svg = fs.readFileSync(process.argv[2], 'utf8')
const sizes = JSON.parse(process.argv[3])
const out = process.argv[4]
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] })
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 })
  await page.setContent(`<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`)
  await page.waitForTimeout(120)
  fs.writeFileSync(out.replace('SIZE', String(s)), await page.screenshot({ omitBackground: true }))
  await page.close()
}
await browser.close()
console.log('rendered', sizes.join(' '))
