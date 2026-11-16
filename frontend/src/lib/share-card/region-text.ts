// Region and first-page posts: what the reader's browser reads inside a region of a PDF page, and the box a
// first-page post starts from. Pure apart from pageTextRuns(), which only reads a page pdf.js has already loaded, so
// the rest is unit tested in Node (test/unit/share-card-region-text.test.ts). See "Region and first-page posts (T5)"
// in docs/share-posts-plan.md: the assistant never sees the region, only this text.
import type { PDFPageProxy } from 'pdfjs-dist'
import { CARD, cleanPassage, type PageRect } from '../../../../src/shared/share-card'
import { boundingBox, runBox, textLines } from './crop-box'

/** A run of text on the page as pdf.js gives it: its string and its box as page fractions. */
export type TextRun = { text: string; box: PageRect }
/** One line of text (one column's part of a row), with its words joined. */
export type TextLine = { text: string; box: PageRect }
/** A page's size in any unit; only its proportions matter. */
type PageSize = { width: number; height: number }

/** Where "Share a region" starts: a box in the middle of the page, for the reader to move over what they want. */
export const MIDDLE_REGION: PageRect = { x1: 0.12, y1: 0.3, x2: 0.88, y2: 0.62 }
/** The share of the text area (or of the page, without text) a first-page post starts with when no heading ends it. */
const TOP_SHARE = 0.55
/** The margins beside and above or below the first page's text, as page fractions. */
const MARGIN_X = 0.03
const MARGIN_Y = 0.02
/** The smallest box this module returns, as in the crop editor (frontend/src/lib/share-card/crop-edit.ts MIN_CROP). */
const MIN_SIDE = 0.1
/** Runs further apart than this many line heights get a space between them. */
const SPACE_GAP = 0.15
/** A heading that ends the abstract: "Introduction", "1 Introduction", "1. INTRODUCTION", "I. Introduction". */
const INTRODUCTION = /^(?:(?:\d{1,2}|[ivx]{1,4})[.:)]?\s*)?introduction[.:]?$/iu

const EPS = 1e-9
const centreX = (r: PageRect) => (r.x1 + r.x2) / 2
const centreY = (r: PageRect) => (r.y1 + r.y2) / 2
const inside = (r: PageRect, region: PageRect) => centreX(r) >= region.x1 && centreX(r) <= region.x2 && centreY(r) >= region.y1 && centreY(r) <= region.y2
const contains = (outer: PageRect, inner: PageRect) =>
  inner.x1 >= outer.x1 - EPS && inner.x2 <= outer.x2 + EPS && inner.y1 >= outer.y1 - EPS && inner.y2 <= outer.y2 + EPS

/**
 * The page's text as lines (textLines in crop-box.ts: runs on one row, split between columns), top to bottom and
 * left to right, each with its runs' strings joined: a space where pdf.js left a gap, none where runs touch.
 */
export function linesOf(runs: TextRun[], page: PageSize): TextLine[] {
  const usable = runs.filter(run => run.text.trim() && [run.box.x1, run.box.y1, run.box.x2, run.box.y2].every(Number.isFinite) && run.box.x2 > run.box.x1 && run.box.y2 > run.box.y1)
  const pieces = textLines(usable.map(run => run.box), page)
  const members = pieces.map(() => [] as TextRun[])
  for (const run of usable) {
    const index = pieces.findIndex(piece => contains(piece, run.box))
    if (index >= 0) members[index]!.push(run)
  }
  return pieces.map((box, index) => {
    const height = (box.y2 - box.y1) * page.height
    let text = ''
    let previous: TextRun | null = null
    for (const run of members[index]!.sort((a, b) => a.box.x1 - b.box.x1)) {
      const gap = previous ? (run.box.x1 - previous.box.x2) * page.width : 0
      if (previous && gap > SPACE_GAP * height && !/\s$/u.test(text) && !/^\s/u.test(run.text)) text += ' '
      text += run.text
      previous = run
    }
    return { text, box }
  })
}

/**
 * Lines in reading order. Where the lines leave a gutter (a strip down the middle that only a few lines cross), the
 * text is in two columns: between lines that cross the gutter, such as a title, the left column is read before the
 * right. Otherwise top to bottom.
 */
export function readingOrder(lines: TextLine[]): TextLine[] {
  const sorted = [...lines].sort((a, b) => centreY(a.box) - centreY(b.box) || a.box.x1 - b.box.x1)
  if (sorted.length < 4) return sorted
  const extent = boundingBox(sorted.map(line => line.box)), width = extent.x2 - extent.x1
  if (!(width > 0)) return sorted
  // How many lines cover each of 100 strips across the text, looking for the emptiest in the middle 60%.
  const BINS = 100
  const covering = Array.from({ length: BINS }, (_, bin) => {
    const x = extent.x1 + (bin + 0.5) * width / BINS
    return sorted.filter(line => line.box.x1 <= x && line.box.x2 >= x).length
  })
  const most = Math.max(...covering)
  let fewest = Infinity, first = -1, last = -1
  for (let bin = Math.floor(BINS * 0.2); bin < Math.ceil(BINS * 0.8); bin++) {
    if (covering[bin]! < fewest) { fewest = covering[bin]!; first = last = bin }
    else if (covering[bin] === fewest && last === bin - 1) last = bin
  }
  const gutter = extent.x1 + ((first + last) / 2 + 0.5) * width / BINS
  const left = sorted.filter(line => line.box.x2 <= gutter), right = sorted.filter(line => line.box.x1 >= gutter)
  if (first < 0 || fewest > most / 3 || left.length < 2 || right.length < 2) return sorted
  const ordered: TextLine[] = []
  let columns: [TextLine[], TextLine[]] = [[], []]
  const flush = () => { ordered.push(...columns[0], ...columns[1]); columns = [[], []] }
  for (const line of sorted) {
    if (line.box.x2 <= gutter) columns[0].push(line)
    else if (line.box.x1 >= gutter) columns[1].push(line)
    else { flush(); ordered.push(line) }
  }
  flush()
  return ordered
}

/**
 * Lines cleaned as the contract cleans a passage (cleanPassage: ligatures, soft hyphens, spaces), keeping one line per
 * text line. A word split by a hyphen at a line end is joined onto the first line, so the server's cleanPassage of
 * the result equals its cleanPassage of the raw text.
 */
function cleanLines(texts: string[]): string[] {
  const lines = texts.map(cleanPassage).filter(Boolean)
  for (let index = 0; index + 1 < lines.length; index++) {
    const split = /\p{Ll}[-‐]$/u.test(lines[index]!) && /^\p{Ll}/u.exec(lines[index + 1]!)
    if (!split) continue
    const [, piece = '', rest = ''] = /^(\S+)\s*(.*)$/u.exec(lines[index + 1]!) ?? []
    lines[index] = lines[index]!.slice(0, -1) + piece
    lines[index + 1] = rest
  }
  return lines.filter(Boolean)
}

/** Whole lines while they fit in `max` characters; a first line longer than that is cut at a word. */
function cut(lines: string[], max: number): string {
  let text = ''
  for (const line of lines) {
    const next = text ? `${text}\n${line}` : line
    if (next.length <= max) { text = next; continue }
    if (!text) text = line.slice(0, max + 1).replace(/\s+\S*$/u, '').slice(0, max)
    break
  }
  return text
}

/**
 * The text inside `region`: the runs whose centre lies inside it, in reading order, one line per text line, cleaned
 * as the contract cleans a passage and cut to CARD.passageMax characters at a line break. '' when the region holds
 * no text, such as a figure without labels. `page` is the page's size in any unit.
 */
export function regionText(runs: TextRun[], region: PageRect, page: PageSize): string {
  const chosen = runs.filter(run => inside(run.box, region))
  return cut(cleanLines(readingOrder(linesOf(chosen, page)).map(line => line.text)), CARD.passageMax)
}

/** The box widened to MIN_SIDE each way around its centre where it is smaller, and kept on the page. */
function onPage(box: PageRect): PageRect {
  const span = (a: number, b: number): [number, number] => {
    let start = Math.max(0, Math.min(a, b)), end = Math.min(1, Math.max(a, b))
    if (end - start < MIN_SIDE) {
      const middle = (start + end) / 2
      start = Math.max(0, Math.min(1 - MIN_SIDE, middle - MIN_SIDE / 2)); end = start + MIN_SIDE
    }
    return [start, end]
  }
  const [x1, x2] = span(box.x1, box.x2), [y1, y2] = span(box.y1, box.y2)
  return { x1, y1, x2, y2 }
}

/**
 * Where a first-page post starts: the title, the authors and the abstract. From the first line of text to the last
 * line above a heading that reads like "Introduction" (with or without a number), across the page's text with a
 * small margin. Without such a heading, the top 55% of the text area; without text, the top 55% of the page.
 */
export function firstPageRegion(runs: TextRun[], page: PageSize): PageRect {
  const lines = linesOf(runs, page)
  if (!lines.length) return { x1: 0, y1: 0, x2: 1, y2: TOP_SHARE }
  const area = boundingBox(lines.map(line => line.box))
  const x1 = area.x1 - MARGIN_X, x2 = area.x2 + MARGIN_X, y1 = area.y1 - MARGIN_Y
  const heading = lines.find(line => INTRODUCTION.test(cleanPassage(line.text)))
  const above = heading ? lines.filter(line => line.box.y2 <= heading.box.y1 + EPS) : []
  if (heading && above.length) {
    const bottom = Math.max(...above.map(line => line.box.y2))
    // The margin below the last line, but never past the middle of the gap to the heading.
    return onPage({ x1, y1, x2, y2: Math.min(bottom + MARGIN_Y, (bottom + heading.box.y1) / 2) })
  }
  return onPage({ x1, y1, x2, y2: area.y1 + TOP_SHARE * (area.y2 - area.y1) })
}

/**
 * The page's text runs that read left to right, with their strings, as page fractions (as crop-box.ts's runBox
 * measures them). Empty for a page without a text layer, or when it cannot be read.
 */
export async function pageTextRuns(page: PDFPageProxy): Promise<TextRun[]> {
  try {
    const base = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    return content.items.flatMap(item => {
      if (!('str' in item) || !item.str.trim() || !(item.width > 0)) return []
      const [a, b, c, d, e, f] = item.transform as number[]
      const length = Math.hypot(a!, b!) || 1
      const [x0, y0] = base.convertToViewportPoint(e!, f!) as [number, number]
      const [x1, y1] = base.convertToViewportPoint(e! + item.width * a! / length, f! + item.width * b! / length) as [number, number]
      const size = item.height || Math.hypot(c!, d!)
      if (!(x1 > x0) || Math.abs(y1 - y0) > 0.05 * (x1 - x0) || !(size > 0)) return []
      return [{ text: item.str, box: runBox(x0, x1, y0, size, base) }]
    })
  } catch {
    return []
  }
}
