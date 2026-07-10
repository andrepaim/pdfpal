import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import staticPlugin from '@fastify/static'
import open from 'open'
import { randomUUID } from 'node:crypto'
import type { PdfpalConfig } from '../core/config.js'
import { openDatabase } from '../core/database.js'
import { ProjectService } from '../core/projects.js'
import { SourceService } from '../core/sources.js'
import { CollectionService } from '../core/collections.js'
import { RetrievalService } from '../core/retrieval.js'
import { listHighlights } from '../core/highlights.js'
import { ChatService } from '../core/chat.js'
import { AgentService, type AgentName } from '../core/agents.js'
import { resolvePdf } from '../core/pdf.js'
import { relatedPapers } from '../core/research.js'
import { PdfpalError } from '../core/types.js'

type Params = { projectId: string; sourceId: string; id: string }
const now = () => new Date().toISOString()

export async function buildServer(config: PdfpalConfig) {
  const app = Fastify({ logger: true, bodyLimit: 30 * 1024 * 1024 })
  const db = openDatabase(config)
  const projects = new ProjectService(db)
  const sources = new SourceService(db, config)
  const collections = new CollectionService(db)
  const chat = new ChatService(db, config)
  await app.register(cors, { origin: false })
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } })

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : String(error)
    const known = error instanceof PdfpalError ? error : new PdfpalError('INTERNAL_ERROR', message)
    const status = known.code === 'PDF_FETCH_TIMEOUT' ? 504 : known.exitCode === 3 ? 404 : known.exitCode === 2 || known.exitCode === 4 ? 400 : 500
    reply.status(status).send({ detail: known.message, code: known.code, details: known.details })
  })

  app.get('/api/health', async () => ({ status: 'ok' }))
  app.get('/api/auth/me', async () => ({ email: 'local@localhost', name: 'Local User', picture: '' }))
  app.post('/api/auth/logout', async () => ({ ok: true }))
  app.get('/api/agents', async () => ({ default: config.agent, agents: new AgentService(config).list() }))

  app.get('/api/projects', async () => projects.list())
  app.post<{ Body: { title: string; description?: string } }>('/api/projects', async request => projects.create(request.body.title, request.body.description))
  app.get<{ Params: Pick<Params, 'projectId'> }>('/api/projects/:projectId', async request => projects.resolve(request.params.projectId))
  app.patch<{ Params: Pick<Params, 'projectId'>; Body: { title?: string; description?: string } }>('/api/projects/:projectId', async request => {
    const project = projects.resolve(request.params.projectId)
    if (request.body.title !== undefined) projects.rename(project.id, request.body.title)
    if (request.body.description !== undefined) db.prepare('UPDATE projects SET description=?,accessed_at=? WHERE id=?').run(request.body.description, now(), project.id)
    return { ok: true }
  })
  app.delete<{ Params: Pick<Params, 'projectId'> }>('/api/projects/:projectId', async request => { projects.delete(request.params.projectId); return { ok: true } })

  app.get<{ Params: Pick<Params, 'projectId'> }>('/api/projects/:projectId/sources', async request => sources.list(request.params.projectId).map(({ pdf_text: _, ...source }) => source))
  app.get<{ Params: Pick<Params, 'projectId' | 'sourceId'> }>('/api/projects/:projectId/sources/:sourceId', async request => sources.resolve(request.params.projectId, request.params.sourceId))
  app.patch<{ Params: Pick<Params, 'projectId' | 'sourceId'>; Body: { title?: string; collection_id?: string | null } }>('/api/projects/:projectId/sources/:sourceId', async request => {
    if (request.body.title !== undefined) sources.rename(request.params.projectId, request.params.sourceId, request.body.title)
    if ('collection_id' in request.body) sources.setCollection(request.params.projectId, request.params.sourceId, request.body.collection_id ?? null)
    return { ok: true }
  })
  app.delete<{ Params: Pick<Params, 'projectId' | 'sourceId'> }>('/api/projects/:projectId/sources/:sourceId', async request => { sources.remove(request.params.projectId, request.params.sourceId); return { ok: true } })
  app.post<{ Params: Pick<Params, 'projectId'>; Body: { url: string; title?: string; collection_id?: string } }>('/api/projects/:projectId/sources', async request => sources.add(request.params.projectId, request.body.url, request.body.title, request.body.collection_id))
  app.post<{ Body: { url: string; project_id: string; source_id?: string; collection_id?: string } }>('/api/extract', async request => {
    if (request.body.source_id) {
      await sources.reindex(request.body.project_id, request.body.source_id, true)
      return sources.resolve(request.body.project_id, request.body.source_id)
    }
    return sources.add(request.body.project_id, request.body.url, undefined, request.body.collection_id)
  })
  app.get<{ Params: Pick<Params, 'projectId' | 'sourceId'> }>('/api/projects/:projectId/sources/:sourceId/file', async (request, reply) => {
    const source = sources.resolve(request.params.projectId, request.params.sourceId)
    const local = sources.pdfPath(source)
    if (local) return reply.type('application/pdf').send(fs.createReadStream(local))
    // URL-only sources from pre-TypeScript databases remain readable. New
    // sources always have a managed copy, so this is a compatibility path.
    if (source.url) {
      const resolved = await resolvePdf(source.url)
      return reply.type('application/pdf').send(resolved.bytes)
    }
    throw new PdfpalError('PDF_NOT_STORED', 'PDF file is not stored locally', 3)
  })
  app.get<{ Querystring: { url: string } }>('/api/proxy-pdf', async (request, reply) => {
    const result = await resolvePdf(request.query.url)
    return reply.type('application/pdf').send(result.bytes)
  })

  app.post<{ Body: { message: string; project_id: string; source_id?: string; active_source_ids?: string[]; collection_id?: string; search_web?: boolean; agent?: AgentName; model?: string } }>('/api/chat', async (request, reply) => {
    const selectors = request.body.source_id ? [request.body.source_id] : request.body.active_source_ids
    const result = await chat.ask(request.body.project_id, request.body.message, { sourceSelectors: selectors, collectionSelector: request.body.collection_id, searchWeb: request.body.search_web, agent: request.body.agent, model: request.body.model })
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    reply.raw.write(`data: ${JSON.stringify({ text: result.answer, sources: result.sources })}\n\n`)
    reply.raw.end('data: [DONE]\n\n')
  })
  app.get<{ Params: Pick<Params, 'projectId' | 'sourceId'> }>('/api/projects/:projectId/sources/:sourceId/chat', async request => ({ messages: chat.history(request.params.projectId, request.params.sourceId).map(parseSources) }))
  app.get<{ Params: Pick<Params, 'projectId'> }>('/api/projects/:projectId/chat', async request => ({ messages: chat.history(request.params.projectId).map(parseSources) }))
  app.delete<{ Params: Pick<Params, 'projectId' | 'sourceId'> }>('/api/projects/:projectId/sources/:sourceId/chat', async request => clearChat(db, request.params.projectId, request.params.sourceId))
  app.delete<{ Params: Pick<Params, 'projectId'> }>('/api/projects/:projectId/chat', async request => clearChat(db, request.params.projectId, null))
  app.get<{ Params: Pick<Params, 'projectId'> }>('/api/projects/:projectId/chats', async request => db.prepare(`SELECT cs.id,cs.source_id,cs.title,cs.created_at,cs.accessed_at,s.title source_title,
    (SELECT COUNT(*) FROM chat_messages WHERE session_id=cs.id) message_count,
    (SELECT content FROM chat_messages WHERE session_id=cs.id AND role='user' ORDER BY id LIMIT 1) first_message
    FROM chat_sessions cs LEFT JOIN sources s ON s.id=cs.source_id WHERE cs.project_id=? ORDER BY cs.accessed_at DESC`).all(request.params.projectId))

  const retrieval = new RetrievalService(db)
  app.get<{ Params: Pick<Params, 'projectId'>; Querystring: { q?: string; limit?: string } }>('/api/projects/:projectId/search', async request => {
    const project = projects.resolve(request.params.projectId)
    const q = String(request.query.q ?? '').trim()
    if (q.length < 2) return { results: [] }
    return { results: retrieval.search(project.id, q, [], Math.min(Number(request.query.limit ?? 20), 50)) }
  })
  app.get<{ Params: Pick<Params, 'projectId'> }>('/api/projects/:projectId/highlights', async request => listHighlights(db, projects.resolve(request.params.projectId).id))

  registerCollectionRoutes(app, collections)
  registerDocumentRoutes(app, db)
  registerAnnotationRoutes(app, db)
  registerResearchRoutes(app, db)

  const frontend = [path.resolve('frontend/dist'), path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../frontend/dist')].find(candidate => fs.existsSync(path.join(candidate, 'index.html')))
  if (frontend) {
    await app.register(staticPlugin, { root: frontend, wildcard: false })
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.status(404).send({ detail: 'Not Found' }) : reply.sendFile('index.html'))
  }
  app.addHook('onClose', async () => db.close())
  return app
}

function parseSources(row: { sources_used: string } & Record<string, unknown>) {
  try { return { ...row, sources_used: JSON.parse(row.sources_used || '[]') } } catch { return { ...row, sources_used: [] } }
}

function clearChat(db: import('better-sqlite3').Database, projectId: string, sourceId: string | null) {
  const row = sourceId === null
    ? db.prepare('SELECT id FROM chat_sessions WHERE project_id=? AND source_id IS NULL').get(projectId)
    : db.prepare('SELECT id FROM chat_sessions WHERE project_id=? AND source_id=?').get(projectId, sourceId)
  if (row) db.prepare('DELETE FROM chat_sessions WHERE id=?').run((row as { id: string }).id)
  return { ok: true }
}

function registerCollectionRoutes(app: any, collections: CollectionService) {
  app.get('/api/projects/:projectId/collections', async (request: any) => collections.list(request.params.projectId))
  app.post('/api/projects/:projectId/collections', async (request: any) => collections.create(request.params.projectId, request.body.name ?? 'New Collection', request.body.parent_id ?? undefined))
  app.patch('/api/projects/:projectId/collections/:id', async (request: any) => {
    const { projectId, id } = request.params, body = request.body
    if (body.name !== undefined) collections.rename(projectId, id, body.name)
    if ('parent_id' in body) collections.move(projectId, id, body.parent_id ?? null)
    if (body.position !== undefined) collections.reorder(projectId, id, body.position)
    return { ok: true }
  })
  app.delete('/api/projects/:projectId/collections/:id', async (request: any) => { collections.delete(request.params.projectId, request.params.id); return { ok: true } })
}

function registerDocumentRoutes(app: Awaited<ReturnType<typeof import('fastify')['default']>>, db: import('better-sqlite3').Database) {
  for (const kind of ['notes', 'artifacts'] as const) {
    const table = kind
    app.get(`/api/projects/:projectId/${kind}`, async (request: any) => db.prepare(`SELECT id,project_id,${kind === 'notes' ? 'source_id,' : ''}title,substr(content,1,200) preview,created_at,updated_at FROM ${table} WHERE project_id=? ORDER BY updated_at DESC`).all(request.params.projectId))
    app.post(`/api/projects/:projectId/${kind}`, async (request: any) => {
      const id = randomUUID(), timestamp = now(), body = request.body
      if (kind === 'notes') db.prepare('INSERT INTO notes(id,project_id,source_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, request.params.projectId, body.source_id ?? null, body.title ?? 'Untitled Note', body.content ?? '', timestamp, timestamp)
      else db.prepare('INSERT INTO artifacts(id,project_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, request.params.projectId, body.title ?? 'Untitled Artifact', body.content ?? '', timestamp, timestamp)
      return { id }
    })
    app.get(`/api/projects/:projectId/${kind}/:id`, async (request: any) => db.prepare(`SELECT * FROM ${table} WHERE id=? AND project_id=?`).get(request.params.id, request.params.projectId) ?? Promise.reject(new PdfpalError('NOT_FOUND', 'Document not found', 3)))
    app.put(`/api/projects/:projectId/${kind}/:id`, async (request: any) => {
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id=? AND project_id=?`).get(request.params.id, request.params.projectId) as any
      if (!existing) throw new PdfpalError('NOT_FOUND', 'Document not found', 3)
      db.prepare(`UPDATE ${table} SET title=?,content=?,updated_at=? WHERE id=?`).run(request.body.title ?? existing.title, request.body.content ?? existing.content, now(), existing.id)
      return { ok: true }
    })
    app.delete(`/api/projects/:projectId/${kind}/:id`, async (request: any) => { db.prepare(`DELETE FROM ${table} WHERE id=? AND project_id=?`).run(request.params.id, request.params.projectId); return { ok: true } })
  }
  app.get('/api/projects/:projectId/sources/:sourceId/notes', async (request: any) => db.prepare('SELECT id,project_id,source_id,title,substr(content,1,200) preview,created_at,updated_at FROM notes WHERE project_id=? AND source_id=? ORDER BY updated_at DESC').all(request.params.projectId, request.params.sourceId))
}

function registerAnnotationRoutes(app: any, db: import('better-sqlite3').Database) {
  app.get('/api/projects/:projectId/sources/:sourceId/annotations', async (request: any) => db.prepare('SELECT * FROM annotations WHERE project_id=? AND source_id=? ORDER BY page_number,y1').all(request.params.projectId, request.params.sourceId))
  app.post('/api/projects/:projectId/sources/:sourceId/annotations', async (request: any) => {
    const id = randomUUID(), body = request.body
    db.prepare('INSERT INTO annotations(id,source_id,project_id,page_number,x1,y1,x2,y2,text,color,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, request.params.sourceId, request.params.projectId, body.page_number, body.x1, body.y1, body.x2, body.y2, body.text, body.color ?? 'yellow', now())
    return db.prepare('SELECT * FROM annotations WHERE id=?').get(id)
  })
  app.patch('/api/projects/:projectId/sources/:sourceId/annotations/:id', async (request: any) => { db.prepare('UPDATE annotations SET color=? WHERE id=? AND source_id=? AND project_id=?').run(request.body.color, request.params.id, request.params.sourceId, request.params.projectId); return db.prepare('SELECT * FROM annotations WHERE id=?').get(request.params.id) })
  app.delete('/api/projects/:projectId/sources/:sourceId/annotations/:id', async (request: any, reply: any) => { db.prepare('DELETE FROM annotations WHERE id=? AND source_id=? AND project_id=?').run(request.params.id, request.params.sourceId, request.params.projectId); reply.status(204).send() })
}

function registerResearchRoutes(app: any, db: import('better-sqlite3').Database) {
  app.get('/api/search/papers', async (request: any) => {
    const q = String(request.query.q ?? '').trim(); if (q.length < 3) throw new PdfpalError('QUERY_TOO_SHORT', 'Query too short', 2)
    const response = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${Math.min(Number(request.query.limit ?? 20), 30)}`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return { results: [], error: `OpenAlex HTTP ${response.status}` }
    const data = await response.json() as any
    return { results: (data.results ?? []).map((work: any) => {
      const arxivLocation = (work.locations ?? []).find((location: any) => {
        const value = `${location.landing_page_url ?? ''} ${location.pdf_url ?? ''}`
        return /arxiv\.org\/(?:abs|pdf)\//i.test(value)
      })
      const arxivUrl = arxivLocation?.landing_page_url || arxivLocation?.pdf_url
      return { title: work.title, authors: (work.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).join(', '), year: work.publication_year, venue: work.primary_location?.source?.display_name, citation_count: work.cited_by_count, arxiv_url: arxivUrl, pdf_url: work.best_oa_location?.pdf_url }
    }) }
  })
  app.get('/api/projects/:projectId/sources/:sourceId/related', async (request: any) => relatedPapers(db, request.params.projectId, request.params.sourceId, request.query.refresh === 'true'))
}

export async function startServer(config: PdfpalConfig, options: { openBrowser: boolean }): Promise<void> {
  const app = await buildServer(config)
  await app.listen({ host: config.host, port: config.port })
  const url = `http://localhost:${config.port}`
  process.stdout.write(`pdfpal: running at ${url}\n`)
  if (options.openBrowser) await open(url).catch(() => process.stderr.write(`pdfpal: open ${url} in your browser\n`))
}
