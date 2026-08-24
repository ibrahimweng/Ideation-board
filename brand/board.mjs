/* The board shot the social card is built from.
 *
 * Made by driving the real app: the pictures are dropped in, the ASCII effect
 * is put on them from the panel, and the colours are pulled out of one. The
 * card therefore shows the product doing the thing it is for, rather than a
 * mockup of it — and if any of that breaks, this stops producing a picture.
 *
 *   node brand/board.mjs http://localhost:4173
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:4173'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  indexedDB.deleteDatabase('ideation.board.db')
  localStorage.clear()
  localStorage.setItem('ideation.theme', 'dark')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1300)

const drop = async (file, at) => {
  const b64 = fs.readFileSync(file).toString('base64')
  await page.evaluate(
    async ({ b64, name, at }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], name, { type: 'image/png' }))
      const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
      Object.defineProperty(ev, 'dataTransfer', { value: dt })
      document.querySelector('.viewport').dispatchEvent(ev)
    },
    { b64, name: file.split('/').pop(), at }
  )
  await page.waitForTimeout(700)
}

await drop('brand/src-a.png', { x: 60, y: 100 })
await drop('brand/src-b.png', { x: 500, y: 100 })
await drop('brand/src-c.png', { x: 820, y: 100 })
await page.waitForTimeout(700)

const grip = (n) =>
  page.evaluate((k) => {
    const c = [...document.querySelectorAll('.card[data-kind="image"]')][k]
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.x + 60), y: Math.round(r.y + 20) }
  }, n)

/* The whole point: everything wears the ASCII screen. */
await page.keyboard.press('Escape')
await page.evaluate(() => document.activeElement?.blur?.())
await page.keyboard.press('Control+a')
await page.waitForTimeout(500)
await page.locator('.fx-thumb[title="ASCII"]').click()
await page.waitForTimeout(4200)

/* And one of them gives up its colours, so the card shows that too. */
const one = await grip(0)
await page.mouse.click(one.x, one.y)
await page.waitForTimeout(400)
await page.mouse.click(one.x, one.y, { button: 'right' })
await page.waitForTimeout(400)
await page.locator('.menu button', { hasText: 'Pull the colours out' }).click()
await page.waitForTimeout(1800)

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.evaluate(() => document.activeElement?.blur?.())
await page.mouse.move(6, 780)
await page.waitForTimeout(800)
fs.writeFileSync('brand/board-shot.png', await page.screenshot())
await browser.close()
console.log('board shot')
