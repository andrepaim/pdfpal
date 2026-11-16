import test from 'node:test'
import assert from 'node:assert/strict'
import { LOOKS, type PageMark, type ShareCardSource } from '../../src/shared/share-card.js'
import { layoutCard, pageSheetSpace, MIN_TEXT_PX, type Box, type CardLayout, type ImageCommand, type Measure, type TextCommand } from '../../frontend/src/lib/share-card/layout.js'
import { itemSource, layoutSlide, SLIDE_LIMITS, slideInput, slideSpace, type SlideContext, type SlideSpec } from '../../frontend/src/lib/share-card/slides.js'
import { CAROUSEL_MAX, CAROUSEL_SHORT, LONG_CREDIT, LONG_TITLE, POST_CAROUSEL, SAMPLES, longEnglish } from '../../frontend/src/lib/share-card/samples.js'

// The same stand-in for canvas measurement as share-card-layout.test.ts.
const measure: Measure = (text, font, letterSpacing) => {
  const match = /^(italic )?(\d+) ([\d.]+)px "(Inter|Newsreader)"/.exec(font)
  assert.ok(match, `unexpected font ${font}`)
  const [, italic, weight, size, family] = match
  const factor = (family === 'Newsreader' ? 0.9 : 1) * (italic ? 0.92 : 1) * (Number(weight) >= 700 ? 1.08 : Number(weight) >= 600 ? 1.04 : 1)
  let width = 0
  for (const c of Array.from(text)) width += (/[MWmw@]/.test(c) ? 0.85 : /[il.,;:'’!|]/.test(c) ? 0.3 : c === ' ' ? 0.28 : /[A-Z]/.test(c) ? 0.66 : 0.55) * Number(size) * factor + letterSpacing
  return width
}
const texts = (layout: CardLayout) => layout.commands.filter((c): c is TextCommand => c.kind === 'text')
const imageOf = (layout: CardLayout) => layout.commands.find((c): c is ImageCommand => c.kind === 'image')
const disjoint = (a: Box, b: Box) => a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1
const MARKS: PageMark[] = [{ color: 'green', rects: [{ x1: 0.05, y1: 0.4, x2: 0.9, y2: 0.5 }] }]
const CROPS = { short: { width: 900, height: 90, marks: MARKS }, tall: { width: 700, height: 1800, marks: MARKS } }
const source = { title: LONG_TITLE, credit: LONG_CREDIT, page: 4, color: 'blue' as const }
const items = [{ page: 7, rects: [], color: 'pink' as const }, { page: 9, rects: [], color: 'green' as const }, { page: 12, rects: [], color: 'yellow' as const }]
const context = (number: number, count: number): SlideContext => ({ source, items, number, count })

/** Text in the safe area, never under 28 px, nothing over the strip, and the strip's four parts apart. */
function assertSlideFits(layout: CardLayout, name: string) {
  assert.equal(layout.width, 1080); assert.equal(layout.height, 1350)
  const { safe } = layout
  for (const text of texts(layout)) {
    assert.ok(text.size >= MIN_TEXT_PX - 1e-9, `${name}: ${text.role} "${text.text}" is ${text.size} px`)
    const { x1, y1, x2, y2 } = text.box
    assert.ok(x1 >= safe.x1 - 0.5 && x2 <= safe.x2 + 0.5 && y1 >= safe.y1 - 0.5 && y2 <= safe.y2 + 0.5, `${name}: ${text.role} "${text.text}" leaves the safe area`)
  }
  const strip = texts(layout).filter(t => ['footerTitle', 'footerCredit', 'wordmark', 'slideNumber'].includes(t.role))
  for (const a of strip) for (const b of strip) if (a !== b) assert.ok(disjoint(a.box, b.box), `${name}: ${a.role} meets ${b.role}`)
  const stripTop = Math.min(...strip.map(t => t.box.y1))
  const main = texts(layout).filter(t => !strip.includes(t))
  for (const text of main) assert.ok(text.box.y2 <= stripTop, `${name}: ${text.role} "${text.text}" overlaps the strip`)
  const image = imageOf(layout)
  if (image) {
    assert.ok(image.y + image.height <= stripTop && image.x >= safe.x1 - 1e-6 && image.x + image.width <= safe.x2 + 1e-6, `${name}: the sheet leaves its room`)
    for (const text of main) assert.ok(text.box.y2 <= image.y, `${name}: ${text.role} overlaps the sheet`)
  }
}

test('the sample carousels hold every slide kind, the longest at the contract\'s limits', () => {
  const kinds = new Set(CAROUSEL_MAX.slides.map(slide => slide.kind))
  assert.deepEqual([...kinds].sort(), ['cover', 'limitations', 'point', 'study', 'takeaway'])
  for (const slide of CAROUSEL_MAX.slides) {
    const text = slide.kind === 'cover' || slide.kind === 'point' ? slide.headline : slide.text
    assert.equal(text.length, SLIDE_LIMITS[slide.kind], `${slide.kind}: ${text}`)
  }
  assert.deepEqual(SLIDE_LIMITS, { cover: 80, study: 160, takeaway: 140, limitations: 160, point: 70, page: 240 })
})

test('every slide fits in every look, at the longest texts and with short and tall crops, numbered up to 12 / 12', () => {
  let count = 0
  for (const carousel of [CAROUSEL_MAX, CAROUSEL_SHORT]) for (const look of LOOKS) for (const [index, slide] of carousel.slides.entries()) {
    for (const crop of slide.kind === 'point' ? [CROPS.short, CROPS.tall] : [undefined]) for (const [number, total] of [[index + 1, carousel.slides.length], [12, 12]] as const) {
      const name = `${carousel.name}/${look}/${slide.kind}${crop ? `/${crop.height}` : ''}/${number}`
      const layout = layoutSlide(slide, context(number, total), { look, crop }, measure)
      count++
      assertSlideFits(layout, name)
      assert.equal(layout.style, slide.kind === 'point' ? 'headline' : 'idea', name)
      assert.equal(texts(layout).find(t => t.role === 'slideNumber')?.text, `${number} / ${total}`, name)
      assert.equal(texts(layout).some(t => t.role === 'pull'), false, name)
      const kicker = texts(layout).find(t => t.role === 'kicker')
      assert.equal(kicker?.text, slide.kicker.toUpperCase(), name)
      const words = texts(layout).filter(t => t.role === 'headline').map(t => t.text).join(' ')
      assert.equal(words, (slide.kind === 'cover' || slide.kind === 'point' ? slide.headline : slide.text).replace(/'/g, '’'), name)
    }
  }
  assert.equal(count, 2 * 3 * (4 * 2 + 3 * 2 * 2))
})

test('a point slide is a claim above its crop, and Big idea without one', () => {
  const slide = CAROUSEL_MAX.slides.find(s => s.kind === 'point')!
  for (const look of LOOKS) {
    const layout = layoutSlide(slide, context(3, 7), { look, crop: CROPS.short }, measure)
    const image = imageOf(layout)!
    assert.deepEqual(image.marks.map(m => m.rects), [MARKS[0]!.rects])
    const without = layoutSlide(slide, context(3, 7), { look }, measure)
    assert.equal(without.style, 'idea'); assert.equal(imageOf(without), undefined)
  }
})

test('a point slide credits its own page; the other slides credit the paper without a page', () => {
  const credit = (slide: SlideSpec) => texts(layoutSlide(slide, { source: { ...source, credit: 'Moreau et al., 2025' }, items, number: 1, count: 7 }, { look: 'ink' }, measure)).find(t => t.role === 'footerCredit')!.text
  for (const slide of CAROUSEL_SHORT.slides) {
    if (slide.kind === 'point') assert.equal(credit(slide), `Moreau et al., 2025 · p. ${items[slide.item]!.page}`)
    else assert.equal(credit(slide), 'Moreau et al., 2025')
  }
  // Without the items, a point slide credits the post's page.
  const point = CAROUSEL_SHORT.slides.find(s => s.kind === 'point')!
  assert.equal(texts(layoutSlide(point, { source: { ...source, credit: 'X' }, number: 1, count: 2 }, { look: 'ink' }, measure)).find(t => t.role === 'footerCredit')!.text, 'X · p. 4')
})

test('the slide number sits in the strip, right-aligned with the wordmark, in every look', () => {
  for (const look of LOOKS) {
    const layout = layoutSlide(CAROUSEL_MAX.slides[0]!, context(3, 7), { look }, measure)
    const number = texts(layout).find(t => t.role === 'slideNumber')!, mark = texts(layout).find(t => t.role === 'wordmark')!
    assert.ok(Math.abs(number.box.x2 - mark.box.x2) < 1, `${look}: ${number.box.x2} vs ${mark.box.x2}`)
    assert.ok(number.box.y2 <= mark.box.y1)
  }
})

test('the kicker may be other than the topic, and cards without the new inputs are unchanged', () => {
  const sample = SAMPLES[0]!
  const plain = layoutCard({ card: sample.card, source: sample.source, style: 'idea', look: 'paper', size: 'feed' }, measure)
  const same = layoutCard({ card: sample.card, source: sample.source, style: 'idea', look: 'paper', size: 'feed', kicker: sample.card.topic }, measure)
  assert.deepEqual(same.commands, plain.commands)
  const other = layoutCard({ card: sample.card, source: sample.source, style: 'idea', look: 'paper', size: 'feed', kicker: 'The study' }, measure)
  assert.equal(texts(other).find(t => t.role === 'kicker')!.text, 'THE STUDY')
  const none = layoutCard({ card: sample.card, source: sample.source, style: 'idea', look: 'paper', size: 'feed', kicker: '' }, measure)
  assert.equal(texts(none).some(t => t.role === 'kicker'), false)
  assert.equal(texts(plain).some(t => t.role === 'slideNumber'), false)
})

test('slideInput is a headline card: the slide\'s words, its kicker, no pull quote', () => {
  const input = slideInput({ kind: 'takeaway', kicker: 'The takeaway', text: 'Fewer, specific comments.' }, context(6, 7), { look: 'marker' })
  assert.equal(input.style, 'idea'); assert.equal(input.size, 'feed'); assert.equal(input.card.headline, 'Fewer, specific comments.')
  assert.equal(input.card.pull, ''); assert.equal(input.kicker, 'The takeaway'); assert.deepEqual(input.slide, { number: 6, count: 7 })
  // Every slide keeps the post's colour, so a Marker carousel has one ground.
  assert.equal(slideInput({ kind: 'point', kicker: 'T', headline: 'C', item: 0 }, context(3, 7), { look: 'marker' }).source.color, 'blue')
})

test('one item of a set becomes a source for pageCrop: its page, boxes and colour', () => {
  const post: ShareCardSource = { version: 1, kind: 'highlight', passage: 'p', page: 2, rects: [], color: 'yellow', region: null, context: '', title: 'T', credit: 'C', url: '' }
  const rects = [{ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.25 }]
  const one = itemSource(post, { page: 9, rects, color: 'green' })
  assert.deepEqual(one, { ...post, page: 9, rects, color: 'green', region: null })
  assert.equal(post.page, 2)
})

// ── Three cards for one highlight (stage 4) ─────────────────────────────────────────────────────────────────────────
const page = (fallback: string): SlideSpec => ({ kind: 'page', kicker: 'LLM Finetuning', fallback })
const one = (number: number, count: number): SlideContext => ({ source, number, count })

test('a page slide is the Page style at Feed: its kicker, the sheet filling the room, the strip with its page and number', () => {
  for (const look of LOOKS) {
    const slide = page(longEnglish.quote), space = slideSpace(slide, one(2, 3), { look }, measure)
    // The room is the Page style's at Feed under the slide's own kicker.
    assert.deepEqual(space, pageSheetSpace({ ...slideInput(slide, one(2, 3), { look }), style: 'page' }, measure))
    assert.equal(space.fill, space.height)
    const layout = layoutSlide(slide, one(2, 3), { look, crop: { width: 900, height: 900 * space.height / space.width, marks: MARKS } }, measure)
    assertSlideFits(layout, `page/${look}`)
    assert.equal(layout.style, 'page')
    const image = imageOf(layout)!
    assert.ok(Math.abs(image.width - space.width) < 1e-6 && Math.abs(image.height - space.height) < 1e-6)
    assert.deepEqual(image.marks.map(m => m.rects), [MARKS[0]!.rects])
    assert.equal(texts(layout).find(t => t.role === 'kicker')!.text, 'LLM FINETUNING')
    assert.equal(texts(layout).some(t => t.role === 'headline' || t.role === 'quote'), false)
    const short = layoutSlide(slide, { ...one(2, 3), source: { ...source, credit: 'Dettmers et al., 2023' } }, { look, crop: CROPS.short }, measure)
    assert.equal(texts(short).find(t => t.role === 'footerCredit')!.text, 'Dettmers et al., 2023 · p. 4')
    assert.equal(texts(layout).find(t => t.role === 'slideNumber')!.text, '2 / 3')
    // A tall crop is drawn narrower and centred; a short one at full width.
    for (const crop of [CROPS.short, CROPS.tall]) assertSlideFits(layoutSlide(slide, one(2, 3), { look, crop }, measure), `page/${look}/${crop.height}`)
  }
})

test('without a crop, a page slide draws its fallback as text under the same kicker, at up to 240 characters', () => {
  assert.equal(longEnglish.quote.length, 240)
  for (const look of LOOKS) for (const fallback of [longEnglish.quote, longEnglish.headline, 'Rest more.']) {
    const name = `${look}/${fallback.length}`
    const layout = layoutSlide(page(fallback), one(2, 3), { look }, measure)
    assertSlideFits(layout, name)
    assert.equal(layout.style, 'quote', name)
    assert.equal(imageOf(layout), undefined)
    assert.equal(texts(layout).find(t => t.role === 'kicker')?.text, 'LLM FINETUNING', name)
    // No quotation glyph: the fallback may be a headline as well as a quote.
    assert.equal(texts(layout).some(t => t.role === 'glyph'), false, name)
    assert.equal(texts(layout).filter(t => t.role === 'quote').map(t => t.text).join(' '), fallback, name)
  }
  // A Quote card without a kicker of its own keeps its glyph.
  const sample = SAMPLES[0]!
  assert.ok(texts(layoutCard({ card: sample.card, source: sample.source, style: 'quote', look: 'ink', size: 'feed' }, measure)).some(t => t.role === 'glyph'))
})

test('the three cards of a post fit numbered 1 / 3 to 3 / 3, and 1 / 2 to 2 / 2 without a takeaway', () => {
  assert.deepEqual(POST_CAROUSEL.slides.map(s => s.kind), ['cover', 'page', 'takeaway'])
  for (const look of LOOKS) for (const slides of [POST_CAROUSEL.slides, POST_CAROUSEL.slides.slice(0, 2)]) for (const [index, slide] of slides.entries()) {
    for (const crop of slide.kind === 'page' ? [CROPS.short, CROPS.tall, undefined] : [undefined]) {
      const name = `${look}/${index + 1}/${slides.length}/${slide.kind}${crop ? `/${crop.height}` : ''}`
      const layout = layoutSlide(slide, one(index + 1, slides.length), { look, crop }, measure)
      assertSlideFits(layout, name)
      assert.equal(texts(layout).find(t => t.role === 'slideNumber')!.text, `${index + 1} / ${slides.length}`, name)
    }
  }
})

test('the Carousel style asked of layoutCard is laid out as Headline', () => {
  const sample = SAMPLES[0]!
  for (const crop of [{ width: 900, height: 400, marks: MARKS }, undefined]) {
    const input = { card: sample.card, source: sample.source, look: 'paper' as const, size: 'feed' as const, crop }
    const carousel = layoutCard({ ...input, style: 'carousel' as unknown as 'headline' }, measure)
    const headline = layoutCard({ ...input, style: 'headline' }, measure)
    assert.deepEqual(carousel, headline)
    assert.equal(carousel.style, crop ? 'headline' : 'idea')
  }
  const space = pageSheetSpace({ card: sample.card, source: sample.source, style: 'carousel' as unknown as 'headline', look: 'ink', size: 'feed' }, measure)
  assert.deepEqual(space, pageSheetSpace({ card: sample.card, source: sample.source, style: 'headline', look: 'ink', size: 'feed' }, measure))
})
