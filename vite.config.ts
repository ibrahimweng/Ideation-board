import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react(), siteMeta()],
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
