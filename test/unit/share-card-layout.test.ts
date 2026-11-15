import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CARD, FIT, LOOKS, SIZES, validateCard, type CardSize, type HighlightColor, type PageMark, type ShareLook, type ShareStyle } from '../../src/shared/share-card.js'
import { layoutCard, pageSheetSpace, MIN_TEXT_PX, TOO_LONG, type CardLayout, type CardLayoutInput, type ImageCommand, type Measure, type TextCommand } from '../../frontend/src/lib/share-card/layout.js'
import { contrast, HIGHLIGHT_HEX, mix, palette } from '../../frontend/src/lib/share-card/looks.js'
import { PAGE_FRAMES, SAMPLE_PAGE, SAMPLES, english, longEnglish, longPortuguese, longWordEnglish, longWordPortuguese, minimal } from '../../frontend/src/lib/share-card/samples.js'

// A stand-in for canvas measurement: per-character widths scaled by size, heavier for bold and narrower for the
// serif, plus the letter spacing after every character, as canvas adds it.
const measure: Measure = (text, font, letterSpacing) => {
  const match = /^(italic )?(\d+) ([\d.]+)px "(Inter|Newsreader)"/.exec(font)
  assert.ok(match, `unexpected font ${font}`)
  const [, italic, weight, size, family] = match
  const factor = (family === 'Newsreader' ? 0.9 : 1) * (italic ? 0.92 : 1) * (Number(weight) >= 700 ? 1.08 : Number(weight) >= 600 ? 1.04 : 1)
  let width = 0
  for (const c of Array.from(text)) width += (/[MWmw@]/.test(c) ? 0.85 : /[il.,;:'’!|]/.test(c) ? 0.3 : c === ' ' ? 0.28 : /[A-Z]/.test(c) ? 0.66 : 0.55) * Number(size) * factor + letterSpacing
  return width
}

const STYLES: ShareStyle[] = ['quote', 'idea', 'takeaways']
const SIZE_NAMES = Object.keys(SIZES) as Array<keyof typeof SIZES>
const ALL_SIZES: CardSize[] = ['feed', 'story', 'fit']
const texts = (layout: CardLayout) => layout.commands.filter((c): c is TextCommand => c.kind === 'text')
const imageOf = (layout: CardLayout) => layout.commands.find((c): c is ImageCommand => c.kind === 'image')
const inputFor = (sample: (typeof SAMPLES)[number], style: ShareStyle, look: ShareLook, size: CardSize): CardLayoutInput =>
  ({ card: sample.card, source: sample.source, style, look, size })
const MARKS: PageMark[] = [
  { color: 'yellow', rects: [{ x1: 0.05, y1: 0.4, x2: 0.95, y2: 0.47 }, { x1: 0.05, y1: 0.47, x2: 0.6, y2: 0.54 }] },
  { color: 'pink', rects: [{ x1: 0.3, y1: 0.8, x2: 0.7, y2: 0.87 }] },
]
/** Crops of a short passage, a wide band of the page, and a tall reader's crop that only fits narrower. */
const CROPS = { short: { width: 900, height: 120, marks: MARKS }, wide: { width: 900, height: 520, marks: MARKS }, tall: { width: 700, height: 1600, marks: MARKS } }

/** Text inside the safe area, never under 28 px, the footer on one line each and clear of everything above it. */
function assertFits(layout: CardLayout, name: string) {
  const { safe } = layout
  for (const text of texts(layout)) {
    assert.ok(text.size >= MIN_TEXT_PX - 1e-9, `${name}: ${text.role} "${text.text}" is ${text.size} px`)
    const { x1, y1, x2, y2 } = text.box
    assert.ok(x1 >= safe.x1 - 0.5 && x2 <= safe.x2 + 0.5 && y1 >= safe.y1 - 0.5 && y2 <= safe.y2 + 0.5,
      `${name}: ${text.role} "${text.text}" at ${JSON.stringify(text.box)} leaves ${JSON.stringify(safe)}`)
  }
  const footer = texts(layout).filter(t => t.role === 'footerTitle' || t.role === 'footerCredit')
  assert.ok(footer.filter(t => t.role === 'footerTitle').length <= 1 && footer.filter(t => t.role === 'footerCredit').length === 1, name)
  const wordmark = texts(layout).find(t => t.role === 'wordmark')!
  for (const line of footer) assert.ok(line.box.x2 < wordmark.box.x1, `${name}: footer runs into the wordmark`)
  const footerTop = Math.min(...footer.map(t => t.box.y1), wordmark.box.y1)
  const main = texts(layout).filter(t => !['footerTitle', 'footerCredit', 'wordmark'].includes(t.role))
  for (const text of main) assert.ok(text.box.y2 <= footerTop, `${name}: ${text.role} "${text.text}" overlaps the footer`)
  const image = imageOf(layout)
  if (image) {
    assert.ok(image.x >= safe.x1 - 1e-6 && image.x + image.width <= safe.x2 + 1e-6 && image.y >= safe.y1 - 1e-6 && image.y + image.height <= footerTop,
      `${name}: the sheet ${JSON.stringify([image.x, image.y, image.width, image.height])} leaves the safe area or meets the footer`)
    for (const text of main) assert.ok(text.box.y2 <= image.y, `${name}: ${text.role} "${text.text}" overlaps the sheet`)
  }
}

test('every sample fits every style, look and size inside the safe area, never under 28 px', () => {
  let count = 0
  for (const sample of SAMPLES) for (const style of STYLES) for (const look of LOOKS) for (const size of ALL_SIZES) {
    const name = `${sample.name}/${style}/${look}/${size}`
    const layout = layoutCard(inputFor(sample, style, look, size), measure)
    count++
    // A text card asked for the Fit size is laid out as Feed.
    const drawn = SIZES[size === 'fit' ? 'feed' : size]
    assert.equal(layout.width, drawn.width); assert.equal(layout.height, drawn.height); assert.equal(layout.style, style)
    assertFits(layout, name)
  }
  assert.equal(count, SAMPLES.length * 3 * 3 * 3)
})

test('Page and Headline fit every sample, look, size and crop', () => {
  let count = 0
  for (const sample of SAMPLES) for (const style of ['page', 'headline'] as const) for (const look of LOOKS) for (const size of ALL_SIZES)
    for (const [cropName, crop] of Object.entries(CROPS)) {
      const name = `${sample.name}/${style}/${look}/${size}/${cropName}`
      const layout = layoutCard({ ...inputFor(sample, style, look, size), crop }, measure)
      count++
      assert.equal(layout.style, style, name)
      assert.equal(layout.width, 1080)
      if (size === 'fit' && style === 'page') assert.ok(layout.height >= FIT.minHeight && layout.height <= FIT.maxHeight, `${name}: ${layout.height}`)
      else assert.equal(layout.height, SIZES[size === 'fit' ? 'feed' : size].height, name)
      assert.ok(imageOf(layout), `${name}: no sheet`)
      assertFits(layout, name)
      if (style === 'headline') {
        const headline = texts(layout).filter(t => t.role === 'headline')
        assert.equal(headline.map(t => t.text).join(' '), sample.card.headline.replace(/'/g, '’'), name)
      }
    }
  assert.equal(count, SAMPLES.length * 2 * 3 * 3 * 3)
})
test('long titles and credits are ellipsized on one line', () => {
  const sample = SAMPLES.find(s => s.name === 'max-en')!
  const layout = layoutCard(inputFor(sample, 'quote', 'ink', 'feed'), measure)
  const title = texts(layout).find(t => t.role === 'footerTitle')!, credit = texts(layout).find(t => t.role === 'footerCredit')!
  assert.match(title.text, /…$/); assert.match(credit.text, /…$/)
  assert.ok(sample.source.title.startsWith(title.text.slice(0, -1)))
  const short = layoutCard(inputFor(SAMPLES[0]!, 'quote', 'ink', 'feed'), measure)
  assert.equal(texts(short).find(t => t.role === 'footerTitle')!.text, 'Learning from feedback')
  assert.equal(texts(short).find(t => t.role === 'footerCredit')!.text, 'Ericsson and Pool, 2016 · p. 4')
  const minimalLayout = layoutCard(inputFor(SAMPLES.find(s => s.name === 'min')!, 'idea', 'paper', 'feed'), measure)
  assert.equal(texts(minimalLayout).some(t => t.role === 'footerTitle' || t.role === 'kicker'), false)
  assert.equal(texts(minimalLayout).find(t => t.role === 'footerCredit')!.text, 'p. 1')
})

test('an emphasised phrase that fits on one line is not split', () => {
  for (const sample of SAMPLES) for (const look of LOOKS) for (const size of SIZE_NAMES) {
    const layout = layoutCard(inputFor(sample, 'quote', look, size), measure)
    const emphasis = texts(layout).filter(t => t.role === 'emphasis')
    if (!sample.card.emphasis) { assert.equal(emphasis.length, 0); continue }
    assert.ok(emphasis.length > 0, `${sample.name}/${look}/${size}: no emphasis drawn`)
    const quoteSize = emphasis[0]!.size
    const phraseWidth = measure(sample.card.emphasis, emphasis[0]!.font, emphasis[0]!.letterSpacing)
    if (phraseWidth < (layout.safe.x2 - layout.safe.x1) * 0.9 && quoteSize > MIN_TEXT_PX)
      assert.equal(new Set(emphasis.map(t => t.y)).size, 1, `${sample.name}/${look}/${size}: emphasis split over lines`)
    // Every look marks the phrase with a box behind it.
    assert.ok(layout.commands.some(c => c.kind === 'rect'), `${sample.name}/${look}/${size}: no emphasis box`)
  }
})

test('the emphasis box takes in closing punctuation', () => {
  const card = { ...english, quote: 'Feedback helps when it shows the gap, not the score.', emphasis: 'the gap' }
  const layout = layoutCard({ card, source: SAMPLES[0]!.source, style: 'quote', look: 'marker', size: 'feed' }, measure)
  assert.deepEqual(texts(layout).filter(t => t.role === 'emphasis').map(t => t.text), ['the', 'gap,'])
})

test('a quote cut from mid-sentence opens with a capital and keeps its emphasis', () => {
  const source = SAMPLES[0]!.source
  const draw = (quote: string, emphasis: string, look: ShareLook, style: ShareStyle = 'quote') =>
    texts(layoutCard({ card: { ...english, quote, emphasis, pull: style === 'idea' ? quote : english.pull }, source, style, look, size: 'feed' }, measure))
      .map(t => [t.role, t.text, Math.round(t.x), Math.round(t.y)])
  for (const look of LOOKS) {
    assert.deepEqual(draw('small steps make practice easier.', 'small steps', look), draw('Small steps make practice easier.', 'Small steps', look))
    assert.deepEqual(draw('small steps make practice easier.', 'practice', look), draw('Small steps make practice easier.', 'practice', look))
  }
  assert.deepEqual(draw('big plans often stall.', '', 'ink', 'idea'), draw('Big plans often stall.', '', 'ink', 'idea'))
})

test('apostrophes become typographic without changing the words', () => {
  const layout = layoutCard({ card: { ...english, quote: 'It isn\'t the amount that matters.', emphasis: '' }, source: SAMPLES[0]!.source, style: 'quote', look: 'paper', size: 'feed' }, measure)
  assert.equal(texts(layout).filter(t => t.role === 'quote').map(t => t.text).join(' '), 'It isn’t the amount that matters.')
})

test('a short quote grows, and the main block sits 40% down its free space', () => {
  const short = layoutCard({ card: minimal, source: SAMPLES[0]!.source, style: 'quote', look: 'marker', size: 'feed' }, measure)
  const quote = texts(short).find(t => t.role === 'quote')!
  assert.ok(quote.size > 9.4 * 10.8 * 1.2, `a two-word quote should grow, got ${quote.size}`)
  const long = layoutCard({ card: longEnglish, source: SAMPLES[0]!.source, style: 'quote', look: 'marker', size: 'feed' }, measure)
  assert.ok(texts(long).find(t => t.role === 'quote')!.size < 9.4 * 10.8)
})

test('a single word wider than the column still draws', () => {
  for (const card of [longWordEnglish, longWordPortuguese]) for (const size of SIZE_NAMES) for (const style of ['idea', 'takeaways'] as const) {
    const layout = layoutCard({ card, source: SAMPLES[0]!.source, style, look: 'ink', size }, measure)
    assert.ok(texts(layout).some(t => /desproporcionalmente|pseudopseudohypoparathyroidism/i.test(t.text)))
  }
})

test('text beyond the contract is refused instead of clipped', () => {
  const tooLong = { ...longEnglish, quote: `${longEnglish.quote} `.repeat(3).trim() }
  for (const look of LOOKS) assert.throws(() => layoutCard({ card: tooLong, source: SAMPLES[0]!.source, style: 'quote', look, size: 'feed' }, measure), new RegExp(TOO_LONG))
  assert.throws(() => layoutCard({ card: { ...english, takeaways: english.takeaways.slice(0, 2) }, source: SAMPLES[0]!.source, style: 'takeaways', look: 'ink', size: 'feed' }, measure), /exactly three/)
})

test('the Page style places the crop as a sheet, or falls back to Quote', () => {
  const sample = SAMPLES[0]!
  for (const size of SIZE_NAMES) for (const look of LOOKS) {
    const space = pageSheetSpace({ card: sample.card, source: sample.source, style: 'page', look, size }, measure)
    assert.equal(space.width, SIZES[size].width - 2 * (size === 'story' ? 108 : 91.8))
    assert.ok(space.height > 300, `${size}/${look}: ${space.height}`)
    const fitting = { width: 900, height: 900 * space.height / space.width * 0.99, marks: MARKS }
    const page = layoutCard({ ...inputFor(sample, 'page', look, size), crop: fitting }, measure)
    assert.equal(page.style, 'page')
    const image = imageOf(page)!
    assert.ok(Math.abs(image.width - space.width) < 1e-6 && image.height <= space.height + 1e-6)
    assert.ok(image.y >= page.safe.y1 && image.y + image.height <= page.safe.y2)
    assert.ok(Math.abs(image.radius - 1.4 * 10.8) < 1e-9)
    const none = layoutCard(inputFor(sample, 'page', look, size), measure)
    assert.equal(none.style, 'quote')
    assert.deepEqual(none.commands, layoutCard(inputFor(sample, 'quote', look, size), measure).commands)
  }
})

test('a crop too tall for the card is drawn narrower and centred, at the full height available', () => {
  const sample = SAMPLES[0]!
  for (const style of ['page', 'headline'] as const) for (const size of ALL_SIZES) {
    const space = pageSheetSpace({ card: sample.card, source: sample.source, style, look: 'ink', size }, measure)
    const tall = { width: 900, height: 900 * space.height / space.width * 1.5, marks: MARKS }
    const layout = layoutCard({ ...inputFor(sample, style, 'ink', size), crop: tall }, measure)
    assert.equal(layout.style, style)
    const image = imageOf(layout)!
    assert.ok(Math.abs(image.height - space.height) < 1e-6, `${style}/${size}: ${image.height} ≠ ${space.height}`)
    assert.ok(Math.abs(image.width - space.width / 1.5) < 1e-6)
    assert.ok(Math.abs(image.x + image.width / 2 - layout.width / 2) < 1e-6, `${style}/${size}: not centred`)
  }
})

test('every mark is painted in its own highlight colour with the multiply blend', () => {
  const sample = SAMPLES[0]!
  for (const style of ['page', 'headline'] as const) {
    const image = imageOf(layoutCard({ ...inputFor(sample, style, 'paper', 'feed'), crop: CROPS.wide }, measure))!
    assert.deepEqual(image.marks, [
      { color: HIGHLIGHT_HEX.yellow, alpha: 0.55, rects: MARKS[0]!.rects },
      { color: HIGHLIGHT_HEX.pink, alpha: 0.55, rects: MARKS[1]!.rects },
    ])
    const bare = imageOf(layoutCard({ ...inputFor(sample, style, 'paper', 'feed'), crop: { ...CROPS.wide, marks: [] } }, measure))!
    assert.deepEqual(bare.marks, [])
  }
})

test('the Fit size is as tall as the kicker, the sheet and the footer need, within its bounds', () => {
  const sample = SAMPLES[0]!
  for (const look of LOOKS) {
    const space = pageSheetSpace({ card: sample.card, source: sample.source, style: 'page', look, size: 'fit' }, measure)
    // The room is that of the tallest Fit card, which is Feed's.
    assert.deepEqual(space, pageSheetSpace({ card: sample.card, source: sample.source, style: 'page', look, size: 'feed' }, measure))
    const chrome = FIT.maxHeight - space.height
    const at = (sheetHeight: number) => layoutCard({ ...inputFor(sample, 'page', look, 'fit'), crop: { width: space.width, height: sheetHeight, marks: MARKS } }, measure)
    // A sheet that needs a card between the bounds gets exactly that card, the sheet at full width.
    const middle = at(500)
    assert.equal(middle.height, Math.ceil(chrome + 500))
    const image = imageOf(middle)!
    assert.ok(Math.abs(image.width - space.width) < 1e-6 && Math.abs(image.height - 500) < 1e-6)
    // The block is placed as on every card: 40% down the free space, here under a pixel.
    const kicker = texts(middle).find(t => t.role === 'kicker')!
    assert.ok(kicker.box.y1 - middle.safe.y1 < 8, `${look}: kicker at ${kicker.box.y1}`)
    // A short strip is held at the minimum height; a tall sheet at the maximum, drawn narrower.
    assert.equal(at(40).height, FIT.minHeight)
    assert.equal(at(space.height).height, FIT.maxHeight)
    const tall = at(space.height * 2)
    assert.equal(tall.height, FIT.maxHeight)
    assert.ok(imageOf(tall)!.width < space.width - 1)
    // The footer stays pinned to the bottom of the shorter card.
    const short = at(40), credit = texts(short).find(t => t.role === 'footerCredit')!
    assert.ok(credit.box.y2 <= FIT.minHeight - 91.8 + 0.5 && credit.box.y2 > FIT.minHeight - 91.8 - 40)
  }
  // Without a crop, Page at Fit is drawn as Quote at the Feed size; other styles at Fit are laid out as Feed.
  const quote = layoutCard(inputFor(sample, 'page', 'ink', 'fit'), measure)
  assert.equal(quote.style, 'quote'); assert.equal(quote.height, SIZES.feed.height)
  assert.deepEqual(quote.commands, layoutCard(inputFor(sample, 'quote', 'ink', 'feed'), measure).commands)
  const headline = layoutCard({ ...inputFor(sample, 'headline', 'ink', 'fit'), crop: CROPS.wide }, measure)
  assert.equal(headline.height, SIZES.feed.height)
  assert.deepEqual(headline.commands, layoutCard({ ...inputFor(sample, 'headline', 'ink', 'feed'), crop: CROPS.wide }, measure).commands)
})

test('Headline puts the topic and the headline above the sheet, and is Big idea without a crop', () => {
  for (const sample of SAMPLES) for (const look of LOOKS) for (const size of SIZE_NAMES) {
    const name = `${sample.name}/${look}/${size}`
    const space = pageSheetSpace({ card: sample.card, source: sample.source, style: 'headline', look, size }, measure)
    const exact = { width: 900, height: 900 * space.height / space.width, marks: MARKS }
    const layout = layoutCard({ ...inputFor(sample, 'headline', look, size), crop: exact }, measure)
    assert.equal(layout.style, 'headline')
    const image = imageOf(layout)!
    // The sheet takes all the room the headline leaves.
    assert.ok(Math.abs(image.width - space.width) < 1e-6 && Math.abs(image.height - space.height) < 1e-6, `${name}: ${image.width}×${image.height}`)
    const headline = texts(layout).filter(t => t.role === 'headline')
    assert.ok(headline.length > 0, name)
    for (const text of headline) assert.ok(text.size >= MIN_TEXT_PX && text.box.y2 <= image.y, name)
    // Always below Big idea's headline, and the sheet keeps at least a third of the room.
    assert.ok(headline[0]!.size < 11.5 * 10.8 * (size === 'story' ? 1.2 : 1), name)
    assert.ok(space.height > (size === 'story' ? 420 : 320), `${name}: sheet ${space.height}`)
    const kicker = texts(layout).find(t => t.role === 'kicker')
    if (sample.card.topic) assert.ok(kicker && kicker.box.y2 <= headline[0]!.box.y1, name)
    const fallback = layoutCard(inputFor(sample, 'headline', look, size), measure)
    assert.equal(fallback.style, 'idea')
    assert.deepEqual(fallback.commands, layoutCard(inputFor(sample, 'idea', look, size), measure).commands)
  }
})

test('a short crop leaves room that the headline grows into, up to 35%', () => {
  for (const sample of SAMPLES) for (const look of LOOKS) for (const size of SIZE_NAMES) {
    const name = `${sample.name}/${look}/${size}`
    const space = pageSheetSpace({ card: sample.card, source: sample.source, style: 'headline', look, size }, measure)
    const full = layoutCard({ ...inputFor(sample, 'headline', look, size), crop: { width: 900, height: 900 * space.height / space.width, marks: MARKS } }, measure)
    const short = layoutCard({ ...inputFor(sample, 'headline', look, size), crop: CROPS.short }, measure)
    const sizeOf = (layout: CardLayout) => texts(layout).find(t => t.role === 'headline')!.size
    assert.ok(sizeOf(short) >= sizeOf(full) - 1e-9, name)
    assert.ok(sizeOf(short) <= Math.max(7.2 * 10.8 * (size === 'story' ? 1.2 : 1) * 1.35, MIN_TEXT_PX) + 1e-6, `${name}: ${sizeOf(short)}`)
    assertFits(short, name)
    // The sheet keeps its full width.
    assert.ok(Math.abs(imageOf(short)!.width - space.width) < 1e-6, name)
  }
  const sample = SAMPLES[0]!
  const nominal = texts(layoutCard({ ...inputFor(sample, 'headline', 'ink', 'feed'), crop: { width: 900, height: 900 * 0.8, marks: MARKS } }, measure)).find(t => t.role === 'headline')!.size
  const grown = texts(layoutCard({ ...inputFor(sample, 'headline', 'ink', 'feed'), crop: CROPS.short }, measure)).find(t => t.role === 'headline')!.size
  assert.ok(grown > nominal * 1.1, `${grown} vs ${nominal}`)
})

test('a headline of 80 characters keeps a sheet, and the headline is never drawn below 28 px', () => {
  const card = { ...longEnglish, headline: 'W'.repeat(8) + ' ' + 'Wide words everywhere make this headline as long as the contract allows' }
  assert.equal(card.headline.length, CARD.headlineMax)
  for (const size of SIZE_NAMES) for (const look of LOOKS) {
    const space = pageSheetSpace({ card, source: SAMPLES[0]!.source, style: 'headline', look, size }, measure)
    assert.ok(space.height > 300, `${size}/${look}: ${space.height}`)
    const layout = layoutCard({ card, source: SAMPLES[0]!.source, style: 'headline', look, size, crop: CROPS.wide }, measure)
    assert.equal(layout.style, 'headline')
    for (const text of texts(layout)) assert.ok(text.size >= MIN_TEXT_PX)
  }
})

test('every fixture is valid under the contract and the maximum ones sit at its limits', () => {
  for (const sample of SAMPLES) validateCard(sample.card, sample.source)
  // The Page and Headline frames: valid cards, and phrases that are on the made-up page.
  const pageText = SAMPLE_PAGE.sections.map(section => section.text).join(' ')
  for (const frame of PAGE_FRAMES) {
    validateCard(frame.card, frame.source)
    assert.ok(frame.marks.length > 0 && frame.marks.every(mark => pageText.includes(mark.phrase)), frame.name)
  }
  assert.deepEqual(new Set(PAGE_FRAMES.map(frame => `${frame.style}/${frame.size}`)), new Set(['page/fit', 'page/feed', 'page/story', 'headline/feed', 'headline/story']))
  for (const card of [longEnglish, longPortuguese]) {
    assert.equal(card.quote.length, CARD.quoteMax); assert.equal(card.emphasis.length, CARD.emphasisMax)
    assert.equal(card.headline.length, CARD.headlineMax); assert.equal(card.pull.length, CARD.pullMax)
    assert.equal(card.topic.length, CARD.topicMax); assert.equal(card.takeawaysTitle.length, CARD.takeawaysTitleMax)
    for (const item of card.takeaways) { assert.equal(item.title.length, CARD.takeawayTitleMax); assert.equal(item.detail.length, CARD.takeawayDetailMax) }
  }
  assert.ok(longWordEnglish.headline.split(' ').some(word => word.length === 30))
})

test('every text and ground pair reaches 4.5:1 in every look and Marker colour', () => {
  const colors = Object.keys(HIGHLIGHT_HEX) as HighlightColor[]
  for (const look of LOOKS) for (const color of colors) {
    const p = palette(look, color, 1080, 1350)
    for (const ground of p.groundTones) {
      const name = `${look}/${color} on ${ground}`
      assert.ok(contrast(p.text, ground) >= 4.5, `${name}: text ${contrast(p.text, ground).toFixed(2)}`)
      assert.ok(contrast(p.accent, ground) >= 4.5, `${name}: accent ${contrast(p.accent, ground).toFixed(2)}`)
      // Translucent text: the credit line (72%), takeaway details (75%) and the pull quote (90%).
      for (const alpha of [0.72, 0.75, 0.9]) assert.ok(contrast(mix(p.text, ground, alpha), ground) >= 4.5, `${name}: text at ${alpha}`)
    }
    // The emphasised phrase on its box, the box blended over the ground where it is translucent.
    const box = mix(p.emphasis.box, p.groundTones[0]!, p.emphasis.boxAlpha)
    assert.ok(contrast(p.emphasis.text, box) >= 4.5, `${look}/${color}: emphasis ${contrast(p.emphasis.text, box).toFixed(2)}`)
  }
})

test('the share-card browser modules keep zod and the schema module out of the bundle', () => {
  const root = path.resolve(import.meta.dirname, '../..'), directory = path.join(root, 'frontend/src/lib/share-card')
  const files = [...fs.readdirSync(directory).filter(name => /\.tsx?$/.test(name)).map(name => path.join(directory, name)),
    ...['src/shared/share-card.ts', 'frontend/src/lib/share-card-api.ts', 'frontend/src/components/SharePostPanel.tsx', 'frontend/src/components/HighlightMenu.tsx'].map(file => path.join(root, file))]
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const [, specifier] of source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm))
      assert.ok(specifier !== 'zod' && !/share-card-schema/.test(specifier!), `${file} imports ${specifier} at runtime`)
  }
})
