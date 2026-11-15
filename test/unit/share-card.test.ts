import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD, captionText, cardDescription, cleanPassage, creditLine, defaultLook, defaultStyle, highlightColor, publicUrl, quoteMatches, validateCard,
  type CardContent, type ShareCardSource,
} from '../../src/shared/share-card.js'
import { cardContentSchema, shareCardSourceSchema } from '../../src/shared/share-card-schema.js'

const passage = 'Attention lets every position look at every other one. However, the cost grows with the square of the sequence length.'
const source: ShareCardSource = {
  version: 1, passage, page: 4, rects: [{ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.25 }], color: 'yellow',
  context: 'Earlier text. We suspect that sparse patterns may reduce this cost. Later text.', title: 'Attention Is All You Need',
  credit: 'Vaswani et al., 2017', url: '',
}
const card: CardContent = {
  quote: 'Attention lets every position look at every other one.', quoteEdited: false, emphasis: 'every other one',
  headline: 'Attention trades cost for reach', pull: 'sparse patterns may reduce this cost', topic: 'Attention',
  takeawaysTitle: 'What full attention buys', style: 'quote', look: 'ink', crop: null,
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
  rejects({ headline: '' }, /headline has 0 characters; allowed 1–60/)
  rejects({ headline: 'h'.repeat(61) }, /headline has 61 characters; allowed 1–60/)
  validateCard({ ...card, headline: 'h'.repeat(60) }, source)
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

test('captionText composes the body, source, link and hashtags', () => {
  const caption = { body: 'Hook line.\n\nBody text.', hashtags: ['attention', 'ml', 'research'], edited: null }
  assert.equal(captionText(source, caption),
    'Hook line.\n\nBody text.\n\n📄 Attention Is All You Need · Vaswani et al., 2017 · p. 4\n\n#attention #ml #research')
  assert.equal(captionText({ ...source, credit: '', url: 'https://arxiv.org/abs/1706.03762' }, caption),
    'Hook line.\n\nBody text.\n\n📄 Attention Is All You Need · p. 4\nhttps://arxiv.org/abs/1706.03762\n\n#attention #ml #research')
  assert.equal(captionText({ ...source, title: ' ', credit: '' }, { ...caption, hashtags: [] }), 'Hook line.\n\nBody text.\n\n📄 p. 4')
  assert.equal(captionText(source, { ...caption, edited: 'My own words.' }), 'My own words.')
  assert.equal(creditLine(source), 'Vaswani et al., 2017 · p. 4')
  assert.equal(creditLine({ credit: '', page: 9 }), 'p. 9')
})

test('defaultStyle leads with the quote up to 120 characters', () => {
  assert.equal(defaultStyle('q'.repeat(CARD.quoteLeadsMax)), 'quote')
  assert.equal(defaultStyle('q'.repeat(121)), 'idea')
  assert.equal(defaultLook(), 'ink')
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
