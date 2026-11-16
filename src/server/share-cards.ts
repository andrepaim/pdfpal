import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ANGLES, LINKS, LOOKS, SET, STYLES } from '../shared/share-card.js'
import { pageRectSchema } from '../shared/share-card-schema.js'
import { ShareCardService, changeShareCardInput, startShareCardInput } from '../core/share-cards.js'

type Params = { projectId: string; id: string }
const empty = z.object({}).strict()
/** Exactly one kind of edit per request. */
const patch = z.union([
  z.object({ style: z.enum(STYLES), look: z.enum(LOOKS) }).strict(),
  z.object({ crop: pageRectSchema.nullable(), slide: z.number().int().min(0).max(SET.maxItems - 1).optional() }).strict(),
  z.object({ set_text: z.object({ field: z.enum(['study', 'takeaway', 'limitations', 'point']), index: z.number().int().min(0).max(SET.maxItems - 1).optional(), text: z.string().max(1_000) }).strict() }).strict(),
  z.object({ angle: z.enum(ANGLES) }).strict(),
  z.object({ show_tags: z.boolean() }).strict(),
  z.object({ link: z.enum(LINKS) }).strict(),
  z.object({ headline: z.string().max(1_000) }).strict(),
  z.object({ caption: z.string().max(16_000) }).strict(),
  z.object({ quote: z.string().max(1_000) }).strict(),
  z.object({ credit: z.string().max(1_000) }).strict(),
])

export function registerShareCardRoutes(app: FastifyInstance, cards: ShareCardService) {
  const options = { bodyLimit: 40_000 }
  const base = '/api/projects/:projectId/share-cards'
  app.post<{ Params: Pick<Params, 'projectId'> }>(base, options, async (request, reply) => {
    const { record, created } = cards.start(request.params.projectId, startShareCardInput.parse(request.body))
    return reply.status(created ? 202 : 200).send(record)
  })
  app.get<{ Params: Pick<Params, 'projectId'>; Querystring: { source_id?: string } }>(base, async request =>
    cards.list(request.params.projectId, typeof request.query.source_id === 'string' && request.query.source_id ? request.query.source_id : undefined))
  app.get<{ Params: Params }>(`${base}/:id`, async request => cards.get(request.params.projectId, request.params.id))
  app.post<{ Params: Params }>(`${base}/:id/change`, options, async (request, reply) =>
    reply.status(202).send(cards.change(request.params.projectId, request.params.id, changeShareCardInput.parse(request.body))))
  app.post<{ Params: Params }>(`${base}/:id/retry`, options, async (request, reply) => {
    empty.parse(request.body ?? {})
    return reply.status(202).send(cards.retry(request.params.projectId, request.params.id))
  })
  app.post<{ Params: Params }>(`${base}/:id/cancel`, options, async request => { empty.parse(request.body ?? {}); return cards.cancel(request.params.projectId, request.params.id) })
  app.post<{ Params: Params }>(`${base}/:id/undo`, options, async request => { empty.parse(request.body ?? {}); return cards.undo(request.params.projectId, request.params.id) })
  app.patch<{ Params: Params }>(`${base}/:id`, options, async request => {
    const body = patch.parse(request.body), { projectId, id } = request.params
    if ('style' in body) return cards.restyle(projectId, id, body.style, body.look)
    if ('crop' in body) return cards.crop(projectId, id, body.crop, body.slide)
    if ('set_text' in body) return cards.editSetText(projectId, id, body.set_text.field, body.set_text.text, body.set_text.index)
    if ('angle' in body) return cards.angle(projectId, id, body.angle)
    if ('show_tags' in body) return cards.showTags(projectId, id, body.show_tags)
    if ('link' in body) return cards.link(projectId, id, body.link)
    if ('headline' in body) return cards.editHeadline(projectId, id, body.headline)
    if ('caption' in body) return cards.editCaption(projectId, id, body.caption)
    if ('quote' in body) return cards.editQuote(projectId, id, body.quote)
    return cards.editCredit(projectId, id, body.credit)
  })
  app.delete<{ Params: Params }>(`${base}/:id`, async (request, reply) => { cards.delete(request.params.projectId, request.params.id); return reply.status(204).send() })
}
