// Which part of the page a Page card shows, in page fractions. Pure, so it is unit tested in Node.
import type { PageRect } from '../../../../src/shared/share-card'

/** Each side's margin around the highlight, and the narrowest crop, as fractions of the page width. */
const SIDE_MARGIN = 0.04
const MIN_WIDTH = 0.55
/** A line of context is this many times the median height of the highlight's line boxes. */
const LINE = 1.35
/** Lines of context above and below, most first: a crop that is too tall for the card tries the next. */
export const EXTRA_LINES = [3, 1, 0] as const

export function boundingBox(rects: PageRect[]): PageRect {
  return { x1: Math.min(...rects.map(r => r.x1)), y1: Math.min(...rects.map(r => r.y1)), x2: Math.max(...rects.map(r => r.x2)), y2: Math.max(...rects.map(r => r.y2)) }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Widens [start, end] to at least `min` around its centre, keeping it inside 0..1. */
function span(start: number, end: number, min: number): [number, number] {
  let a = Math.max(0, start), b = Math.min(1, end)
  if (b - a < min) {
    const centre = (a + b) / 2
    a = centre - min / 2; b = centre + min / 2
    if (a < 0) { b -= a; a = 0 }
    if (b > 1) { a -= b - 1; b = 1 }
    a = Math.max(0, a); b = Math.min(1, b)
  }
  return [a, b]
}

/**
 * The crop around a highlight: its bounding box widened by 4% of the page on each side and to at least 55% of the
 * page, and `extraLines` lines of context above and below. Clamped to the page.
 */
export function cropBox(rects: PageRect[], extraLines: number): PageRect {
  const box = boundingBox(rects)
  const line = LINE * median(rects.map(r => Math.max(0, r.y2 - r.y1)))
  const [x1, x2] = span(box.x1 - SIDE_MARGIN, box.x2 + SIDE_MARGIN, MIN_WIDTH)
  return { x1, x2, y1: Math.max(0, box.y1 - extraLines * line), y2: Math.min(1, box.y2 + extraLines * line) }
}

/**
 * The largest crop whose sheet fits: at the full sheet width, its height must not exceed `sheet.height`. Null when
 * even the highlighted lines alone are too tall. `page` is the page's size in any unit.
 */
export function fittingCrop(rects: PageRect[], page: { width: number; height: number }, sheet: { width: number; height: number }): PageRect | null {
  if (!rects.length || page.width <= 0 || page.height <= 0 || sheet.width <= 0) return null
  for (const extra of EXTRA_LINES) {
    const box = cropBox(rects, extra)
    const width = (box.x2 - box.x1) * page.width, height = (box.y2 - box.y1) * page.height
    if (width > 0 && height > 0 && sheet.width * height / width <= sheet.height) return box
  }
  return null
}

/** The highlight's line boxes as fractions of the crop, for drawing over it. */
export function relativeRects(rects: PageRect[], crop: PageRect): PageRect[] {
  const w = crop.x2 - crop.x1, h = crop.y2 - crop.y1
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return rects.map(r => ({ x1: clamp((r.x1 - crop.x1) / w), y1: clamp((r.y1 - crop.y1) / h), x2: clamp((r.x2 - crop.x1) / w), y2: clamp((r.y2 - crop.y1) / h) }))
}
