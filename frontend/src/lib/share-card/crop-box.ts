// Which part of the page a Page card shows, in page fractions. Pure, so it is unit tested in Node.
import type { PageMark, PageRect } from '../../../../src/shared/share-card'

/** Each side's margin around the highlight, and the narrowest crop, as fractions of the page width. */
const SIDE_MARGIN = 0.04
const MIN_WIDTH = 0.55
/**
 * A line of context is the median distance between the highlight's lines; for a single line, or lines further apart
 * than a paragraph's (a highlight across columns), this many times the median height of its boxes.
 */
const LINE = 1.35
const MAX_LINE = 2.5
/** Lines of context above and below, most first: an automatic crop that is too tall for the card tries the next. */
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

/** The height of one line of text around the highlight, as a page fraction. */
function lineStep(rects: PageRect[]): number {
  const height = median(rects.map(r => Math.max(0, r.y2 - r.y1)))
  // Boxes whose tops are within half a line are on the same line.
  const tops: number[] = []
  for (const top of rects.map(r => r.y1).sort((a, b) => a - b)) if (!tops.length || top - tops.at(-1)! > height / 2) tops.push(top)
  const step = tops.length > 1 ? median(tops.slice(1).map((top, index) => top - tops[index]!)) : 0
  return step >= height * 0.9 && step <= MAX_LINE * height ? step : LINE * height
}

/**
 * The crop around a highlight: its bounding box widened by 4% of the page on each side and to at least 55% of the
 * page, and `extraLines` lines of context above and below. Clamped to the page.
 */
export function cropBox(rects: PageRect[], extraLines: number): PageRect {
  const box = boundingBox(rects)
  const line = lineStep(rects)
  const [x1, x2] = span(box.x1 - SIDE_MARGIN, box.x2 + SIDE_MARGIN, MIN_WIDTH)
  return { x1, x2, y1: Math.max(0, box.y1 - extraLines * line), y2: Math.min(1, box.y2 + extraLines * line) }
}

/**
 * The automatic crop: the most context, from `extraLines` down through 1 and 0 lines, whose sheet fits. At the full
 * sheet width its height must not exceed `sheet.height`. Null when even the highlighted lines alone are too tall.
 * `page` is the page's size in any unit.
 */
export function autoCrop(rects: PageRect[], page: { width: number; height: number }, sheet: { width: number; height: number }, extraLines: 0 | 1 | 3): PageRect | null {
  if (!rects.length || page.width <= 0 || page.height <= 0 || sheet.width <= 0) return null
  for (const extra of EXTRA_LINES.filter(lines => lines <= extraLines)) {
    const box = cropBox(rects, extra)
    const width = (box.x2 - box.x1) * page.width, height = (box.y2 - box.y1) * page.height
    if (width > 0 && height > 0 && sheet.width * height / width <= sheet.height) return box
  }
  return null
}

/** A reader's crop ordered and clamped to the page. Null, meaning automatic, when it is missing or has no area. */
export function readerCrop(crop: PageRect | null | undefined): PageRect | null {
  if (!crop || ![crop.x1, crop.y1, crop.x2, crop.y2].every(Number.isFinite)) return null
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  const box = { x1: clamp(Math.min(crop.x1, crop.x2)), y1: clamp(Math.min(crop.y1, crop.y2)), x2: clamp(Math.max(crop.x1, crop.x2)), y2: clamp(Math.max(crop.y1, crop.y2)) }
  return box.x2 > box.x1 && box.y2 > box.y1 ? box : null
}

/**
 * The sheet's drawn size for a crop of `crop` pixels in `space`: the full width, or narrower when that would be too
 * tall, so any crop fits. Null when either has no area.
 */
export function fitSheet(crop: { width: number; height: number }, space: { width: number; height: number }): { width: number; height: number } | null {
  if (!(crop.width > 0 && crop.height > 0 && space.width > 0 && space.height > 0)) return null
  const height = space.width * crop.height / crop.width
  return height <= space.height ? { width: space.width, height } : { width: space.height * crop.width / crop.height, height: space.height }
}

/**
 * Highlights as fractions of the crop, for drawing over it. A box that crosses the crop's edge is clipped to it; a
 * box outside it is dropped, and so is a highlight with no box left.
 */
export function cropMarks(marks: PageMark[], crop: PageRect): PageMark[] {
  const w = crop.x2 - crop.x1, h = crop.y2 - crop.y1
  if (!(w > 0 && h > 0)) return []
  return marks.map(mark => ({ color: mark.color, rects: mark.rects.flatMap(r => {
    const x1 = Math.max(r.x1, crop.x1), y1 = Math.max(r.y1, crop.y1), x2 = Math.min(r.x2, crop.x2), y2 = Math.min(r.y2, crop.y2)
    return x2 > x1 && y2 > y1 ? [{ x1: (x1 - crop.x1) / w, y1: (y1 - crop.y1) / h, x2: (x2 - crop.x1) / w, y2: (y2 - crop.y1) / h }] : []
  }) })).filter(mark => mark.rects.length)
}

/** The largest canvas side a crop is rendered at. */
export const MAX_CROP_PX = 4095

export type CropOptions = {
  /** The room for the sheet at the full inner width (cardSheetSpace). */
  sheet: { width: number; height: number }
  /** The reader's crop as page fractions; null means automatic. */
  crop: PageRect | null
  /** Every highlight on the page, as page fractions; empty means just `own`. */
  marks: PageMark[]
  /** The most lines of context an automatic crop tries. */
  extraLines: 0 | 1 | 3
}
export type CropPlan = {
  /** The crop, as page fractions. */
  box: PageRect
  /** The highlights inside it, as fractions of it. */
  marks: PageMark[]
  /** Pixels per page unit, and the rendered size in pixels: as large as the sheet is drawn, within MAX_CROP_PX. */
  scale: number; width: number; height: number
}

/**
 * What to render for a post's page: the reader's crop, else the automatic one around `own` (the post's highlight);
 * the marks inside it, `own` alone when `marks` is empty; and the render size. Null when an automatic crop cannot
 * fit. `page` is the page's size in PDF units.
 */
export function planCrop(own: PageMark, page: { width: number; height: number }, options: CropOptions): CropPlan | null {
  if (!(page.width > 0 && page.height > 0)) return null
  const box = readerCrop(options.crop) ?? autoCrop(own.rects, page, options.sheet, options.extraLines)
  if (!box) return null
  const crop = { width: (box.x2 - box.x1) * page.width, height: (box.y2 - box.y1) * page.height }
  const drawn = fitSheet(crop, options.sheet) ?? { width: options.sheet.width, height: options.sheet.width * crop.height / crop.width }
  const scale = Math.min(drawn.width / crop.width, MAX_CROP_PX / Math.max(crop.width, crop.height))
  return {
    box, marks: cropMarks(options.marks.length ? options.marks : [own], box), scale,
    width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)),
  }
}
