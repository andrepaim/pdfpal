import test from 'node:test'
import assert from 'node:assert/strict'
import { autoCrop, boundingBox, cropBox, cropMarks, fitSheet, planCrop, readerCrop } from '../../frontend/src/lib/share-card/crop-box.js'

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
