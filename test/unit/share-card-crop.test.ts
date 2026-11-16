import test from 'node:test'
import assert from 'node:assert/strict'
import { autoCrop, boundingBox, cropBox, cropMarks, fitSheet, planCrop, readerCrop, runBox, textLines } from '../../frontend/src/lib/share-card/crop-box.js'

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)
const rounded = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))
const A4 = { width: 595.28, height: 841.89 }
const lines = [{ x1: 0.12, y1: 0.10, x2: 0.88, y2: 0.12 }, { x1: 0.12, y1: 0.12, x2: 0.86, y2: 0.14 }, { x1: 0.12, y1: 0.14, x2: 0.5, y2: 0.16 }]

test('the crop widens the highlight by 4% a side and adds lines of context above and below', () => {
  const box = cropBox(lines, 3)
  near(box.x1, 0.08); near(box.x2, 0.92)
  // A line is the distance between the highlight's lines (0.02).
  near(box.y1, 0.10 - 3 * 0.02); near(box.y2, 0.16 + 3 * 0.02)
  const none = cropBox(lines, 0)
  near(none.y1, 0.10); near(none.y2, 0.16)
  assert.deepEqual(boundingBox(lines), { x1: 0.12, y1: 0.10, x2: 0.88, y2: 0.16 })
})

test('a highlight over several lines measures a line of context by the distance between its lines', () => {
  // Boxes 0.012 tall on lines 0.016 apart: context lands on line boundaries, not mid-line.
  const spaced = [{ x1: 0.12, y1: 0.300, x2: 0.88, y2: 0.312 }, { x1: 0.12, y1: 0.316, x2: 0.88, y2: 0.328 }, { x1: 0.12, y1: 0.332, x2: 0.4, y2: 0.344 }]
  const box = cropBox(spaced, 3)
  near(box.y1, 0.300 - 3 * 0.016); near(box.y2, 0.344 + 3 * 0.016)
  // Several boxes on one line count as one line; a single line falls back to 1.35 × its height.
  const oneLine = [{ x1: 0.12, y1: 0.3, x2: 0.3, y2: 0.312 }, { x1: 0.35, y1: 0.3005, x2: 0.6, y2: 0.312 }]
  near(cropBox(oneLine, 1).y1, 0.3 - 1.35 * (0.012 + 0.0115) / 2)
})

test('a narrow highlight is widened to 55% of the page around its centre, inside the page', () => {
  const word = cropBox([{ x1: 0.4, y1: 0.5, x2: 0.5, y2: 0.52 }], 1)
  near(word.x2 - word.x1, 0.55); near((word.x1 + word.x2) / 2, 0.45)
  const left = cropBox([{ x1: 0.01, y1: 0.5, x2: 0.1, y2: 0.52 }], 1)
  near(left.x1, 0); near(left.x2, 0.55)
  const right = cropBox([{ x1: 0.9, y1: 0.5, x2: 0.99, y2: 0.52 }], 1)
  near(right.x1, 0.45); near(right.x2, 1)
  const top = cropBox([{ x1: 0.1, y1: 0.0, x2: 0.9, y2: 0.02 }, { x1: 0.1, y1: 0.97, x2: 0.9, y2: 1 }], 3)
  assert.equal(top.y1, 0); assert.equal(top.y2, 1)
})

test('an automatic crop too tall for the sheet steps down through fewer lines of context, then is unavailable', () => {
  const sheet = { width: 896, height: 600 }
  assert.deepEqual(autoCrop(lines, A4, sheet, 3), cropBox(lines, 3))
  // Each crop's sheet height at full width: 3 lines ≈ 272 px, 1 line ≈ 151 px, none ≈ 91 px on this page.
  const height = (extra: number) => { const box = cropBox(lines, extra); return sheet.width * (box.y2 - box.y1) * A4.height / ((box.x2 - box.x1) * A4.width) }
  assert.deepEqual(autoCrop(lines, A4, { width: 896, height: Math.floor(height(3)) }, 3), cropBox(lines, 1))
  assert.deepEqual(autoCrop(lines, A4, { width: 896, height: Math.floor(height(1)) }, 3), cropBox(lines, 0))
  assert.equal(autoCrop(lines, A4, { width: 896, height: Math.floor(height(0)) }, 3), null)
  assert.equal(autoCrop([], A4, sheet, 3), null)
  assert.equal(autoCrop(lines, { width: 0, height: 10 }, sheet, 3), null)
  assert.equal(autoCrop(lines, A4, { width: 0, height: 600 }, 3), null)
})

test('the context setting is the most an automatic crop tries', () => {
  const sheet = { width: 896, height: 2000 }
  assert.deepEqual(autoCrop(lines, A4, sheet, 1), cropBox(lines, 1))
  assert.deepEqual(autoCrop(lines, A4, sheet, 0), cropBox(lines, 0))
  const box = cropBox(lines, 1)
  const oneLine = 896 * (box.y2 - box.y1) * A4.height / ((box.x2 - box.x1) * A4.width)
  assert.deepEqual(autoCrop(lines, A4, { width: 896, height: Math.floor(oneLine) }, 1), cropBox(lines, 0))
  assert.equal(autoCrop(lines, A4, { width: 896, height: 10 }, 0), null)
})

test('a reader\'s crop is ordered and clamped to the page; one with no area means automatic', () => {
  assert.deepEqual(readerCrop({ x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.6 }), { x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.6 })
  assert.deepEqual(readerCrop({ x1: 0.9, y1: 0.6, x2: 0.1, y2: 0.2 }), { x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.6 })
  assert.deepEqual(readerCrop({ x1: -0.2, y1: -1, x2: 1.4, y2: 2 }), { x1: 0, y1: 0, x2: 1, y2: 1 })
  assert.equal(readerCrop(null), null)
  assert.equal(readerCrop({ x1: 0.3, y1: 0.2, x2: 0.3, y2: 0.8 }), null)
  assert.equal(readerCrop({ x1: 1.2, y1: 0.2, x2: 1.5, y2: 0.8 }), null)
  assert.equal(readerCrop({ x1: Number.NaN, y1: 0.2, x2: 0.5, y2: 0.8 }), null)
})

test('a sheet takes the full width, or is drawn narrower so a tall crop fits its height', () => {
  assert.deepEqual(fitSheet({ width: 1000, height: 500 }, { width: 896, height: 600 }), { width: 896, height: 448 })
  assert.deepEqual(fitSheet({ width: 1000, height: 1000 }, { width: 896, height: 600 }), { width: 600, height: 600 })
  assert.deepEqual(fitSheet({ width: 100, height: 2000 }, { width: 896, height: 600 }), { width: 30, height: 600 })
  assert.equal(fitSheet({ width: 0, height: 10 }, { width: 896, height: 600 }), null)
  assert.equal(fitSheet({ width: 10, height: 10 }, { width: 896, height: 0 }), null)
})

test('marks are given as fractions of the crop, clipped at its edge, and dropped outside it', () => {
  const crop = { x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.3 }
  const marks = cropMarks([
    { color: 'yellow', rects: [{ x1: 0.1, y1: 0.1, x2: 0.35, y2: 0.2 }, { x1: 0.0, y1: 0.25, x2: 0.9, y2: 0.4 }] },
    { color: 'green', rects: [{ x1: 0.2, y1: 0.5, x2: 0.4, y2: 0.52 }] },
    { color: 'pink', rects: [{ x1: 0.2, y1: 0.05, x2: 0.4, y2: 0.08 }, { x1: 0.35, y1: 0.15, x2: 0.6, y2: 0.2 }] },
    { color: 'blue', rects: [{ x1: 0.6, y1: 0.15, x2: 0.7, y2: 0.2 }] },
  ], crop)
  assert.deepEqual(rounded(marks), [
    { color: 'yellow', rects: [{ x1: 0, y1: 0, x2: 0.5, y2: 0.5 }, { x1: 0, y1: 0.75, x2: 1, y2: 1 }] },
    { color: 'pink', rects: [{ x1: 0.5, y1: 0.25, x2: 1, y2: 0.5 }] },
  ])
})

test('a crop plan: the reader\'s crop or the automatic one, the marks inside it, and a render as large as the sheet drawn', () => {
  const sheet = { width: 896, height: 600 }
  const own = { rects: lines, color: 'blue' as const }
  // Automatic, without marks: the post's own highlight in its own colour.
  const auto = planCrop(own, A4, { sheet, crop: null, marks: [], extraLines: 3 })!
  assert.deepEqual(auto.box, cropBox(lines, 3))
  assert.deepEqual(auto.marks.map(m => m.color), ['blue'])
  assert.deepEqual(rounded(auto.marks[0]!.rects), rounded(cropMarks([own], auto.box)[0]!.rects))
  assert.equal(auto.width, 896)
  near(auto.scale, 896 / ((auto.box.x2 - auto.box.x1) * A4.width))
  assert.equal(auto.height, Math.round((auto.box.y2 - auto.box.y1) * A4.height * auto.scale))
  // The context setting is passed on.
  assert.deepEqual(planCrop(own, A4, { sheet, crop: null, marks: [], extraLines: 1 })!.box, cropBox(lines, 1))
  // The page's marks replace the fallback, each clipped to the crop.
  const marks = [{ rects: lines, color: 'yellow' as const }, { rects: [{ x1: 0.1, y1: 0.9, x2: 0.5, y2: 0.92 }], color: 'green' as const }]
  assert.deepEqual(planCrop(own, A4, { sheet, crop: null, marks, extraLines: 3 })!.marks.map(m => m.color), ['yellow'])
  // A reader's tall crop is accepted and rendered at the narrower width it is drawn at.
  const tall = planCrop(own, A4, { sheet, crop: { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.95 }, marks, extraLines: 3 })!
  assert.deepEqual(tall.box, { x1: 0.1, y1: 0.05, x2: 0.9, y2: 0.95 })
  assert.deepEqual(tall.marks.map(m => m.color), ['yellow', 'green'])
  assert.equal(tall.height, 600)
  assert.ok(tall.width < 896 && Math.abs(tall.width - 600 * 0.8 * A4.width / (0.9 * A4.height)) < 1)
  // A reader's crop with no area is automatic; an automatic crop that cannot fit is unavailable.
  assert.deepEqual(planCrop(own, A4, { sheet, crop: { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.6 }, marks: [], extraLines: 3 })!.box, cropBox(lines, 3))
  assert.equal(planCrop(own, A4, { sheet: { width: 896, height: 20 }, crop: null, marks: [], extraLines: 3 }), null)
  assert.equal(planCrop({ rects: [], color: 'yellow' }, A4, { sheet, crop: null, marks: [], extraLines: 3 }), null)
  // The render never exceeds the largest canvas side.
  const whole = planCrop(own, A4, { sheet: { width: 20_000, height: 40_000 }, crop: { x1: 0, y1: 0, x2: 1, y2: 1 }, marks: [], extraLines: 3 })!
  assert.ok(whole.width <= 4095 && whole.height <= 4095, `${whole.width}×${whole.height}`)
})

// ── Automatic crops snapped to the page's text ─────────────────────────────────────────────────────────────────────
// Text runs as pdf.js gives them, on a US Letter page in points, turned into page fractions by runBox.
const LETTER = { width: 612, height: 792 }
const run = (left: number, right: number, baseline: number, size = 10) => runBox(left, right, baseline, size, LETTER)
const column = (left: number, right: number, first: number, count: number, pitch = 13, size = 10) =>
  Array.from({ length: count }, (_, index) => run(left, right, first + index * pitch, size))
/** A highlight on one line from `left` to `right`, as the reader's text layer gives it. */
const mark = (left: number, right: number, baseline: number, size = 10) =>
  ({ x1: left / LETTER.width, y1: (baseline - 0.82 * size) / LETTER.height, x2: right / LETTER.width, y2: (baseline + 0.26 * size) / LETTER.height })
const tall = { width: 896, height: 5000 }
const sheetHeight = (box: { x1: number; y1: number; x2: number; y2: number }, width = 896) =>
  width * (box.y2 - box.y1) * LETTER.height / ((box.x2 - box.x1) * LETTER.width)
/** Every run is wholly inside the crop or wholly outside it: no line is cut through, no word at the sides. */
function assertNothingCut(box: { x1: number; y1: number; x2: number; y2: number }, runs: Array<{ x1: number; y1: number; x2: number; y2: number }>) {
  for (const r of runs) {
    const across = r.x2 > box.x1 && r.x1 < box.x2, down = r.y2 > box.y1 && r.y1 < box.y2
    if (!across || !down) continue
    assert.ok(r.y1 >= box.y1 - 1e-9 && r.y2 <= box.y2 + 1e-9, `a line is cut: ${JSON.stringify(r)} in ${JSON.stringify(box)}`)
    assert.ok(r.x1 >= box.x1 - 1e-9 && r.x2 <= box.x2 + 1e-9, `a line is cut at the side: ${JSON.stringify(r)} in ${JSON.stringify(box)}`)
  }
}
const inside = (box: { y1: number; y2: number }, runs: Array<{ y1: number; y2: number }>) => runs.filter(r => r.y1 >= box.y1 - 1e-9 && r.y2 <= box.y2 + 1e-9).length

test('text runs on one row join into one line piece, and a wide gap splits them into columns', () => {
  const pieces = textLines([run(72, 200, 100), run(203, 300, 100), run(330, 540, 100), run(72, 540, 113)], LETTER)
  assert.deepEqual(rounded(pieces), rounded([run(72, 300, 100), run(330, 540, 100), run(72, 540, 113)]))
  assert.deepEqual(textLines([], LETTER), [])
})

test('an automatic crop takes whole lines and the width of the text column, not 55% of the page', () => {
  const runs = column(72, 540, 100, 40)
  // A short phrase in the middle of the 11th line, with one line of context.
  const box = autoCrop([mark(250, 330, 230)], LETTER, tall, 1, runs)!
  assertNothingCut(box, runs)
  assert.equal(inside(box, runs), 3)
  assert.ok(box.x1 < 72 / 612 && box.x1 > 50 / 612 && box.x2 > 540 / 612 && box.x2 < 562 / 612, JSON.stringify(box))
  // The edges sit in the gaps next to the first and last lines.
  assert.ok(box.y1 < runs[9]!.y1 && box.y1 > runs[8]!.y2 && box.y2 > runs[11]!.y2 && box.y2 < runs[12]!.y1)
  assert.equal(inside(autoCrop([mark(250, 330, 230)], LETTER, tall, 3, runs)!, runs), 7)
  assert.equal(inside(autoCrop([mark(250, 330, 230)], LETTER, tall, 0, runs)!, runs), 1)
})

test('a heading above the context is taken whole or left out, never cut', () => {
  const runs = [...column(72, 540, 100, 6), run(72, 180, 196, 12), ...column(72, 540, 214, 10)]
  for (const extra of [0, 1, 3] as const) for (const line of [0, 1, 2]) {
    const box = autoCrop([mark(100, 400, 214 + line * 13)], LETTER, tall, extra, runs)!
    assertNothingCut(box, runs)
  }
})

test('on a two-column page the crop keeps to the highlight\'s column; across both it takes both', () => {
  // Columns 54–298 and 314–558; the right one's baselines are offset by half a line.
  const left = column(54, 298, 100, 40), right = column(314, 558, 106.5, 40), runs = [...left, ...right]
  const inLeft = autoCrop([mark(100, 250, 100 + 13 * 12)], LETTER, tall, 3, runs)!
  assertNothingCut(inLeft, runs)
  assert.ok(inLeft.x2 < 314 / 612 && inLeft.x1 < 54 / 612, JSON.stringify(inLeft))
  assert.equal(inside(inLeft, left), 7)
  // The same margin on both sides, though one side meets the gutter.
  near((54 / 612 - inLeft.x1) * 1e3, (inLeft.x2 - 298 / 612) * 1e3)
  const inRight = autoCrop([mark(320, 500, 106.5 + 13 * 20)], LETTER, tall, 1, runs)!
  assertNothingCut(inRight, runs)
  assert.ok(inRight.x1 > 298 / 612 && inRight.x2 > 558 / 612, JSON.stringify(inRight))
  // The last line of the left column and the first of the right: the union of both columns.
  const across = autoCrop([mark(54, 298, 100 + 13 * 39), mark(314, 450, 106.5)], LETTER, tall, 0, runs)!
  assert.ok(across.x1 < 54 / 612 && across.x2 > 558 / 612, JSON.stringify(across))
  assertNothingCut(across, runs)
})

test('text across both columns stops the context, which is then taken from the other side', () => {
  const title = run(54, 558, 80, 16)
  const left = column(54, 298, 110, 30), right = column(314, 558, 110, 30), runs = [title, ...left, ...right]
  const box = autoCrop([mark(60, 200, 110)], LETTER, tall, 3, runs)!
  assertNothingCut(box, runs)
  assert.ok(box.y1 >= title.y2 && box.x2 < 314 / 612, JSON.stringify(box))
  assert.equal(inside(box, left), 7)
  // A gap of several lines (a figure) stops it too.
  const split = [...column(72, 540, 100, 10), ...column(72, 540, 400, 10)]
  const above = autoCrop([mark(80, 300, 100 + 13 * 8)], LETTER, tall, 3, split)!
  assert.ok(above.y2 < split[10]!.y1, JSON.stringify(above))
  assert.equal(inside(above, split), 7)
})

test('the automatic crop grows by whole lines, balanced, until its sheet fills the room', () => {
  const runs = column(72, 540, 100, 45)
  const highlight = [mark(100, 400, 100 + 13 * 20)]
  const minimum = autoCrop(highlight, LETTER, { width: 896, height: 5000 }, 1, runs)!
  for (const fill of [300, 600, 900]) {
    const box = autoCrop(highlight, LETTER, { width: 896, height: 5000, fill }, 1, runs)!
    assertNothingCut(box, runs)
    const lines = inside(box, runs), pitch = sheetHeight(box) * 13 / ((box.y2 - box.y1) * LETTER.height)
    assert.ok(sheetHeight(box) <= fill + 1e-6 && sheetHeight(box) > fill - 1.5 * pitch, `fill ${fill}: ${sheetHeight(box)}`)
    assert.ok(lines >= 3)
    // Balanced: as many lines above the highlight as below, or one more above.
    const above = runs.slice(0, 20).filter(r => r.y1 >= box.y1).length, below = runs.slice(21).filter(r => r.y2 <= box.y2).length
    assert.ok(above - below === 0 || above - below === 1, `fill ${fill}: ${above} above, ${below} below`)
  }
  // A fill below the minimum context keeps the minimum; the room still caps the minimum.
  assert.deepEqual(autoCrop(highlight, LETTER, { width: 896, height: 5000, fill: 10 }, 1, runs), minimum)
  // Near the top of the text, the lines come from below.
  const top = autoCrop([mark(100, 400, 100 + 13)], LETTER, { width: 896, height: 5000, fill: 600 }, 1, runs)!
  assert.equal(runs.slice(0, 1).filter(r => r.y1 >= top.y1).length, 1)
  assert.ok(inside(top, runs) > 10)
  // The whole page's text fits: everything, and no more.
  const all = autoCrop(highlight, LETTER, { width: 896, height: 50_000, fill: 50_000 }, 1, runs)!
  assert.equal(inside(all, runs), 45)
})

test('a crop that grows downwards never ends on a heading without the line under it', () => {
  const heading = run(72, 160, 240, 12)
  const runs = [...column(72, 540, 100, 10), heading, ...column(72, 540, 258, 10)]
  let seen = 0
  for (let fill = 60; fill <= 900; fill += 5) {
    const box = autoCrop([mark(100, 400, 165)], LETTER, { width: 896, height: 5000, fill }, 0, runs)!
    assertNothingCut(box, runs)
    if (heading.y1 >= box.y1 && heading.y2 <= box.y2) {
      seen++
      assert.ok(runs[11]!.y2 <= box.y2, `fill ${fill}: the crop ends on the heading`)
    }
  }
  assert.ok(seen > 0)
})

test('an automatic crop with text still steps down through less context when the room is short', () => {
  const runs = column(72, 540, 100, 40), highlight = [mark(100, 400, 230)]
  const three = autoCrop(highlight, LETTER, tall, 3, runs)!, one = autoCrop(highlight, LETTER, tall, 1, runs)!, none = autoCrop(highlight, LETTER, tall, 0, runs)!
  assert.deepEqual(autoCrop(highlight, LETTER, { width: 896, height: Math.floor(sheetHeight(three)) }, 3, runs), one)
  assert.deepEqual(autoCrop(highlight, LETTER, { width: 896, height: Math.floor(sheetHeight(one)) }, 3, runs), none)
  // After stepping down, the crop still grows into the room it has.
  assert.equal(inside(autoCrop(highlight, LETTER, { width: 896, height: Math.floor(sheetHeight(one)), fill: 5000 }, 3, runs)!, runs), 2)
  assert.equal(autoCrop(highlight, LETTER, { width: 896, height: Math.floor(sheetHeight(none)) }, 3, runs), null)
})

test('without a usable text layer the automatic crop is the old one', () => {
  const highlight = [mark(250, 330, 230)]
  for (const extra of [0, 1, 3] as const) {
    assert.deepEqual(autoCrop(highlight, LETTER, tall, extra, []), cropBox(highlight, extra))
    // Text elsewhere on the page, none of it under the highlight (a scanned page with a printed header).
    assert.deepEqual(autoCrop(highlight, LETTER, { ...tall, fill: 4000 }, extra, [run(72, 300, 40)]), cropBox(highlight, extra))
  }
})

test('a reader\'s crop is drawn exactly as set, with or without the post\'s own boxes', () => {
  const runs = column(72, 540, 100, 40)
  const crop = { x1: 0.1, y1: 0.2, x2: 0.7, y2: 0.45 }
  const pink = { rects: [mark(100, 300, 230), mark(100, 300, 700)], color: 'pink' as const }
  // A region post: no boxes of its own; the marks come only from the page.
  const region = planCrop({ rects: [], color: 'yellow' }, LETTER, { sheet: { width: 896, height: 600, fill: 600 }, crop, marks: [pink], extraLines: 3 }, runs)!
  assert.deepEqual(region.box, crop)
  assert.deepEqual(region.marks.map(m => [m.color, m.rects.length]), [['pink', 1]])
  assert.deepEqual(planCrop({ rects: [], color: 'yellow' }, LETTER, { sheet: { width: 896, height: 600 }, crop, marks: [], extraLines: 3 }, runs)!.marks, [])
  // Without a crop, a region post has nothing to start from.
  assert.equal(planCrop({ rects: [], color: 'yellow' }, LETTER, { sheet: { width: 896, height: 600 }, crop: null, marks: [pink], extraLines: 3 }, runs), null)
  // The automatic crop is planned from the text and the fill.
  const sheet = { width: 896, height: 1000, fill: 500 }
  assert.deepEqual(planCrop({ rects: [mark(250, 330, 230)], color: 'yellow' }, LETTER, { sheet, crop: null, marks: [], extraLines: 1 }, runs)!.box,
    autoCrop([mark(250, 330, 230)], LETTER, sheet, 1, runs))
})

test('lines set so tight that their boxes overlap still give a crop of just the lines asked for', () => {
  // Pitch 11 for 10-point text: each line's box reaches a little into the next one's, as in a dense abstract.
  const runs = column(100, 500, 100, 40, 11), centre = (r: { y1: number; y2: number }) => (r.y1 + r.y2) / 2
  const highlight = [16, 17, 18, 19].map(line => mark(100, 500, 100 + 11 * line))
  const lines = (box: { y1: number; y2: number }) => runs.filter(r => centre(r) > box.y1 && centre(r) < box.y2).length
  for (const [extra, count] of [[3, 10], [1, 6], [0, 4]] as const) {
    const box = autoCrop(highlight, LETTER, { width: 896, height: 600 }, extra, runs)!
    assert.ok(box, `extra ${extra}: no crop`)
    assert.equal(lines(box), count, `extra ${extra}: ${JSON.stringify(box)}`)
  }
  // A room that fits the highlighted lines and some context: never refused.
  const own = autoCrop(highlight, LETTER, { width: 896, height: 260 }, 0, runs)
  assert.ok(own && lines(own) === 4)
})

test('an automatic crop is never refused when the plain rule fits, whatever the text layer', () => {
  // A small seeded generator, so a failure can be replayed.
  let seed = 20261116
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)]!
  for (let round = 0; round < 400; round++) {
    const size = 7 + random() * 6, pitch = size * (0.95 + random() * 0.6), columns = pick([1, 1, 2] as const)
    const left = 40 + random() * 80, right = 612 - 40 - random() * 80, gutter = 10 + random() * 20
    const spans = columns === 1 ? [[left, right]] : [[left, (left + right - gutter) / 2], [(left + right + gutter) / 2, right]]
    const first = 60 + random() * 200, count = 10 + Math.floor(random() * 40)
    const offsets = spans.map((_, index) => index ? random() * pitch : 0)
    const runs = spans.flatMap(([a, b], index) => column(a!, b!, first + offsets[index]!, count, pitch, size))
    // Noise: small raised markers, stray words beside the text, a wide heading.
    for (let i = 0; i < 6; i++) { const x = left + random() * (right - left - 20); runs.push(run(x, x + 6, first + random() * count * pitch - size * 0.3, size * 0.7)) }
    if (random() < 0.5) runs.push(run(left, right, first - 2 * pitch, size * 1.4))
    const which = Math.floor(random() * spans.length), [a, b] = spans[which]!
    const lineCount = 1 + Math.floor(random() * 6), start = Math.floor(random() * (count - lineCount))
    const baseline = (line: number) => first + offsets[which]! + line * pitch
    const highlight = Array.from({ length: lineCount }, (_, i) => mark(a! + (i ? 0 : random() * 50), b! - (i === lineCount - 1 ? random() * 50 : 0), baseline(start + i), size))
    const extra = pick([0, 1, 3] as const)
    const plainHeight = sheetHeight(cropBox(highlight, 0))
    const sheet = { width: 896, height: plainHeight * (1 + random() * 3), fill: random() < 0.5 ? undefined : plainHeight * (1 + random() * 4) }
    const plain = autoCrop(highlight, LETTER, sheet, extra, [])
    const snapped = autoCrop(highlight, LETTER, sheet, extra, runs)
    const name = `round ${round}: ${columns} column(s), ${lineCount} line(s), extra ${extra}`
    if (plain) assert.ok(snapped, `${name}: refused though the plain rule fits`)
    if (snapped) assert.ok(sheetHeight(snapped) <= sheet.height + 1e-6, `${name}: taller than the room`)
  }
})
