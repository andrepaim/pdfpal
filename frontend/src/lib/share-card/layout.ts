// Share-card layout: where every word goes, at what size, on a 1080-wide card. Pure: no DOM, no canvas. The caller
// passes a `measure` function, so the same code lays out the preview, every export and the Node tests. The
// measurements are DistillPod's (ShareCardRenderer.kt); see "The renderer" in docs/share-cards-plan.md. Below, u is
// 1% of the card width.
import { FIT, SIZES, collapse, creditLine, type CardContent, type CardSize, type PageMark, type PageRect, type ShareCardSource, type ShareLook, type ShareStyle } from '../../../../src/shared/share-card'
import { fitSheet } from './crop-box'
import { HIGHLIGHT_HEX, palette, type Fill, type Palette } from './looks'

/** Width of `text` in the CSS `font`, with `letterSpacing` px added after every character (the last included). */
export type Measure = (text: string, font: string, letterSpacing: number) => number

export type Face = 'regular' | 'semibold' | 'bold' | 'serif' | 'serifItalic'
export const SANS_STACK = '"Inter", system-ui, sans-serif'
export const SERIF_STACK = '"Newsreader", Georgia, serif'

/** The CSS font for a face at `size` px. */
export function fontCss(face: Face, size: number): string {
  const px = `${Math.round(size * 100) / 100}px`
  switch (face) {
    case 'regular': return `400 ${px} ${SANS_STACK}`
    case 'semibold': return `600 ${px} ${SANS_STACK}`
    case 'bold': return `700 ${px} ${SANS_STACK}`
    case 'serif': return `400 ${px} ${SERIF_STACK}`
    case 'serifItalic': return `italic 400 ${px} ${SERIF_STACK}`
  }
}

// Vertical metrics, as fractions of the font size, read from the bundled TTFs (hhea, OS/2 and glyph boxes). Layout
// positions baselines from these rather than asking the canvas, so it stays pure and identical everywhere.
const INTER = { ascent: 0.96875, descent: 0.2412, ink: 0.78, accent: 0.95, cap: 0.7275 }
const NEWSREADER = { ascent: 0.735, descent: 0.265, ink: 0.735, accent: 0.875, cap: 0.67, digit: 0.686, quoteMark: { left: 0.0445, right: 0.371, bottom: 0.4325, top: 0.6835 } }
const metrics = (face: Face) => face === 'serif' || face === 'serifItalic' ? NEWSREADER : INTER
const TALL = /[ÀÁÂÃÄÅÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ]/u
const DESCENDING = /[gjpqyQçÇ,;()[\]{}]/u

/** Large text steps down to this share of its nominal size before the card is refused. */
const FLOOR = 0.6
const STEPS = 20
/** Below FLOOR only for a block whose single word is wider than the column, so contract-valid text still draws. */
const WORD_FLOOR = 0.4
/** A quote of at most GROW_LINES lines may grow this many 2% steps above its nominal size. */
const GROW_STEPS = 12
const GROW_LINES = 3
export const MIN_TEXT_PX = 28
/** Where a block that does not fill its space sits: 0 top, 1 bottom. Slightly above centre reads as centred. */
const PLACEMENT = 0.4
/** The Headline style's headline steps down until the sheet has this share of the main region, or reaches FLOOR. */
const SHEET_SHARE = 0.5
/** A headline at its nominal size may grow this much, in this many steps, into room a short crop leaves. */
const GROW_HEADLINE = 0.35
const GROW_HEADLINE_STEPS = 7
/** Below this height, in u, a sheet is not worth drawing and Headline is laid out as Big idea. */
const MIN_SHEET = 15
/** The highlights over a crop: their colour at this opacity, with the multiply blend, as one highlight is drawn. */
const MARK_ALPHA = 0.55
export const WORDMARK = 'PDFPAL'
export const TOO_LONG = 'The card text needs shortening.'

export type Box = { x1: number; y1: number; x2: number; y2: number }
export type TextRole = 'glyph' | 'kicker' | 'quote' | 'emphasis' | 'headline' | 'pull' | 'takeawaysTitle' | 'numeral' | 'takeawayTitle' | 'takeawayDetail'
  | 'footerTitle' | 'footerCredit' | 'wordmark' | 'slideNumber'
export type TextCommand = {
  kind: 'text'; role: TextRole; text: string
  /** Start of the text and its alphabetic baseline. */
  x: number; y: number
  font: string; size: number; color: string; alpha: number; letterSpacing: number
  /** Approximate ink box, for tests and hit checks. */
  box: Box
}
export type RectCommand = { kind: 'rect'; x: number; y: number; width: number; height: number; color: string; alpha: number }
export type ImageCommand = {
  kind: 'image'; x: number; y: number; width: number; height: number; radius: number
  shadow: { blur: number; offsetY: number; color: string }
  /** Every highlight inside the crop, its boxes as fractions of the crop, painted over it with the multiply blend. */
  marks: Array<{ color: string; alpha: number; rects: PageRect[] }>
}
export type DrawCommand = { kind: 'background'; fill: Fill } | RectCommand | TextCommand | ImageCommand

export type CardLayoutInput = {
  card: Pick<CardContent, 'quote' | 'emphasis' | 'headline' | 'pull' | 'topic' | 'takeawaysTitle' | 'takeaways'>
  source: Pick<ShareCardSource, 'title' | 'credit' | 'page' | 'color'>
  style: ShareStyle
  look: ShareLook
  size: CardSize
  /**
   * Pixel size of the crop for the Page and Headline styles, and the highlights inside it as fractions of it. Without
   * one, Page is drawn as Quote and Headline as Big idea.
   */
  crop?: { width: number; height: number; marks: PageMark[] }
  /** The kicker's words instead of the topic (a carousel's "The study"); '' draws none. */
  kicker?: string
  /**
   * A carousel slide's number and the count, drawn as "3 / 7" in the strip above the wordmark. On a slide, a source
   * page of 0 or less credits the paper without a page.
   */
  slide?: { number: number; count: number }
}
export type CardLayout = {
  width: number; height: number
  /** The style actually drawn: Page falls back to Quote, Headline to Big idea. */
  style: ShareStyle
  look: ShareLook
  /** Where text may go: inside the padding and safe areas. */
  safe: Box
  commands: DrawCommand[]
  fits: true
}

type Ink = { face: Face; size: number; color: string; alpha: number; tracking: number; box?: { color: string; alpha: number } }
const fontOf = (ink: Ink) => fontCss(ink.face, ink.size)
const spacingOf = (ink: Ink) => ink.tracking * ink.size
/** Baseline below the top of a line box of `leading` times the size, centred as CSS does. */
const baselineOf = (ink: Ink, leading: number) => {
  const m = metrics(ink.face)
  return (ink.size * leading - (m.ascent + m.descent) * ink.size) / 2 + m.ascent * ink.size
}

/** Single-spaced, with typographic apostrophes; the wording itself is never changed. */
export const clean = (text: string) => collapse(text).replace(/(?<=\p{L})'(?=\p{L})/gu, '’')

/**
 * A quote that starts mid-sentence ("…some CFOs play") opens with a capital, as quotation style allows; the
 * stored words stay exact. `emphasis` follows when it covers that letter.
 */
export function opening(text: string, emphasis: string): [string, string] {
  const index = text.search(/\p{L}/u)
  if (index < 0) return [text, emphasis]
  const letter = text[index]!
  if (letter === letter.toUpperCase() || letter.toLowerCase() !== letter) return [text, emphasis]
  const capital = (s: string, at: number) => s.slice(0, at) + s.slice(at, at + 1).toUpperCase() + s.slice(at + 1)
  const start = emphasis ? text.indexOf(emphasis) : -1
  return [capital(text, index), start >= 0 && start <= index && start + emphasis.length > index ? capital(emphasis, index - start) : emphasis]
}

type Run = { text: string; ink: Ink; width: number }
type Line = Run[][]

/**
 * Left-aligned text with one optional emphasised range. Words never break inside; a word wider than the column
 * makes wrap() fail so the caller steps the size down.
 */
class Paragraph {
  private readonly words: Run[][]
  /** Whether each word holds emphasised text. */
  private readonly marked: boolean[]
  private readonly space: number
  private readonly boxTop: number
  private readonly boxBottom: number
  readonly lineHeight: number
  readonly firstBaseline: number
  /** Negative tracking lets the last letter's ink run past its advance; lines leave room for it. */
  private readonly overhang: number
  lines: Line[] = []
  /** How far the first line starts left of the column, so an opening quotation mark hangs outside it. */
  hang = 0

  private readonly measure: Measure
  readonly base: Ink
  private readonly pad: number
  private readonly role: TextRole

  constructor(measure: Measure, text: string, emphasis: string, base: Ink, emphasized: Ink, leading: number, pad = 0, role: TextRole = 'quote') {
    this.measure = measure; this.base = base; this.pad = pad; this.role = role
    const start = emphasis.trim() ? text.indexOf(emphasis) : -1
    let end = start + emphasis.length
    // A box padded away from its closing punctuation leaves the comma stranded, so the box takes it in.
    if (start >= 0 && emphasized.box) while (end < text.length && '.,;:!?…)”’»'.includes(text[end]!)) end++
    const words: Run[][] = []
    let word: Run[] = [], run = '', inside = false
    const endRun = () => { if (run) { const ink = inside ? emphasized : base; word.push({ text: run, ink, width: measure(run, fontOf(ink), spacingOf(ink)) }); run = '' } }
    const endWord = () => { endRun(); if (word.length) { words.push(word); word = [] } }
    // Code points, with their UTF-16 offset for the emphasis range.
    let offset = 0
    for (const c of Array.from(text)) {
      if (/\s/u.test(c)) endWord()
      else {
        const isInside = start >= 0 && offset >= start && offset < end
        if (isInside !== inside) { endRun(); inside = isInside }
        run += c
      }
      offset += c.length
    }
    endWord()
    this.words = words
    this.marked = words.map(w => w.some(r => r.ink !== base))
    this.space = measure(' ', fontOf(base), spacingOf(base))
    this.overhang = Math.max(0, -spacingOf(base))
    this.lineHeight = base.size * leading
    this.firstBaseline = baselineOf(base, leading)
    const m = metrics(base.face), phrase = start >= 0 ? text.slice(start, end) : ''
    // The box covers ascenders and descenders, and grows only for marks that reach further (such as É).
    this.boxTop = -(TALL.test(phrase) ? m.accent + 0.05 : Math.max(0.8, m.ink + 0.05)) * base.size
    this.boxBottom = (DESCENDING.test(phrase) ? m.descent + 0.05 : 0.22) * base.size
  }

  get height() { return this.lines.length * this.lineHeight }
  get size() { return this.base.size }
  /** Top of a capital relative to the baseline (negative). */
  get capTop() { return -metrics(this.base.face).cap * this.base.size }
  /** The widest single word, which no line break can help. */
  get widest() { return Math.max(0, ...this.words.map(w => this.width([w]))) + this.overhang }
  /** Whether the emphasised phrase runs over more than one line. */
  get splitsEmphasis() { return this.lines.filter(line => line.some(word => word.some(run => run.ink !== this.base))).length > 1 }
  measureText(text: string) { return this.measure(text, fontOf(this.base), spacingOf(this.base)) }

  /**
   * Places runs on one line. A box gets `pad` of room inside the line but hangs into the margin at either end, so
   * its text stays aligned with the column. Returns the inked width.
   */
  private walk(line: Line, text: (run: Run, x: number) => void, box: (left: number, right: number) => void): number {
    let x = 0, end = 0, boxed = false, boxStart = 0, first = true
    line.forEach((word, index) => {
      if (index > 0) x = end + this.space
      for (const run of word) {
        const isBoxed = !!run.ink.box
        if (isBoxed !== boxed) {
          if (isBoxed) { if (!first) x += this.pad; boxStart = x - this.pad } else { box(boxStart, end + this.pad); x += this.pad }
          boxed = isBoxed
        }
        text(run, x)
        x += run.width; end = x; first = false
      }
    })
    if (boxed) box(boxStart, end + this.pad)
    return end
  }

  private width(line: Line) { return this.walk(line, () => {}, () => {}) }

  private breakLines(width: number): Line[] | null {
    width -= this.overhang
    if (this.words.some(word => this.width([word]) > width)) return null
    // An emphasised phrase that fits on one line is kept together; a split phrase loses its punch.
    const units: Line[] = []
    for (let index = 0; index < this.words.length;) {
      let end = index + 1
      if (this.marked[index]) while (end < this.words.length && this.marked[end]) end++
      const group = this.words.slice(index, end)
      if (group.length > 1 && this.width(group) > width) for (const word of group) units.push([word])
      else units.push(group)
      index = end
    }
    const result: Line[] = []
    let line: Line = []
    for (const unit of units) {
      if (line.length && this.width([...line, ...unit]) > width) { result.push(line); line = [] }
      line = [...line, ...unit]
    }
    if (line.length) result.push(line)
    return result
  }

  /**
   * Breaks into lines no wider than `width`. `balance` evens out the lines, as CSS text-wrap: balance does for
   * headlines; otherwise only a lone last word is avoided. False when a word cannot fit.
   */
  wrap(width: number, balance: boolean): boolean {
    const greedy = this.breakLines(width)
    if (!greedy) return false
    this.lines = greedy
    if (greedy.length < 2) return true
    if (balance) {
      let low = width * 0.5, high = width
      for (let i = 0; i < 14; i++) {
        const middle = (low + high) / 2
        const candidate = this.breakLines(middle)
        if (candidate && candidate.length === greedy.length) { this.lines = candidate; high = middle } else low = middle
      }
    } else if (greedy.at(-1)!.length === 1) {
      for (let candidateWidth = width - width * 0.01; candidateWidth > width * 0.55; candidateWidth -= width * 0.01) {
        const candidate = this.breakLines(candidateWidth)
        if (!candidate || candidate.length !== greedy.length) break
        if (candidate.at(-1)!.length > 1) { this.lines = candidate; break }
      }
    }
    return true
  }

  draw(out: DrawCommand[], left: number, top: number) {
    this.lines.forEach((line, index) => {
      const y = top + index * this.lineHeight + this.firstBaseline
      const start = index === 0 ? left - this.hang : left
      const box = line.flat().find(run => run.ink.box)?.ink.box
      if (box) this.walk(line, () => {}, (l, r) => out.push({ kind: 'rect', x: start + l, y: y + this.boxTop, width: r - l, height: this.boxBottom - this.boxTop, color: box.color, alpha: box.alpha }))
      this.walk(line, (run, x) => out.push(textCommand(run.ink.box ? 'emphasis' : this.role, run.text, start + x, y, run.ink, run.width)), () => {})
    })
  }
}

function textCommand(role: TextRole, text: string, x: number, y: number, ink: Ink, width: number): TextCommand {
  const m = metrics(ink.face), spacing = spacingOf(ink)
  const top = TALL.test(text) ? m.accent : m.ink
  return {
    kind: 'text', role, text, x, y, font: fontOf(ink), size: ink.size, color: ink.color, alpha: ink.alpha, letterSpacing: spacing,
    box: { x1: x, y1: y - top * ink.size, x2: x + width - spacing, y2: y + m.descent * ink.size },
  }
}

/** One element of a vertical stack. */
type Part = { height: number; draw: (out: DrawCommand[], y: number) => void }

class Card {
  readonly width: number
  readonly height: number
  readonly u: number
  readonly story: boolean
  /** Story content type is a fifth larger; header and footer keep their feed size. */
  readonly k: number
  readonly padX: number
  readonly top: number
  readonly bottom: number
  readonly inner: number
  readonly p: Palette
  readonly out: DrawCommand[] = []
  footerTop = 0

  private readonly input: CardLayoutInput
  private readonly measure: Measure

  /** A Fit card is given its `height`; every other size has its own. Fit is otherwise laid out as Feed. */
  constructor(input: CardLayoutInput, measure: Measure, height?: number) {
    this.input = input; this.measure = measure
    if (input.size === 'fit') { this.width = FIT.width; this.height = height ?? FIT.maxHeight }
    else { this.width = SIZES[input.size].width; this.height = SIZES[input.size].height }
    this.u = this.width / 100
    this.story = input.size === 'story'
    this.k = this.story ? 1.2 : 1
    this.padX = (this.story ? 10 : 8.5) * this.u
    this.top = (this.story ? 20 : 8.5) * this.u
    this.bottom = this.height - (this.story ? 22 : 8.5) * this.u
    this.inner = this.width - 2 * this.padX
    this.p = palette(input.look, input.source.color, this.width, this.height)
  }

  px(units: number, scale = 1) { return Math.max(units * this.u * this.k * scale, MIN_TEXT_PX) }
  chrome(units: number) { return Math.max(units * this.u, MIN_TEXT_PX) }
  get safe(): Box { return { x1: this.padX, y1: this.top, x2: this.padX + this.inner, y2: this.bottom } }
  get regionBottom() { return this.footerTop - 6 * this.u * this.k }
  get available() { return this.regionBottom - this.top }

  /** Background and footer; afterwards `available` is the room for the main block. */
  frame() {
    this.out.push({ kind: 'background', fill: this.p.ground })
    this.footerTop = this.footer()
  }

  layout(): CardLayout {
    this.frame()
    let style = this.input.style
    let parts: Part[] | undefined
    if (style === 'page' || style === 'headline') {
      parts = this.sheetParts(style) ?? undefined
      if (!parts) style = style === 'page' ? 'quote' : 'idea'
    }
    if (!parts) {
      // A short quote may grow so the card does not look empty; everything else starts at its nominal size.
      for (let step = style === 'quote' ? -GROW_STEPS : 0; step <= STEPS && !parts; step++) {
        const candidate = this.compose(style, 1 - step * (1 - FLOOR) / STEPS)
        if (candidate && total(candidate) <= this.available) parts = candidate
      }
    }
    if (!parts) throw new Error(TOO_LONG)
    let y = this.top + (this.available - total(parts)) * PLACEMENT
    for (const part of parts) { part.draw(this.out, y); y += part.height }
    return { width: this.width, height: this.height, style, look: this.input.look, safe: this.safe, commands: this.out, fits: true }
  }

  /** The main block at scale `s`, or null when a word is too wide at that size. */
  compose(style: ShareStyle, s: number): Part[] | null {
    // Supporting text shrinks half as fast as the large type so the hierarchy holds.
    const t = 1 - (1 - s) / 2
    const floor = s <= FLOOR + 1e-4
    const { u, k, p, padX, inner } = this
    const card = this.input.card
    const parts: Part[] = []
    const gap = (units: number, scale: number) => parts.push({ height: units * u * k * scale, draw: () => {} })
    if (style === 'idea') {
      this.kicker(parts, 5, s)
      const headline = this.display(card.headline, 11.5, s, -0.04, 1, floor, 'headline')
      if (!headline) return null
      parts.push(this.text(headline, padX))
      const pull = opening(clean(card.pull), '')[0]
      if (pull) {
        gap(6, s)
        const quoted = '“"\'‘«'.includes(pull[0]!) ? pull : `“${pull}”`
        const bar = 0.7 * u * k, indent = bar + 4 * u * k
        // A headline shrunk for one long word must still lead its pull quote.
        const pullScale = Math.min(t, headline.size * 0.6 / (4.5 * u * k))
        const paragraph = this.wrapped(pullScale, inner - indent, false, floor,
          q => this.plain(quoted, { face: 'serifItalic', size: this.px(4.5, q), color: p.text, alpha: 0.9, tracking: 0 }, 1.3, 'pull'))
        if (!paragraph) return null
        if (quoted[0] === '“') paragraph.hang = paragraph.measureText('“')
        parts.push({ height: paragraph.height, draw: (out, y) => {
          out.push({ kind: 'rect', x: padX, y, width: bar, height: paragraph.height, color: p.accent, alpha: 1 })
          paragraph.draw(out, padX + indent, y)
        } })
      }
    } else if (style === 'takeaways') {
      this.kicker(parts, 3, s)
      const title = this.display(card.takeawaysTitle, 8.6, s, -0.035, 1.04, floor, 'takeawaysTitle')
      if (!title) return null
      parts.push(this.text(title, padX))
      // Rows stay clearly below a title that had to shrink for one long word.
      const rows = Math.min(t, title.size * 0.8 / (5 * u * k))
      for (const [index, item] of card.takeaways.entries()) {
        gap(index === 0 ? 7 : 5.2, index === 0 ? s : rows)
        const row = this.takeaway(index + 1, item.title, item.detail, rows, floor)
        if (!row) return null
        parts.push(row)
      }
    } else {
      const [text, emphasis] = opening(clean(card.quote), clean(card.emphasis))
      const marker = p.look === 'marker'
      const quote = (q: number) => {
        const size = this.px(marker ? 9.4 : 8.3, q), tracking = marker ? -0.035 : -0.01, face: Face = marker ? 'bold' : 'serif'
        const base: Ink = { face, size, color: p.text, alpha: 1, tracking }
        const emphasized: Ink = { face, size, color: p.emphasis.text, alpha: 1, tracking, box: { color: p.emphasis.box, alpha: p.emphasis.boxAlpha } }
        return new Paragraph(this.measure, text, emphasis, base, emphasized, marker ? 1.04 : 1.16, 0.17 * size, 'quote')
      }
      let paragraph = this.wrapped(s, inner, false, floor, quote)
      if (!paragraph) return null
      if (s > 1 && paragraph.lines.length > GROW_LINES) return null
      // An emphasis split over two lines loses its punch; a slightly smaller size that keeps it whole wins.
      if (paragraph.splitsEmphasis) for (const smaller of [...new Set([0.93, 0.86].map(f => Math.max(s * f, FLOOR)))]) {
        const candidate = quote(smaller)
        if (candidate.wrap(inner, false) && !candidate.splitsEmphasis) { paragraph = candidate; break }
      }
      if (marker) this.kicker(parts, 6, s)
      else { parts.push(this.glyph(this.px(30, s))); gap(4, s) }
      parts.push(this.text(paragraph, padX))
    }
    return parts
  }

  /**
   * Page: the kicker, then the crop as a sheet. Headline: the kicker, the headline, then the sheet. The sheet takes the
   * full inner width, or is drawn narrower and centred when the crop is too tall for the room left. Null without a
   * crop, or when there is no room for one.
   */
  sheetParts(style: 'page' | 'headline'): Part[] | null {
    const crop = this.input.crop
    if (!crop) return null
    const chosen = this.sheetHead(style)
    if (!chosen) return null
    let head = chosen.parts
    const sheet = fitSheet(crop, { width: this.inner, height: this.available - total(head) })
    if (!sheet) return null
    // A crop shorter than its room leaves space that a headline at its nominal size grows into.
    if (style === 'headline' && chosen.scale >= 1) for (let step = GROW_HEADLINE_STEPS; step > 0; step--) {
      const larger = this.headlineHead(1 + step * GROW_HEADLINE / GROW_HEADLINE_STEPS, false)
      if (larger && total(larger) + sheet.height <= this.available) { head = larger; break }
    }
    const { u, padX, inner } = this
    const x = padX + (inner - sheet.width) / 2
    const marks = crop.marks.map(mark => ({ color: HIGHLIGHT_HEX[mark.color], alpha: MARK_ALPHA, rects: mark.rects }))
    return [...head, { height: sheet.height, draw: (out, y) => out.push({
      kind: 'image', x, y, width: sheet.width, height: sheet.height, radius: 1.4 * u,
      shadow: { blur: 3 * u, offsetY: 1.2 * u, color: 'rgba(0,0,0,0.35)' }, marks,
    }) }]
  }

  /**
   * What sits above the sheet, before the crop is known. The headline starts a little smaller than Big idea's and
   * steps down until the sheet has SHEET_SHARE of the room or the headline reaches FLOOR; it is never under
   * MIN_TEXT_PX. Null when the sheet would have less than MIN_SHEET.
   */
  sheetHead(style: 'page' | 'headline'): { parts: Part[]; scale: number } | null {
    if (style === 'page') { const parts: Part[] = []; this.kicker(parts, 5, 1); return { parts, scale: 1 } }
    let chosen: { parts: Part[]; scale: number } | null = null
    for (let step = 0; step <= STEPS; step++) {
      const scale = 1 - step * (1 - FLOOR) / STEPS
      const parts = this.headlineHead(scale, step === STEPS)
      if (!parts) continue
      chosen = { parts, scale }
      if (this.available - total(parts) >= SHEET_SHARE * this.available) break
    }
    return chosen && this.available - total(chosen.parts) >= MIN_SHEET * this.u ? chosen : null
  }

  /** The kicker and the headline at scale `s`, with the gap before the sheet. Null when a word is too wide. */
  headlineHead(s: number, floor: boolean): Part[] | null {
    const parts: Part[] = []
    this.kicker(parts, 3.5, Math.min(s, 1))
    const text = clean(this.input.card.headline)
    if (!text) return parts
    const headline = this.display(text, 7.2, s, -0.03, 1.06, floor, 'headline')
    if (!headline) return null
    parts.push(this.text(headline, this.padX), { height: 5 * this.u * this.k * Math.min(s, 1), draw: () => {} })
    return parts
  }

  /** The room for the sheet at the full inner width, below what sits above it. */
  sheetSpace(style: 'page' | 'headline'): { width: number; height: number } {
    const head = this.sheetHead(style)
    return { width: this.inner, height: head ? this.available - total(head.parts) : 0 }
  }

  plain(text: string, ink: Ink, leading: number, role: TextRole) { return new Paragraph(this.measure, clean(text), '', ink, ink, leading, 0, role) }

  /**
   * A balanced display line at `units` and scale `s`. It takes up to 15% less size when that saves a line, so a
   * word that only just misses does not sit alone ("More / feedback / ...").
   */
  display(text: string, units: number, s: number, tracking: number, leading: number, floor: boolean, role: TextRole): Paragraph | null {
    const build = (q: number) => this.plain(text, { face: 'bold', size: this.px(units, q), color: this.p.text, alpha: 1, tracking }, leading, role)
    const full = build(s)
    if (!full.wrap(this.inner, true)) return this.wrapped(s, this.inner, true, floor, build)
    const smaller = Math.max(s * 0.85, FLOOR)
    if (smaller >= s) return full
    const tight = build(smaller)
    return tight.wrap(this.inner, true) && tight.lines.length < full.lines.length ? tight : full
  }

  /**
   * `build` at scale `q`, wrapped into `column`. Once the card is at its floor, a single word wider than the column
   * shrinks only this block further, down to WORD_FLOOR, so contract-valid content always draws.
   */
  wrapped(q: number, column: number, balance: boolean, floor: boolean, build: (q: number) => Paragraph): Paragraph | null {
    const paragraph = build(q)
    if (paragraph.wrap(column, balance)) return paragraph
    if (!floor) return null
    // Width is close to linear in size; the loop absorbs rounding and the 28 px clamp.
    for (let smaller = Math.min(q, q * column / paragraph.widest) * 0.995; smaller >= WORD_FLOOR / this.k; smaller *= 0.98) {
      const candidate = build(smaller)
      if (candidate.wrap(column, balance)) return candidate
    }
    return null
  }

  text(paragraph: Paragraph, left: number): Part { return { height: paragraph.height, draw: (out, y) => paragraph.draw(out, left, y) } }

  /** Ink and Paper's opening quotation mark, its ink aligned with the text edge. */
  glyph(size: number): Part {
    const mark = NEWSREADER.quoteMark
    const ink: Ink = { face: 'serif', size, color: this.p.accent, alpha: 1, tracking: 0 }
    return { height: (mark.top - mark.bottom) * size, draw: (out, y) => {
      const x = this.padX - mark.left * size, baseline = y + mark.top * size
      const command = textCommand('glyph', '“', x, baseline, ink, (mark.right + mark.left) * size)
      command.box = { x1: this.padX, y1: y, x2: this.padX + (mark.right - mark.left) * size, y2: y + (mark.top - mark.bottom) * size }
      out.push(command)
    } }
  }

  /** The topic in capitals; the accent on Ink and Paper, the text colour on Marker. A blank topic draws nothing. */
  kicker(parts: Part[], after: number, s: number) {
    const marker = this.p.look === 'marker'
    const ink: Ink = { face: marker ? 'bold' : 'semibold', size: this.px(3), color: marker ? this.p.text : this.p.accent, alpha: 1, tracking: 0.14 }
    const label = this.ellipsize(clean(this.input.kicker ?? this.input.card.topic).toUpperCase(), ink, this.inner)
    if (!label) return
    const leading = 1.25
    parts.push({ height: ink.size * leading, draw: (out, y) => out.push(textCommand('kicker', label, this.padX, y + baselineOf(ink, leading), ink, this.measure(label, fontOf(ink), spacingOf(ink)))) })
    parts.push({ height: after * this.u * this.k * s, draw: () => {} })
  }

  takeaway(number: number, title: string, detail: string, t: number, floor: boolean): Part | null {
    const { u, k, p, padX, inner } = this
    const column = 11 * u * k * t
    const numeral: Ink = { face: 'serif', size: this.px(11, t), color: p.accent, alpha: 1, tracking: 0 }
    const heading = this.wrapped(t, inner - column, false, floor, q => this.plain(title, { face: 'bold', size: this.px(5, q), color: p.text, alpha: 1, tracking: -0.015 }, 1.15, 'takeawayTitle'))
    if (!heading) return null
    const body = this.wrapped(t, inner - column, false, floor, q => this.plain(detail, { face: 'regular', size: this.px(3.6, q), color: p.text, alpha: 0.75, tracking: 0 }, 1.3, 'takeawayDetail'))
    if (!body) return null
    const between = 1 * u * k * t
    // The numeral's top lines up with the title's capitals.
    const numeralBaseline = heading.firstBaseline + heading.capTop + NEWSREADER.digit * numeral.size
    const height = Math.max(heading.height + between + body.height, numeralBaseline + 0.02 * numeral.size)
    const label = String(number)
    return { height, draw: (out, y) => {
      out.push(textCommand('numeral', label, padX, y + numeralBaseline, numeral, this.measure(label, fontOf(numeral), 0)))
      heading.draw(out, padX + column, y)
      body.draw(out, padX + column, y + heading.height + between)
    } }
  }

  /**
   * Title over credit and page, and the wordmark, pinned to the bottom; on a carousel slide, its number over the
   * wordmark, both right-aligned. The title and credit are ellipsized to leave the right-hand column clear. Returns
   * its top.
   */
  footer(): number {
    const { u, p, padX, inner } = this
    const gap = 3.2 * u
    const slide = this.input.slide
    const mark: Ink = { face: 'bold', size: this.chrome(2.6), color: p.text, alpha: 0.55, tracking: 0.14 }
    const markWidth = this.measure(WORDMARK, fontOf(mark), spacingOf(mark))
    const numberInk: Ink = { face: 'semibold', size: this.chrome(3.1), color: p.text, alpha: 0.72, tracking: 0 }
    const number = slide ? `${slide.number} / ${slide.count}` : ''
    const numberWidth = number ? this.measure(number, fontOf(numberInk), 0) : 0
    const width = inner - Math.max(markWidth - spacingOf(mark), numberWidth) - gap
    const titleInk: Ink = { face: 'bold', size: this.chrome(3.5), color: p.text, alpha: 1, tracking: 0 }
    const creditInk: Ink = { face: 'regular', size: this.chrome(3.1), color: p.text, alpha: 0.72, tracking: 0 }
    const title = this.ellipsize(clean(this.input.source.title), titleInk, width)
    const source = this.input.source
    const credit = this.ellipsize(clean(slide && !(source.page > 0) ? collapse(source.credit) : creditLine(source)), creditInk, width)
    const titleLine = title ? titleInk.size * 1.25 : 0, creditLineHeight = credit ? creditInk.size * 1.3 : 0
    const markLine = mark.size * 1.3, numberLine = number ? numberInk.size * 1.3 : 0
    const height = Math.max(titleLine + creditLineHeight, numberLine + markLine)
    const footerTop = this.bottom - height
    const y = footerTop + (height - titleLine - creditLineHeight) / 2
    if (title) this.out.push(textCommand('footerTitle', title, padX, y + baselineOf(titleInk, 1.25), titleInk, this.measure(title, fontOf(titleInk), 0)))
    if (credit) this.out.push(textCommand('footerCredit', credit, padX, y + titleLine + baselineOf(creditInk, 1.3), creditInk, this.measure(credit, fontOf(creditInk), 0)))
    const right = footerTop + (height - numberLine - markLine) / 2
    if (number) this.out.push(textCommand('slideNumber', number, padX + inner - numberWidth, right + baselineOf(numberInk, 1.3), numberInk, numberWidth))
    // Canvas adds tracking after the last letter too; the ink ends at the right edge.
    this.out.push(textCommand('wordmark', WORDMARK, padX + inner - markWidth + spacingOf(mark), right + numberLine + baselineOf(mark, 1.3), mark, markWidth))
    return footerTop
  }

  ellipsize(text: string, ink: Ink, width: number): string {
    if (width <= 0 || !text) return ''
    const measure = (s: string) => this.measure(s, fontOf(ink), spacingOf(ink)) - spacingOf(ink)
    if (measure(text) <= width) return text
    const chars = Array.from(text)
    let low = 0, high = chars.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (measure(chars.slice(0, middle).join('').trimEnd() + '…') <= width) low = middle; else high = middle - 1
    }
    return low === 0 ? '' : chars.slice(0, low).join('').trimEnd() + '…'
  }
}

const total = (parts: Part[]) => parts.reduce((sum, part) => sum + part.height, 0)

/**
 * Lays out a card. Throws Error(TOO_LONG) when the text cannot fit, which content within the contract's limits never
 * does. A Page card without a crop is laid out as Quote, a Headline card as Big idea; `style` in the result says so.
 * The Fit size applies to Page: as tall as the kicker, the sheet and the footer need, within FIT. Any other style
 * asked for Fit, and Page drawn as Quote, is laid out as Feed.
 */
export function layoutCard(input: CardLayoutInput, measure: Measure): CardLayout {
  if (input.style === 'takeaways' && input.card.takeaways.length !== 3) throw new Error('The Takeaways card needs exactly three items.')
  if (input.size === 'fit') {
    const tallest = new Card(input, measure, FIT.maxHeight)
    tallest.frame()
    const parts = input.style === 'page' ? tallest.sheetParts('page') : null
    if (!parts) return new Card({ ...input, size: 'feed' }, measure).layout()
    // Rounded up, so the sheet still fits at the width it had on the tallest card.
    const height = Math.min(FIT.maxHeight, Math.max(FIT.minHeight, Math.ceil(FIT.maxHeight - (tallest.available - total(parts)) - 1e-6)))
    return new Card(input, measure, height).layout()
  }
  return new Card(input, measure).layout()
}

/**
 * The room for the crop on a Page or Headline card (any other style counts as Page): the tallest sheet, in px at the
 * full inner width, that fits between what sits above it and the footer. For Fit, that of the tallest Fit card, so
 * the crop can be chosen before the card's height is known. `fill` is the sheet height an automatic crop grows
 * towards so the card has no empty ground: all the room on Feed and Story, the smallest Fit card's sheet on Fit.
 */
export function pageSheetSpace(input: Omit<CardLayoutInput, 'crop'>, measure: Measure): { width: number; height: number; fill: number } {
  // Headline at Fit is laid out as Feed.
  const style = input.style === 'headline' ? 'headline' : 'page', size = style === 'headline' && input.size === 'fit' ? 'feed' : input.size
  const card = new Card({ ...input, style, size }, measure, size === 'fit' ? FIT.maxHeight : undefined)
  card.frame()
  const space = card.sheetSpace(style)
  return { ...space, fill: size === 'fit' ? Math.max(0, space.height - (FIT.maxHeight - FIT.minHeight)) : space.height }
}
