// Zod schemas for the share-card shapes in ./share-card.ts. Server-side only: the reader imports the
// contract module, never this one, so zod stays out of its bundle (test/unit/visual-bundle.test.ts).
import { z } from 'zod'
import {
  ANGLES, CARD, DESTINATIONS, HIGHLIGHT_COLORS, LINKS, LOOKS, PAPER, SET, SOURCE_KINDS, STYLES, TAKE_MAX,
  type Caption, type CardContent, type PageMark, type PageRect, type PaperContent, type PaperResult, type Row, type Stat, type SetContent, type SetItem, type ShareCardSource,
} from './share-card.js'

const fraction = z.number().finite().min(0).max(1)
export const pageRectSchema = z.object({ x1: fraction, y1: fraction, x2: fraction, y2: fraction }).strict()
export const statSchema = z.object({ value: z.string().max(200), label: z.string().max(200) }).strict()
export const rowSchema = z.object({ label: z.string().max(200), value: z.string().max(200) }).strict()

export const setItemSchema = z.object({
  annotation_id: z.string().max(200).nullable(), passage: z.string().min(CARD.passageMin).max(CARD.passageMax), page: z.number().int().positive(),
  rects: z.array(pageRectSchema).max(500), color: z.enum(HIGHLIGHT_COLORS),
}).strict()

/**
 * A stored source. One stored before region posts has no kind, region or items and is a highlight. A highlight's
 * passage has CARD.passageMin characters at least; a region's may be empty; a set's holds all its highlights. Only a
 * region or first-page post carries a region, and only a set has items, 2 to SET.maxItems.
 */
export const shareCardSourceSchema = z.object({
  version: z.literal(1),
  kind: z.enum(SOURCE_KINDS).default('highlight'),
  passage: z.string().max(CARD.passageMax * SET.maxItems + 2 * (SET.maxItems - 1)),
  page: z.number().int().positive(),
  rects: z.array(pageRectSchema).max(500),
  color: z.enum(HIGHLIGHT_COLORS),
  region: pageRectSchema.nullable().default(null),
  items: z.array(setItemSchema).max(SET.maxItems).default([]),
  context: z.string().max(CARD.paperContextMax),
  title: z.string().max(2000),
  credit: z.string().max(CARD.creditMax),
  url: z.string().max(4000),
}).strict().superRefine((source, context) => {
  if (source.kind === 'highlight' && source.passage.length < CARD.passageMin) context.addIssue({ code: 'custom', path: ['passage'], message: `A highlight's passage needs at least ${CARD.passageMin} characters.` })
  if (source.kind !== 'paper' && source.context.length > CARD.contextMax) context.addIssue({ code: 'custom', path: ['context'], message: `A page text has at most ${CARD.contextMax} characters.` })
  if (source.kind !== 'set' && source.passage.length > CARD.passageMax) context.addIssue({ code: 'custom', path: ['passage'], message: `A passage has at most ${CARD.passageMax} characters.` })
  if ((source.kind === 'region' || source.kind === 'paper') !== (source.region !== null)) context.addIssue({ code: 'custom', path: ['region'], message: 'Only a region or first-page post has a region.' })
  if (source.kind === 'set' ? source.items.length < SET.minItems : source.items.length > 0) context.addIssue({ code: 'custom', path: ['items'], message: `Only a set has items, ${SET.minItems} to ${SET.maxItems}.` })
})

export const setContentSchema = z.object({
  study: z.string(), studyStats: z.array(statSchema).max(PAPER.maxStats).default([]), points: z.array(z.string()).max(SET.maxItems), takeaway: z.string(), limitations: z.string(),
  crops: z.array(pageRectSchema.nullable()).max(SET.maxItems),
}).strict()

export const cardTakeawaySchema = z.object({ title: z.string(), detail: z.string() }).strict()

export const paperResultSchema = z.object({ text: z.string(), stat: statSchema.nullable(), rows: z.array(rowSchema).max(PAPER.maxRows) }).strict()
/**
 * A paper post's words. One stored before stage 6 has results as plain sentences and no methodStats: they read as
 * { text, stat: null, rows: [] } and [].
 */
export const paperContentSchema = z.object({
  question: z.string(), method: z.string(), methodStats: z.array(statSchema).max(PAPER.maxStats).default([]),
  results: z.array(z.union([paperResultSchema, z.string().transform((text): PaperResult => ({ text, stat: null, rows: [] }))])).max(PAPER.maxResults),
}).strict()

/** Shape only. Limits and the exact-quote rules are checked by validateCard, whose messages name them. */
export const cardContentSchema = z.object({
  quote: z.string(), quoteEdited: z.boolean(), emphasis: z.string(), headline: z.string(), pull: z.string(),
  topic: z.string(), takeawaysTitle: z.string(), takeaways: z.array(cardTakeawaySchema),
  style: z.enum(STYLES), look: z.enum(LOOKS), crop: pageRectSchema.nullable(),
  set: setContentSchema.nullable().default(null),
  takeaway: z.string().default(''),
  paper: paperContentSchema.nullable().default(null),
  stat: statSchema.nullable().default(null),
}).strict()

export const pageMarkSchema = z.object({ rects: z.array(pageRectSchema).max(500), color: z.enum(HIGHLIGHT_COLORS) }).strict()

const draft = z.string().max(16_000)
export const captionSchema = z.object({
  destination: z.enum(DESTINATIONS),
  take: z.string().max(TAKE_MAX),
  drafts: z.object({ finding: draft, contrast: draft, caveat: draft }).strict(),
  angle: z.enum(ANGLES),
  hashtags: z.array(z.string().max(31)).max(5),
  showTags: z.boolean(),
  link: z.enum(LINKS),
  edited: z.string().max(16_000).nullable(),
}).strict()

/** The version behind Undo: the card and caption as they were before the last change. */
export const previousVersionSchema = z.object({ card: cardContentSchema, caption: captionSchema }).strict()

// The schemas and the contract's hand-written types must describe the same shapes.
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
const same = <T extends true>(value: T) => value
same<Same<z.infer<typeof pageRectSchema>, PageRect>>(true)
same<Same<z.infer<typeof shareCardSourceSchema>, ShareCardSource>>(true)
same<Same<z.infer<typeof cardContentSchema>, CardContent>>(true)
same<Same<z.infer<typeof captionSchema>, Caption>>(true)
same<Same<z.infer<typeof pageMarkSchema>, PageMark>>(true)
same<Same<z.infer<typeof setItemSchema>, SetItem>>(true)
same<Same<z.infer<typeof setContentSchema>, SetContent>>(true)
same<Same<z.infer<typeof paperContentSchema>, PaperContent>>(true)
same<Same<z.infer<typeof statSchema>, Stat>>(true)
same<Same<z.infer<typeof rowSchema>, Row>>(true)
same<Same<z.infer<typeof paperResultSchema>, PaperResult>>(true)
