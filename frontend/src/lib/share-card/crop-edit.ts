// The crop editor's geometry: moving the crop box, resizing it by its handles and stepping it with the keyboard, all
// in page fractions (0..1, origin at the top left). Pure, so it is unit tested in Node
// (test/unit/share-card-crop-edit.test.ts); frontend/src/components/CropEditor.tsx turns pointer and key events into
// these calls.
import type { PageRect } from '../../../../src/shared/share-card'

/** The four edges and four corners, by compass point. */
export const CROP_HANDLES = ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw'] as const
export type CropHandle = (typeof CROP_HANDLES)[number]
/** What a drag or a key moves: the whole box or one handle. */
export type CropPart = CropHandle | 'box'
/** The smallest crop, as a fraction of the page in each direction. */
export const MIN_CROP = 0.1
/** One arrow-key step, and one with Shift, as fractions of the page. */
export const CROP_STEP = 0.01
export const CROP_STEP_LARGE = 0.05

/** Rounds away floating-point dust (0.30000000000000004) so repeated steps land on clean values. */
const clean = (value: number) => Math.round(value * 1e6) / 1e6
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback
const tidy = (rect: PageRect): PageRect => ({ x1: clean(rect.x1), y1: clean(rect.y1), x2: clean(rect.x2), y2: clean(rect.y2) })

/** Puts [a, b] in order inside 0..1 and widens it to at least MIN_CROP around its centre, staying inside the page. */
function span(a: number, b: number, low: number, high: number): [number, number] {
  let start = clamp(Math.min(finite(a, low), finite(b, high)), 0, 1), end = clamp(Math.max(finite(a, low), finite(b, high)), 0, 1)
  if (end - start < MIN_CROP) {
    const centre = (start + end) / 2
    start = centre - MIN_CROP / 2; end = centre + MIN_CROP / 2
    if (start < 0) { end -= start; start = 0 }
    if (end > 1) { start -= end - 1; end = 1 }
  }
  return [start, end]
}

/** Any crop made valid: corners in order, inside the page, at least MIN_CROP each way. Non-finite values fall back to the page edge. */
export function normalizeCrop(rect: PageRect): PageRect {
  const [x1, x2] = span(rect.x1, rect.x2, 0, 1), [y1, y2] = span(rect.y1, rect.y2, 0, 1)
  return tidy({ x1, y1, x2, y2 })
}

/** The box moved by (dx, dy), keeping its size and stopping at each page edge. */
export function moveCrop(rect: PageRect, dx: number, dy: number): PageRect {
  const box = normalizeCrop(rect)
  const x = clamp(box.x1 + dx, 0, 1 - (box.x2 - box.x1)), y = clamp(box.y1 + dy, 0, 1 - (box.y2 - box.y1))
  return tidy({ x1: x, y1: y, x2: x + box.x2 - box.x1, y2: y + box.y2 - box.y1 })
}

/**
 * The box with one handle moved by (dx, dy): an edge moves only its own side and ignores the offset across it; a
 * corner moves its two sides. A side stops at the page edge and MIN_CROP short of the opposite side.
 */
export function resizeCrop(rect: PageRect, handle: CropHandle, dx: number, dy: number): PageRect {
  const box = normalizeCrop(rect)
  let { x1, y1, x2, y2 } = box
  if (handle.includes('w')) x1 = clamp(box.x1 + dx, 0, box.x2 - MIN_CROP)
  if (handle.includes('e')) x2 = clamp(box.x2 + dx, box.x1 + MIN_CROP, 1)
  if (handle.includes('n')) y1 = clamp(box.y1 + dy, 0, box.y2 - MIN_CROP)
  if (handle.includes('s')) y2 = clamp(box.y2 + dy, box.y1 + MIN_CROP, 1)
  return tidy({ x1, y1, x2, y2 })
}

/**
 * A drag of `part` by the total offset since the drag began, applied to the box as it was then. Using the start box
 * and the total offset (not the last step) means a box held against an edge follows the pointer back exactly.
 */
export function dragCrop(start: PageRect, part: CropPart, dx: number, dy: number): PageRect {
  return part === 'box' ? moveCrop(start, dx, dy) : resizeCrop(start, part, dx, dy)
}

/** The offset an arrow key asks for, CROP_STEP_LARGE with Shift; null for any other key. */
export function keyDelta(key: string, large: boolean): { dx: number; dy: number } | null {
  const step = large ? CROP_STEP_LARGE : CROP_STEP
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 }
    case 'ArrowRight': return { dx: step, dy: 0 }
    case 'ArrowUp': return { dx: 0, dy: -step }
    case 'ArrowDown': return { dx: 0, dy: step }
    default: return null
  }
}

/** The box after one arrow key on the focused part, or null when the key is not an arrow. */
export function nudgeCrop(rect: PageRect, part: CropPart, key: string, large: boolean): PageRect | null {
  const delta = keyDelta(key, large)
  return delta && dragCrop(rect, part, delta.dx, delta.dy)
}

const percent = (value: number) => `${Math.round(value * 100)}%`
/** The crop in words, for screen readers. */
export function cropDescription(rect: PageRect): string {
  return `left ${percent(rect.x1)}, top ${percent(rect.y1)}, right ${percent(rect.x2)}, bottom ${percent(rect.y2)} of the page`
}

/** "x1,y1,x2,y2" to four decimals: the crop box's data-crop attribute, read by the browser tests. */
export function cropAttribute(rect: PageRect): string {
  return [rect.x1, rect.y1, rect.x2, rect.y2].map(value => value.toFixed(4)).join(',')
}
