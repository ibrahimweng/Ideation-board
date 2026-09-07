/* ---------------------------------------------------------------------------
 * A page of a PDF, as pixels.
 *
 * A PDF used to arrive as a grey card with three letters on it and a Download
 * link. That is the wrong answer on a board whose whole subject is looking at
 * things: reference decks are PDFs, type specimens are PDFs, and a brand
 * direction is largely made of them. A card that cannot show its own contents
 * is a filename with a rectangle around it.
 *
 * So a PDF card is a picture of a page, and the file itself is kept beside it.
 * That follows the shape a video card already has — `media` is the file,
 * `poster` is what you look at — which means everything downstream works with
 * no special case: the page goes to the graphics card, takes the thirty one
 * effects, exports, and gives up its colours to the palette.
 *
 * ## Why the library is loaded late
 *
 * Reading PDF is not a small job and pdf.js is not a small library. Most
 * boards never hold one, so it is behind a dynamic import and costs nothing at
 * all until the first PDF is dropped. Vite splits it into its own chunk, the
 * service worker caches that chunk with the rest of the build, and a PDF
 * dropped on a plane still renders.
 * ------------------------------------------------------------------------- */

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'

/* Matches DECODE_CAP in media.ts, and for the same reason: nothing on the
 * board is ever drawn above 1536 pixels, so a page rendered larger is memory
 * and upload time spent on detail nobody samples. */
const PAGE_CAP = 1600

/* Where the sixteen fallback fonts are served from. A PDF that names Helvetica
 * rather than embedding it needs these, or its text renders as nothing at all.
 * They are copied out of the package at build time by the plugin in
 * vite.config.ts, and they are on this origin because the whole point of this
 * app is that nothing it holds goes anywhere else. */
const FONTS = '/pdf-fonts/'

/* Set `window.__pdfTrace = true` before dropping a document to see why one
 * would not open. Reading a PDF fails for ordinary reasons — encrypted,
 * damaged, not really a PDF — and the answer to all of them is the same quiet
 * card, so the reason is thrown away rather than shown. That is right for
 * somebody using the app and useless for anybody working on it. */
const TRACE = () => (globalThis as unknown as { __pdfTrace?: boolean }).__pdfTrace === true

type Pdfjs = typeof import('pdfjs-dist')

let loading: Promise<Pdfjs> | null = null

async function library(): Promise<Pdfjs> {
  if (!loading) {
    loading = (async () => {
      /* The legacy build, deliberately.
       *
       * The modern one calls Map.prototype.getOrInsertComputed, which is new
       * enough that a browser from last year does not have it — and the
       * failure is a TypeError deep inside a render, which arrives here as a
       * document that would not open for no stated reason. The legacy build is
       * the same library with the polyfills for that kind of thing already in
       * it. It costs about 70KB more and it means a PDF opens on whatever
       * browser somebody actually has, which is the trade this app should be
       * making every time. */
      const lib = await import('pdfjs-dist/legacy/build/pdf.min.mjs')
      /* The worker is asked for by URL rather than imported, because it is a
       * worker: Vite gives back the address of the built file and pdf.js
       * starts it itself. It has to be the legacy worker too, or the polyfills
       * are only on one side of the wire. */
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })()
  }
  return loading
}

/* The document last opened, kept so that turning a page does not read and
 * parse the whole file again. One is enough: paging happens inside a document,
 * and holding several would mean holding several parsed PDFs in memory for no
 * reason anybody asked for. */
let openDoc: { key: string; task: PDFDocumentLoadingTask; doc: PDFDocumentProxy } | null = null

/* Closing is done through the loading task rather than the document: the task
 * is what owns the worker, and letting go of the document alone would leave it
 * running. */
function close() {
  if (!openDoc) return
  const { task } = openDoc
  openDoc = null
  void task.destroy().catch(() => {})
}

async function documentFor(key: string, file: Blob): Promise<PDFDocumentProxy> {
  if (openDoc?.key === key) return openDoc.doc
  const lib = await library()
  const data = new Uint8Array(await file.arrayBuffer())
  const task = lib.getDocument({ data, standardFontDataUrl: FONTS })
  const doc = await task.promise
  /* Let the old one go before holding the new one, or a session that walks
   * through several files keeps every one of them parsed. */
  close()
  openDoc = { key, task, doc }
  return doc
}

/* Called when a PDF card goes away, so its parsed document does not outlive
 * the thing that wanted it. */
export function forgetPdf(key: string) {
  if (openDoc?.key === key) close()
}

export interface RenderedPage {
  blob: Blob
  w: number
  h: number
  /* How many pages the document has, so a card can say "3 of 12" without
   * opening it a second time to count. */
  pages: number
}

/* One page, drawn. Page numbers are one-based, the way they are printed on the
 * page and the way pdf.js counts them.
 *
 * Returns null rather than throwing on anything that is not really a PDF, or
 * is encrypted, or is damaged. The caller's answer to that is a card with the
 * file on it and no picture, which is where PDFs were before this file
 * existed — a worse card, not a broken board. */
export async function renderPdfPage(
  key: string,
  file: Blob,
  page = 1,
  cap = PAGE_CAP
): Promise<RenderedPage | null> {
  try {
    const doc = await documentFor(key, file)
    const pages = doc.numPages
    const n = Math.min(Math.max(1, Math.round(page)), pages)
    const p = await doc.getPage(n)

    /* Rendered at whatever scale brings the long edge up to the cap, so a
     * small page is drawn sharp rather than at its own modest size and a large
     * one is not drawn at poster resolution to be shown at card size. */
    const base = p.getViewport({ scale: 1 })
    const long = Math.max(base.width, base.height)
    const scale = long > 0 ? Math.min(4, cap / long) : 1
    const viewport = p.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    /* A PDF page is transparent where nothing is drawn, and a transparent card
     * over a dark board shows the board through the margins of the page. Paper
     * is white. */
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    await p.render({ canvas, canvasContext: ctx, viewport }).promise
    p.cleanup()

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/webp', 0.9)
    )
    if (!blob) return null
    return { blob, w: canvas.width, h: canvas.height, pages }
  } catch (e) {
    if (TRACE()) console.error('[pdf] could not render page', page, 'of', key, e)
    return null
  }
}

/* Whether a file is worth handing to any of the above. The type is what a
 * browser reports for a real PDF; the extension is the fallback for a file
 * dragged out of somewhere that reported nothing. */
export const isPdf = (mime: string, name = '') =>
  mime === 'application/pdf' || /\.pdf$/i.test(name)
