import { pdfjs } from 'react-pdf'

// Bundle the worker from the same pdfjs-dist version used by react-pdf.
// package.json pins pdfjs-dist to react-pdf's exact version (no "^"): pdfjs
// throws if the API and worker versions differ, and a caret range lets npm
// hoist a newer pdfjs-dist here than the one react-pdf bundles internally,
// silently breaking every render with "Failed to render page".
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

// Module-level constant so react-pdf's loadDocument effect never sees a new
// object reference, preventing spurious document destroy/reload cycles.
export const PDF_OPTIONS = {
  withCredentials: true,
  // PDF.js needs these assets to decode JPEG2000 page images and to load
  // fallback fonts. Vite exposes them at these stable paths in dev and in
  // the production bundle (see vite.config.ts).
  wasmUrl: '/pdfjs/wasm/',
  standardFontDataUrl: '/pdfjs/standard_fonts/',
}

export { pdfjs }
