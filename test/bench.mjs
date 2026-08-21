/* Runs test/bench.html and prints the comparison. */
import { chromium } from 'playwright'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const N = process.env.N || 40
const SRC = process.env.SRC || 1400
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.error('[pageerror]', e.message))
const url = pathToFileURL(path.resolve('test/bench.html')).href + `?n=${N}&src=${SRC}`
await page.goto(url)
await page.waitForFunction(() => window.__bench, null, { timeout: 120000 })
console.log(JSON.stringify(await page.evaluate(() => window.__bench), null, 2))
await browser.close()
