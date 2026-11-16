// Carousel slides, drawn as 1080 × 1350 slides with the layout engine's own parts: a post made from several
// highlights ("Stage 3" in docs/share-posts-plan.md) and the Carousel style's three cards for one highlight
// ("Stage 4"). The cover and the text slides are headline cards without a pull quote (the Big idea style); a point
// slide is the Headline style, its claim above that highlight's page crop; a page slide is the Page style, the post's
// own crop under the kicker, or its fallback text when there is no crop. slideInput, layoutSlide and slideSpace are
// pure (tested in Node); renderSlide and slideSheetSpace draw with the bundled fonts.
import type { HighlightColor, PageRect, ShareCardSource, ShareLook } from '../../../../src/shared/share-card'
import type { SheetRoom } from './crop-box'
import { drawCard } from './draw'
import { loadCardFonts } from './fonts'
import { canvasMeasure } from './index'
import { layoutCard, pageSheetSpace, type CardLayout, type CardLayoutInput, type Measure } from './layout'
import type { PageCrop } from './page-crop'

/** One slide; structurally the same as SlideSpec in src/shared/share-card.ts, which setSlides() returns. */
export type SlideSpec =
  | { kind: 'cover'; kicker: string; headline: string }
  | { kind: 'study' | 'takeaway' | 'limitations'; kicker: string; text: string }
  | { kind: 'point'; kicker: string; headline: string; item: number }
  | { kind: 'page'; kicker: string; fallback: string }

/**
 * The longest text each kind holds, in characters: SET's limits, CARD.headlineMax for the cover, and CARD.quoteMax
 * for a page slide's fallback (the quote, or the headline when there is none).
 */
export const SLIDE_LIMITS = { cover: 80, study: 160, takeaway: 140, limitations: 160, point: 70, page: 240 } as const

/** What a point slide needs of its highlight: the page it is on, its boxes and colour. A SetItem has these. */
export type SlideItem = { page: number; rects: PageRect[]; color: HighlightColor }

/** The post, as every slide of it shares: the credit strip's fields, the highlights, and the slide's place. */
export type SlideContext = {
  /** The title and credit in the strip; `color` is the Marker look's ground for every slide. */
  source: Pick<ShareCardSource, 'title' | 'credit' | 'page' | 'color'>
  /** The set's highlights, in order; a point slide credits its item's page. Without them it credits source.page. */
  items?: SlideItem[]
  /** 1-based. */
  number: number
  count: number
}

/** How to draw the slide, as CardRenderOptions does for a card. */
export type SlideOptions = {
  look: ShareLook
  /**
   * The page crop of a point slide (pageCrop with itemSource) or a page slide (pageCrop with the post's own source).
   * Without it a point's claim is drawn as Big idea and a page slide's fallback as text under its kicker.
   */
  crop?: PageCrop
}

/** A slide's words: the cover's and a point's headline, a page slide's fallback, the other kinds' text. */
export const slideText = (slide: SlideSpec) => slide.kind === 'cover' || slide.kind === 'point' ? slide.headline : slide.kind === 'page' ? slide.fallback : slide.text

/**
 * The card a slide is drawn as. Cover and text slides: the Big idea style with the words as its headline and no pull
 * quote. Point slides: the Headline style. Page slides: the Page style, which without a crop is the Quote style
 * drawing the fallback, with the kicker in place of the quotation mark. The kicker is the slide's own; the strip
 * carries the number and count. Only point and page slides credit a page: the item's, or the post's.
 */
export function slideInput(slide: SlideSpec, context: SlideContext, options: Omit<SlideOptions, 'crop'> & { crop?: { width: number; height: number; marks: PageCrop['marks'] } }): CardLayoutInput {
  const point = slide.kind === 'point', sheet = point || slide.kind === 'page'
  const page = point ? context.items?.[slide.item]?.page ?? context.source.page : slide.kind === 'page' ? context.source.page : 0
  return {
    card: { quote: slideText(slide), emphasis: '', headline: slideText(slide), pull: '', topic: '', takeawaysTitle: '', takeaways: [] },
    source: { title: context.source.title, credit: context.source.credit, page, color: context.source.color },
    style: point ? 'headline' : slide.kind === 'page' ? 'page' : 'idea',
    look: options.look,
    size: 'feed',
    crop: sheet && options.crop ? { width: options.crop.width, height: options.crop.height, marks: options.crop.marks } : undefined,
    kicker: slide.kicker,
    slide: { number: context.number, count: context.count },
  }
}

/** Lays out a slide (pure). A point slide without a crop is laid out as Big idea; `style` says so. */
export function layoutSlide(slide: SlideSpec, context: SlideContext, options: Parameters<typeof slideInput>[2], measure: Measure): CardLayout {
  return layoutCard(slideInput(slide, context, options), measure)
}

/**
 * One highlight of a set as the source pageCrop takes: the post's source with that item's page, boxes and colour.
 * pageCrop(fileUrl, itemSource(source, item), { sheet: await slideSheetSpace(...), crop, marks, extraLines: 3 }).
 */
export function itemSource<T extends ShareCardSource>(source: T, item: SlideItem): T {
  return { ...source, page: item.page, rects: item.rects, color: item.color, region: null }
}

/**
 * The room for a point slide's crop under its claim, or a page slide's under its kicker, with how far an automatic
 * crop grows to fill it (pure). Other kinds have no crop; they get a point slide's room.
 */
export function slideSpace(slide: SlideSpec, context: SlideContext, options: Pick<SlideOptions, 'look'>, measure: Measure): SheetRoom {
  const input = slideInput(slide, context, options)
  return pageSheetSpace({ ...input, style: slide.kind === 'page' ? 'page' : 'headline' }, measure)
}

/** slideSpace with the bundled fonts: pass it to pageCrop as `sheet`. */
export async function slideSheetSpace(slide: SlideSpec, context: SlideContext, options: Pick<SlideOptions, 'look'>): Promise<SheetRoom> {
  await loadCardFonts()
  return slideSpace(slide, context, options, canvasMeasure())
}

/** Draws a slide on a new 1080 × 1350 canvas; `canvas.dataset.style` names the style drawn. */
export async function renderSlide(slide: SlideSpec, context: SlideContext, options: SlideOptions): Promise<HTMLCanvasElement> {
  await loadCardFonts()
  const layout = layoutSlide(slide, context, options, canvasMeasure())
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw cards.')
  drawCard(ctx, layout, options.crop?.image)
  canvas.dataset.style = layout.style
  return canvas
}
