import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD, DESTINATION_DEFAULTS, DRAFT, REGION_MIN, SET, SET_STYLE_REFUSED, TAKE_MAX, captionText, cardDescription, cleanPassage, creditLine, defaultLook,
  draftLimits, firstCommentText, highlightColor, numbersIn, publicUrl, quoteMatches, regionProblem, setSlides, sourceLine, summaryTitle, unsupportedNumbers,
  validateCard, postSlides, STYLES, STYLE_NAMES, REGION_STYLES, type Caption, type CardContent, type SetContent, type SetItem, type ShareCardSource,
} from '../../src/shared/share-card.js'
import { captionSchema, cardContentSchema, previousVersionSchema, shareCardSourceSchema } from '../../src/shared/share-card-schema.js'

const passage = 'Attention lets every position look at every other one. However, the cost grows with the square of the sequence length.'
const source: ShareCardSource = {
  version: 1, passage, page: 4, rects: [{ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.25 }], color: 'yellow',
  context: 'Earlier text. We suspect that sparse patterns may reduce this cost. Later text.', title: 'Attention Is All You Need',
  credit: 'Vaswani et al., 2017', url: '', kind: 'highlight', region: null, items: [],
}
const card: CardContent = {
  quote: 'Attention lets every position look at every other one.', quoteEdited: false, emphasis: 'every other one',
  headline: 'Attention trades cost for reach', pull: 'sparse patterns may reduce this cost', topic: 'Attention',
  takeawaysTitle: 'What full attention buys', style: 'quote', look: 'ink', crop: null, set: null, takeaway: '',
  takeaways: [{ title: 'Reach is global', detail: 'Every position can use any other.' },
    { title: 'Cost is quadratic', detail: 'Longer inputs cost much more.' }, { title: 'Sparsity may help', detail: 'The authors suspect it.' }],
}

const rejects = (change: Partial<CardContent>, message: RegExp) => assert.throws(() => validateCard({ ...card, ...change }, source), message)

test('a card within every limit passes', () => {
  validateCard(card, source)
  validateCard({ ...card, emphasis: '', pull: '', topic: '' }, source)
  assert.deepEqual(cardContentSchema.parse(card), card)
  assert.deepEqual(shareCardSourceSchema.parse(source), source)
})

test('every limit is checked and named', () => {
  rejects({ quote: '' }, /^Error: quote has 0 characters; allowed 1–240\.$/)
  rejects({ quote: 'a'.repeat(241), quoteEdited: true }, /quote has 241 characters; allowed 1–240/)
  validateCard({ ...card, quote: 'a'.repeat(240), quoteEdited: true, emphasis: '' }, source)
  rejects({ quote: 'Attention lets every token look at every other one.' }, /quote must be copied exactly from highlight/)
  rejects({ emphasis: 'e'.repeat(41) }, /emphasis has 41 characters; allowed 0–40/)
  rejects({ emphasis: 'every token' }, /emphasis must be an exact part of quote/)
  rejects({ headline: '' }, /headline has 0 characters; allowed 1–80/)
  rejects({ headline: 'h'.repeat(81) }, /headline has 81 characters; allowed 1–80/)
  validateCard({ ...card, headline: 'h'.repeat(80) }, source)
  rejects({ pull: 'p'.repeat(141) }, /pull has 141 characters; allowed 0–140/)
  rejects({ pull: 'An invented pull quote.' }, /pull must be copied exactly from highlight or pageText/)
  rejects({ topic: 't'.repeat(25) }, /topic has 25 characters; allowed 0–24/)
  rejects({ takeawaysTitle: '' }, /takeawaysTitle has 0 characters; allowed 1–48/)
  rejects({ takeawaysTitle: 't'.repeat(49) }, /takeawaysTitle has 49 characters; allowed 1–48/)
  rejects({ takeaways: card.takeaways.slice(0, 2) }, /takeaways needs exactly three items; it has 2/)
  rejects({ takeaways: [...card.takeaways, card.takeaways[0]!] }, /it has 4/)
  rejects({ takeaways: [card.takeaways[0]!, { title: 't'.repeat(33), detail: 'd' }, card.takeaways[2]!] }, /takeaways\[1\]\.title has 33 characters; allowed 1–32/)
  rejects({ takeaways: [card.takeaways[0]!, card.takeaways[1]!, { title: 't', detail: '' }] }, /takeaways\[2\]\.detail has 0 characters; allowed 1–72/)
  rejects({ takeaways: [{ title: 't', detail: 'd'.repeat(73) }, card.takeaways[1]!, card.takeaways[2]!] }, /takeaways\[0\]\.detail has 73 characters/)
  rejects({ style: 'poster' as CardContent['style'] }, /Unknown card style: poster/)
  rejects({ look: 'neon' as CardContent['look'] }, /Unknown card look: neon/)
})

test('a quote the reader edited skips the exact-match check, but not its length', () => {
  validateCard({ ...card, quote: 'Attention lets each position see all the others.', quoteEdited: true, emphasis: '' }, source)
  rejects({ quote: 'Attention lets each position see all the others.' }, /copied exactly/)
})

test('a pull quote may come from the page text', () => {
  validateCard({ ...card, pull: 'We suspect that sparse patterns' }, source)
})

test('quoteMatches ignores line breaks and spacing differences', () => {
  assert.equal(quoteMatches('', 'anything'), true)
  assert.equal(quoteMatches('   ', 'anything'), true)
  assert.equal(quoteMatches('look at every\nother one', passage), true)
  assert.equal(quoteMatches(' every   position ', 'Attention lets every\n position look'), true)
  assert.equal(quoteMatches('every position', 'every positions'), true)
  assert.equal(quoteMatches('Every position', passage), false)
  assert.equal(quoteMatches('look at all', passage), false)
})

test('cleanPassage spells out ligatures without flattening superscripts', () => {
  assert.equal(cleanPassage('the ﬁrst ﬂow is eﬀective, eﬃcient and ﬆable; baﬄing, oﬅen'), 'the first flow is effective, efficient and stable; baffling, often')
  assert.equal(cleanPassage('O(n²) and x₁ stay'), 'O(n²) and x₁ stay')
})

test('cleanPassage removes soft hyphens', () => {
  assert.equal(cleanPassage('atten­tion is all'), 'attention is all')
})

test('cleanPassage joins a word split by a hyphen at a line end', () => {
  assert.equal(cleanPassage('the trans-\nformer architecture'), 'the transformer architecture')
  assert.equal(cleanPassage('the trans- \n former'), 'the transformer')
  assert.equal(cleanPassage('the trans‐\r\nformer'), 'the transformer')
  assert.equal(cleanPassage('informa-\nção'), 'informação')
  // Accepted: a real compound broken at its hyphen is joined too.
  assert.equal(cleanPassage('self-\nattention'), 'selfattention')
  // Not a line-end split: an upper-case continuation, a hyphen inside a line, or a dash between words.
  assert.equal(cleanPassage('GPT-\n4 and BERT-\nLarge'), 'GPT- 4 and BERT- Large')
  assert.equal(cleanPassage('self-attention layers'), 'self-attention layers')
  assert.equal(cleanPassage('fast - and\ncheap'), 'fast - and cheap')
})

test('cleanPassage collapses every whitespace run and trims', () => {
  assert.equal(cleanPassage('  one\n two\t\tthree four five\r\n\nsix  '), 'one two three four five six')
  assert.equal(cleanPassage('\n\n'), '')
})

const caption: Caption = {
  destination: 'linkedin', take: '', angle: 'finding', hashtags: ['attention', 'ml', 'research'], showTags: false, link: 'post', edited: null,
  drafts: { finding: 'Hook line.\n\nBody text.', contrast: 'Belief line.\n\nBut the paper.', caveat: '' },
}
const linked = { ...source, url: 'https://arxiv.org/abs/1706.03762' }
const SOURCE_LINE = '📄 Attention Is All You Need · Vaswani et al., 2017 · p. 4'

test('captionText composes the chosen draft, source line, link and hashtags for LinkedIn', () => {
  assert.equal(sourceLine(source), SOURCE_LINE)
  assert.equal(sourceLine({ ...source, title: ' ', credit: '' }), '📄 p. 4')
  assert.equal(captionText(linked, caption), `Hook line.\n\nBody text.\n\n${SOURCE_LINE}\nhttps://arxiv.org/abs/1706.03762`)
  assert.equal(captionText(linked, { ...caption, angle: 'contrast' }), `Belief line.\n\nBut the paper.\n\n${SOURCE_LINE}\nhttps://arxiv.org/abs/1706.03762`)
  // The link held back for the first comment; hashtags only when shown.
  assert.equal(captionText(linked, { ...caption, link: 'comment', showTags: true }), `Hook line.\n\nBody text.\n\n${SOURCE_LINE}\n\n#attention #ml #research`)
  assert.equal(captionText(source, { ...caption, showTags: true, hashtags: [] }), `Hook line.\n\nBody text.\n\n${SOURCE_LINE}`)
  // An empty angle falls back to the finding; edited text replaces everything.
  assert.equal(captionText(source, { ...caption, angle: 'caveat' }), `Hook line.\n\nBody text.\n\n${SOURCE_LINE}`)
  assert.equal(captionText(linked, { ...caption, edited: 'My own words.' }), 'My own words.')
  assert.equal(firstCommentText(linked), `${SOURCE_LINE}\nhttps://arxiv.org/abs/1706.03762`)
  assert.equal(firstCommentText(source), '')
  assert.equal(creditLine(source), 'Vaswani et al., 2017 · p. 4')
  assert.equal(creditLine({ credit: '', page: 9 }), 'p. 9')
})

test('a carousel\'s source line names the pages its highlights span, in the copied text and the first comment', () => {
  const item = (page: number) => ({ annotation_id: null, passage: 'A passage long enough to be a highlight.', page, rects: [], color: 'yellow' as const })
  const set = { ...linked, kind: 'set' as const, page: 3, items: [item(3), item(1), item(3)] }
  const spanning = '📄 Attention Is All You Need · Vaswani et al., 2017 · pp. 1–3'
  assert.equal(sourceLine(set), spanning)
  assert.equal(captionText(set, caption), `Hook line.\n\nBody text.\n\n${spanning}\nhttps://arxiv.org/abs/1706.03762`)
  assert.equal(firstCommentText(set), `${spanning}\nhttps://arxiv.org/abs/1706.03762`)
  // Highlights on one page name it once.
  const onePage = { ...set, items: [item(3), item(3)] }
  assert.equal(sourceLine(onePage), '📄 Attention Is All You Need · Vaswani et al., 2017 · p. 3')
  assert.equal(captionText(onePage, { ...caption, destination: 'instagram' }), 'Hook line.\n\nBody text.\n\n📄 Attention Is All You Need · Vaswani et al., 2017 · p. 3\nhttps://arxiv.org/abs/1706.03762')
  // Every other post keeps its own page, whatever it carries in items.
  assert.equal(sourceLine({ ...linked, items: [item(1), item(9)] }), SOURCE_LINE)
})

test('captionText gives X the draft and the link only, and Instagram the source line, link and hashtags', () => {
  const x: Caption = { ...caption, destination: 'x', showTags: true, link: 'comment' }
  assert.equal(captionText(linked, x), 'Hook line.\n\nBody text.\n\nhttps://arxiv.org/abs/1706.03762')
  assert.equal(captionText(source, x), 'Hook line.\n\nBody text.')
  const instagram: Caption = { ...caption, destination: 'instagram', showTags: true, link: 'comment' }
  assert.equal(captionText(linked, instagram), `Hook line.\n\nBody text.\n\n${SOURCE_LINE}\nhttps://arxiv.org/abs/1706.03762\n\n#attention #ml #research`)
  assert.equal(captionText(source, { ...instagram, showTags: false }), `Hook line.\n\nBody text.\n\n${SOURCE_LINE}`)
})

test('the caption schema matches the contract and refuses an unknown destination or angle', () => {
  assert.deepEqual(captionSchema.parse(caption), caption)
  assert.deepEqual(previousVersionSchema.parse({ card, caption }), { card, caption })
  assert.throws(() => captionSchema.parse({ ...caption, destination: 'facebook' }))
  assert.throws(() => captionSchema.parse({ ...caption, angle: 'summary' }))
  assert.throws(() => captionSchema.parse({ ...caption, link: 'bio' }))
  assert.throws(() => captionSchema.parse({ ...caption, body: 'old shape' }))
})

test('draftLimits follow the destination, the take, a change and a link on X', () => {
  assert.deepEqual(draftLimits('linkedin'), DRAFT.linkedin)
  assert.deepEqual(draftLimits('instagram', { url: 'https://example.org' }), DRAFT.instagram)
  // X counts a link as 23 characters, plus the blank line before it.
  assert.deepEqual(draftLimits('x', { url: 'https://example.org/a/very/long/path' }), { ...DRAFT.x, maxChars: 255, hookMax: 255 })
  // A change may make a draft shorter and a single paragraph.
  assert.deepEqual(draftLimits('linkedin', { changed: true }), { ...DRAFT.linkedin, minWords: 10, minParagraphs: 1 })
  assert.deepEqual(draftLimits('x', { changed: true }), DRAFT.x)
  // A take is its own paragraph after at least one other; on X a long take raises the limits.
  const take = 'word '.repeat(70).trim() + '.'
  assert.equal(take.length, 350)
  assert.deepEqual(draftLimits('x', { take }), { ...DRAFT.x, maxChars: 490, hookMax: 490, maxWords: 95, minParagraphs: 2 })
  assert.deepEqual(draftLimits('x', { take: 'Short take.' }), { ...DRAFT.x, minParagraphs: 2 })
  assert.deepEqual(draftLimits('linkedin', { take }), DRAFT.linkedin)
  assert.equal(TAKE_MAX, 400)
  assert.deepEqual(DESTINATION_DEFAULTS.instagram, { style: 'carousel', size: 'feed', extraLines: 3, showTags: true })
})

test('cardDescription reads the words drawn in each style', () => {
  assert.equal(cardDescription(card, 'quote'), `Quote card: “${card.quote}”`)
  assert.equal(cardDescription(card, 'page'), `Page card: “${card.quote}”`)
  assert.equal(cardDescription({ ...card, headline: 'Reach costs.' }, 'idea'), 'Big idea card: Reach costs. “sparse patterns may reduce this cost”')
  assert.equal(cardDescription({ ...card, pull: '' }, 'idea'), 'Big idea card: Attention trades cost for reach.')
  assert.equal(cardDescription(card, 'takeaways'), 'Takeaways card: What full attention buys. 1. Reach is global: Every position can use any other. ' +
    '2. Cost is quadratic: Longer inputs cost much more. 3. Sparsity may help: The authors suspect it.')
})

test('highlightColor turns unknown colours into yellow', () => {
  assert.equal(highlightColor('pink'), 'pink')
  assert.equal(highlightColor('purple'), 'yellow')
  assert.equal(highlightColor(null), 'yellow')
})

test('publicUrl keeps only public http and https links', () => {
  assert.equal(publicUrl('https://arxiv.org/abs/1706.03762'), 'https://arxiv.org/abs/1706.03762')
  assert.equal(publicUrl('http://example.org/paper.pdf'), 'http://example.org/paper.pdf')
  for (const bad of [null, undefined, '', 'not a url', 'file:///home/me/paper.pdf', 'ftp://example.org/a.pdf', 'javascript:alert(1)',
    'https://user:secret@example.org/a.pdf', 'https://user@example.org/a.pdf', 'http://localhost:8200/a.pdf', 'http://app.localhost/a',
    'http://127.0.0.1/a', 'http://127.1/a', 'http://2130706433/a', 'http://10.0.0.5/a', 'http://172.16.1.1/a', 'http://172.31.255.1/a',
    'http://192.168.1.10/a', 'http://169.254.169.254/latest', 'http://0.0.0.0/a', 'http://100.64.0.1/a', 'http://[::1]/a', 'http://[fd00::1]/a',
    'http://[fe80::1]/a', 'http://[::ffff:127.0.0.1]/a', 'http://[::ffff:10.0.0.1]/a', 'test/fixtures/sample.pdf']) {
    assert.equal(publicUrl(bad), '', String(bad))
  }
  assert.equal(publicUrl('http://172.32.0.1/a'), 'http://172.32.0.1/a')
})

test('numbersIn finds every numeral as written, but not digits inside a name', () => {
  assert.deepEqual(numbersIn('In 2017, 1,572 alliances (63%) rated g = .65; p53, CO2 and H1N1 are names.'), ['2017', '1,572', '63', '.65'])
  assert.deepEqual(numbersIn('the 3rd trial, 1990s, 2021–2024, 8:30, −0.3, GPT-4'), ['3', '1990', '2021', '2024', '8', '30', '0.3', '4'])
  assert.deepEqual(numbersIn('12\u2009345 people, 12 345 items and 1.234,5 euros'), ['12\u2009345', '12', '345', '1.234,5'])
  assert.deepEqual(numbersIn('No digits at all, one or two words.'), [])
})

test('unsupportedNumbers compares numbers canonically and lets an ambiguous one through', () => {
  // [draft, allowed text, numbers refused]
  const cases: Array<[string, string, string[]]> = [
    // Thousands separators, either way round, and the Portuguese and thin-space styles.
    ['1,572 alliances', 'They looked at 1572 alliances', []],
    ['1572 alliances', 'They looked at 1,572 alliances', []],
    ['1,572 alianças', 'Foram 1.572 alianças', []],
    ['12345 people', '12\u00a0345 people', []],
    ['1,573 alliances', '1,572 alliances', ['1,573']],
    // Percentages: the unit does not matter, only the number.
    ['63% of them', 'rated 63 percent successful', []],
    ['63 percent', 'rated 63% successful', []],
    ['63 por cento', '63%', []],
    ['64%', 'rated 63 percent successful', ['64']],
    // Decimals: a leading point, a decimal comma, trailing zeros, and rounding to fewer places.
    ['g = 0.65', 'an average effect of g = .65', []],
    ['g = 0.65', 'efeito médio g = 0,65', []],
    ['0.650', 'g = 0.65', []],
    ['1.4 percent', 'by 1.35 percent', []],
    ['1.3 percent', 'by 1.35 percent', []],
    ['1.2 percent', 'by 1.35 percent', ['1.2']],
    ['63%', 'rated 63.4 percent', []],
    ['2 points', 'a gain of 1.5 points', ['2']],
    ['0.65', 'g = 0.6', ['0.65']],
    // Years and ranges: each end is a number; an abbreviated end is read in full.
    ['in 2017', 'Vaswani et al., 2017', []],
    ['a 2023 review', 'A review of 185 studies', ['2023']],
    ['from 2021 to 2024', 'between 2021–2024', []],
    ['in 2022', 'between 2021–2024', ['2022']],
    ['until 2024', 'from 2021-24', []],
    ['the 1990s', 'alliances from the 1990s', []],
    // Ordinals and numbers spelled out in the source.
    ['the 21st century', 'in the 21st century', []],
    ['the 3rd trial', 'the third trial', []],
    ['33 studies', 'thirty-three studies', []],
    ['1 in 10', 'one in ten adults', []],
    ['94 effect sizes', 'ninety four effect sizes', []],
    ['34 studies', 'thirty-three studies', ['34']],
    // Names with digits are not quantities; a sign is ignored; an unreadable token must appear as written.
    ['p53 and CO2', 'nothing here', []],
    ['GPT-4', 'nothing here', ['4']],
    ['−0.3', 'a change of 0.3', []],
    ['version 3.5.1', 'version 3.5.1', []],
    ['version 3.5.2', 'version 3.5.1', ['3.5.2']],
    ['47 and 47 again', 'nothing', ['47']],
    ['1,5 vezes', '1.5 times', []],
    ['33 studies and 94 effect sizes', 'Of 94 effect sizes across 33 studies', []],
  ]
  for (const [draft, allowed, refused] of cases) assert.deepEqual(unsupportedNumbers(draft, [allowed]), refused, `${draft} | ${allowed}`)
  // Any of the allowed texts may hold the number.
  assert.deepEqual(unsupportedNumbers('47 points in 2017 on p. 4', ['nothing', 'Vaswani et al., 2017', '4', 'I doubt the 47 points']), [])
  assert.deepEqual(unsupportedNumbers('No numbers here.', []), [])
})

const REGION = { x1: 0.1, y1: 0.4, x2: 0.9, y2: 0.7 }
const regionSource: ShareCardSource = { ...source, kind: 'region', region: REGION, rects: [], passage: 'Accuracy Sequence length', page: 3 }
const regionCard: CardContent = {
  quote: '', quoteEdited: false, emphasis: '', headline: 'Longer inputs cost more', pull: '', topic: 'Attention', takeawaysTitle: '', takeaways: [],
  style: 'page', look: 'ink', crop: REGION, set: null, takeaway: '',
}

test('a region or paper card has only a headline, a topic and a takeaway, and only the Page, Headline and Carousel styles', () => {
  for (const kind of ['region', 'paper'] as const) {
    const from = { ...regionSource, kind }
    validateCard(regionCard, from)
    validateCard({ ...regionCard, style: 'headline', topic: '' }, from)
    for (const [change, message] of [
      [{ quote: 'Accuracy' }, /^Error: quote must be empty for a post made from a region\.$/],
      [{ emphasis: 'x' }, /emphasis must be empty for a post made from a region/],
      [{ pull: 'Accuracy' }, /pull must be empty/],
      [{ takeawaysTitle: 'Three lessons' }, /takeawaysTitle must be empty/],
      [{ takeaways: card.takeaways }, /takeaways must be empty for a post made from a region/],
      [{ style: 'quote' }, /^Error: A post made from a region has no quote or takeaways, so it uses the Page, Headline or Carousel style\.$/],
      [{ style: 'takeaways' }, /uses the Page, Headline or Carousel style/],
      [{ headline: '' }, /headline has 0 characters; allowed 1–80/],
      [{ topic: 't'.repeat(25) }, /topic has 25 characters/],
    ] as Array<[Partial<CardContent>, RegExp]>) assert.throws(() => validateCard({ ...regionCard, ...change }, from), message, String(message))
  }
  // A highlight's card still needs its quote and three takeaways; a source without a kind is a highlight.
  assert.throws(() => validateCard(regionCard, source), /quote has 0 characters/)
  assert.throws(() => validateCard(regionCard, { passage: source.passage, context: source.context }), /quote has 0 characters/)
})

test('the source schema reads a stored source without a kind as a highlight and allows a short region text', () => {
  const { kind: _kind, region: _region, items: _items, ...stored } = source
  assert.deepEqual(shareCardSourceSchema.parse(stored), source)
  assert.deepEqual(shareCardSourceSchema.parse(regionSource), regionSource)
  assert.deepEqual(shareCardSourceSchema.parse({ ...regionSource, kind: 'paper', passage: '' }), { ...regionSource, kind: 'paper', passage: '' })
  assert.throws(() => shareCardSourceSchema.parse({ ...source, passage: 'Too short.' }))
  assert.throws(() => shareCardSourceSchema.parse({ ...regionSource, passage: 'p'.repeat(CARD.passageMax + 1) }))
  assert.throws(() => shareCardSourceSchema.parse({ ...regionSource, region: null }))
  assert.throws(() => shareCardSourceSchema.parse({ ...source, region: REGION }))
  assert.throws(() => shareCardSourceSchema.parse({ ...regionSource, kind: 'figure' }))
})

test('regionProblem refuses a region that is inverted, outside the page or under 5% of it', () => {
  assert.equal(REGION_MIN, 0.05)
  assert.equal(regionProblem(REGION), null)
  assert.equal(regionProblem({ x1: 0, y1: 0, x2: 0.05, y2: 0.05 }), null)
  for (const bad of [{ x1: 0.5, y1: 0.4, x2: 0.4, y2: 0.7 }, { ...REGION, y2: 0.4 }, { ...REGION, x2: 0.14 }, { ...REGION, y2: 0.449 }, { ...REGION, x2: 1.2 }, { ...REGION, y1: -0.1 }])
    assert.equal(regionProblem(bad), 'A region needs x1 < x2 and y1 < y2 inside the page, and at least 5% of the page in each direction.', JSON.stringify(bad))
})

test('a region or paper post is described and listed without a quote', () => {
  assert.equal(cardDescription(regionCard, 'page', regionSource), 'Page card: a region of page 3')
  assert.equal(cardDescription(regionCard, 'page', { ...regionSource, kind: 'paper', page: 1 }), 'Page card: the first page of the paper')
  assert.equal(cardDescription(regionCard, 'page'), 'Page card: a region of the page')
  assert.equal(cardDescription(regionCard, 'headline', regionSource), 'Headline card: Longer inputs cost more.')
  assert.equal(cardDescription(card, 'page', source), `Page card: “${card.quote}”`)
  assert.equal(summaryTitle(regionSource, 'Longer inputs cost more'), 'Longer inputs cost more')
  assert.equal(summaryTitle(regionSource, ''), 'Region on p. 3')
  assert.equal(summaryTitle({ ...regionSource, kind: 'paper', page: 1 }, ''), 'First page')
  assert.equal(summaryTitle({ ...regionSource, kind: 'paper', page: 2 }, ''), 'Paper on p. 2')
  assert.equal(summaryTitle(source, ''), passage.slice(0, 80).replace(/\s+\S*$/, '') + '…')
  assert.equal(summaryTitle({ ...source, passage: 'A short passage of text.' }, ''), 'A short passage of text.')
})

// Carousels: several highlights of one paper, one post.
const items: SetItem[] = [
  { annotation_id: 'a1', passage: 'Attention lets every position look at every other one.', page: 2, rects: [{ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.22 }], color: 'green' },
  { annotation_id: 'a2', passage: 'The cost grows with the square of the sequence length.', page: 3, rects: [{ x1: 0.1, y1: 0.5, x2: 0.6, y2: 0.52 }], color: 'pink' },
  { annotation_id: null, passage: 'We suspect that sparse patterns may reduce this cost.', page: 5, rects: [{ x1: 0.1, y1: 0.7, x2: 0.8, y2: 0.72 }], color: 'yellow' },
]
const setSource: ShareCardSource = {
  ...source, kind: 'set', items, passage: items.map(item => item.passage).join('\n\n'), page: 2, rects: [], color: 'yellow', region: null,
}
const set: SetContent = {
  study: 'The authors describe a model built only on attention.', points: ['Every position sees every other', 'Cost grows with the square', 'Sparsity may cut the cost'],
  takeaway: 'Attention buys reach at a price that grows fast.', limitations: 'The fix for the cost is a suspicion, not a result.', crops: [null, null, null],
}
const setCard: CardContent = { ...regionCard, style: 'headline', crop: null, headline: 'Reach has a quadratic price', set }

test('a carousel card has a headline, a topic and one point and crop per highlight, in the Headline style', () => {
  assert.deepEqual(SET, { minItems: 2, maxItems: 8, studyMax: 160, pointMax: 70, takeawayMax: 140, limitationsMax: 160 })
  validateCard(setCard, setSource)
  validateCard({ ...setCard, set: { ...set, study: '', limitations: '', crops: [null, { x1: 0, y1: 0.4, x2: 1, y2: 0.6 }, null] } }, setSource)
  const withSet = (change: Partial<SetContent>) => ({ ...setCard, set: { ...set, ...change } })
  for (const [value, message] of [
    [{ ...setCard, set: null }, /^Error: A carousel needs its slides\.$/],
    [{ ...setCard, quote: 'Attention' }, /quote must be empty for a carousel/],
    [{ ...setCard, takeaways: card.takeaways }, /takeaways must be empty for a carousel/],
    [{ ...setCard, crop: { x1: 0, y1: 0, x2: 1, y2: 1 } }, /crop must be empty for a carousel; each highlight slide has its own/],
    [{ ...setCard, style: 'page' }, /^Error: A carousel's slides use the Headline style; only the look can change\.$/],
    [{ ...setCard, headline: 'h'.repeat(81) }, /headline has 81 characters; allowed 1–80/],
    [withSet({ points: set.points.slice(0, 2) }), /^Error: points has 2 items; it needs exactly 3, one per highlight in order\.$/],
    [withSet({ crops: [null] }), /crops has 1 items; it needs exactly 3/],
    [withSet({ points: ['p'.repeat(71), 'b', 'c'] }), /^Error: points\[0\] has 71 characters; allowed 1–70\.$/],
    [withSet({ points: ['a', '', 'c'] }), /points\[1\] has 0 characters; allowed 1–70/],
    [withSet({ study: 's'.repeat(161) }), /^Error: study has 161 characters; allowed 0–160\.$/],
    [withSet({ takeaway: '' }), /takeaway has 0 characters; allowed 1–140/],
    [withSet({ takeaway: 't'.repeat(141) }), /takeaway has 141 characters; allowed 1–140/],
    [withSet({ limitations: 'l'.repeat(161) }), /limitations has 161 characters; allowed 0–160/],
    [withSet({ crops: [null, { x1: 0.5, y1: 0, x2: 0.4, y2: 1 }, null] }), /crops\[1\] needs x1 < x2 and y1 < y2/],
  ] as Array<[CardContent, RegExp]>) assert.throws(() => validateCard(value, setSource), message, String(message))
  // A carousel's words are refused on a single post, and a single post's on a carousel.
  assert.throws(() => validateCard(setCard, source), /quote has 0 characters/)
  assert.throws(() => validateCard({ ...card, set }, source), /set must be empty for a post from one highlight/)
  assert.throws(() => validateCard({ ...regionCard, set }, regionSource), /set must be empty for a post made from a region/)
  assert.equal(SET_STYLE_REFUSED, "A carousel's slides use the Headline style; only the look can change.")
})

test('the source and card schemas read stored values without items or set, and hold a carousel\'s', () => {
  const { set: _set, ...stored } = card
  assert.deepEqual(cardContentSchema.parse(stored), card)
  assert.deepEqual(cardContentSchema.parse(setCard), setCard)
  assert.deepEqual(shareCardSourceSchema.parse(setSource), setSource)
  assert.throws(() => shareCardSourceSchema.parse({ ...setSource, items: items.slice(0, 1) }))
  assert.throws(() => shareCardSourceSchema.parse({ ...setSource, items: [...items, ...items, ...items] }))
  assert.throws(() => shareCardSourceSchema.parse({ ...source, items }))
  assert.throws(() => shareCardSourceSchema.parse({ ...setSource, region: REGION }))
  assert.throws(() => shareCardSourceSchema.parse({ ...setSource, items: [{ ...items[0], passage: 'Too short.' }, items[1]] }))
  // A carousel's passage holds all its highlights; a single post's stays within passageMax.
  const long = Array.from({ length: 8 }, (_, index) => ({ ...items[0]!, passage: 'p'.repeat(CARD.passageMax), page: index + 1 }))
  shareCardSourceSchema.parse({ ...setSource, items: long, passage: long.map(item => item.passage).join('\n\n') })
  assert.throws(() => shareCardSourceSchema.parse({ ...source, passage: 'p'.repeat(CARD.passageMax + 1) }))
})

test('setSlides lists the cover, the study, one slide per highlight, the takeaway and the limits', () => {
  const cover = { kind: 'cover', kicker: 'Attention', headline: 'Reach has a quadratic price' }
  const points = set.points.map((headline, item) => ({ kind: 'point', kicker: 'Attention', headline, item }))
  const takeaway = { kind: 'takeaway', kicker: 'The takeaway', text: set.takeaway }
  const study = { kind: 'study', kicker: 'The study', text: set.study }
  const limits = { kind: 'limitations', kicker: 'Limits', text: set.limitations }
  assert.deepEqual(setSlides(setCard, setSource), [cover, study, ...points, takeaway, limits])
  assert.deepEqual(setSlides({ ...setCard, set: { ...set, study: '' } }, setSource), [cover, ...points, takeaway, limits])
  assert.deepEqual(setSlides({ ...setCard, set: { ...set, limitations: '' } }, setSource), [cover, study, ...points, takeaway])
  assert.deepEqual(setSlides({ ...setCard, set: { ...set, study: '', limitations: '' } }, setSource), [cover, ...points, takeaway])
  // Two highlights make the shortest carousel; a point beyond the source's highlights is not drawn.
  const two = { ...setSource, items: items.slice(0, 2) }
  assert.deepEqual(setSlides({ ...setCard, set: { ...set, study: '', limitations: '', points: set.points.slice(0, 2), crops: [null, null] } }, two), [cover, ...points.slice(0, 2), takeaway])
  assert.deepEqual(setSlides(setCard, two).filter(slide => slide.kind === 'point').length, 2)
  // A card that is not a carousel has no slides.
  assert.deepEqual(setSlides(card, source), [])
})

test('a carousel is described and listed by its headline and its size', () => {
  assert.equal(cardDescription(setCard, 'headline', setSource), 'Carousel of 7 slides: Reach has a quadratic price.')
  assert.equal(cardDescription({ ...setCard, set: { ...set, study: '' } }, 'headline'), 'Carousel of 6 slides: Reach has a quadratic price.')
  assert.equal(summaryTitle(setSource, 'Reach has a quadratic price'), 'Reach has a quadratic price')
  assert.equal(summaryTitle(setSource, ''), '3 highlights')
})

test('review: a thousands reading never matches a smaller number, and rounding never bridges one', () => {
  const source = '312 managers across 5 firms answered the survey [10]. Page 20. Of 12,500 patients, 13.4% were older.'
  for (const draft of ['10,000 managers', '312,000 managers', '5,000 firms', '20,000 responses', '5.000 firms', '10.000 people'])
    assert.deepEqual(unsupportedNumbers(draft, [source]), [numbersIn(draft)[0]], draft)
  // 12,500 is not 12.5, so it supports neither 13 nor 12.5.
  assert.deepEqual(unsupportedNumbers('13 hospitals', ['Of 12,500 patients']), ['13'])
  assert.deepEqual(unsupportedNumbers('12.5 patients', ['Of 12,500 patients']), ['12.5'])
  // A draft's thousands reading is not rounded either: 1,234 is not 1.2341 rounded.
  assert.deepEqual(unsupportedNumbers('1,234 items', ['a ratio of 1.2341']), ['1,234'])
  // What must still pass.
  for (const [draft, allowed] of [['1,572 alliances', '1572 alliances'], ['1572 alliances', '1,572 alliances'], ['0.65', 'g = .65'],
    ['1,572 alianças', 'Foram 1.572 alianças'], ['1.572', 'Foram 1.572 alianças'], ['12,500 patients', 'Of 12 500 patients'], ['13%', 'were 13.4% older'],
    ['0.650', 'g = 0.65'], ['1.4 percent', 'by 1.35 percent']] as const)
    assert.deepEqual(unsupportedNumbers(draft, [allowed]), [], `${draft} | ${allowed}`)
})

test('review: the source side of the numbers check is lenient, the draft side exact', () => {
  for (const [draft, allowed] of [
    ['from 2010–19', 'between 2010 and 2019'], ['from 2010-19', 'in 2010 and in 2019'],
    ['12 hospitals', 'data of12 hospitals'], ['in 2017', 'collected in2017'],
    ['100 people', 'one hundred people'], ['250 people', 'two hundred and fifty people'], ['1000 people', 'a thousand people'],
    ['the 20th century', 'the twentieth century'], ['the 21st trial', 'the twenty-first trial'],
    ['62%', 'in 2019,62% of firms'], ['2019', 'in 2019,62% of firms'],
  ] as const) assert.deepEqual(unsupportedNumbers(draft, [allowed]), [], `${draft} | ${allowed}`)
  // Exact on the draft side: an abbreviated end still needs its year; names with digits in the draft are still skipped.
  assert.deepEqual(unsupportedNumbers('from 2010–19', ['in 2010 only']), ['19'])
  assert.deepEqual(unsupportedNumbers('p53 and CO2', ['nothing']), [])
  assert.deepEqual(unsupportedNumbers('101 people', ['one hundred people']), ['101'])
  // A sign is prose, not a number: a fall of 12% supports "12%".
  assert.deepEqual(unsupportedNumbers('a rise of 12%', ['a change of −12%']), [])
})

test('review: a take always leaves room for words of the assistant\'s own, even with a change', () => {
  assert.equal(draftLimits('linkedin', { take: 'My take.', changed: true }).minParagraphs, 2)
  assert.equal(draftLimits('x', { take: 'My take.', changed: true }).minParagraphs, 2)
  assert.equal(draftLimits('linkedin', { changed: true }).minParagraphs, 1)
})

// Stage 4: three cards for Instagram.
const TAKEAWAY = 'Long inputs stay costly until a cheaper pattern is proven.'

test('the Carousel style, its name, the Instagram default and the takeaway limit', () => {
  assert.deepEqual(STYLES, ['page', 'headline', 'carousel', 'quote', 'idea', 'takeaways'])
  assert.equal(STYLE_NAMES.carousel, 'Carousel'); assert.equal(DESTINATION_DEFAULTS.instagram.style, 'carousel')
  assert.equal(CARD.takeawayMax, 140)
  assert.deepEqual(REGION_STYLES, ['page', 'headline', 'carousel'])
})

test('a card\'s takeaway: within 140 characters, empty for a stored card, refused on a set', () => {
  validateCard({ ...card, takeaway: TAKEAWAY, style: 'carousel' }, source)
  validateCard({ ...card, takeaway: 't'.repeat(140) }, source)
  assert.throws(() => validateCard({ ...card, takeaway: 't'.repeat(141) }, source), /^Error: takeaway has 141 characters; allowed 0–140\.$/)
  validateCard({ ...regionCard, takeaway: TAKEAWAY, style: 'carousel' }, regionSource)
  assert.throws(() => validateCard({ ...regionCard, takeaway: 't'.repeat(141) }, regionSource), /takeaway has 141 characters/)
  assert.throws(() => validateCard({ ...setCard, takeaway: TAKEAWAY }, setSource), /^Error: A carousel of several highlights keeps its takeaway on its own slide \(set\.takeaway\)\.$/)
  assert.throws(() => validateCard({ ...setCard, style: 'carousel' }, setSource), /only the look can change/)
  // A card stored before the takeaway existed reads as ''.
  const { takeaway: _takeaway, ...stored } = card
  assert.deepEqual(cardContentSchema.parse(stored), card)
})

test('postSlides: cover, page and takeaway for a post in the Carousel style; none for a set', () => {
  const withTakeaway = { ...card, takeaway: TAKEAWAY }
  const cover = { kind: 'cover', kicker: 'Attention', headline: card.headline }
  assert.deepEqual(postSlides(withTakeaway, source), [cover, { kind: 'page', kicker: 'Attention', fallback: card.quote },
    { kind: 'takeaway', kicker: 'The takeaway', text: TAKEAWAY }])
  assert.deepEqual(postSlides(card, source), [cover, { kind: 'page', kicker: 'Attention', fallback: card.quote }])
  // Without a quote (a region or first-page post) the page slide falls back to the headline.
  assert.deepEqual(postSlides({ ...regionCard, takeaway: TAKEAWAY }, regionSource), [{ kind: 'cover', kicker: 'Attention', headline: regionCard.headline },
    { kind: 'page', kicker: 'Attention', fallback: regionCard.headline }, { kind: 'takeaway', kicker: 'The takeaway', text: TAKEAWAY }])
  assert.deepEqual(postSlides(setCard, setSource), [])
  assert.equal(cardDescription(withTakeaway, 'carousel', source), 'Carousel of 3 slides: Attention trades cost for reach.')
  assert.equal(cardDescription(card, 'carousel'), 'Carousel of 2 slides: Attention trades cost for reach.')
  assert.equal(cardDescription({ ...regionCard, takeaway: TAKEAWAY }, 'carousel', regionSource), 'Carousel of 3 slides: Longer inputs cost more.')
})
