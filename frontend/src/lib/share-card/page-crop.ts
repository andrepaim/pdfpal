// The picture on Page and Headline cards: the PDF's own pixels, so formulas, figures and scanned pages look right.
// Loads the document itself, so a post opened outside the reader still gets it. The geometry is planCrop's.
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageMark, PageRect, ShareCardSource } from '../../../../src/shared/share-card'
import { PDF_OPTIONS, pdfjs } from '../pdf-document'
import { planCrop, type CropOptions } from './crop-box'

export type PageCrop = {
  image: CanvasImageSource
  /** The rendered size in pixels. */
  width: number; height: number
  /** The crop drawn, as page fractions. */
  box: PageRect
  /** The highlights inside it, as fractions of the crop. */
  marks: PageMark[]
}
export type PageCropOptions = CropOptions
/** Why the page cannot be shown for a post. */
export type PageUnavailable = 'no-source' | 'no-file' | 'too-tall'
export const PAGE_UNAVAILABLE: Record<PageUnavailable, string> = {
  'no-source': 'The PDF for this post was removed.',
  'no-file': 'The PDF page could not be loaded.',
  'too-tall': 'This highlight is too tall for a Page card.',
}

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
 * Renders the post's page crop, as large in pixels as the sheet is drawn, with the page's original colours: the
 * reader's `crop`, or the automatic one around the post's highlight with up to `extraLines` of context. `marks` are
 * every highlight on the page; empty means the post's own. Throws an Error whose message is a PageUnavailable reason.
 */
export async function pageCrop(fileUrl: string | null, source: ShareCardSource, options: PageCropOptions): Promise<PageCrop> {
  if (!fileUrl) throw new Error('no-source' satisfies PageUnavailable)
  let canvas: HTMLCanvasElement, plan: ReturnType<typeof planCrop>
  try {
    const document = await load(fileUrl)
    const page = await document.getPage(source.page)
    const base = page.getViewport({ scale: 1 })
    plan = planCrop({ rects: source.rects, color: source.color }, { width: base.width, height: base.height }, options)
    if (!plan) throw new Error('too-tall' satisfies PageUnavailable)
    const { box, scale } = plan
    const viewport = page.getViewport({ scale, offsetX: -box.x1 * base.width * scale, offsetY: -box.y1 * base.height * scale })
    canvas = window.document.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no-file' satisfies PageUnavailable)
    await page.render({ canvas: null, canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise
  } catch (error) {
    throw new Error((error as Error).message === 'too-tall' ? 'too-tall' : 'no-file')
  }
  return { image: canvas, width: canvas.width, height: canvas.height, box: plan.box, marks: plan.marks }
}
