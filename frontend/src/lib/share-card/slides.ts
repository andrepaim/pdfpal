// Carousel slides, drawn as 1080 × 1350 slides with the layout engine's own parts: a post made from several
// highlights ("Stage 3" in docs/share-posts-plan.md) and the Carousel style's three cards for one highlight
// ("Stage 4"). The cover and the text slides are headline cards without a pull quote (the Big idea style); a point
// slide is the Headline style, its claim above that highlight's page crop; a page slide is the Page style, the post's
// own crop under the kicker, or its fallback text when there is no crop. slideInput, layoutSlide and slideSpace are
// pure (tested in Node); renderSlide and slideSheetSpace draw with the bundled fonts.
import { collapse, type HighlightColor, type PageRect, type ShareCardSource, type ShareLook } from '../../../../src/shared/share-card'
import type { SheetRoom } from './crop-box'
import { drawCard } from './draw'
import { loadCardFonts } from './fonts'
import { canvasMeasure } from './index'
import { layoutCard, pageSheetSpace, TOO_LONG, type CardLayout, type CardLayoutInput, type DeckBlock, type Measure } from './layout'
import type { PageCrop } from './page-crop'

/** A number with its unit as the paper writes it ("312", "24 hours", "41%"), and what it counts. */
export type Stat = { value: string; label: string }
/** One row of a comparison: what is compared, and its value in the measure all rows share. */
export type Row = { label: string; value: string }

/**
 * One slide; structurally the same as SlideSpec in src/shared/share-card.ts. The numbers (`stat`, `stats`, `rows`)
 * are optional here so a slide from a post stored before them draws as before: missing means none.
 */
export type SlideSpec =
  | { kind: 'cover'; kicker: string; headline: string; stat?: Stat | null }
  | { kind: 'study'; kicker: string; text: string; stats?: Stat[] }
  | { kind: 'takeaway' | 'limitations'; kicker: string; text: string }
  | { kind: 'point'; kicker: string; headline: string; item: number }
  | { kind: 'page'; kicker: string; fallback: string }
  | { kind: 'lead'; kicker: string; headline: string; fallback: string }
  | { kind: 'question'; kicker: string; text: string }
  | { kind: 'method'; kicker: string; text: string; stats?: Stat[] }
  | { kind: 'result'; kicker: string; text: string; item?: number; stat?: Stat | null; rows?: Row[] }

/**
 * The longest text each kind holds, in characters: SET's limits, CARD.headlineMax for the cover and a paper's lead,
 * CARD.quoteMax for a page slide's fallback (the quote, or the headline when there is none), and PAPER's limits.
 */
export const SLIDE_LIMITS = { cover: 80, study: 160, takeaway: 140, limitations: 160, point: 70, page: 240, lead: 80, question: 160, method: 160, result: 140 } as const

/**
 * The number a result's text starts with, with its sign and unit ("41%", "2x", "−0.4 points", "1,204"), or ''. A
 * result slide draws it in the look's emphasis box, so the eye finds the finding first.
 */
export function leadingNumber(text: string): string {
  return /^[<>~≈±+\-−]?\s?[$€£]?\d(?:[\d.,]*\d)?(?:\s?%|×|x(?![a-z])|-fold|\s(?:times|percent|percentage points?|points?|pp)(?![a-z]))?/iu.exec(text.trim())?.[0] ?? ''
}

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

const filled = (stat: Stat | null | undefined): stat is Stat => !!stat && !!collapse(stat.value)

/**
 * The rows' values as fractions of the largest, for bars from a common zero; null unless every value is one
 * non-negative number with the same unit ("41%", "1,204", "12.5 GB"): no ranges, signs, bounds or approximations, and
 * a largest value above zero. Bars are drawn only when they can be honest.
 */
export function comparable(rows: Row[]): number[] | null {
  const parsed = rows.map(row => {
    const value = collapse(row.value)
    if (/[<>~≈±–—]|^[-−+]|\d\s*-\s*\d/u.test(value)) return null
    const match = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(\D*)$/u.exec(value)
    if (!match) return null
    return { number: Number(match[1]!.replace(/,/gu, '') + (match[2] ?? '')), unit: match[3]!.trim().toLowerCase() }
  })
  if (parsed.length < 2 || parsed.some(item => !item || !Number.isFinite(item.number))) return null
  const units = new Set(parsed.map(item => item!.unit)), largest = Math.max(...parsed.map(item => item!.number))
  if (units.size !== 1 || !(largest > 0)) return null
  return parsed.map(item => item!.number / largest)
}

/**
 * The layout a slide's content asks for; undefined for the slides that show the page (page, point, lead). Numbers
 * lead when there are any: tiles for a method or study with stats, a comparison table for a result with two or more
 * rows, the number very large for a result or cover with a key number. A cover whose headline already holds its
 * number boxes it in the headline instead of saying it twice at two sizes. Without numbers: the cover as a hook,
 * the question with its mark, the takeaway with its bar, and the study, method, result and limits as statements.
 */
export function deckBlock(slide: SlideSpec): DeckBlock | undefined {
  switch (slide.kind) {
    case 'point': case 'page': case 'lead': return undefined
    case 'cover': {
      if (!filled(slide.stat)) return { kind: 'text', text: slide.headline }
      const value = collapse(slide.stat.value)
      return collapse(slide.headline).includes(value) ? { kind: 'text', text: slide.headline, emphasis: value }
        : { kind: 'number', stat: slide.stat, text: slide.headline, headline: true }
    }
    case 'study': case 'method': {
      const stats = (slide.stats ?? []).filter(filled)
      return stats.length ? { kind: 'stats', stats: stats.slice(0, 4), text: slide.text } : { kind: 'text', text: slide.text, statement: true }
    }
    case 'question': return { kind: 'question', text: slide.text }
    case 'takeaway': return { kind: 'takeaway', text: slide.text }
    case 'limitations': return { kind: 'text', text: slide.text, statement: true }
    case 'result': {
      const rows = (slide.rows ?? []).filter(row => collapse(row.label) && collapse(row.value)).slice(0, 4)
      if (rows.length >= 2) {
        const key = filled(slide.stat) ? collapse(slide.stat.value) : ''
        const marked = Math.max(0, rows.findIndex(row => key && collapse(row.value) === key))
        return { kind: 'table', text: slide.text, rows, marked, bars: comparable(rows) }
      }
      if (filled(slide.stat)) return { kind: 'number', stat: slide.stat, text: slide.text, headline: false }
      return { kind: 'text', text: slide.text, emphasis: leadingNumber(slide.text) || undefined, statement: true }
    }
  }
}

/** A slide's words: the cover's, a point's and a lead's headline, a page slide's fallback, the other kinds' text. */
export const slideText = (slide: SlideSpec) =>
  slide.kind === 'cover' || slide.kind === 'point' || slide.kind === 'lead' ? slide.headline : slide.kind === 'page' ? slide.fallback : slide.text

/**
 * The card a slide is drawn as. Cover and text slides (study, takeaway, limitations, question, method, result): the
 * Big idea style with the words as its headline and no pull quote; a result boxes the number it starts with. Point
 * and lead slides: the Headline style, which without a crop is Big idea; a lead then takes its fallback as the pull
 * quote when it differs from the headline (layoutSlide leaves it out when it does not fit). Page slides: the Page
 * style, which without a crop is the Quote style drawing the fallback, with the kicker in place of the quotation
 * mark. The kicker is the slide's own; the strip carries the number and count. Only point, page and lead slides
 * credit a page: the item's, or the post's.
 */
export function slideInput(slide: SlideSpec, context: SlideContext, options: Omit<SlideOptions, 'crop'> & { crop?: { width: number; height: number; marks: PageCrop['marks'] } }): CardLayoutInput {
  const point = slide.kind === 'point', own = slide.kind === 'page' || slide.kind === 'lead', sheet = point || own
  const page = point ? context.items?.[slide.item]?.page ?? context.source.page : own ? context.source.page : 0
  const pull = slide.kind === 'lead' && !options.crop && collapse(slide.fallback) !== collapse(slide.headline) ? slide.fallback : ''
  return {
    card: { quote: slideText(slide), emphasis: '', headline: slideText(slide), pull, topic: '', takeawaysTitle: '', takeaways: [] },
    source: { title: context.source.title, credit: context.source.credit, page, color: context.source.color },
    style: point || slide.kind === 'lead' ? 'headline' : slide.kind === 'page' ? 'page' : 'idea',
    deck: deckBlock(slide),
    look: options.look,
    size: 'feed',
    crop: sheet && options.crop ? { width: options.crop.width, height: options.crop.height, marks: options.crop.marks } : undefined,
    kicker: slide.kicker,
    slide: { number: context.number, count: context.count },
  }
}

/**
 * Lays out a slide (pure). A point or lead slide without a crop is laid out as Big idea; `style` says so. A lead's
 * pull quote that does not fit is left out.
 */
export function layoutSlide(slide: SlideSpec, context: SlideContext, options: Parameters<typeof slideInput>[2], measure: Measure): CardLayout {
  const input = slideInput(slide, context, options)
  if (!input.card.pull) return layoutCard(input, measure)
  try { return layoutCard(input, measure) } catch (error) {
    if ((error as Error).message !== TOO_LONG) throw error
    return layoutCard({ ...input, card: { ...input.card, pull: '' } }, measure)
  }
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
