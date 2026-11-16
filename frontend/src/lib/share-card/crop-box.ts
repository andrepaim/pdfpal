// Which part of the page a Page card shows, in page fractions. Pure, so it is unit tested in Node.
//
// An automatic crop is snapped to the page's text when pdf.js gives a text layer: whole lines, the width of the
// text column the highlight is in, and as many lines as the card has room for (sheet.fill). Without a text layer (a
// scanned page) it is the highlight's box widened and given estimated lines of context. A reader's crop is drawn
// exactly as set.
import type { PageMark, PageRect } from '../../../../src/shared/share-card'

/**
 * The room for a sheet at the full inner width (cardSheetSpace). `fill`, when set, is the sheet height an automatic
 * crop grows towards so the card has no empty ground: the full room on Feed and Story, the minimum Fit card's sheet
 * on Fit. Without it the automatic crop keeps its minimum context.
 */
export type SheetRoom = { width: number; height: number; fill?: number }

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

// ── Snapping to the page's text ───────────────────────────────────────────────────────────────────────────────────
/** A text run's box above and below its baseline, as fractions of its font size. */
const RUN_ASCENT = 0.88
const RUN_DESCENT = 0.25
/** Runs on one row further apart than this many line heights are in different columns. */
const COLUMN_GAP = 1
/** Lines further apart than this many line heights (a figure, the page's foot) end the context in that direction. */
const BREAK_LINES = 3
/** How far beyond the column the crop shows, as a page fraction, and beyond the first and last line, in lines. */
const SNAP_X = 0.03
const SNAP_Y = 0.45
/** Lines whose centres are further apart than this many times the usual distance start a new block. */
const BLOCK_GAP = 1.3
/** How far around the highlight, in lines, text beside it marks the edge of its column. */
const NEAR_LINES = 3

/** A text run from `left` to `right` on `baseline` at `size`, all in the page's units, as page fractions. */
export function runBox(left: number, right: number, baseline: number, size: number, page: { width: number; height: number }): PageRect {
  return { x1: left / page.width, y1: (baseline - RUN_ASCENT * size) / page.height, x2: right / page.width, y2: (baseline + RUN_DESCENT * size) / page.height }
}

const heightOf = (r: PageRect) => r.y2 - r.y1
const verticalOverlap = (a: PageRect, b: PageRect) => Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
const sameRow = (a: PageRect, b: PageRect) => verticalOverlap(a, b) >= 0.5 * Math.min(heightOf(a), heightOf(b))
const centre = (r: PageRect) => (r.y1 + r.y2) / 2

/** Boxes grouped into rows by vertical overlap, top to bottom, each left to right. */
function rowsOf(boxes: PageRect[]): PageRect[][] {
  const rows: PageRect[][] = []
  for (const box of [...boxes].sort((a, b) => centre(a) - centre(b))) {
    const row = rows.at(-1)
    if (row && sameRow(boundingBox(row), box)) row.push(box)
    else rows.push([box])
  }
  return rows.map(row => row.sort((a, b) => a.x1 - b.x1))
}

/**
 * The page's text as line pieces: runs on one row joined, and split where the gap between them is wider than a line
 * is tall, which is a gap between columns. Top to bottom, then left to right.
 */
export function textLines(runs: PageRect[], page: { width: number; height: number }): PageRect[] {
  const valid = runs.filter(r => [r.x1, r.y1, r.x2, r.y2].every(Number.isFinite) && r.x2 > r.x1 && r.y2 > r.y1)
  const pieces: PageRect[] = []
  for (const row of rowsOf(valid)) {
    let current: PageRect | null = null
    for (const r of row) {
      if (current && (r.x1 - current.x2) * page.width <= COLUMN_GAP * Math.min(heightOf(current), heightOf(r)) * page.height) current = boundingBox([current, r])
      else { if (current) pieces.push(current); current = { ...r } }
    }
    if (current) pieces.push(current)
  }
  return pieces
}

/**
 * The automatic crop snapped to the text: the lines of the highlight's column, `extraLines` of context above and
 * below at least (stepping down to 1 and 0 when that is too tall), then more whole lines, balanced, while the sheet
 * stays within `sheet.fill`. A side whose text runs out, meets text across the column's edge or a wide gap gives
 * its lines to the other side. Undefined when the highlight is on none of the text (no usable text layer).
 */
function snappedCrop(rects: PageRect[], page: { width: number; height: number }, sheet: SheetRoom, extraLines: 0 | 1 | 3, runs: PageRect[]): PageRect | null | undefined {
  const EPS = 1e-9
  const pieces = textLines(runs, page)
  const hit = pieces.filter(p => rects.some(r => r.x2 > p.x1 && r.x1 < p.x2 && verticalOverlap(r, p) >= 0.5 * Math.min(heightOf(r), heightOf(p))))
  if (!hit.length) return undefined
  const line = median(pieces.map(heightOf))
  const own = boundingBox(hit)
  // The column's edges: the nearest text beside the highlight's lines, on either side.
  const near = (p: PageRect) => p.y2 > own.y1 - NEAR_LINES * line && p.y1 < own.y2 + NEAR_LINES * line
  const lefts = pieces.filter(p => near(p) && p.x2 <= own.x1).map(p => p.x2), rights = pieces.filter(p => near(p) && p.x1 >= own.x2).map(p => p.x1)
  const left = lefts.length ? Math.max(...lefts) : null, right = rights.length ? Math.min(...rights) : null
  const zone = { x1: left === null ? 0 : (left + own.x1) / 2, x2: right === null ? 1 : (right + own.x2) / 2 }
  const inColumn = (p: PageRect) => p.x1 >= zone.x1 - EPS && p.x2 <= zone.x2 + EPS
  const outside = (p: PageRect) => p.x2 <= zone.x1 + EPS || p.x1 >= zone.x2 - EPS
  // Text that runs across the column's edge, such as a title over two columns, ends the context.
  const barriers = pieces.filter(p => !inColumn(p) && !outside(p))
  const rows = rowsOf(pieces.filter(inColumn)).map(boundingBox)
  const hitRows = rows.flatMap((row, index) => hit.some(p => centre(p) >= row.y1 && centre(p) <= row.y2) ? [index] : [])
  const blocked = (upper: number, lower: number) => rows[lower]!.y1 - rows[upper]!.y2 > BREAK_LINES * line ||
    barriers.some(b => centre(b) > centre(rows[upper]!) && centre(b) < centre(rows[lower]!))
  // The column's width from its lines around the highlight, so a short last line still gets the column.
  const around = rows.filter(near)
  const column = { x1: Math.min(...around.map(r => r.x1)), x2: Math.max(...around.map(r => r.x2)) }

  const box = ([first, last]: [number, number]): PageRect => {
    const chosen = rows.slice(first, last + 1)
    const minX = Math.min(column.x1, ...chosen.map(r => r.x1)), maxX = Math.max(column.x2, ...chosen.map(r => r.x2))
    // One margin on both sides: at most half the gutter to the next column on either.
    const margin = Math.min(SNAP_X, left === null ? SNAP_X : (minX - left) / 2, right === null ? SNAP_X : (right - maxX) / 2)
    const x1 = Math.max(0, minX - margin), x2 = Math.min(1, maxX + margin)
    const across = pieces.filter(p => p.x2 > x1 && p.x1 < x2)
    // Text half inside the lines' span (the other column's line on an offset baseline) is taken in whole.
    let top = chosen[0]!.y1, bottom = chosen.at(-1)!.y2
    for (let moved = true; moved;) {
      moved = false
      for (const p of across) {
        if (p.y1 < top - EPS && p.y2 > top + EPS) { top = p.y1; moved = true }
        if (p.y1 < bottom - EPS && p.y2 > bottom + EPS) { bottom = p.y2; moved = true }
      }
    }
    // The edges sit between lines: never past the middle of the gap to the next text above or below.
    const above = across.filter(p => p.y2 <= top + EPS).map(p => p.y2), below = across.filter(p => p.y1 >= bottom - EPS).map(p => p.y1)
    return {
      x1, x2,
      y1: Math.max(0, top - SNAP_Y * line, above.length ? (Math.max(...above) + top) / 2 : 0),
      y2: Math.min(1, bottom + SNAP_Y * line, below.length ? (Math.min(...below) + bottom) / 2 : 1),
    }
  }
  // A line further below the one before it than lines usually are starts a block, such as a heading: the crop does
  // not end on it but takes the line under it too.
  const centres = rows.map(centre), pitch = median(centres.slice(1).map((value, index) => value - centres[index]!))
  const startsBlock = (index: number) => index > 0 && centres[index]! - centres[index - 1]! > BLOCK_GAP * pitch
  // Every crop from the highlight's lines outwards, one line at a time, above and below in turn.
  const states: Array<[number, number]> = [[Math.min(...hitRows), Math.max(...hitRows)]]
  for (let step = 0; ; step++) {
    const [first, last] = states.at(-1)!
    const up = first > 0 && !blocked(first - 1, first), down = last < rows.length - 1 && !blocked(last, last + 1)
    if (!up && !down) break
    if (step % 2 === 0 ? up : !down) states.push([first - 1, last])
    else states.push([first, startsBlock(last + 1) && last + 2 < rows.length && !blocked(last + 1, last + 2) ? last + 2 : last + 1])
  }
  const sheetHeight = (r: PageRect) => sheet.width * (r.y2 - r.y1) * page.height / ((r.x2 - r.x1) * page.width)
  const fill = Math.min(sheet.fill ?? 0, sheet.height)
  for (const extra of EXTRA_LINES.filter(lines => lines <= extraLines)) {
    let index = Math.min(2 * extra, states.length - 1), crop = box(states[index]!)
    if (sheetHeight(crop) > sheet.height + EPS) continue
    while (index + 1 < states.length) {
      const larger = box(states[index + 1]!)
      if (sheetHeight(larger) > fill + EPS) break
      crop = larger; index++
    }
    return crop
  }
  return null
}

/**
 * The automatic crop. With the page's text runs (`text`, as page fractions), it is snapped to whole lines and the
 * highlight's text column, takes at least `extraLines` of context, stepping down through 1 and 0 when that is too
 * tall, and grows by whole lines while its sheet stays within `sheet.fill`. Without usable text, it is the most
 * context from `extraLines` down whose sheet fits. Either way, at the full sheet width its height must not exceed
 * `sheet.height`; null when even the highlighted lines alone are too tall. `page` is the page's size in any unit.
 */
export function autoCrop(rects: PageRect[], page: { width: number; height: number }, sheet: SheetRoom, extraLines: 0 | 1 | 3, text: PageRect[] = []): PageRect | null {
  if (!rects.length || page.width <= 0 || page.height <= 0 || sheet.width <= 0) return null
  const snapped = text.length ? snappedCrop(rects, page, sheet, extraLines, text) : undefined
  if (snapped !== undefined) return snapped
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
  /** The room for the sheet at the full inner width, and how far an automatic crop grows (cardSheetSpace). */
  sheet: SheetRoom
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
 * What to render for a post's page: the reader's crop exactly as set, else the automatic one around `own` (the post's
 * highlight), snapped to the page's `text` runs when there are any; the marks inside it, `own` alone when `marks` is
 * empty; and the render size. Null when an automatic crop cannot fit, or there is no crop and `own` has no boxes (a
 * region post). `page` is the page's size in PDF units.
 */
export function planCrop(own: PageMark, page: { width: number; height: number }, options: CropOptions, text: PageRect[] = []): CropPlan | null {
  if (!(page.width > 0 && page.height > 0)) return null
  const box = readerCrop(options.crop) ?? autoCrop(own.rects, page, options.sheet, options.extraLines, text)
  if (!box) return null
  const crop = { width: (box.x2 - box.x1) * page.width, height: (box.y2 - box.y1) * page.height }
  const drawn = fitSheet(crop, options.sheet) ?? { width: options.sheet.width, height: options.sheet.width * crop.height / crop.width }
  const scale = Math.min(drawn.width / crop.width, MAX_CROP_PX / Math.max(crop.width, crop.height))
  return {
    box, marks: cropMarks(options.marks.length ? options.marks : [own], box), scale,
    width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)),
  }
}
