import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/* ---------------------------------------------------------------------------
 * The address the site is served from.
 *
 * A link preview is fetched by a machine with no page to resolve a relative
 * path against, so og:image has to be a full URL. Hard coding one means it is
 * wrong in every preview deploy and wrong again the day the domain changes, so
 * this asks the build environment instead. Vercel puts the real domain there.
 *
 * Empty in development, where the relative paths beside these tags are what a
 * browser wants anyway and nothing is fetching a preview.
 * ------------------------------------------------------------------------- */
function siteUrl(): string {
  const env = process.env
  const raw =
    /* Set this to pin a domain of your own. */
    env.SITE_URL ||
    /* The stable production domain, whichever deploy is being built. */
    env.VERCEL_PROJECT_PRODUCTION_URL ||
    /* Falls back to this exact deploy, so a preview previews itself. */
    env.VERCEL_URL ||
    ''
  if (!raw) return ''
  const trimmed = raw.replace(/\/+$/, '')
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

/* Fills %SITE_URL% in index.html. Vite's own %VITE_*% substitution only reads
 * .env files, and the value wanted here is one the host supplies. */
function siteMeta(): Plugin {
  return {
    name: 'ideation-site-meta',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.split('%SITE_URL%').join(siteUrl()),
    },
  }
}

/* ---------------------------------------------------------------------------
 * The fonts pdf.js falls back on.
 *
 * A PDF that names Helvetica rather than embedding it needs the real outlines
 * from somewhere, and without them its text renders as nothing at all — a page
 * of shapes with the words missing, which is a worse answer than not showing
 * the page. pdfjs-dist ships sixteen files for exactly this.
 *
 * Copied out of the package rather than committed, because they belong to that
 * package and would go stale the moment it was updated. Served from this
 * origin rather than from a CDN, because the one thing this app promises is
 * that nothing it holds goes anywhere else.
 * ------------------------------------------------------------------------- */
function pdfFonts(): Plugin {
  const from = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts')
  const at = '/pdf-fonts/'
  return {
    name: 'ideation-pdf-fonts',
    /* In development there is no dist to copy into, so they are served
       straight out of the package. */
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (!url.startsWith(at)) return next()
        /* Only ever a bare file name from that one directory. */
        const name = path.basename(decodeURIComponent(url.slice(at.length)))
        const file = path.join(from, name)
        if (!name || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', 'font/otf')
        fs.createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      const out = path.join(options.dir || 'dist', 'pdf-fonts')
      if (!fs.existsSync(from)) return
      fs.mkdirSync(out, { recursive: true })
      for (const name of fs.readdirSync(from)) {
        fs.copyFileSync(path.join(from, name), path.join(out, name))
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), siteMeta(), pdfFonts()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
})
