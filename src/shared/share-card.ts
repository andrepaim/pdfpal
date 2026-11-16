// Share cards: the contract between the pipeline (src/core/share-cards.ts), the server routes and the
// reader's renderer. See docs/share-posts-plan.md (and docs/share-cards-plan.md for the first build). The server and the reader both import this module, so it
// imports neither Node nor DOM modules, and no zod: the reader's bundle must stay free of it
// (test/unit/visual-bundle.test.ts). The zod schemas for these shapes are in ./share-card-schema.ts.

export const CARD = {
  quoteMax: 240, quoteLeadsMax: 120, emphasisMax: 40, headlineMax: 80, pullMax: 140,
  topicMax: 24, takeawaysTitleMax: 48, takeawayTitleMax: 32, takeawayDetailMax: 72,
  passageMin: 20, passageMax: 6000, contextMax: 12000, creditMax: 200,
} as const
/** Page and Headline show the PDF's own pixels; the other three are text cards. See docs/share-posts-plan.md. */
export const STYLES = ['page', 'headline', 'quote', 'idea', 'takeaways'] as const
export const TEXT_CARD_STYLES = ['quote', 'idea', 'takeaways'] as const
export const LOOKS = ['ink', 'paper', 'marker'] as const
export const SIZES = { feed: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } } as const
/** The Fit size: as tall as the Page style's crop needs, within these bounds. */
export const FIT = { width: 1080, minHeight: 608, maxHeight: 1350 } as const
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
/** Where the post is going. It sets the frame, the text length and the defaults. */
export const DESTINATIONS = ['linkedin', 'x', 'instagram'] as const
/** The three drafts one request may return. */
export const ANGLES = ['finding', 'contrast', 'caveat'] as const
/**
 * What a post started from: a highlight, a box the reader drew on a page, the first page of the paper, or a set of
 * highlights from one paper told as a carousel.
 */
export const SOURCE_KINDS = ['highlight', 'region', 'paper', 'set'] as const
/** A carousel: how many highlights, and the limits of its slides' words. */
export const SET = { minItems: 2, maxItems: 8, studyMax: 160, pointMax: 70, takeawayMax: 140, limitationsMax: 160 } as const
/** The smallest region, as a fraction of the page in each direction. */
export const REGION_MIN = 0.05
/** Where the link goes in a LinkedIn post: in the post, or held back as a ready first-comment line. */
export const LINKS = ['post', 'comment'] as const

export type ShareStyle = (typeof STYLES)[number]
export type ShareLook = (typeof LOOKS)[number]
/** 'fit' applies to the Page style; other styles draw it as 'feed'. */
export type CardSize = keyof typeof SIZES | 'fit'
export type Destination = (typeof DESTINATIONS)[number]
export type Angle = (typeof ANGLES)[number]
export type LinkPlacement = (typeof LINKS)[number]
export type SourceKind = (typeof SOURCE_KINDS)[number]
/** One highlight of a carousel, copied when the post is made so that the post outlives it. */
export type SetItem = { annotation_id: string | null; passage: string; page: number; rects: PageRect[]; color: HighlightColor }
/** A carousel's words beyond the cover, and the reader's crop of each highlight slide (null is automatic). */
export type SetContent = { study: string; points: string[]; takeaway: string; limitations: string; crops: Array<PageRect | null> }
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]
export type ShareCardStatus = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'

/** Fractions of the page, 0..1. */
export type PageRect = { x1: number; y1: number; x2: number; y2: number }

/** One highlight on the post's page: its boxes as page fractions. */
export type PageMark = { rects: PageRect[]; color: HighlightColor }

/** Fixed when the post is created. Only `credit` may change later. */
export type ShareCardSource = {
  version: 1
  /** Unknown in sources stored before region posts, which are highlights. */
  kind: SourceKind
  /**
   * For a highlight, the highlight after cleanPassage(), CARD.passageMin..passageMax characters. For a region or the
   * first page, the text the reader's browser read inside the region, cleaned the same way: at most CARD.passageMax
   * characters, possibly short or empty (a figure may hold only axis labels).
   */
  passage: string
  page: number
  /** Per-line boxes; the single bounding box for highlights made before per-line boxes existed. Empty for a region. */
  rects: PageRect[]
  /** Unknown stored colours become 'yellow'; always 'yellow' for a region. */
  color: HighlightColor
  /** The box a region or first-page post started from, as page fractions; null for a highlight. */
  region: PageRect | null
  /**
   * A carousel's highlights in the reader's order, 2 to SET.maxItems; [] for every other kind. For a set, passage is
   * their passages joined by blank lines, page is the first item's page, rects is [], color 'yellow' and region null.
   */
  items: SetItem[]
  /**
   * Text of the page and its two neighbours, at most CARD.contextMax characters. For a set, the text of the items'
   * own pages, the budget shared fairly between them.
   */
  context: string
  title: string
  /** For example "Vaswani et al., 2017"; may be empty. */
  credit: string
  /** A public link, or ''. */
  url: string
}

export type CardTakeaway = { title: string; detail: string }

export type CardContent = {
  quote: string
  /** True when the reader edited the quote so that it no longer matches the passage. */
  quoteEdited: boolean
  /** An exact part of quote, or ''. */
  emphasis: string
  headline: string
  /** An exact part of passage or context, or ''. */
  pull: string
  topic: string
  takeawaysTitle: string
  /** Exactly three. */
  takeaways: CardTakeaway[]
  style: ShareStyle
  look: ShareLook
  /** The reader's crop of the page, as page fractions; null means automatic. Always null for a set. */
  crop: PageRect | null
  /**
   * A carousel's slides (null for every other kind). A set's card has a headline and a topic, no quote and no
   * takeaways, points and crops one per item, and the Headline style.
   */
  set: SetContent | null
}

/** The text of a post: up to three drafts for one destination, and how the copied text is composed. */
export type Caption = {
  destination: Destination
  /** The reader's line the drafts were built around, or ''. */
  take: string
  /** drafts.finding is never empty; the other two may be ''. */
  drafts: Record<Angle, string>
  angle: Angle
  /** 3 to 5, always returned; shown when showTags. */
  hashtags: string[]
  showTags: boolean
  link: LinkPlacement
  /** When set, replaces the composed text. */
  edited: string | null
}

export type ShareCardRecord = {
  id: string; project_id: string; source_id: string | null; annotation_id: string | null
  /** Of the latest generation. */
  status: ShareCardStatus
  source: ShareCardSource
  /** The last completed version; may be present while status is running or failed. */
  card: CardContent | null
  caption: Caption | null
  can_undo: boolean
  instruction: string
  error: string | null
  created_at: string; updated_at: string
  /** Of the latest request; the completed version's own is caption.destination. */
  destination: Destination
  /** Of the latest request; the completed version's own is caption.take. */
  take: string
  /** Every highlight now on the post's page, the post's own included; read live from annotations. A set's first item's page. */
  marks: PageMark[]
  /** For a set, one list per item: every highlight now on that item's page, the item's own included. [] otherwise. */
  set_marks: PageMark[][]
}

export type ShareCardSummary = {
  id: string; status: ShareCardStatus; annotation_id: string | null; source_id: string | null
  page: number
  kind: SourceKind
  /** See summaryTitle(). */
  title: string
  updated_at: string
}

export const STYLE_NAMES: Record<ShareStyle, string> = { page: 'Page', headline: 'Headline', quote: 'Quote', idea: 'Big idea', takeaways: 'Takeaways' }
export const LOOK_NAMES: Record<ShareLook, string> = { ink: 'Ink', paper: 'Paper', marker: 'Marker' }
export const DESTINATION_NAMES: Record<Destination, string> = { linkedin: 'LinkedIn', x: 'X · Bluesky · Threads', instagram: 'Instagram' }
export const ANGLE_NAMES: Record<Angle, string> = { finding: 'The finding', contrast: 'Belief vs. paper', caveat: 'The caveat' }

/** What a destination starts with. `extraLines` is the context around the highlight in an automatic crop. */
export const DESTINATION_DEFAULTS: Record<Destination, { style: ShareStyle; size: CardSize; extraLines: 0 | 1 | 3; showTags: boolean }> = {
  linkedin: { style: 'page', size: 'fit', extraLines: 3, showTags: false },
  x: { style: 'page', size: 'fit', extraLines: 1, showTags: false },
  instagram: { style: 'headline', size: 'feed', extraLines: 3, showTags: true },
}

/** Limits of one draft, by destination. `hookMax` is the first line, which is what shows before "see more". */
export const DRAFT: Record<Destination, { minWords: number; maxWords: number; maxChars: number; hookMax: number; minParagraphs: number; maxParagraphs: number }> = {
  linkedin: { minWords: 120, maxWords: 300, maxChars: 3000, hookMax: 140, minParagraphs: 3, maxParagraphs: 8 },
  instagram: { minWords: 80, maxWords: 200, maxChars: 2200, hookMax: 125, minParagraphs: 2, maxParagraphs: 6 },
  x: { minWords: 8, maxWords: 60, maxChars: 280, hookMax: 280, minParagraphs: 1, maxParagraphs: 2 },
}
/** The reader's take. On X a take raises a draft's maxChars to max(280, take.length + 140). */
export const TAKE_MAX = 400

export type DraftLimits = (typeof DRAFT)[Destination]

/** How X counts any link, plus the blank line the app puts before it. */
const X_LINK_CHARS = 23 + 2
const wordCount = (text: string) => text.split(/\s+/u).filter(Boolean).length

/**
 * The limits one draft is checked against. A take is its own paragraph after at least one other, and a long take
 * raises the word and character limits so that it still fits with a lead-in (the X rule in docs/share-posts-plan.md,
 * which never binds on LinkedIn or Instagram). A change instruction may make a draft shorter and a single paragraph.
 * On X the app appends the link, which counts as 23 characters, so a draft leaves room for it.
 */
export function draftLimits(destination: Destination, options: { take?: string; changed?: boolean; url?: string } = {}): DraftLimits {
  const base = DRAFT[destination], take = collapse(options.take ?? '')
  let { minWords, maxWords, maxChars, minParagraphs, maxParagraphs } = base
  if (take) {
    maxWords = Math.max(maxWords, wordCount(take) + 25)
    maxChars = Math.max(maxChars, take.length + 140)
    minParagraphs = Math.max(minParagraphs, 2)
    maxParagraphs = Math.max(maxParagraphs, 2)
  }
  if (options.changed) { minWords = Math.min(minWords, 10); minParagraphs = 1 }
  if (destination === 'x' && options.url?.trim()) maxChars -= X_LINK_CHARS
  // Where the first line is the whole visible post (X), it follows the character limit.
  const hookMax = base.hookMax >= base.maxChars ? maxChars : Math.min(base.hookMax, maxChars)
  return { minWords, maxWords, maxChars, hookMax, minParagraphs, maxParagraphs }
}

/** Whether a generation owns the post: nothing else may change it meanwhile. */
export const isActive = (status: ShareCardStatus) => status === 'pending' || status === 'running'

/** Every whitespace run, including line breaks and non-breaking spaces, as one space; trimmed. */
export const collapse = (text: string) => text.replace(/\s+/gu, ' ').trim()

const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'ft', 'ﬆ': 'st' }

/**
 * The highlight's text as it is stored, given to the model and checked against: ligatures spelled out, soft
 * hyphens removed, a word split by a hyphen at a line end joined, and whitespace collapsed. Not NFKC, which
 * would also flatten superscripts. A real compound broken at its hyphen ("self-" / "attention") is joined too;
 * the reader can fix the quote, and the Page style shows the true page.
 */
export function cleanPassage(text: string): string {
  return collapse(text
    .replace(/[ﬀ-ﬆ]/gu, match => LIGATURES[match] ?? match)
    .replace(/­/gu, '')
    // The hyphen may be U+002D or U+2010. pdf.js can leave spaces around the line break.
    .replace(/(\p{Ll})[-‐][^\S\n]*\r?\n\s*(?=\p{Ll})/gu, '$1'))
}

/** True when `quote` is blank or `text` contains it, both with whitespace collapsed. */
export function quoteMatches(quote: string, text: string): boolean {
  const wanted = collapse(quote)
  return !wanted || collapse(text).includes(wanted)
}

function limit(name: string, value: string, max: number, min = 1) {
  if (value.length < min || value.length > max) throw new Error(`${name} has ${value.length} characters; allowed ${min}–${max}.`)
}

/**
 * Throws unless the card can be drawn and every quoted word comes from the source. Messages name the field
 * and the limit, because they are handed back to the model as the repair reason.
 */
export function validateCard(card: CardContent, source: Pick<ShareCardSource, 'passage' | 'context'> & { kind?: SourceKind; items?: SetItem[] }): void {
  if (source.kind === 'set') return validateSetCard(card, source.items ?? [])
  if (source.kind && source.kind !== 'highlight') return validateRegionCard(card)
  limit('quote', card.quote, CARD.quoteMax)
  if (!card.quoteEdited && !quoteMatches(card.quote, source.passage)) throw new Error('quote must be copied exactly from highlight.')
  limit('emphasis', card.emphasis, CARD.emphasisMax, 0)
  if (card.emphasis && !card.quote.includes(card.emphasis)) throw new Error('emphasis must be an exact part of quote.')
  limit('headline', card.headline, CARD.headlineMax)
  limit('pull', card.pull, CARD.pullMax, 0)
  if (!quoteMatches(card.pull, `${source.passage} ${source.context}`)) throw new Error('pull must be copied exactly from highlight or pageText.')
  limit('topic', card.topic, CARD.topicMax, 0)
  limit('takeawaysTitle', card.takeawaysTitle, CARD.takeawaysTitleMax)
  if (!Array.isArray(card.takeaways) || card.takeaways.length !== 3) throw new Error(`takeaways needs exactly three items; it has ${Array.isArray(card.takeaways) ? card.takeaways.length : 0}.`)
  card.takeaways.forEach((item, index) => {
    limit(`takeaways[${index}].title`, item.title, CARD.takeawayTitleMax)
    limit(`takeaways[${index}].detail`, item.detail, CARD.takeawayDetailMax)
  })
  if (!(STYLES as readonly string[]).includes(card.style)) throw new Error(`Unknown card style: ${card.style}.`)
  if (!(LOOKS as readonly string[]).includes(card.look)) throw new Error(`Unknown card look: ${card.look}.`)
  if (card.set) throw new Error('set must be empty for a post from one highlight.')
}

/** Why a region or first-page post cannot take a text-card style. */
export const REGION_STYLE_REFUSED = 'A post made from a region has no quote or takeaways, so it uses the Page or Headline style.'
/** The styles a region or first-page post can take. */
export const REGION_STYLES = ['page', 'headline'] as const

/** A region or first-page card: a headline and a topic, nothing quoted, drawn as Page or Headline. */
function validateRegionCard(card: CardContent): void {
  for (const name of ['quote', 'emphasis', 'pull', 'takeawaysTitle'] as const) if (card[name]) throw new Error(`${name} must be empty for a post made from a region.`)
  if (!Array.isArray(card.takeaways) || card.takeaways.length) throw new Error('takeaways must be empty for a post made from a region.')
  limit('headline', card.headline, CARD.headlineMax)
  limit('topic', card.topic, CARD.topicMax, 0)
  if (!(STYLES as readonly string[]).includes(card.style)) throw new Error(`Unknown card style: ${card.style}.`)
  if (!(REGION_STYLES as readonly string[]).includes(card.style)) throw new Error(REGION_STYLE_REFUSED)
  if (!(LOOKS as readonly string[]).includes(card.look)) throw new Error(`Unknown card look: ${card.look}.`)
  if (card.set) throw new Error('set must be empty for a post made from a region.')
}

/** Why a carousel cannot take another style. */
export const SET_STYLE_REFUSED = "A carousel's slides use the Headline style; only the look can change."

/**
 * A carousel's card: a headline and a topic on the cover, then its slides' words within SET's limits, one point and
 * one crop per item. Messages name the answer's fields, because they are also the repair reason.
 */
function validateSetCard(card: CardContent, items: SetItem[]): void {
  const set = card.set
  if (!set) throw new Error('A carousel needs its slides.')
  for (const name of ['quote', 'emphasis', 'pull', 'takeawaysTitle'] as const) if (card[name]) throw new Error(`${name} must be empty for a carousel.`)
  if (!Array.isArray(card.takeaways) || card.takeaways.length) throw new Error('takeaways must be empty for a carousel.')
  if (card.crop) throw new Error('crop must be empty for a carousel; each highlight slide has its own.')
  limit('headline', card.headline, CARD.headlineMax)
  limit('topic', card.topic, CARD.topicMax, 0)
  for (const name of ['points', 'crops'] as const)
    if (!Array.isArray(set[name]) || set[name].length !== items.length) throw new Error(`${name} has ${Array.isArray(set[name]) ? set[name].length : 0} items; it needs exactly ${items.length}, one per highlight in order.`)
  set.points.forEach((point, index) => limit(`points[${index}]`, point, SET.pointMax))
  limit('study', set.study, SET.studyMax, 0)
  limit('takeaway', set.takeaway, SET.takeawayMax)
  limit('limitations', set.limitations, SET.limitationsMax, 0)
  set.crops.forEach((crop, index) => { if (crop && !(crop.x1 < crop.x2 && crop.y1 < crop.y2)) throw new Error(`crops[${index}] needs x1 < x2 and y1 < y2.`) })
  if (card.style !== 'headline') throw new Error(SET_STYLE_REFUSED)
  if (!(LOOKS as readonly string[]).includes(card.look)) throw new Error(`Unknown card look: ${card.look}.`)
}

/** One slide of a carousel, in order. `item` is the index of the highlight a point slide shows. */
export type SlideSpec =
  | { kind: 'cover'; kicker: string; headline: string }
  | { kind: 'study' | 'takeaway' | 'limitations'; kicker: string; text: string }
  | { kind: 'point'; kicker: string; headline: string; item: number }

/**
 * A carousel's slides: the cover; the study when it is not empty; one slide per highlight; the takeaway; the limits
 * when they are not empty. A point slide's kicker is the topic, as the cover's. [] for a card that is not a carousel.
 */
export function setSlides(card: CardContent, source: Pick<ShareCardSource, 'items'>): SlideSpec[] {
  const set = card.set
  if (!set) return []
  const points = set.points.slice(0, source.items.length).map((headline, item): SlideSpec => ({ kind: 'point', kicker: card.topic, headline, item }))
  return [
    { kind: 'cover', kicker: card.topic, headline: card.headline },
    ...set.study ? [{ kind: 'study', kicker: 'The study', text: set.study } as const] : [],
    ...points,
    { kind: 'takeaway', kicker: 'The takeaway', text: set.takeaway },
    ...set.limitations ? [{ kind: 'limitations', kicker: 'Limits', text: set.limitations } as const] : [],
  ]
}

/** Why a region cannot start a post, or null when it can: ordered, inside the page, at least REGION_MIN each way. */
export function regionProblem(region: PageRect): string | null {
  const { x1, y1, x2, y2 } = region
  const inside = [x1, y1, x2, y2].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
  // A small tolerance, so that a region of exactly 5% computed in floating point is not refused.
  return inside && x2 - x1 >= REGION_MIN - 1e-9 && y2 - y1 >= REGION_MIN - 1e-9 ? null
    : 'A region needs x1 < x2 and y1 < y2 inside the page, and at least 5% of the page in each direction.'
}

/** A post's name in lists: the headline, else the start of the highlight, "Region on p. N", "First page" or "N highlights". */
export function summaryTitle(source: Pick<ShareCardSource, 'kind' | 'passage' | 'page' | 'items'>, headline: string): string {
  if (headline) return headline
  if (source.kind === 'set') return `${source.items.length} highlights`
  if (source.kind === 'region') return `Region on p. ${source.page}`
  if (source.kind === 'paper') return source.page === 1 ? 'First page' : `Paper on p. ${source.page}`
  return source.passage.length > 80 ? `${source.passage.slice(0, 80).replace(/\s+\S*$/u, '')}…` : source.passage
}

export const defaultLook = (): ShareLook => 'ink'

/** Unknown stored colours become yellow. */
export const highlightColor = (color: string | null | undefined): HighlightColor =>
  (HIGHLIGHT_COLORS as readonly string[]).includes(color ?? '') ? color as HighlightColor : 'yellow'

/** The source line under the caption and in the card footer: credit and page. */
export const creditLine = (source: Pick<ShareCardSource, 'credit' | 'page'>) =>
  [collapse(source.credit), `p. ${source.page}`].filter(Boolean).join(' · ')

/** The typed source line under a post's text: title, credit and page. */
export const sourceLine = (source: Pick<ShareCardSource, 'title' | 'credit' | 'page'>) =>
  '📄 ' + [collapse(source.title), collapse(source.credit), `p. ${source.page}`].filter(Boolean).join(' · ')

/**
 * The post's text exactly as it is copied: the edited text, or the chosen draft (the finding when that angle is
 * empty) followed by what the destination carries. LinkedIn: the source line, then the link unless it is held back
 * for the first comment, and the hashtags when shown. X: the link only. Instagram: the source line, the link as plain
 * text and the hashtags when shown; `link` applies to LinkedIn only.
 */
export function captionText(source: ShareCardSource, caption: Caption): string {
  if (caption.edited !== null) return caption.edited
  const draft = (caption.drafts[caption.angle] || caption.drafts.finding).trim(), url = source.url.trim()
  const tags = caption.showTags ? caption.hashtags.map(tag => `#${tag}`).join(' ') : ''
  if (caption.destination === 'x') return [draft, url].filter(Boolean).join('\n\n')
  const link = caption.destination === 'linkedin' && caption.link === 'comment' ? '' : url
  return [draft, [sourceLine(source), link].filter(Boolean).join('\n'), tags].filter(Boolean).join('\n\n')
}

/** The ready first-comment line for a LinkedIn post whose link is held back: the source line and the link; '' without a link. */
export function firstCommentText(source: ShareCardSource): string {
  const url = source.url.trim()
  return url ? `${sourceLine(source)}\n${url}` : ''
}

/** What a screen reader hears for the card: the words drawn in `style`. */
export function cardDescription(card: CardContent, style: ShareStyle, source?: Pick<ShareCardSource, 'kind' | 'page'>): string {
  if (card.set) {
    const count = 2 + (card.set.study ? 1 : 0) + card.set.points.length + (card.set.limitations ? 1 : 0)
    return `Carousel of ${count} slides: ${card.headline.replace(/\.+$/u, '')}.`
  }
  // A region or first-page post has no quote: the Page card names what it shows, the Headline card reads its headline.
  if (!card.quote && (style === 'page' || style === 'headline')) {
    if (style === 'headline') return `Headline card: ${card.headline.replace(/\.+$/u, '')}.`
    return source?.kind === 'paper' ? 'Page card: the first page of the paper' : `Page card: a region of ${source ? `page ${source.page}` : 'the page'}`
  }
  switch (style) {
    case 'quote': return `Quote card: “${card.quote}”`
    case 'page': return `Page card: “${card.quote}”`
    case 'headline': return `Headline card: ${card.headline.replace(/\.+$/u, '')}. “${card.quote}”`
    case 'idea': return `Big idea card: ${card.headline.replace(/\.+$/u, '')}.` + (card.pull.trim() ? ` “${card.pull}”` : '')
    case 'takeaways': return `Takeaways card: ${card.takeawaysTitle.replace(/\.+$/u, '')}. ` +
      card.takeaways.map((item, index) => `${index + 1}. ${item.title}: ${item.detail}`).join(' ')
  }
}

function privateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

function privateIPv6(host: string): boolean {
  const address = host.replace(/^\[|\]$/gu, '').toLowerCase()
  if (!address.includes(':')) return false
  if (address === '::' || address === '::1') return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(address)?.[1]
  if (mapped) return privateIPv4(mapped)
  // ::ffff:7f00:1 is the hexadecimal form of a mapped IPv4 address.
  if (address.startsWith('::ffff:')) return true
  return /^f[cd]/u.test(address) || /^fe[89ab]/u.test(address)
}

/**
 * The source's link when it may appear in a public post: http or https, no user name or password, and a host
 * that is not localhost or a loopback or private address. Otherwise ''.
 */
export function publicUrl(url: string | null | undefined): string {
  if (!url) return ''
  let parsed: URL
  try { parsed = new URL(url.trim()) } catch { return '' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (parsed.username || parsed.password) return ''
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || privateIPv4(host) || privateIPv6(host)) return ''
  return parsed.href
}

// The numbers check. Every number the assistant writes must appear in what it was given, so that a recalled,
// computed or converted figure never reaches a post. When two readings of a numeral are possible (is "1.572" a
// thousand or a decimal?) both count: the check prefers letting a legitimate draft through to blocking it.
//
// - A numeral is a run of digits with "." or "," (or a non-breaking or thin space) between digit groups, or a
//   leading-point decimal such as ".65". Digits glued to a preceding letter ("p53", "CO2", "H1N1") are names, not
//   quantities, and are skipped. Signs and units are ignored: "63%", "63 percent" and "63" are the same number.
// - Thousands separators are dropped in either style ("1,572", "1.572", "1 572" are 1572), a decimal comma is a
//   decimal point, and trailing decimal zeros do not matter ("0.650" is "0.65", ".65" is "0.65"). A numeral with one
//   separator and three digits after it ("1,572") reads both as a thousand and as a decimal.
// - A draft may round a decimal from the source to fewer places ("1.35" as "1.4" or "1.3"), and to a whole number
//   only when the source's number is 10 or more ("63.4%" as "63%", but not "1.5" as "2").
// - A year is a number like any other; a range ("2021–2024") is its two ends, and an abbreviated end ("2021-24")
//   also counts in full. An ordinal ("3rd") is its number. An unreadable numeral ("3.5.1") must appear as written.
// - English number words from zero to ninety-nine and ordinals up to "twelfth" in the source count as the number,
//   so "thirty-three studies" supports "33". Number words in a draft are not checked.

const NUMERAL = /(?<![\p{L}\p{N}.,])(?:\d+(?:[.,   ]\d+)*|\.\d+)/gu
const WORD_UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const WORD_TENS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const WORD_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
const NUMBER_WORDS = new RegExp(`\\b(?:(${WORD_TENS.join('|')})(?:[-\\s]+(${WORD_UNITS.slice(1, 10).join('|')}))?|(${WORD_UNITS.join('|')})|(${WORD_ORDINALS.join('|')}))\\b`, 'giu')
const ABBREVIATED_RANGE = /(?<!\d)(\d{2})(\d{2})\s*[-–—]\s*(\d{2})(?!\d)/gu

/** Every numeral in `text`, as written. */
export const numbersIn = (text: string): string[] => [...text.matchAll(NUMERAL)].map(match => match[0])

/** A plain decimal string without leading or trailing zeros: "007" is "7", ".650" is "0.65". */
function canonical(digits: string): string {
  const [whole = '', fraction = ''] = digits.split('.')
  const head = whole.replace(/^0+(?=\d)/u, '') || '0', tail = fraction.replace(/0+$/u, '')
  return tail ? `${head}.${tail}` : head
}

/** Every value a numeral may stand for, in canonical form. */
function readings(numeral: string): string[] {
  const out = new Set<string>()
  if (/^\d+$/u.test(numeral)) out.add(canonical(numeral))
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(numeral)) out.add(canonical(numeral.replaceAll(',', '')))
  if (/^\d{1,3}(?:[.   ]\d{3})+(?:,\d+)?$/u.test(numeral)) out.add(canonical(numeral.replace(/[.   ]/gu, '').replace(',', '.')))
  if (/^\d{1,3}(?:[   ]\d{3})+(?:\.\d+)?$/u.test(numeral)) out.add(canonical(numeral.replace(/[   ]/gu, '')))
  if (/^\d*[.,]\d+$/u.test(numeral)) out.add(canonical(numeral.replace(',', '.')))
  return [...out]
}

const decimals = (value: string) => value.split('.')[1]?.length ?? 0

/**
 * The numerals in `text` that none of `allowedTexts` supports, each once, as written. See the rules above.
 */
export function unsupportedNumbers(text: string, allowedTexts: string[]): string[] {
  const raw = new Set<string>(), values = new Set<string>()
  for (const allowed of allowedTexts) {
    for (const numeral of numbersIn(allowed)) { raw.add(numeral); for (const value of readings(numeral)) values.add(value) }
    for (const [, century = '', , end = ''] of allowed.matchAll(ABBREVIATED_RANGE)) values.add(canonical(century + end))
    for (const [, tens, unit, single, ordinal] of allowed.matchAll(NUMBER_WORDS)) {
      const value = tens ? (WORD_TENS.indexOf(tens.toLowerCase()) + 2) * 10 + (unit ? WORD_UNITS.indexOf(unit.toLowerCase()) : 0)
        : single ? WORD_UNITS.indexOf(single.toLowerCase()) : WORD_ORDINALS.indexOf(ordinal!.toLowerCase()) + 1
      values.add(String(value))
    }
  }
  const precise = [...values].filter(value => decimals(value) > 0).map(value => ({ value: Number(value), places: decimals(value) }))
  const rounds = (value: string) => precise.some(source => source.places > decimals(value) && (decimals(value) > 0 || source.value >= 10) &&
    Math.abs(source.value - Number(value)) <= 0.5 * 10 ** -decimals(value) + 1e-9)
  const refused = new Set<string>()
  for (const numeral of numbersIn(text)) {
    const options = readings(numeral)
    if (!raw.has(numeral) && !options.some(value => values.has(value) || rounds(value))) refused.add(numeral)
  }
  return [...refused]
}
