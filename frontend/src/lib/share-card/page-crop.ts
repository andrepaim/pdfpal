// The picture on Page and Headline cards: the PDF's own pixels, so formulas, figures and scanned pages look right.
// Loads the document itself, so a post opened outside the reader still gets it. The geometry is planCrop's.
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { PageMark, PageRect, ShareCardSource } from '../../../../src/shared/share-card'
import { PDF_OPTIONS, pdfjs } from '../pdf-document'
import { planCrop, readerCrop, runBox, type CropOptions } from './crop-box'

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
 * The page's text runs that read left to right, as page fractions, for snapping an automatic crop to its lines and
 * columns. Empty for a page without a text layer (a scanned page) or when it cannot be read.
 */
async function textRuns(page: PDFPageProxy, base: ReturnType<PDFPageProxy['getViewport']>): Promise<PageRect[]> {
  try {
    const content = await page.getTextContent()
    return content.items.flatMap(item => {
      if (!('str' in item) || !item.str.trim() || !(item.width > 0)) return []
      const [a, b, c, d, e, f] = item.transform as number[]
      const length = Math.hypot(a!, b!) || 1
      const [x0, y0] = base.convertToViewportPoint(e!, f!) as [number, number]
      const [x1, y1] = base.convertToViewportPoint(e! + item.width * a! / length, f! + item.width * b! / length) as [number, number]
      const size = item.height || Math.hypot(c!, d!)
      // Only text that runs left to right on the rendered page.
      if (!(x1 > x0) || Math.abs(y1 - y0) > 0.05 * (x1 - x0) || !(size > 0)) return []
      return [runBox(x0, x1, y0, size, base)]
    })
  } catch {
    return []
  }
}

/**
 * Renders the post's page crop, as large in pixels as the sheet is drawn, with the page's original colours: the
 * reader's `crop` exactly as set, or the automatic one around the post's highlight: at least `extraLines` of context,
 * snapped to the page's lines and text column, and grown to `sheet.fill`. `marks` are every highlight on the page;
 * empty means the post's own. Throws an Error whose message is a PageUnavailable reason.
 */
export async function pageCrop(fileUrl: string | null, source: ShareCardSource, options: PageCropOptions): Promise<PageCrop> {
  if (!fileUrl) throw new Error('no-source' satisfies PageUnavailable)
  let canvas: HTMLCanvasElement, plan: ReturnType<typeof planCrop>
  try {
    const document = await load(fileUrl)
    const page = await document.getPage(source.page)
    const base = page.getViewport({ scale: 1 })
    // The text layer is read only for an automatic crop; a reader's crop is drawn as set.
    const text = readerCrop(options.crop) ? [] : await textRuns(page, base)
    plan = planCrop({ rects: source.rects, color: source.color }, { width: base.width, height: base.height }, options, text)
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
