// Zod schemas for the share-card shapes in ./share-card.ts. Server-side only: the reader imports the
// contract module, never this one, so zod stays out of its bundle (test/unit/visual-bundle.test.ts).
import { z } from 'zod'
import { CARD, HIGHLIGHT_COLORS, LOOKS, STYLES, type Caption, type CardContent, type PageRect, type ShareCardSource } from './share-card.js'

const fraction = z.number().finite().min(0).max(1)
export const pageRectSchema = z.object({ x1: fraction, y1: fraction, x2: fraction, y2: fraction }).strict()

export const shareCardSourceSchema = z.object({
  version: z.literal(1),
  passage: z.string().min(CARD.passageMin).max(CARD.passageMax),
  page: z.number().int().positive(),
  rects: z.array(pageRectSchema).max(500),
  color: z.enum(HIGHLIGHT_COLORS),
  context: z.string().max(CARD.contextMax),
  title: z.string().max(2000),
  credit: z.string().max(CARD.creditMax),
  url: z.string().max(4000),
}).strict()

export const cardTakeawaySchema = z.object({ title: z.string(), detail: z.string() }).strict()

/** Shape only. Limits and the exact-quote rules are checked by validateCard, whose messages name them. */
export const cardContentSchema = z.object({
  quote: z.string(), quoteEdited: z.boolean(), emphasis: z.string(), headline: z.string(), pull: z.string(),
  topic: z.string(), takeawaysTitle: z.string(), takeaways: z.array(cardTakeawaySchema),
  style: z.enum(STYLES), look: z.enum(LOOKS), crop: pageRectSchema.nullable(),
}).strict()

export const captionSchema = z.object({
  body: z.string().max(16_000), hashtags: z.array(z.string().max(31)).max(5), edited: z.string().max(16_000).nullable(),
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
