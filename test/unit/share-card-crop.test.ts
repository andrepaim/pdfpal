import test from 'node:test'
import assert from 'node:assert/strict'
import { boundingBox, cropBox, fittingCrop, relativeRects } from '../../frontend/src/lib/share-card/crop-box.js'

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)
const A4 = { width: 595.28, height: 841.89 }
const lines = [{ x1: 0.12, y1: 0.10, x2: 0.88, y2: 0.12 }, { x1: 0.12, y1: 0.12, x2: 0.86, y2: 0.14 }, { x1: 0.12, y1: 0.14, x2: 0.5, y2: 0.16 }]

test('the crop widens the highlight by 4% a side and adds lines of context above and below', () => {
  const box = cropBox(lines, 3)
  near(box.x1, 0.08); near(box.x2, 0.92)
  // A line is 1.35 × the median box height (0.02).
  near(box.y1, 0.10 - 3 * 0.027); near(box.y2, 0.16 + 3 * 0.027)
  const none = cropBox(lines, 0)
  near(none.y1, 0.10); near(none.y2, 0.16)
  assert.deepEqual(boundingBox(lines), { x1: 0.12, y1: 0.10, x2: 0.88, y2: 0.16 })
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

test('a crop too tall for the sheet drops to one line of context, then none, then is unavailable', () => {
  const sheet = { width: 896, height: 600 }
  assert.deepEqual(fittingCrop(lines, A4, sheet), cropBox(lines, 3))
  // Each crop's sheet height at full width: 3 lines ≈ 338 px, 1 line ≈ 239 px, none ≈ 190 px on this page.
  const height = (extra: number) => { const box = cropBox(lines, extra); return sheet.width * (box.y2 - box.y1) * A4.height / ((box.x2 - box.x1) * A4.width) }
  assert.deepEqual(fittingCrop(lines, A4, { width: 896, height: Math.floor(height(3)) }), cropBox(lines, 1))
  assert.deepEqual(fittingCrop(lines, A4, { width: 896, height: Math.floor(height(1)) }), cropBox(lines, 0))
  assert.equal(fittingCrop(lines, A4, { width: 896, height: Math.floor(height(0)) }), null)
  assert.equal(fittingCrop([], A4, sheet), null)
  assert.equal(fittingCrop(lines, { width: 0, height: 10 }, sheet), null)
})

test('the highlight boxes are given as fractions of the crop', () => {
  const crop = { x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.3 }
  assert.deepEqual(relativeRects([{ x1: 0.1, y1: 0.1, x2: 0.35, y2: 0.2 }, { x1: 0.0, y1: 0.25, x2: 0.9, y2: 0.4 }], crop).map(r => Object.values(r).map(v => Math.round(v * 1000) / 1000)),
    [[0, 0, 0.5, 0.5], [0, 0.75, 1, 1]])
})
