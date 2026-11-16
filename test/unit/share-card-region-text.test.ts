import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD, cleanPassage, type PageRect } from '../../src/shared/share-card.js'
import { MIDDLE_REGION, firstPageRegion, linesOf, regionText, type TextRun } from '../../frontend/src/lib/share-card/region-text.js'

const A4 = { width: 595.28, height: 841.89 }
/** One character's width and one line's height, as page fractions (about 6 and 12 points). */
const CHAR = 0.01
const HEIGHT = 0.0143
const near = (actual: number, expected: number, within = 1e-6) => assert.ok(Math.abs(actual - expected) < within, `${actual} ≠ ${expected}`)

/** A line of words starting at `x` with its baseline at `y`: one run per word, a space's width apart, as pdf.js gives them. */
function line(text: string, x: number, y: number, height = HEIGHT): TextRun[] {
  const runs: TextRun[] = []
  let left = x
  for (const word of text.split(' ')) {
    const width = word.length * CHAR * height / HEIGHT
    runs.push({ text: word, box: { x1: left, y1: y - height, x2: left + width, y2: y } })
    left += width + CHAR * height / HEIGHT
  }
  return runs
}
/** Lines one under the other, 1.4 line heights apart. */
const block = (texts: string[], x: number, top: number) => texts.flatMap((text, index) => line(text, x, top + index * 1.4 * HEIGHT))

test('the text inside a region: words whose centre is inside, one line per text line, top to bottom', () => {
  const runs = block(['Above the region stays out.', 'Accuracy rises with steps', 'Steps 0 10 20', 'Below the region stays out.'], 0.1, 0.3)
  const region: PageRect = { x1: 0.05, y1: 0.3 + 0.7 * HEIGHT, x2: 0.9, y2: 0.3 + 3 * HEIGHT }
  assert.equal(regionText(runs, region, A4), 'Accuracy rises with steps\nSteps 0 10 20')
  // A word whose box crosses the region's edge counts only when its centre is inside.
  // "rises" (0.19 to 0.24) and "20" (0.21 to 0.23) both cross x = 0.218; only the first has its centre inside.
  const half: PageRect = { x1: 0.05, y1: region.y1, x2: 0.218, y2: region.y2 }
  assert.equal(regionText(runs, half, A4), 'Accuracy rises\nSteps 0 10')
})

test('a figure with no text inside the region gives an empty string', () => {
  const runs = block(['Text above the figure.'], 0.1, 0.1)
  assert.equal(regionText(runs, { x1: 0.1, y1: 0.4, x2: 0.9, y2: 0.7 }, A4), '')
  assert.equal(regionText([], MIDDLE_REGION, A4), '')
})

test('the text is cleaned as the contract cleans a passage: ligatures, a word split at a line end, extra spaces', () => {
  const runs = [...line('the cost grows with the se-', 0.1, 0.2), ...line('quence length. The ﬁrst  results', 0.1, 0.2 + 1.4 * HEIGHT)]
  const text = regionText(runs, { x1: 0, y1: 0, x2: 1, y2: 0.5 }, A4)
  assert.equal(text, 'the cost grows with the sequence\nlength. The first results')
  // What the server stores is the same text with the line breaks collapsed.
  assert.equal(cleanPassage(text), cleanPassage('the cost grows with the se-\nquence length. The ﬁrst results'))
})

test('runs that touch, or carry their own spaces, are joined as pdf.js wrote them', () => {
  const runs: TextRun[] = [
    { text: 'Fig', box: { x1: 0.1, y1: 0.2, x2: 0.13, y2: 0.2 + HEIGHT } },
    { text: 'ure 2: ', box: { x1: 0.13, y1: 0.2, x2: 0.2, y2: 0.2 + HEIGHT } },
    { text: 'loss', box: { x1: 0.2, y1: 0.2, x2: 0.24, y2: 0.2 + HEIGHT } },
  ]
  assert.equal(regionText(runs, { x1: 0, y1: 0, x2: 1, y2: 1 }, A4), 'Figure 2: loss')
})

test('a region across two columns reads the left column, then the right, after a title that spans both', () => {
  const title = line('A title across both columns of the page, set in one line', 0.1, 0.1)
  const left = block(['Left one', 'Left two', 'Left three'], 0.1, 0.15)
  const right = block(['Right one', 'Right two', 'Right three'], 0.55, 0.15)
  const text = regionText([...right, ...title, ...left], { x1: 0, y1: 0, x2: 1, y2: 0.5 }, A4)
  assert.equal(text, 'A title across both columns of the page, set in one line\nLeft one\nLeft two\nLeft three\nRight one\nRight two\nRight three')
  // Inside one column, the other column is left out.
  assert.equal(regionText([...right, ...left], { x1: 0.05, y1: 0, x2: 0.5, y2: 0.5 }, A4), 'Left one\nLeft two\nLeft three')
})

/** A whole line as one run, as pdf.js often gives it: its box as wide as its characters, spaces included. */
const wholeLine = (text: string, x: number, y: number): TextRun => ({ text, box: { x1: x, y1: y - HEIGHT, x2: x + text.length * CHAR, y2: y } })

test('words are chosen one by one inside a run that holds a whole line', () => {
  // Nine five-letter words, one run from 0.1 to 0.63: word i starts at 0.1 + 0.06 i, its centre 0.025 further on.
  const run = wholeLine('word1 word2 word3 word4 word5 word6 word7 word8 word9', 0.1, 0.3)
  const third = (run.box.x2 - run.box.x1) / 3
  assert.equal(regionText([run], { x1: run.box.x1 + third, y1: 0.2, x2: run.box.x1 + 2 * third, y2: 0.4 }, A4), 'word4 word5 word6')
  // A box edge through a word: the word counts when its centre is inside, and not when it is not.
  const centre5 = 0.1 + 4 * 0.06 + 0.025
  assert.equal(regionText([run], { x1: 0.29, y1: 0.2, x2: centre5 + 0.001, y2: 0.4 }, A4), 'word4 word5')
  assert.equal(regionText([run], { x1: 0.29, y1: 0.2, x2: centre5 - 0.001, y2: 0.4 }, A4), 'word4')
  assert.equal(regionText([run], { x1: centre5 - 0.001, y1: 0.2, x2: 1, y2: 0.4 }, A4), 'word5 word6 word7 word8 word9')
})

test('a box over one column of a two-column page takes only that column, however pdf.js split the rows', () => {
  const rows = [['Left one', 'Right one'], ['Left two', 'Right two'], ['Left three', 'Right three']]
  const y = (index: number) => 0.2 + index * 1.4 * HEIGHT
  // Each column's part of a row as its own run.
  const separate = rows.flatMap(([left, right], index) => [wholeLine(left!, 0.1, y(index)), wholeLine(right!, 0.55, y(index))])
  // Harder: each row as one run, the gutter held by spaces.
  const joined = rows.map(([left, right], index) => wholeLine(`${left}${' '.repeat(45 - left!.length)}${right}`, 0.1, y(index)))
  for (const runs of [separate, joined]) {
    assert.equal(regionText(runs, { x1: 0.05, y1: 0.1, x2: 0.5, y2: 0.4 }, A4), 'Left one\nLeft two\nLeft three')
    assert.equal(regionText(runs, { x1: 0.5, y1: 0.1, x2: 0.95, y2: 0.4 }, A4), 'Right one\nRight two\nRight three')
  }
})

test(`the text is cut to ${CARD.passageMax} characters at a line break`, () => {
  const texts = Array.from({ length: 300 }, (_, index) => `Line ${index} of a long table with several cells`)
  const runs = texts.flatMap((text, index) => line(text, 0.05, 0.02 + index * 0.0031, 0.003))
  const text = regionText(runs, { x1: 0, y1: 0, x2: 1, y2: 1 }, A4)
  assert.ok(text.length <= CARD.passageMax && text.length > CARD.passageMax - 60, `${text.length}`)
  assert.ok(text.startsWith('Line 0 of a long table'))
  assert.match(text, /cells$/)
  // A single line longer than the limit is cut at a word.
  const long: TextRun[] = Array.from({ length: 1400 }, (_, index) => ({ text: 'word', box: { x1: index * 0.0007, y1: 0.5, x2: index * 0.0007 + 0.0005, y2: 0.5005 } }))
  const cut = regionText(long, { x1: 0, y1: 0, x2: 1, y2: 1 }, A4)
  assert.ok(cut.length <= CARD.passageMax && cut.endsWith('word'), `${cut.length}`)
})

test('the page as text lines, with their words joined', () => {
  const lines = linesOf([...line('second line', 0.1, 0.3), ...line('first line', 0.1, 0.2)], A4)
  assert.deepEqual(lines.map(entry => entry.text), ['first line', 'second line'])
  near(lines[0]!.box.x1, 0.1); near(lines[0]!.box.y2, 0.2)
})

// ── The first page ────────────────────────────────────────────────────────────────────────────────────────────────────
const TITLE = line('Sparse attention at a fraction of the cost', 0.2, 0.1, 0.024)
const AUTHORS = line('Ada Lovelace and Alan Turing', 0.3, 0.14)
const ABSTRACT = block(['Abstract', 'We study attention whose cost grows with the square', 'of the sequence length and propose a sparse pattern', 'that keeps quality at a third of the cost.'], 0.15, 0.2)
const BODY = block(['Attention lets every position look at every other', 'position in the sequence, which is costly.'], 0.1, 0.32 + 1.4 * HEIGHT)
const FOOT = line('1', 0.5, 0.95)
const abstractBottom = 0.2 + 3 * 1.4 * HEIGHT

test('the first page: from the first line to the last before "Introduction", across the text with a small margin', () => {
  for (const heading of ['1 Introduction', '1. INTRODUCTION', 'I. Introduction', 'Introduction']) {
    const runs = [...TITLE, ...AUTHORS, ...ABSTRACT, ...line(heading, 0.1, 0.32), ...BODY, ...FOOT]
    const box = firstPageRegion(runs, A4)
    const allLeft = 0.1, allRight = Math.max(...runs.map(run => run.box.x2))
    assert.ok(box.x1 < allLeft && box.x1 > allLeft - 0.04, `${heading}: x1 ${box.x1}`)
    assert.ok(box.x2 > allRight && box.x2 < allRight + 0.04, `${heading}: x2 ${box.x2}`)
    assert.ok(box.y1 < 0.1 - 0.024 && box.y1 > 0.1 - 0.024 - 0.03, `${heading}: y1 ${box.y1}`)
    // The abstract's last line is in; the heading is not.
    assert.ok(box.y2 >= abstractBottom && box.y2 < 0.32 - HEIGHT, `${heading}: y2 ${box.y2}`)
    // The box holds the title, the authors and the abstract.
    assert.equal(regionText(runs, box, A4).split('\n')[0], 'Sparse attention at a fraction of the cost')
    assert.match(regionText(runs, box, A4), /third of the cost\.$/)
  }
})

test('a line that only mentions the introduction is not its heading', () => {
  const runs = [...TITLE, ...ABSTRACT, ...line('In the introduction we argue', 0.1, 0.25), ...BODY]
  const box = firstPageRegion(runs, A4)
  const top = Math.min(...runs.map(run => run.box.y1)), bottom = Math.max(...runs.map(run => run.box.y2))
  // No heading: the top 55% of the text, with the margin above.
  near(box.y2, top + 0.55 * (bottom - top), 1e-9)
})

test('without an "Introduction" heading, the top 55% of the text area', () => {
  const runs = [...TITLE, ...AUTHORS, ...ABSTRACT, ...BODY, ...FOOT]
  const box = firstPageRegion(runs, A4)
  const top = Math.min(...runs.map(run => run.box.y1)), bottom = Math.max(...runs.map(run => run.box.y2))
  near(box.y2, top + 0.55 * (bottom - top), 1e-9)
  assert.ok(box.y1 < top)
  assert.ok(box.x1 < 0.1 && box.x2 > Math.max(...runs.map(run => run.box.x2)))
})

test('a page without a text layer: the top 55% of the page', () => {
  assert.deepEqual(firstPageRegion([], A4), { x1: 0, y1: 0, x2: 1, y2: 0.55 })
})

test('the first-page box is never smaller than a region may be, and stays on the page', () => {
  const runs = [...line('Title', 0.45, 0.02, 0.01), ...line('1 Introduction', 0.45, 0.04, 0.01)]
  const box = firstPageRegion(runs, A4)
  assert.ok(box.x2 - box.x1 >= 0.1 - 1e-9 && box.y2 - box.y1 >= 0.1 - 1e-9, JSON.stringify(box))
  for (const value of [box.x1, box.y1, box.x2, box.y2]) assert.ok(value >= 0 && value <= 1)
})

test('the region a reader starts from sits in the middle of the page', () => {
  assert.ok(MIDDLE_REGION.x1 > 0 && MIDDLE_REGION.x2 < 1 && MIDDLE_REGION.y1 > 0.2 && MIDDLE_REGION.y2 < 0.8)
  near((MIDDLE_REGION.x1 + MIDDLE_REGION.x2) / 2, 0.5)
})
