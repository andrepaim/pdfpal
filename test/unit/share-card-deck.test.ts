import test from 'node:test'
import assert from 'node:assert/strict'
import { LOOKS, type HighlightColor, type PageMark } from '../../src/shared/share-card.js'
import { MIN_TEXT_PX, TILE_ALPHA, TILE_LABEL_ALPHA, type Box, type CardLayout, type Measure, type RectCommand, type TextCommand } from '../../frontend/src/lib/share-card/layout.js'
import { contrast, HIGHLIGHT_HEX, mix, palette } from '../../frontend/src/lib/share-card/looks.js'
import { comparable, deckBlock, layoutSlide, type SlideContext, type SlideSpec } from '../../frontend/src/lib/share-card/slides.js'
import { DECK_LIMITS, DECK_PAPER, DECK_PAPER_PLAIN, DECK_POST, DECK_POST_PLAIN, DECK_SET, DECK_SET_PLAIN, LONG_CREDIT, LONG_TITLE } from '../../frontend/src/lib/share-card/samples.js'

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
const rects = (layout: CardLayout) => layout.commands.filter((c): c is RectCommand => c.kind === 'rect')
const role = (layout: CardLayout, name: TextCommand['role']) => texts(layout).filter(t => t.role === name)
const disjoint = (a: Box, b: Box) => a.x2 <= b.x1 + 0.5 || b.x2 <= a.x1 + 0.5 || a.y2 <= b.y1 + 0.5 || b.y2 <= a.y1 + 0.5
const MARKS: PageMark[] = [{ color: 'green', rects: [{ x1: 0.05, y1: 0.4, x2: 0.9, y2: 0.5 }] }]
const CROPS = [{ width: 900, height: 120, marks: MARKS }, { width: 700, height: 1800, marks: MARKS }]
const source = { title: LONG_TITLE, credit: LONG_CREDIT, page: 4, color: 'blue' as const }
const ctx = (number: number, count: number): SlideContext => ({ source, number, count, items: [{ page: 2, rects: [], color: 'pink' }, { page: 3, rects: [], color: 'green' }, { page: 5, rects: [], color: 'yellow' }] })
const draw = (slide: SlideSpec, look: (typeof LOOKS)[number], number = 2, count = 6, crop?: (typeof CROPS)[number]) => layoutSlide(slide, ctx(number, count), { look, crop }, measure)

/** Text in the safe area, never under 28 px, no two texts on top of each other, nothing over the strip. */
function assertFits(layout: CardLayout, name: string) {
  assert.equal(layout.width, 1080); assert.equal(layout.height, 1350)
  const { safe } = layout, all = texts(layout)
  for (const text of all) {
    assert.ok(text.size >= MIN_TEXT_PX - 1e-9, `${name}: ${text.role} "${text.text}" is ${text.size} px`)
    const { x1, y1, x2, y2 } = text.box
    assert.ok(x1 >= safe.x1 - 0.5 && x2 <= safe.x2 + 0.5 && y1 >= safe.y1 - 0.5 && y2 <= safe.y2 + 0.5, `${name}: ${text.role} "${text.text}" ${JSON.stringify(text.box)} leaves the safe area`)
  }
  // Lines of one paragraph may touch (display type is set at a leading of 1); different elements may not.
  const block = (t: TextCommand) => t.role === 'emphasis' ? 'headline' : t.role
  for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) if (block(a) !== block(b)) assert.ok(disjoint(a.box, b.box), `${name}: ${a.role} "${a.text}" meets ${b.role} "${b.text}"`)
  const strip = all.filter(t => ['footerTitle', 'footerCredit', 'wordmark', 'slideNumber'].includes(t.role)), top = Math.min(...strip.map(t => t.box.y1))
  for (const r of rects(layout)) assert.ok(r.y + r.height <= top + 0.5 && r.x >= safe.x1 - 20 && r.x + r.width <= safe.x2 + 20, `${name}: a rect leaves its room`)
  for (const text of all.filter(t => !strip.includes(t))) assert.ok(text.box.y2 <= top, `${name}: ${text.role} overlaps the strip`)
}

const DECKS = [DECK_POST, DECK_SET, DECK_PAPER, DECK_POST_PLAIN, DECK_SET_PLAIN, DECK_PAPER_PLAIN]

test('every deck slide fits in every look, with numbers and without, and at the limits', () => {
  for (const look of LOOKS) {
    for (const deck of DECKS) for (const [index, slide] of deck.slides.entries()) for (const crop of ['page', 'point', 'lead'].includes(slide.kind) ? CROPS : [undefined])
      assertFits(draw(slide, look, index + 1, deck.slides.length, crop), `${deck.name}/${look}/${index + 1}`)
    for (const [index, slide] of DECK_LIMITS.entries()) assertFits(draw(slide, look), `limits/${look}/${index}`)
  }
})

test('the layout follows the slide\'s numbers; without them it is the text slide', () => {
  const method = DECK_PAPER.slides[2]!, result1 = DECK_PAPER.slides[3]!, result2 = DECK_PAPER.slides[4]!, cover = DECK_POST.slides[0]!
  assert.equal(deckBlock(method)?.kind, 'stats'); assert.equal(deckBlock(result1)?.kind, 'table'); assert.equal(deckBlock(result2)?.kind, 'number')
  assert.equal(deckBlock(cover)?.kind, 'number'); assert.equal(deckBlock(DECK_SET.slides[1]!)?.kind, 'stats')
  for (const kind of ['page', 'point', 'lead'] as const) assert.equal(deckBlock(DECK_SET.slides.concat(DECK_POST.slides, DECK_PAPER.slides).find(s => s.kind === kind)!), undefined)
  for (const look of LOOKS) {
    // Missing fields, empty fields and blank values all draw the slide without numbers.
    const plain = (slide: SlideSpec) => draw(slide, look).commands
    for (const [full, ...variants] of [
      [{ kind: 'method', kicker: 'The method', text: 'Two groups.' }, { kind: 'method', kicker: 'The method', text: 'Two groups.', stats: [] }, { kind: 'method', kicker: 'The method', text: 'Two groups.', stats: [{ value: ' ', label: 'x' }] }],
      [{ kind: 'study', kicker: 'The study', text: 'One school.' }, { kind: 'study', kicker: 'The study', text: 'One school.', stats: [] }],
      [{ kind: 'cover', kicker: 'T', headline: 'A hook' }, { kind: 'cover', kicker: 'T', headline: 'A hook', stat: null }],
      [{ kind: 'result', kicker: 'R', text: 'It helped.' }, { kind: 'result', kicker: 'R', text: 'It helped.', stat: null, rows: [] }, { kind: 'result', kicker: 'R', text: 'It helped.', stat: null, rows: [{ label: 'A', value: '1' }] }],
    ] as SlideSpec[][]) for (const variant of variants) assert.deepEqual(plain(variant), plain(full!))
    assert.equal(role(draw(DECK_PAPER_PLAIN.slides[2]!, look), 'statValue').length, 0)
  }
})

test('stat tiles: one wide tile, two side by side, three as two and one wide, four in a grid; values share one size', () => {
  const stat = (n: number) => Array.from({ length: n }, (_, i) => ({ value: ['312', '1,204', '24 hours', '65B'][i]!, label: 'a label that may run onto a second line here' }))
  for (const look of LOOKS) for (const n of [1, 2, 3, 4]) {
    const layout = draw({ kind: 'method', kicker: 'The method', text: 'Two groups, one term.', stats: stat(n) }, look)
    assertFits(layout, `${look}/${n}`)
    const values = role(layout, 'statValue'), tiles = rects(layout).filter(r => r.radius)
    assert.equal(values.length, n); assert.equal(tiles.length, n)
    assert.equal(new Set(values.map(v => v.size)).size, 1)
    const inner = layout.safe.x2 - layout.safe.x1
    const wide = tiles.filter(r => Math.abs(r.width - inner) < 1)
    assert.equal(wide.length, n === 1 || n === 3 ? 1 : 0, `${look}/${n}`)
    // The sentence is clearly smaller than the values.
    for (const line of role(layout, 'deckText')) assert.ok(line.size < values[0]!.size * 0.6)
    // Tiles in one row share a height.
    const rows = new Map<number, number[]>()
    for (const tile of tiles) rows.set(Math.round(tile.y), [...(rows.get(Math.round(tile.y)) ?? []), tile.height])
    for (const heights of rows.values()) assert.equal(new Set(heights.map(h => Math.round(h))).size, 1)
  }
})

test('a comparison: values right-aligned, the key row marked, bars only when they can be honest', () => {
  const result = DECK_PAPER.slides[3]!
  for (const look of LOOKS) {
    const layout = draw(result, look)
    const values = [...role(layout, 'rowValue'), ...role(layout, 'emphasis')].sort((a, b) => a.y - b.y)
    assert.deepEqual(values.map(v => v.text), ['41%', '29%', '12%', '9%'])
    for (const value of values) assert.ok(Math.abs(value.box.x2 - values[0]!.box.x2) < 1, `${look}: values not aligned`)
    // The row whose value is the result's key number is the one in the emphasis box.
    assert.deepEqual(role(layout, 'emphasis').map(t => t.text), ['41%'])
    // Bars from a common zero: each the same fraction of the longest as its value of the largest.
    const bars = rects(layout).filter(r => r.height > 8 && r.height < 20 && !r.radius).sort((a, b) => a.y - b.y)
    assert.equal(bars.length, 4)
    const ratios = bars.map(bar => bar.width / bars[0]!.width)
    for (const [index, value] of [41, 29, 12, 9].entries()) assert.ok(Math.abs(ratios[index]! - value / 41) < 1e-6, `${look}: bar ${index}`)
  }
  // A range or a negative value: no bars, the table still drawn.
  const mixed = draw(DECK_LIMITS[6]!, 'ink')
  assert.equal(role(mixed, 'rowValue').length + role(mixed, 'emphasis').length, 3)
  assert.equal(rects(mixed).filter(r => r.height > 8 && r.height < 20).length, 0)
  assert.deepEqual(comparable([{ label: 'a', value: '41%' }, { label: 'b', value: '9%' }]), [1, 9 / 41])
  assert.deepEqual(comparable([{ label: 'a', value: '1,204' }, { label: 'b', value: '602' }]), [1, 0.5])
  assert.deepEqual(comparable([{ label: 'a', value: '12.5 GB' }, { label: 'b', value: '25 gb' }]), [0.5, 1])
  for (const values of [['41%', '9'], ['9–12%', '41%'], ['−2%', '41%'], ['-2', '4'], ['<5%', '41%'], ['~40%', '41%'], ['0%', '0%'], ['41%', 'n/a'], ['3 ± 1', '4'], ['1.2k', '900']])
    assert.equal(comparable(values.map(value => ({ label: 'x', value }))), null, values.join(' / '))
})

test('one key number: very large over its label, the sentence smaller and whole, the number not boxed in it', () => {
  for (const look of LOOKS) {
    const layout = draw({ kind: 'result', kicker: 'Result 1', text: '41% higher gains for students given specific comments.', item: 0, stat: { value: '41%', label: 'higher gains' }, rows: [] }, look)
    const value = role(layout, 'statValue')
    assert.deepEqual(value.map(v => v.text), ['41%'])
    assert.ok(value[0]!.size > 200, `${look}: ${value[0]!.size}`)
    assert.equal(role(layout, 'emphasis').length, 0)
    assert.equal(role(layout, 'deckText').map(t => t.text).join(' '), '41% higher gains for students given specific comments.')
    const label = role(layout, 'statLabel')[0]!
    assert.ok(label.box.y1 > value[0]!.box.y2 && role(layout, 'deckText')[0]!.box.y1 > label.box.y2)
    // A long value is drawn smaller so it stays on one line.
    const long = role(draw(DECK_LIMITS[2]!, look), 'statValue')
    assert.equal(long.length, 1); assert.ok(long[0]!.box.x2 <= layout.safe.x2 + 0.5)
  }
})

test('a cover with its key number: the number, its label and the headline; a headline holding the number boxes it instead', () => {
  for (const look of LOOKS) {
    const hero = draw(DECK_POST.slides[0]!, look, 1, 3)
    assert.equal(role(hero, 'statValue')[0]!.text, '41%')
    assert.equal(role(hero, 'headline').map(t => t.text).join(' '), 'Specific feedback beats praise, and the gap keeps growing')
    assert.ok(role(hero, 'headline')[0]!.size > role(hero, 'statLabel')[0]!.size)
    const holds = draw(DECK_LIMITS[5]!, look, 1, 3)
    assert.equal(role(holds, 'statValue').length, 0)
    assert.deepEqual(role(holds, 'emphasis').map(t => t.text), ['41%'])
  }
})

test('the question has its mark, the takeaway its bar at the foot; the kicker sits at one height on every slide', () => {
  for (const look of LOOKS) {
    const question = draw(DECK_PAPER.slides[1]!, look)
    assert.deepEqual(role(question, 'mark').map(t => t.text), ['?'])
    assert.equal(role(draw({ kind: 'question', kicker: 'The question', text: 'Whether praise helps.' }, look), 'mark').length, 0)
    const takeaway = draw(DECK_PAPER.slides[5]!, look, 6, 6)
    const bar = rects(takeaway).find(r => r.color === palette(look, 'blue', 1080, 1350).accent)!
    const words = role(takeaway, 'headline'), strip = Math.min(...texts(takeaway).filter(t => t.role === 'footerTitle').map(t => t.box.y1))
    assert.ok(bar.x + bar.width < words[0]!.box.x1)
    // At the foot: the space under the text is the gap above the strip, not the free space.
    assert.ok(strip - Math.max(...words.map(w => w.box.y2)) < 90, `${look}: ${strip - Math.max(...words.map(w => w.box.y2))}`)
    for (const deck of DECKS) {
      const kickers = deck.slides.flatMap((slide, index) => deckBlock(slide) ? [role(draw(slide, look, index + 1, deck.slides.length), 'kicker')[0]!.y] : [])
      assert.equal(new Set(kickers.map(y => Math.round(y))).size, 1, `${deck.name}/${look}`)
    }
  }
})

test('stat tiles keep 4.5:1 for their values and labels in every look and Marker colour', () => {
  for (const look of LOOKS) for (const color of Object.keys(HIGHLIGHT_HEX) as HighlightColor[]) {
    const p = palette(look, color, 1080, 1350)
    for (const ground of p.groundTones) {
      const tile = mix(p.text, ground, TILE_ALPHA)
      assert.ok(contrast(p.accent, tile) >= 4.5, `${look}/${color}: value ${contrast(p.accent, tile).toFixed(2)}`)
      assert.ok(contrast(mix(p.text, tile, TILE_LABEL_ALPHA), tile) >= 4.5, `${look}/${color}: label ${contrast(mix(p.text, tile, TILE_LABEL_ALPHA), tile).toFixed(2)}`)
    }
  }
})
