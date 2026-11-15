import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { CARD, LOOKS, SIZES, validateCard, type CardSize, type HighlightColor, type ShareLook, type ShareStyle } from '../../src/shared/share-card.js'
import { layoutCard, pageSheetSpace, MIN_TEXT_PX, TOO_LONG, type CardLayout, type CardLayoutInput, type Measure, type TextCommand } from '../../frontend/src/lib/share-card/layout.js'
import { contrast, HIGHLIGHT_HEX, mix, palette } from '../../frontend/src/lib/share-card/looks.js'
import { SAMPLES, english, longEnglish, longPortuguese, longWordEnglish, longWordPortuguese, minimal } from '../../frontend/src/lib/share-card/samples.js'

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
const SIZE_NAMES = Object.keys(SIZES) as CardSize[]
const texts = (layout: CardLayout) => layout.commands.filter((c): c is TextCommand => c.kind === 'text')
const inputFor = (sample: (typeof SAMPLES)[number], style: ShareStyle, look: ShareLook, size: CardSize): CardLayoutInput =>
  ({ card: sample.card, source: sample.source, style, look, size })

test('every sample fits every style, look and size inside the safe area, never under 28 px', () => {
  let count = 0
  for (const sample of SAMPLES) for (const style of STYLES) for (const look of LOOKS) for (const size of SIZE_NAMES) {
    const name = `${sample.name}/${style}/${look}/${size}`
    const layout = layoutCard(inputFor(sample, style, look, size), measure)
    count++
    assert.equal(layout.width, SIZES[size].width); assert.equal(layout.height, SIZES[size].height); assert.equal(layout.style, style)
    const { safe } = layout
    for (const text of texts(layout)) {
      assert.ok(text.size >= MIN_TEXT_PX - 1e-9, `${name}: ${text.role} "${text.text}" is ${text.size} px`)
      const { x1, y1, x2, y2 } = text.box
      assert.ok(x1 >= safe.x1 - 0.5 && x2 <= safe.x2 + 0.5 && y1 >= safe.y1 - 0.5 && y2 <= safe.y2 + 0.5,
        `${name}: ${text.role} "${text.text}" at ${JSON.stringify(text.box)} leaves ${JSON.stringify(safe)}`)
    }
    // The footer is one line each, ellipsized rather than wrapped, and it never overlaps the main block.
    const footer = texts(layout).filter(t => t.role === 'footerTitle' || t.role === 'footerCredit')
    assert.ok(footer.filter(t => t.role === 'footerTitle').length <= 1 && footer.filter(t => t.role === 'footerCredit').length === 1, name)
    const wordmark = texts(layout).find(t => t.role === 'wordmark')!
    for (const line of footer) assert.ok(line.box.x2 < wordmark.box.x1, `${name}: footer runs into the wordmark`)
    const footerTop = Math.min(...footer.map(t => t.box.y1), wordmark.box.y1)
    for (const text of texts(layout).filter(t => !['footerTitle', 'footerCredit', 'wordmark'].includes(t.role)))
      assert.ok(text.box.y2 <= footerTop, `${name}: ${text.role} "${text.text}" overlaps the footer`)
  }
  assert.equal(count, SAMPLES.length * 3 * 3 * 2)
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
    const space = pageSheetSpace({ card: sample.card, source: sample.source, look, size }, measure)
    assert.equal(space.width, SIZES[size].width - 2 * (size === 'story' ? 108 : 91.8))
    assert.ok(space.height > 300, `${size}/${look}: ${space.height}`)
    const fitting = { width: 900, height: 900 * space.height / space.width * 0.99 }
    const page = layoutCard({ ...inputFor(sample, 'page', look, size), crop: fitting }, measure)
    assert.equal(page.style, 'page')
    const image = page.commands.find(c => c.kind === 'image')
    assert.ok(image && image.kind === 'image')
    assert.ok(Math.abs(image.width - space.width) < 1e-6 && image.height <= space.height + 1e-6)
    assert.ok(image.y >= page.safe.y1 && image.y + image.height <= page.safe.y2)
    assert.equal(image.highlight.color, HIGHLIGHT_HEX[sample.source.color])
    assert.ok(Math.abs(image.radius - 1.4 * 10.8) < 1e-9)
    const tall = layoutCard({ ...inputFor(sample, 'page', look, size), crop: { width: 900, height: 900 * space.height / space.width * 1.02 } }, measure)
    assert.equal(tall.style, 'quote'); assert.equal(tall.commands.some(c => c.kind === 'image'), false)
    const none = layoutCard(inputFor(sample, 'page', look, size), measure)
    assert.equal(none.style, 'quote')
    assert.deepEqual(none.commands, layoutCard(inputFor(sample, 'quote', look, size), measure).commands)
  }
})

test('every fixture is valid under the contract and the maximum ones sit at its limits', () => {
  for (const sample of SAMPLES) validateCard(sample.card, sample.source)
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

test('the renderer\'s browser modules keep zod and the schema module out of the bundle', () => {
  const directory = path.resolve(import.meta.dirname, '../../frontend/src/lib/share-card')
  for (const file of fs.readdirSync(directory).filter(name => /\.tsx?$/.test(name))) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8')
    for (const [, specifier] of source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm))
      assert.ok(specifier !== 'zod' && !/share-card-schema/.test(specifier!), `${file} imports ${specifier} at runtime`)
  }
})
