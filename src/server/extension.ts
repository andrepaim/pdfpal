import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Database } from 'better-sqlite3'
import { z, ZodError } from 'zod'
import type { PdfpalConfig } from '../core/config.js'
import { ExtensionAuth, ExtensionError } from '../core/extension-auth.js'
import { KindleService, kindleCapture, kindleMetadata } from '../core/kindle.js'
import { ProjectService } from '../core/projects.js'
import { PdfpalError } from '../core/types.js'
import { VisualExplanationService, VisualError } from '../core/visual-explanations.js'

const projectId = z.string().min(1).max(200)
const requestId = z.string().uuid()
const askSchema = z.object({ request_id: requestId, project_id: projectId, capture: kindleCapture,
  question: z.string().trim().min(1).max(8000), include_project: z.boolean().default(false), response_mode: z.enum(['text', 'visual']).default('text') }).strict()
  .refine(input => input.capture.scope === 'book' ? !input.capture.text : !!input.capture.text, 'Attach a selection or choose book chat.')
const saveSchema = z.object({ request_id: requestId, project_id: projectId, capture: kindleCapture, turn_id: z.string().uuid().optional() }).strict()
  .refine(input => !!input.capture.text || !!input.turn_id, 'Choose a passage or completed answer to save.')

export async function registerExtensionRoutes(app: FastifyInstance, db: Database, config: PdfpalConfig, visuals: VisualExplanationService) {
  const auth = new ExtensionAuth(db), kindle = new KindleService(db, config, visuals), projects = new ProjectService(db)
  await app.register(async bridge => {
    const clients = new WeakMap<FastifyRequest, string>()
    const client = (request: FastifyRequest) => clients.get(request)!
    let pairingWindow = 0, pairingAttempts = 0
    bridge.setErrorHandler((error, _request, reply) => {
      const status = error instanceof ExtensionError || error instanceof VisualError ? error.status : error instanceof ZodError ? 400
        : error instanceof PdfpalError ? (error.exitCode === 3 ? 404 : 400) : (error as { statusCode?: number }).statusCode || 500
      const detail = error instanceof ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
        : error instanceof Error ? error.message : 'Request failed.'
      reply.status(status).send({ detail })
    })
    bridge.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) ||
        !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(request.headers.host || '')) {
        throw new ExtensionError(403, 'The extension bridge accepts local connections only.')
      }
      const origin = request.headers.origin
      if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw new ExtensionError(403, 'Use the paired browser extension.')
      if (request.url.split('?')[0] === '/api/extension/pair') {
        if (Date.now() - pairingWindow > 60_000) { pairingWindow = Date.now(); pairingAttempts = 0 }
        if (++pairingAttempts > 10) throw new ExtensionError(429, 'Too many pairing attempts. Wait a minute and try again.')
        return
      }
      const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
      if (!token) throw new ExtensionError(401, 'Connect the extension to pdfpal first.')
      clients.set(request, auth.authenticate(token, origin).id)
    })
    bridge.post('/pair', { bodyLimit: 4000 }, async request => {
      const body = z.object({ code: z.string().trim().regex(/^[a-f0-9]{32}$/), origin: z.string() }).strict().parse(request.body)
      if (request.headers.origin && request.headers.origin !== body.origin) throw new ExtensionError(403, 'Extension origin does not match.')
      return auth.exchange(body.code, body.origin)
    })
    bridge.get('/status', async request => ({ client_id: client(request), agent: config.agent }))
    bridge.delete('/connection', async request => { auth.revoke(client(request)); return { ok: true } })
    bridge.get('/projects', async () => projects.list())
    bridge.post('/projects', { bodyLimit: 4000 }, async request => {
      const body = z.object({ title: z.string().trim().min(1).max(1000) }).strict().parse(request.body)
      return projects.create(body.title)
    })
    bridge.post('/history', { bodyLimit: 10_000 }, async request => {
      const body = z.object({ project_id: projectId, metadata: kindleMetadata }).strict().parse(request.body)
      return kindle.history(client(request), body.project_id, body.metadata)
    })
    bridge.post('/history/clear', { bodyLimit: 10_000 }, async request => {
      const body = z.object({ project_id: projectId, metadata: kindleMetadata }).strict().parse(request.body)
      return kindle.clear(client(request), body.project_id, body.metadata)
    })
    bridge.post('/turns', { bodyLimit: 200_000 }, async (request, reply) => {
      const turn = kindle.ask(client(request), askSchema.parse(request.body))
      return reply.status(202).send(turn)
    })
    bridge.get<{ Params: { id: string } }>('/turns/:id', async request => kindle.getTurn(client(request), request.params.id))
    bridge.get<{ Params: { projectId: string; id: string } }>('/projects/:projectId/visuals/:id', async request => visuals.get(request.params.projectId, request.params.id, client(request)))
    bridge.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/visuals/:id/save', async request => visuals.save(request.params.projectId, request.params.id, client(request)))
    bridge.post('/notes', { bodyLimit: 200_000 }, async request => kindle.saveNote(client(request), saveSchema.parse(request.body)))
  }, { prefix: '/api/extension' })
  return kindle
}
