// Share-card rendering in the reader: layout (pure) + bundled fonts + canvas. The same code draws the preview and
// every export. Nothing is drawn by a model. See "The renderer" in docs/share-cards-plan.md.
import type { CardContent, CardSize, ShareCardSource, ShareLook, ShareStyle } from '../../../../src/shared/share-card'
import { drawCard } from './draw'
import { loadCardFonts } from './fonts'
import { layoutCard, pageSheetSpace, type CardLayout, type Measure } from './layout'
import type { PageCrop } from './page-crop'

export { layoutCard, pageSheetSpace, TOO_LONG, type CardLayout, type CardLayoutInput, type DrawCommand, type Measure } from './layout'
export { loadCardFonts } from './fonts'
export { HIGHLIGHT_HEX, palette } from './looks'

export type CardRenderContent = { card: CardContent; source: ShareCardSource }
export type { PageCrop } from './page-crop'
export type CardRenderOptions = {
  style: ShareStyle; look: ShareLook
  /** 'fit' applies to Page; other styles draw it as 'feed'. */
  size: CardSize
  /** The page crop for Page and Headline (pageCrop). Without it they are drawn as Quote and Big idea. */
  crop?: PageCrop
}

let measureContext: CanvasRenderingContext2D | null = null
const widths = new Map<string, number>()

/** Measures with a canvas, as draw.ts draws. Call after loadCardFonts(). */
export function canvasMeasure(): Measure {
  measureContext ??= document.createElement('canvas').getContext('2d')
  const ctx = measureContext
  if (!ctx) throw new Error('This browser cannot draw cards.')
  return (text, font, letterSpacing) => {
    const key = `${font}|${letterSpacing}|${text}`
    let width = widths.get(key)
    if (width === undefined) {
      ctx.font = font
      ctx.letterSpacing = `${letterSpacing}px`
      width = ctx.measureText(text).width
      if (widths.size > 20_000) widths.clear()
      widths.set(key, width)
    }
    return width
  }
}

/** Lays out the card with the bundled fonts loaded. */
export async function cardLayout(content: CardRenderContent, options: CardRenderOptions): Promise<CardLayout> {
  await loadCardFonts()
  const { card, source } = content
  return layoutCard({ card, source, style: options.style, look: options.look, size: options.size,
    crop: options.crop && { width: options.crop.width, height: options.crop.height, marks: options.crop.marks } }, canvasMeasure())
}

/**
 * The room for the sheet on a Page or Headline card of this style, look and size, at the full inner width: pass it to
 * pageCrop as `sheet`. For Fit it is the tallest Fit card's room, so the crop is chosen before the card's height.
 */
export async function cardSheetSpace(content: CardRenderContent, options: Omit<CardRenderOptions, 'crop'>): Promise<{ width: number; height: number }> {
  await loadCardFonts()
  return pageSheetSpace({ card: content.card, source: content.source, style: options.style, look: options.look, size: options.size }, canvasMeasure())
}

/**
 * Draws the card on a new canvas, `layout.height` tall (which varies for Fit). `canvas.dataset.style` names the style
 * drawn (Page falls back to Quote and Headline to Big idea without a crop). Throws Error(TOO_LONG) only for text
 * beyond the contract's limits.
 */
export async function renderCard(content: CardRenderContent, options: CardRenderOptions): Promise<HTMLCanvasElement> {
  const layout = await cardLayout(content, options)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw cards.')
  drawCard(ctx, layout, options.crop?.image)
  canvas.dataset.style = layout.style
  return canvas
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The card image could not be encoded.')), 'image/png'))
}

/** The card as a PNG. */
export async function cardPng(content: CardRenderContent, options: CardRenderOptions): Promise<Blob> {
  return canvasPng(await renderCard(content, options))
}
