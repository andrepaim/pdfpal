// /dev/share-cards: the share-card sample matrix, for review and the browser test (frontend/e2e/share-cards.spec.ts).
// Hidden: loaded lazily and linked from nowhere. Every card is drawn, encoded as a PNG and shown as an image, so
// the page holds a hundred-odd small blobs instead of as many full-size canvases.
//
// Page and Headline frames (data-frame) crop a made-up paper page drawn here, through the same planCrop that
// pageCrop uses for a PDF, with the page's lines given as text runs as pdf.js gives them. Slides (data-slide) do the
// same for the Carousel style's page slide (automatic, short and tall crops, and its fallback), a paper carousel's
// lead, and each point of a carousel of several highlights. Text cards (data-sample) are the first build's matrix, unchanged.
import { useEffect, useState } from 'react'
import { LOOKS, type CardSize, type PageMark, type PageRect, type ShareLook, type ShareStyle } from '../../../src/shared/share-card'
import { canvasPng, cardSheetSpace, loadCardFonts, renderCard, type PageCrop } from '../lib/share-card'
import { boundingBox, planCrop, runBox, type CropPlan } from '../lib/share-card/crop-box'
import { CAROUSEL_MAX, CAROUSEL_SHORT, DECK_LIMITS, DECK_PAPER, DECK_PAPER_PLAIN, DECK_POST, DECK_POST_PLAIN, DECK_SET, DECK_SET_PLAIN, OTHERS_ON_PAGE, PAGE_FRAMES, PAPER_CAROUSEL, PAPER_CAROUSEL_FIVE, POST_CAROUSEL, SAMPLE_PAGE, SAMPLES, type CarouselSample, type DeckSample, type PageFrame } from '../lib/share-card/samples'
import { renderSlide, slideSheetSpace, type SlideContext, type SlideSpec } from '../lib/share-card/slides'

type Result = { kind: 'frame' | 'slide' | 'sample'; name: string; url?: string; size?: string; error?: string }
const STYLES: ShareStyle[] = ['quote', 'idea', 'takeaways']
const SIZES: CardSize[] = ['feed', 'story']
/** Canvas pixels per PDF point for the made-up page: sharp at any crop the frames use. */
const PAGE_SCALE = 4

type Word = { text: string; x: number; width: number; baseline: number; size: number }

type SamplePage = { canvas: HTMLCanvasElement; find: (phrase: string) => PageRect[]; runs: PageRect[] }
/** Gap between the columns of the two-column page, in points. */
const GUTTER = 18

/**
 * Draws SAMPLE_PAGE as a PDF page would render: white, black type, justified body text, in one column or two (the
 * first two sections on the left). Lines that would pass the bottom margin are left out. `runs` are its lines as
 * pdf.js gives text runs, one per line.
 */
function drawSamplePage(columns: 1 | 2): SamplePage {
  const { width, height, margin } = SAMPLE_PAGE
  const canvas = document.createElement('canvas')
  canvas.width = width * PAGE_SCALE; canvas.height = height * PAGE_SCALE
  const ctx = canvas.getContext('2d')!
  ctx.scale(PAGE_SCALE, PAGE_SCALE)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height)
  ctx.textBaseline = 'alphabetic'
  const paragraphs: Array<{ words: Word[]; font: string }> = []
  const runs: PageRect[] = []
  let y: number = margin, left: number = margin, column = width - 2 * margin

  /** Lays out `text` in the column; justified unless `ragged`. Returns its words. */
  const block = (text: string, font: string, size: number, leading: number, color: string, ragged: boolean): Word[] => {
    ctx.font = font; ctx.fillStyle = color
    const space = ctx.measureText(' ').width
    const tokens = text.split(/\s+/u).map(word => ({ text: word, width: ctx.measureText(word).width }))
    const lines: Array<typeof tokens> = []
    let line: typeof tokens = [], used = 0
    for (const token of tokens) {
      if (line.length && used + space + token.width > column) { lines.push(line); line = []; used = 0 }
      used += (line.length ? space : 0) + token.width; line.push(token)
    }
    if (line.length) lines.push(line)
    const words: Word[] = []
    lines.forEach((items, index) => {
      const baseline = y + size
      y += leading
      if (baseline > height - margin) return
      const last = index === lines.length - 1
      const natural = items.reduce((sum, item) => sum + item.width, 0)
      const gap = !ragged && !last && items.length > 1 ? (column - natural) / (items.length - 1) : space
      let x = left
      for (const item of items) {
        ctx.fillText(item.text, x, baseline)
        words.push({ text: item.text, x, width: item.width, baseline, size })
        x += item.width + gap
      }
      runs.push(runBox(left, x - gap, baseline, size, SAMPLE_PAGE))
    })
    return words
  }

  block(SAMPLE_PAGE.journal, '400 8px "Inter"', 8, 11, '#555555', true)
  y += 18
  block(SAMPLE_PAGE.title, '700 18px "Inter"', 18, 22, '#000000', true)
  y += 10
  block(SAMPLE_PAGE.authors, '400 11px "Newsreader"', 11, 14, '#000000', true)
  block(SAMPLE_PAGE.affiliations, 'italic 400 8.5px "Newsreader"', 8.5, 12, '#333333', true)
  const body = '400 10px "Newsreader"'
  const top = y
  if (columns === 2) column = (width - 2 * margin - GUTTER) / 2
  SAMPLE_PAGE.sections.forEach((section, index) => {
    if (columns === 2 && index === 2) { y = top; left = margin + column + GUTTER }
    y += 14
    block(section.heading, '600 10.5px "Inter"', 10.5, 15, '#000000', true)
    y += 2
    paragraphs.push({ words: block(section.text, body, 10, 13.2, '#111111', false), font: body })
  })

  /** The phrase's boxes, one per line, as page fractions. */
  const find = (phrase: string): PageRect[] => {
    const wanted = phrase.split(/\s+/u)
    for (const { words, font } of paragraphs) for (let start = 0; start + wanted.length <= words.length; start++) {
      const run = words.slice(start, start + wanted.length)
      // A phrase may end before a word's punctuation ("better:").
      if (!run.every((word, index) => index === run.length - 1 ? word.text.startsWith(wanted[index]!) : word.text === wanted[index])) continue
      ctx.font = font
      const rects: PageRect[] = []
      for (const word of run) {
        const right = word.x + (word === run.at(-1) ? ctx.measureText(wanted.at(-1)!).width : word.width)
        const top = word.baseline - 0.82 * word.size, bottom = word.baseline + 0.26 * word.size
        const current = rects.at(-1)
        if (current && Math.abs(current.y1 * height - top) < 0.5) current.x2 = right / width
        else rects.push({ x1: word.x / width, y1: top / height, x2: right / width, y2: bottom / height })
      }
      return rects
    }
    throw new Error(`The sample page has no "${phrase}".`)
  }
  return { canvas, find, runs }
}

/** A frame's page crop, cut from the made-up page as pageCrop renders a PDF page. */
async function frameCrop(frame: PageFrame, look: ShareLook, page: SamplePage) {
  const marks: PageMark[] = frame.marks.map(mark => ({ rects: page.find(mark.phrase), color: mark.color }))
  const own = marks[0]!
  const source = { ...frame.source, rects: own.rects, color: own.color }
  const sheet = await cardSheetSpace({ card: frame.card, source }, { style: frame.style, look, size: frame.size })
  const plan = planCrop(own, SAMPLE_PAGE, { sheet, crop: frame.crop, marks, extraLines: frame.extraLines }, frame.crop ? [] : page.runs)
  return { source, crop: cut(page, plan) }
}

/** The planned crop cut from the made-up page, as pageCrop renders it from a PDF page. */
function cut(page: SamplePage, plan: CropPlan | null): PageCrop {
  if (!plan) throw new Error('too-tall')
  const image = document.createElement('canvas')
  image.width = plan.width; image.height = plan.height
  const ctx = image.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  const { box } = plan, w = page.canvas.width, h = page.canvas.height
  ctx.drawImage(page.canvas, box.x1 * w, box.y1 * h, (box.x2 - box.x1) * w, (box.y2 - box.y1) * h, 0, 0, plan.width, plan.height)
  return { image, width: plan.width, height: plan.height, box: plan.box, marks: plan.marks }
}

/** A carousel's slide context: the strip's fields, its items (all on the made-up page's page 1) and the numbering. */
const carouselContext = (carousel: CarouselSample, index: number): SlideContext => ({
  source: { ...carousel.source, color: 'yellow' }, items: carousel.items.map(item => ({ page: 1, rects: [], color: item.mark.color })),
  number: index + 1, count: carousel.slides.length,
})

/** The Carousel style's page slide: the post's own highlight and every other one on the made-up page, cropped. */
async function postPageCrop(slide: SlideSpec, context: SlideContext, look: ShareLook, page: SamplePage, crop: PageRect | 'tight' | null): Promise<PageCrop> {
  const rects = page.find(POST_CAROUSEL.mark.phrase)
  const marks = [POST_CAROUSEL.mark, ...OTHERS_ON_PAGE].map(mark => ({ rects: page.find(mark.phrase), color: mark.color }))
  const sheet = await slideSheetSpace(slide, context, { look })
  const box = boundingBox(rects)
  const reader = crop === 'tight' ? { x1: 0.09, y1: box.y1 - 0.0016, x2: 0.91, y2: box.y2 + 0.0016 } : crop
  return cut(page, planCrop({ rects, color: POST_CAROUSEL.mark.color }, SAMPLE_PAGE, { sheet, crop: reader, marks, extraLines: 3 }, reader ? [] : page.runs))
}

/**
 * A deck's picture slide: a page or lead slide crops around the post's own highlight (the lead to the title, authors
 * and abstract), a point slide around its item; every highlight on the page is drawn.
 */
async function deckCrop(deck: DeckSample, slide: SlideSpec, context: SlideContext, look: ShareLook, page: SamplePage): Promise<PageCrop> {
  const own = slide.kind === 'point' ? deck.items[slide.item]! : deck.items[0]!
  const rects = page.find(own.phrase)
  const marks = [POST_CAROUSEL.mark, ...OTHERS_ON_PAGE].map(mark => ({ rects: page.find(mark.phrase), color: mark.color }))
  const sheet = await slideSheetSpace(slide, context, { look })
  const crop = slide.kind === 'lead' ? PAPER_CAROUSEL.crop : null
  return cut(page, planCrop({ rects, color: own.color }, SAMPLE_PAGE, { sheet, crop, marks, extraLines: 3 }, crop ? [] : page.runs))
}

/** A point slide's crop: its highlight on the made-up page, with every highlight of the set as marks. */
async function slideCrop(carousel: CarouselSample, slide: Extract<SlideSpec, { kind: 'point' }>, context: SlideContext, look: ShareLook, page: SamplePage): Promise<PageCrop> {
  const item = carousel.items[slide.item]!
  const rects = page.find(item.mark.phrase)
  const marks = carousel.items.map(other => ({ rects: page.find(other.mark.phrase), color: other.mark.color }))
  const sheet = await slideSheetSpace(slide, context, { look })
  // 'tight': just the highlight's lines across the column, its edges halfway into the gaps to the next lines.
  const box = boundingBox(rects)
  const crop = item.crop === 'tight' ? { x1: 0.09, y1: box.y1 - 0.0016, x2: 0.91, y2: box.y2 + 0.0016 } : item.crop
  return cut(page, planCrop({ rects, color: item.mark.color }, SAMPLE_PAGE, { sheet, crop, marks, extraLines: 3 }, crop ? [] : page.runs))
}

export default function ShareCardSamples() {
  const [results, setResults] = useState<Result[]>([])
  const [done, setDone] = useState(false)
  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    const show = async (kind: Result['kind'], name: string, draw: () => Promise<HTMLCanvasElement>) => {
      let result: Result
      try {
        const canvas = await draw()
        const size = `${canvas.width}×${canvas.height}`
        const url = URL.createObjectURL(await canvasPng(canvas))
        canvas.width = 0
        urls.push(url)
        result = { kind, name, url, size }
      } catch (error) { result = { kind, name, error: error instanceof Error ? error.message : String(error) } }
      if (!cancelled) setResults(previous => [...previous, result])
    }
    void (async () => {
      await loadCardFonts()
      const pages = { 1: drawSamplePage(1), 2: drawSamplePage(2) }
      for (const frame of PAGE_FRAMES) for (const look of LOOKS as readonly ShareLook[]) {
        if (cancelled) return
        await show('frame', `${frame.name}-${look}`, async () => {
          const { source, crop } = await frameCrop(frame, look, pages[frame.columns ?? 1])
          const canvas = await renderCard({ card: frame.card, source }, { style: frame.style, look, size: frame.size, crop })
          if (canvas.dataset.style !== frame.style) throw new Error(`Drawn as ${canvas.dataset.style}.`)
          return canvas
        })
      }
      // Decks: a highlight post, a set and a paper, each with its numbers and without any, in every look; the limit
      // cases in Ink.
      const decks: Array<[DeckSample, readonly ShareLook[]]> = [[DECK_POST, LOOKS], [DECK_SET, LOOKS], [DECK_PAPER, LOOKS], [DECK_POST_PLAIN, LOOKS], [DECK_SET_PLAIN, LOOKS], [DECK_PAPER_PLAIN, LOOKS],
        [{ name: 'deck-limits', slides: DECK_LIMITS, source: { ...PAPER_CAROUSEL.source }, items: [POST_CAROUSEL.mark] }, ['ink']]]
      for (const [deck, looks] of decks) for (const look of looks) for (const [index, slide] of deck.slides.entries()) {
        if (cancelled) return
        await show('slide', `${deck.name}-${look}-${index + 1}-${slide.kind}`, async () => {
          const context: SlideContext = { source: { ...deck.source, color: 'yellow' }, number: index + 1, count: deck.slides.length,
            items: deck.items.map(item => ({ page: 1, rects: [], color: item.color })) }
          const crop = ['page', 'point', 'lead'].includes(slide.kind) ? await deckCrop(deck, slide, context, look, pages[1]) : undefined
          return renderSlide(slide, context, { look, crop })
        })
      }
      // A paper carousel in every look (six slides) and the five-slide one in Ink; the lead also without its crop.
      for (const [carousel, looks] of [[PAPER_CAROUSEL, LOOKS], [PAPER_CAROUSEL_FIVE, ['ink']]] as const) for (const look of looks as readonly ShareLook[]) {
        type Variant = { slide: SlideSpec; index: number; crop: boolean; label: string }
        const variants = carousel.slides.flatMap((slide, index): Variant[] => slide.kind === 'lead' && carousel === PAPER_CAROUSEL
          ? [{ slide, index, crop: true, label: 'lead' }, { slide, index, crop: false, label: 'lead-cover' }]
          : [{ slide, index, crop: slide.kind === 'lead', label: slide.kind }])
        for (const { slide, index, crop: withCrop, label } of variants) {
          if (cancelled) return
          await show('slide', `${carousel.name}-${look}-${index + 1}-${label}`, async () => {
            const context: SlideContext = { source: { ...carousel.source, color: 'yellow' }, number: index + 1, count: carousel.slides.length }
            let crop: PageCrop | undefined
            if (withCrop) {
              const rects = pages[1].find(POST_CAROUSEL.mark.phrase)
              const marks = [POST_CAROUSEL.mark, ...OTHERS_ON_PAGE].map(mark => ({ rects: pages[1].find(mark.phrase), color: mark.color }))
              const sheet = await slideSheetSpace(slide, context, { look })
              crop = cut(pages[1], planCrop({ rects, color: POST_CAROUSEL.mark.color }, SAMPLE_PAGE, { sheet, crop: carousel.crop, marks, extraLines: 3 }))
            }
            const canvas = await renderSlide(slide, context, { look, crop })
            const expected = slide.kind === 'lead' && crop ? 'headline' : 'idea'
            if (canvas.dataset.style !== expected) throw new Error(`Drawn as ${canvas.dataset.style}.`)
            return canvas
          })
        }
      }
      // The Carousel style's three cards in every look: the page slide automatic, short, tall, and as its fallback.
      for (const look of LOOKS as readonly ShareLook[]) {
        type Variant = { slide: SlideSpec; index: number; variant: string }
        const variants = POST_CAROUSEL.slides.flatMap((slide, index): Variant[] => slide.kind === 'page'
          ? ['auto', 'short', 'tall', 'fallback'].map(variant => ({ slide, index, variant }))
          : [{ slide, index, variant: slide.kind }])
        for (const { slide, index, variant } of variants) {
          if (cancelled) return
          await show('slide', `${POST_CAROUSEL.name}-${look}-${index + 1}-${variant}`, async () => {
            const context: SlideContext = { source: { ...POST_CAROUSEL.source, color: 'yellow' }, number: index + 1, count: POST_CAROUSEL.slides.length }
            const crop = slide.kind === 'page' && variant !== 'fallback' ? await postPageCrop(slide, context, look, pages[1], POST_CAROUSEL.crops[variant as 'auto' | 'short' | 'tall']) : undefined
            const canvas = await renderSlide(slide, context, { look, crop })
            const expected = slide.kind === 'page' ? (crop ? 'page' : 'quote') : 'idea'
            if (canvas.dataset.style !== expected) throw new Error(`Drawn as ${canvas.dataset.style}.`)
            return canvas
          })
        }
      }
      // The longest texts in every look; the short ones in Ink.
      for (const [carousel, looks] of [[CAROUSEL_MAX, LOOKS], [CAROUSEL_SHORT, ['ink']]] as const) for (const look of looks as readonly ShareLook[])
        for (const [index, slide] of carousel.slides.entries()) {
          if (cancelled) return
          await show('slide', `${carousel.name}-${look}-${String(index + 1).padStart(2, '0')}-${slide.kind}`, async () => {
            const context = carouselContext(carousel, index)
            const crop = slide.kind === 'point' ? await slideCrop(carousel, slide, context, look, pages[1]) : undefined
            const canvas = await renderSlide(slide, context, { look, crop })
            if (canvas.dataset.style !== (slide.kind === 'point' ? 'headline' : 'idea')) throw new Error(`Drawn as ${canvas.dataset.style}.`)
            return canvas
          })
        }
      for (const sample of SAMPLES) for (const style of STYLES) for (const look of LOOKS as readonly ShareLook[]) for (const size of SIZES) {
        if (cancelled) return
        await show('sample', `${sample.name}-${style}-${look}-${size}`, () => renderCard({ card: sample.card, source: sample.source }, { style, look, size }))
      }
      if (!cancelled) setDone(true)
    })()
    return () => { cancelled = true; urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [])
  const section = (kind: Result['kind'], title: string) => {
    const items = results.filter(result => result.kind === kind)
    return (
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{title} ({items.length})</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {items.map(result => {
            // The browser test counts data-sample; the frames are marked apart so its count still holds.
            const attributes = kind === 'frame' ? { 'data-frame': result.name } : kind === 'slide' ? { 'data-slide': result.name } : { 'data-sample': result.name }
            return (
              <figure key={result.name} {...attributes} data-fits={result.url ? 'true' : 'false'} style={{ margin: 0, width: 216 }}>
                {result.url ? <img src={result.url} alt={result.name} style={{ width: 216, display: 'block', borderRadius: 4 }} />
                  : <div role="alert" style={{ width: 216, height: 270, background: '#511', padding: 8 }}>{result.error}</div>}
                <figcaption style={{ fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>{result.name}{result.size ? ` · ${result.size}` : ''}</figcaption>
              </figure>
            )
          })}
        </div>
      </section>
    )
  }
  return (
    <main style={{ padding: 24, background: '#202024', minHeight: '100vh', color: '#eee', fontFamily: 'system-ui, sans-serif' }} data-samples-done={done ? 'true' : undefined}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>Share card samples ({results.length}{done ? '' : '…'})</h1>
      {section('frame', 'Page and Headline')}
      {section('slide', 'Carousel slides')}
      {section('sample', 'Text cards')}
    </main>
  )
}
