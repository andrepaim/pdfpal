// Carousel slides: one post made from several highlights, drawn as 1080 × 1350 slides with the layout engine's own
// parts. See "Stage 3" in docs/share-posts-plan.md. The cover and the text slides are headline cards without a pull
// quote (the Big idea style); a point slide is the Headline style: its claim above that highlight's page crop.
// slideInput and layoutSlide are pure (tested in Node); renderSlide and slideSheetSpace draw with the bundled fonts.
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

/** The longest text each kind holds, in characters: SET's limits, and CARD.headlineMax for the cover. */
export const SLIDE_LIMITS = { cover: 80, study: 160, takeaway: 140, limitations: 160, point: 70 } as const

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
  /** A point slide's page crop (pageCrop with itemSource). Without it the claim is drawn as Big idea. */
  crop?: PageCrop
}

/** A slide's words: the cover's and a point's headline, the other kinds' text. */
export const slideText = (slide: SlideSpec) => slide.kind === 'cover' || slide.kind === 'point' ? slide.headline : slide.text

/**
 * The card a slide is drawn as. Cover and text slides: the Big idea style with the words as its headline and no pull
 * quote. Point slides: the Headline style. The kicker is the slide's own; the strip carries the number and count.
 * Only a point slide's credit has a page: its item's.
 */
export function slideInput(slide: SlideSpec, context: SlideContext, options: Omit<SlideOptions, 'crop'> & { crop?: { width: number; height: number; marks: PageCrop['marks'] } }): CardLayoutInput {
  const point = slide.kind === 'point'
  const page = point ? context.items?.[slide.item]?.page ?? context.source.page : 0
  return {
    card: { quote: '', emphasis: '', headline: slideText(slide), pull: '', topic: '', takeawaysTitle: '', takeaways: [] },
    source: { title: context.source.title, credit: context.source.credit, page, color: context.source.color },
    style: point ? 'headline' : 'idea',
    look: options.look,
    size: 'feed',
    crop: point && options.crop ? { width: options.crop.width, height: options.crop.height, marks: options.crop.marks } : undefined,
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

/** The room for a point slide's crop under its claim: pass it to pageCrop as `sheet`. */
export async function slideSheetSpace(slide: SlideSpec, context: SlideContext, options: Pick<SlideOptions, 'look'>): Promise<SheetRoom> {
  await loadCardFonts()
  const input = slideInput(slide, context, options)
  return pageSheetSpace({ ...input, style: 'headline' }, canvasMeasure())
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
