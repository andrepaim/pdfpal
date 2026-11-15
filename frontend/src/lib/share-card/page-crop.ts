// The Page style's picture: the PDF's own pixels around the highlight, so formulas, figures and scanned pages look
// right. Loads the document itself, so a post opened outside the reader still gets it.
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ShareCardSource } from '../../../../src/shared/share-card'
import { PDF_OPTIONS, pdfjs } from '../pdf-document'
import { fittingCrop, relativeRects } from './crop-box'
import type { CardRenderOptions } from './index'

export type PageCrop = NonNullable<CardRenderOptions['crop']>
/** Why the Page style cannot be offered for a post. */
export type PageUnavailable = 'no-source' | 'no-file' | 'too-tall'
export const PAGE_UNAVAILABLE: Record<PageUnavailable, string> = {
  'no-source': 'The PDF for this post was removed.',
  'no-file': 'The PDF page could not be loaded.',
  'too-tall': 'This highlight is too tall for a Page card.',
}
const MAX_PAGE_PX = 4095

const documents = new Map<string, Promise<PDFDocumentProxy>>()

function load(url: string): Promise<PDFDocumentProxy> {
  let document = documents.get(url)
  if (!document) {
    document = pdfjs.getDocument({ url, ...PDF_OPTIONS }).promise
    document.catch(() => documents.delete(url))
    documents.set(url, document)
    // Keep the two most recent documents open.
    for (const [key, value] of documents) {
      if (documents.size <= 2) break
      if (key !== url) { documents.delete(key); void value.then(doc => doc.destroy()).catch(() => {}) }
    }
  }
  return document
}

/**
 * Renders the crop around the highlight at least as wide in pixels as the sheet, with the page's original colours.
 * Throws an Error whose message is a PageUnavailable reason.
 */
export async function pageCrop(fileUrl: string | null, source: ShareCardSource, sheet: { width: number; height: number }): Promise<PageCrop> {
  if (!fileUrl) throw new Error('no-source' satisfies PageUnavailable)
  let canvas: HTMLCanvasElement, crop: ReturnType<typeof fittingCrop>
  try {
    const document = await load(fileUrl)
    const page = await document.getPage(source.page)
    const base = page.getViewport({ scale: 1 })
    crop = fittingCrop(source.rects, { width: base.width, height: base.height }, sheet)
    if (!crop) throw new Error('too-tall' satisfies PageUnavailable)
    const scale = Math.min(sheet.width / ((crop.x2 - crop.x1) * base.width), MAX_PAGE_PX / Math.max(base.width, base.height))
    const viewport = page.getViewport({ scale, offsetX: -crop.x1 * base.width * scale, offsetY: -crop.y1 * base.height * scale })
    canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((crop.x2 - crop.x1) * base.width * scale))
    canvas.height = Math.max(1, Math.round((crop.y2 - crop.y1) * base.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no-file' satisfies PageUnavailable)
    await page.render({ canvas: null, canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise
  } catch (error) {
    throw new Error((error as Error).message === 'too-tall' ? 'too-tall' : 'no-file')
  }
  return { image: canvas, width: canvas.width, height: canvas.height, rects: relativeRects(source.rects, crop) }
}
