import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/* ---------------------------------------------------------------------------
 * The icon and the picture beside the link.
 *
 * Both fail silently. A missing favicon shows a blank page glyph, and a
 * missing og:image shows a link with nothing beside it — neither throws,
 * neither appears in any log, and the place they are seen is somebody else's
 * message window. Renaming a file in public/ would break them for good and
 * nothing else in this repository would notice.
 *
 * So: everything index.html and the manifest point at has to be there, and the
 * social picture has to be the size the scrapers are told it is.
 * ------------------------------------------------------------------------- */

const root = process.cwd()
const html = readFileSync(join(root, 'index.html'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.webmanifest'), 'utf8'))

/* Anything in index.html that names a file at the site root. %SITE_URL% is
 * filled in at build time, so it is stripped back off to get the path. */
const referenced = () => {
  const out = new Set<string>()
  for (const m of html.matchAll(/(?:href|content)="(?:%SITE_URL%)?(\/[^"]*)"/g)) {
    const path = m[1]
    /* The site root itself is not a file. */
    if (path === '/' || path.startsWith('//')) continue
    out.add(path)
  }
  return [...out]
}

/* Width and height out of a PNG's IHDR, which is always the first chunk. */
function pngSize(file: string) {
  const b = readFileSync(file)
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

describe('what index.html points at', () => {
  it('names an icon at all', () => {
    expect(html).toMatch(/rel="icon"[^>]*favicon\.svg/)
    expect(html).toMatch(/rel="icon"[^>]*favicon\.ico/)
    expect(html).toMatch(/rel="apple-touch-icon"/)
    expect(html).toMatch(/rel="manifest"/)
  })

  it('has every file it points at', () => {
    const missing = referenced().filter((p) => !existsSync(join(root, 'public', p)))
    expect(missing).toEqual([])
  })

  /* Named rather than counted: a count passes just as well after somebody
   * deletes the touch icon and adds something else. */
  it('points at exactly the set it should', () => {
    expect(referenced().sort()).toEqual([
      '/apple-touch-icon.png',
      '/favicon.ico',
      '/favicon.svg',
      '/manifest.webmanifest',
      '/og.png',
    ])
  })

  it('gives the link preview an absolute address to fill in', () => {
    expect(html).toContain('property="og:image" content="%SITE_URL%/og.png"')
    expect(html).toContain('property="og:url" content="%SITE_URL%/"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
  })

  it('says what the picture is, for anyone who cannot see it', () => {
    const alt = html.match(/property="og:image:alt"\s*\n?\s*content="([^"]+)"/)
    expect(alt?.[1]?.length ?? 0).toBeGreaterThan(30)
  })

  it('describes itself in both places, and says the same thing', () => {
    const d = html.match(/name="description"\s*\n?\s*content="([^"]+)"/)?.[1] || ''
    const og = html.match(/property="og:description"\s*\n?\s*content="([^"]+)"/)?.[1] || ''
    expect(d.length).toBeGreaterThan(40)
    expect(og.length).toBeGreaterThan(40)
    /* Not identical — the page's is allowed to be longer — but the same claim. */
    expect(d.startsWith(og.slice(0, 40))).toBe(true)
  })
})

describe('the picture beside the link', () => {
  it('is the size the tags promise', () => {
    const size = pngSize(join(root, 'public/og.png'))
    expect(size).toEqual({ w: 1200, h: 630 })
    expect(html).toContain('content="1200"')
    expect(html).toContain('content="630"')
  })

  it('is small enough to be fetched by a preview bot', () => {
    /* Several of them give up past a megabyte. */
    expect(statSync(join(root, 'public/og.png')).size).toBeLessThan(1024 * 1024)
  })
})

describe('the icons themselves', () => {
  it('are the sizes they claim to be', () => {
    expect(pngSize(join(root, 'public/icon-192.png'))).toEqual({ w: 192, h: 192 })
    expect(pngSize(join(root, 'public/icon-512.png'))).toEqual({ w: 512, h: 512 })
    expect(pngSize(join(root, 'public/icon-maskable-512.png'))).toEqual({ w: 512, h: 512 })
    expect(pngSize(join(root, 'public/apple-touch-icon.png'))).toEqual({ w: 180, h: 180 })
  })

  it('the .ico really holds three sizes', () => {
    const b = readFileSync(join(root, 'public/favicon.ico'))
    expect(b.readUInt16LE(0)).toBe(0)
    expect(b.readUInt16LE(2)).toBe(1)
    const count = b.readUInt16LE(4)
    expect(count).toBe(3)
    const sizes = Array.from({ length: count }, (_, i) => b.readUInt8(6 + i * 16))
    expect(sizes.sort((x, y) => x - y)).toEqual([16, 32, 48])
  })

  it('the SVG carries the mark and the brand colour, and names itself', () => {
    const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8')
    expect(svg).toContain('#ff5a1f')
    expect(svg).toContain('<title>Ideation Board</title>')
    /* The halftone: the solid half plus the dots it breaks into. */
    expect(svg.match(/<circle/g)?.length ?? 0).toBeGreaterThan(10)
  })

  it('the manifest points at icons that exist, including a maskable one', () => {
    const missing = manifest.icons
      .map((i: { src: string }) => i.src)
      .filter((src: string) => !existsSync(join(root, 'public', src)))
    expect(missing).toEqual([])
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
    expect(manifest.theme_color).toBe('#ff5a1f')
  })
})
