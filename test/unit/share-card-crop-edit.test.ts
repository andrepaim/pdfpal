import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CROP_HANDLES, CROP_STEP, CROP_STEP_LARGE, MIN_CROP, cropAttribute, cropDescription, dragCrop, keyDelta, moveCrop,
  normalizeCrop, nudgeCrop, resizeCrop,
} from '../../frontend/src/lib/share-card/crop-edit.js'

type Rect = { x1: number; y1: number; x2: number; y2: number }
const near = (actual: Rect, expected: Rect) => {
  for (const key of ['x1', 'y1', 'x2', 'y2'] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} ≠ ${expected[key]} in ${JSON.stringify(actual)}`)
}
const box: Rect = { x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.5 }

test('the handles are the four edges and the four corners', () => {
  assert.deepEqual([...CROP_HANDLES].sort(), ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
  assert.equal(MIN_CROP, 0.1)
  assert.ok(CROP_STEP > 0 && CROP_STEP_LARGE > CROP_STEP)
})

test('moving keeps the size and stops at each page edge', () => {
  near(moveCrop(box, 0.1, -0.05), { x1: 0.3, y1: 0.25, x2: 0.7, y2: 0.45 })
  near(moveCrop(box, -1, -1), { x1: 0, y1: 0, x2: 0.4, y2: 0.2 })
  near(moveCrop(box, 1, 1), { x1: 0.6, y1: 0.8, x2: 1, y2: 1 })
  // One axis clamped, the other free.
  near(moveCrop(box, 0.5, 0.1), { x1: 0.6, y1: 0.4, x2: 1, y2: 0.6 })
})

test('each edge handle moves only its own edge', () => {
  near(resizeCrop(box, 'n', 0.3, -0.1), { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.5 })
  near(resizeCrop(box, 's', 0.3, 0.1), { x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.6 })
  near(resizeCrop(box, 'w', -0.1, 0.3), { x1: 0.1, y1: 0.3, x2: 0.6, y2: 0.5 })
  near(resizeCrop(box, 'e', 0.1, 0.3), { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.5 })
})

test('each corner handle moves its two edges', () => {
  near(resizeCrop(box, 'nw', -0.1, -0.1), { x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.5 })
  near(resizeCrop(box, 'ne', 0.1, -0.1), { x1: 0.2, y1: 0.2, x2: 0.7, y2: 0.5 })
  near(resizeCrop(box, 'sw', -0.1, 0.1), { x1: 0.1, y1: 0.3, x2: 0.6, y2: 0.6 })
  near(resizeCrop(box, 'se', 0.1, 0.1), { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.6 })
})

test('resizing stops at the page edges', () => {
  near(resizeCrop(box, 'nw', -5, -5), { x1: 0, y1: 0, x2: 0.6, y2: 0.5 })
  near(resizeCrop(box, 'se', 5, 5), { x1: 0.2, y1: 0.3, x2: 1, y2: 1 })
  near(resizeCrop(box, 'n', 0, -5), { x1: 0.2, y1: 0, x2: 0.6, y2: 0.5 })
  near(resizeCrop(box, 'e', 5, 0), { x1: 0.2, y1: 0.3, x2: 1, y2: 0.5 })
})

test('resizing stops at 10% of the page in each direction and never flips the box', () => {
  near(resizeCrop(box, 'n', 0, 0.9), { x1: 0.2, y1: 0.4, x2: 0.6, y2: 0.5 })
  near(resizeCrop(box, 's', 0, -0.9), { x1: 0.2, y1: 0.3, x2: 0.6, y2: 0.4 })
  near(resizeCrop(box, 'w', 0.9, 0), { x1: 0.5, y1: 0.3, x2: 0.6, y2: 0.5 })
  near(resizeCrop(box, 'e', -0.9, 0), { x1: 0.2, y1: 0.3, x2: 0.3, y2: 0.5 })
  near(resizeCrop(box, 'se', -0.9, -0.9), { x1: 0.2, y1: 0.3, x2: 0.3, y2: 0.4 })
  near(resizeCrop(box, 'nw', 0.9, 0.9), { x1: 0.5, y1: 0.4, x2: 0.6, y2: 0.5 })
})

test('a drag applies the total offset to the box it started from, so clamping does not drift', () => {
  // Pulled past the edge and back: the box returns to where the offset says, not where the clamp left it.
  const start = box
  near(dragCrop(start, 'box', -1, 0), { x1: 0, y1: 0.3, x2: 0.4, y2: 0.5 })
  near(dragCrop(start, 'box', 0.05, 0), { x1: 0.25, y1: 0.3, x2: 0.65, y2: 0.5 })
  near(dragCrop(start, 'se', 0.1, 0.1), resizeCrop(start, 'se', 0.1, 0.1))
  near(dragCrop(start, 'box', 0, 0), start)
})

test('arrow keys give a small step, and a larger one with Shift; other keys give nothing', () => {
  assert.deepEqual(keyDelta('ArrowLeft', false), { dx: -CROP_STEP, dy: 0 })
  assert.deepEqual(keyDelta('ArrowRight', false), { dx: CROP_STEP, dy: 0 })
  assert.deepEqual(keyDelta('ArrowUp', false), { dx: 0, dy: -CROP_STEP })
  assert.deepEqual(keyDelta('ArrowDown', true), { dx: 0, dy: CROP_STEP_LARGE })
  assert.equal(keyDelta('Enter', false), null)
  assert.equal(keyDelta('a', true), null)
})

test('a keyboard step moves the focused part and clamps like a drag', () => {
  near(nudgeCrop(box, 'box', 'ArrowRight', false)!, { x1: 0.21, y1: 0.3, x2: 0.61, y2: 0.5 })
  near(nudgeCrop(box, 'box', 'ArrowUp', true)!, { x1: 0.2, y1: 0.25, x2: 0.6, y2: 0.45 })
  near(nudgeCrop(box, 'n', 'ArrowUp', false)!, { x1: 0.2, y1: 0.29, x2: 0.6, y2: 0.5 })
  near(nudgeCrop(box, 'se', 'ArrowLeft', true)!, { x1: 0.2, y1: 0.3, x2: 0.55, y2: 0.5 })
  // An edge ignores the arrows across it.
  near(nudgeCrop(box, 'n', 'ArrowLeft', false)!, box)
  near(nudgeCrop({ x1: 0, y1: 0, x2: 0.5, y2: 0.5 }, 'box', 'ArrowLeft', true)!, { x1: 0, y1: 0, x2: 0.5, y2: 0.5 })
  assert.equal(nudgeCrop(box, 'box', 'Tab', false), null)
  // Repeated steps land on clean values instead of accumulating floating-point error.
  let moved: Rect = { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3 }
  for (let i = 0; i < 20; i++) moved = nudgeCrop(moved, 'box', 'ArrowRight', false)!
  assert.equal(moved.x1, 0.3); assert.equal(moved.x2, 0.5)
})

test('a starting crop is put in order, inside the page and at least the minimum size', () => {
  near(normalizeCrop({ x1: 0.6, y1: 0.5, x2: 0.2, y2: 0.3 }), box)
  near(normalizeCrop({ x1: -0.2, y1: -0.1, x2: 1.3, y2: 0.4 }), { x1: 0, y1: 0, x2: 1, y2: 0.4 })
  // Too small: widened around its centre.
  near(normalizeCrop({ x1: 0.48, y1: 0.5, x2: 0.52, y2: 0.51 }), { x1: 0.45, y1: 0.455, x2: 0.55, y2: 0.555 })
  // Too small at an edge: widened into the page.
  near(normalizeCrop({ x1: 0, y1: 0.98, x2: 0.02, y2: 1 }), { x1: 0, y1: 0.9, x2: 0.1, y2: 1 })
  // Nonsense values become the whole page rather than NaN.
  near(normalizeCrop({ x1: Number.NaN, y1: 0, x2: Number.POSITIVE_INFINITY, y2: 1 }), { x1: 0, y1: 0, x2: 1, y2: 1 })
  // Every operation starts from a normalised box.
  near(moveCrop({ x1: 0.6, y1: 0.5, x2: 0.2, y2: 0.3 }, 0, 0), box)
})

test('the crop is described in words and as four fractions for tests', () => {
  assert.equal(cropDescription(box), 'left 20%, top 30%, right 60%, bottom 50% of the page')
  assert.equal(cropDescription({ x1: 0.1234, y1: 0, x2: 1, y2: 0.999 }), 'left 12%, top 0%, right 100%, bottom 100% of the page')
  assert.equal(cropAttribute({ x1: 0.12346, y1: 0, x2: 1, y2: 0.5 }), '0.1235,0.0000,1.0000,0.5000')
})
