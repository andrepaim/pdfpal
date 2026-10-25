import type { FastifyInstance } from 'fastify'
import { VisualExplanationService, webVisualInput } from '../core/visual-explanations.js'
import { z } from 'zod'

export function registerVisualRoutes(app: FastifyInstance, visuals: VisualExplanationService) {
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/visuals', { bodyLimit: 120_000 }, async (request, reply) => {
    const input = webVisualInput.parse(request.body)
    return reply.status(202).send(visuals.startWeb(request.params.projectId, input))
  })
  app.get<{ Params: { projectId: string; id: string } }>('/api/projects/:projectId/visuals/:id', async request => visuals.get(request.params.projectId, request.params.id))
  app.post<{ Params: { projectId: string; id: string } }>('/api/projects/:projectId/visuals/:id/save', async request => visuals.save(request.params.projectId, request.params.id))
  app.post<{ Params: { projectId: string; id: string } }>('/api/projects/:projectId/visuals/:id/retry', async request => {
    const body = z.object({ request_id: z.string().uuid() }).strict().parse(request.body)
    return visuals.retryWeb(request.params.projectId, request.params.id, body.request_id)
  })
}
