/// <reference types="vite/client" />

/* Vite's own module types: `?url` on an import gives back the address of the
 * built file rather than its contents, which is how the PDF worker is handed
 * to pdf.js in src/store/pdf.ts. Without this the compiler has never heard of
 * that suffix and the import is an error. */

/* pdf.js ships a second copy of itself built for browsers that do not have the
 * very newest language features, and that is the one src/store/pdf.ts loads.
 * The package publishes no types for the path, and they would be the same
 * types anyway: it is the same library. */
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist'
}
