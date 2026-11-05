import { timingSafeEqual, createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import type { Socket } from 'node:net'
import { z } from 'zod'
import type { PdfpalConfig } from '../core/config.js'
import { ProjectService } from '../core/projects.js'
import { SourceService } from '../core/sources.js'
import { CollectionService } from '../core/collections.js'
import { NoteService } from '../core/notes.js'
import { RetrievalService, splitPages } from '../core/retrieval.js'
import { listHighlights } from '../core/highlights.js'
import { TrashService } from '../core/trash.js'
import type { BackupService } from '../core/backups.js'
import { CliOperations } from '../core/cli-operations.js'
import { CURRENT_SCHEMA } from '../core/database.js'
import { PdfpalError, type Source } from '../core/types.js'
import { CLI_PROTOCOL, CLI_CAPABILITIES, type RuntimeIdentity } from '../shared/cli-protocol.js'
import { errorReportsFor } from '../core/error-reports.js'

export interface CliRuntime { identity: RuntimeIdentity; credential: string; build: string; privateSocket?: (socket: Socket) => boolean }
const selector = z.string().trim().min(1).max(1000)
const text = z.string().max(1000000)
const paging = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) }
const project = { project: selector }, source = { ...project, source: selector }, note = { ...project, note: selector }, collection = { ...project, collection: selector }
const schemas: Record<string, z.ZodType<any>> = {
  'project.list': z.strictObject(paging), 'project.show': z.strictObject(project),
  'project.create': z.strictObject({ title: selector, description: text.default('') }),
  'project.rename': z.strictObject({ ...project, title: selector }), 'project.delete': z.strictObject({ ...project, yes: z.literal(true) }),
  'source.list': z.strictObject({ ...project, ...paging }), 'source.show': z.strictObject(source),
  'source.text': z.strictObject({ ...source, page: z.number().int().min(1).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20000).default(8000) }),
  'source.add': z.strictObject({ ...project, url: z.url().refine(s => /^https?:\/\//i.test(s)).max(4000).optional(),
    file: z.strictObject({ filename: z.string().min(1).max(250), base64: z.string().max(35 * 1024 * 1024) }).optional(),
    title: selector.optional(), collection: selector.optional(), allowDuplicate: z.boolean().default(false) }).refine(a => Boolean(a.url) !== Boolean(a.file), 'Provide one PDF URL or file.'),
  'source.rename': z.strictObject({ ...source, title: selector }), 'source.move': z.strictObject({ ...source, target: selector }),
  'source.file': z.strictObject({ ...source, collection: selector.nullable() }), 'source.remove': z.strictObject({ ...source, yes: z.literal(true) }),
  'collection.list': z.strictObject({ ...project, ...paging }), 'collection.create': z.strictObject({ ...project, name: selector, parent: selector.optional() }),
  'collection.rename': z.strictObject({ ...collection, name: selector }), 'collection.move': z.strictObject({ ...collection, parent: selector.nullable() }),
  'collection.reorder': z.strictObject({ ...collection, position: z.number().int().nonnegative() }), 'collection.delete': z.strictObject({ ...collection, yes: z.literal(true) }),
  'note.list': z.strictObject({ ...project, ...paging }), 'note.show': z.strictObject(note),
  'note.create': z.strictObject({ ...project, title: selector.optional(), content: text, source: selector.optional() }),
  'note.edit': z.strictObject({ ...note, content: text, expectedUpdatedAt: z.string().datetime().optional() }), 'note.rename': z.strictObject({ ...note, title: selector, expectedUpdatedAt: z.string().datetime().optional() }), 'note.delete': z.strictObject({ ...note, yes: z.literal(true) }),
  search: z.strictObject({ ...project, query: z.string().min(1).max(4000), limit: z.number().int().min(1).max(50).default(16) }),
  highlights: z.strictObject({ ...project, ...paging }), 'trash.list': z.strictObject(paging),
  'trash.restore': z.strictObject({ id: z.string().regex(/^[a-f0-9]{32}$/), asCopy: z.boolean().default(false) }),
  'backup.list': z.strictObject(paging), 'backup.create': z.strictObject({}), 'backup.verify': z.strictObject({ id: z.uuid() }),
}
const reads = new Set(['project.list', 'project.show', 'source.list', 'source.show', 'source.text', 'collection.list', 'note.list', 'note.show', 'search', 'highlights', 'trash.list', 'backup.list', 'backup.verify'])
const asynchronous = new Set(['source.add', 'trash.restore', 'backup.create'])
const compact = ({ pdf_text: _text, ...item }: Source) => item
function page(items: unknown[], args: { offset: number; limit: number }) {
  return { items: items.slice(args.offset, args.offset + args.limit), total: items.length, offset: args.offset,
    nextOffset: args.offset + args.limit < items.length ? args.offset + args.limit : null }
}

export function registerCliRoutes(app: FastifyInstance, db: Database, config: PdfpalConfig, runtime: CliRuntime, backups: BackupService, changed: () => void) {
  const projects = new ProjectService(db), sources = new SourceService(db, config), collections = new CollectionService(db), notes = new NoteService(db, config)
  const trash = new TrashService(db), operations = new CliOperations(db, runtime.identity.library), jobs = new Set<Promise<void>>()
  let closing = false
  const failed = (id: string, error: unknown, started: number) => {
    operations.fail(id, error)
    if (!(error instanceof PdfpalError) || error.exitCode === 1) errorReportsFor(db).record('SERVER_ERROR', Date.now() - started)
  }
  const gate = async (request: any, reply: any) => {
    if (!runtime.privateSocket?.(request.raw.socket) && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)) return reply.code(403).send({ code: 'FORBIDDEN', detail: 'Use the local pdfpal service.' })
    const token = request.headers['x-pdfpal-cli']
    if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(runtime.credential) || !timingSafeEqual(Buffer.from(token), Buffer.from(runtime.credential))) return reply.code(403).send({ code: 'FORBIDDEN', detail: 'The local command credential is invalid.' })
    if (request.headers['x-pdfpal-library'] !== runtime.identity.library || request.headers['x-pdfpal-instance'] !== runtime.identity.instance)
      return reply.code(409).send({ code: 'LIBRARY_MISMATCH', detail: 'The library or app instance changed. Check status before continuing.' })
    if (closing) return reply.code(409).send({ code: 'DESKTOP_CLOSING', detail: 'pdfpal is closing. Check the operation receipt after restarting.' })
  }
  app.get('/api/cli/v1/status', { preHandler: gate }, async () => ({ ...runtime.identity, cliProtocol: CLI_PROTOCOL, build: runtime.build, schema: CURRENT_SCHEMA, capabilities: CLI_CAPABILITIES }))
  app.get<{ Params: { id: string } }>('/api/cli/v1/operations/:id', { preHandler: gate }, async request => operations.get(z.uuid().parse(request.params.id)))

  const syncAction = (action: string, a: any): unknown => {
    switch (action) {
      case 'project.list': return page(projects.list(), a)
      case 'project.show': return projects.resolve(a.project)
      case 'project.create': return projects.create(a.title, a.description)
      case 'project.rename': return projects.rename(a.project, a.title)
      case 'project.delete': return projects.delete(a.project)
      case 'source.list': return page(sources.list(a.project).map(compact), a)
      case 'source.show': return compact(sources.resolve(a.project, a.source))
      case 'source.text': {
        const found = sources.resolve(a.project, a.source), raw = found.pdf_text ?? '', known = /^\[Page \d+\]\s*$/m.test(raw)
        if (a.page && !known) throw new PdfpalError('PAGE_UNAVAILABLE', 'This source has no reliable page markers. Retrieve text without --page.', 2)
        const selected = a.page ? splitPages(raw).find(p => p.page === a.page)?.text : raw
        if (selected === undefined) throw new PdfpalError('PAGE_NOT_FOUND', 'The requested page was not found.', 3)
        return { source_id: found.id, source_title: found.title, page: a.page ?? null, pageMarkers: known, text: selected.slice(a.offset, a.offset + a.limit), offset: a.offset,
          nextOffset: a.offset + a.limit < selected.length ? a.offset + a.limit : null }
      }
      case 'source.rename': return compact(sources.rename(a.project, a.source, a.title))
      case 'source.move': return compact(sources.move(a.project, a.source, a.target))
      case 'source.file': return compact(sources.setCollection(a.project, a.source, a.collection))
      case 'source.remove': return compact(sources.remove(a.project, a.source))
      case 'collection.list': return page(collections.list(a.project), a)
      case 'collection.create': return collections.create(a.project, a.name, a.parent)
      case 'collection.rename': return collections.rename(a.project, a.collection, a.name)
      case 'collection.move': return collections.move(a.project, a.collection, a.parent)
      case 'collection.reorder': return collections.reorder(a.project, a.collection, a.position)
      case 'collection.delete': return collections.delete(a.project, a.collection)
      case 'note.list': return page(notes.list(a.project).map(({ content: _content, ...item }) => item), a)
      case 'note.show': return notes.resolve(a.project, a.note)
      case 'note.create': return notes.create(a.project, { title: a.title, content: a.content, sourceSelector: a.source })
      case 'note.rename': return notes.update(a.project, a.note, { title: a.title, expectedUpdatedAt: a.expectedUpdatedAt })
      case 'note.edit': return notes.update(a.project, a.note, { content: a.content, expectedUpdatedAt: a.expectedUpdatedAt })
      case 'note.delete': return notes.delete(a.project, a.note)
      case 'search': return new RetrievalService(db).search(projects.resolve(a.project).id, a.query, [], a.limit)
      case 'highlights': return page(listHighlights(db, projects.resolve(a.project).id), a)
      case 'trash.list': return page(trash.list(), a)
      default: throw new PdfpalError('UNKNOWN_COMMAND', 'Unsupported local command.', 2)
    }
  }
  const asyncAction = async (action: string, a: any, id: string, resourceId: string) => {
    if (action === 'source.add') {
      const target = projects.resolve(a.project)
      const completed = db.prepare('SELECT * FROM sources WHERE id=? AND project_id=?').get(resourceId, target.id) as Source | undefined
      if (completed) { operations.complete(id, compact(completed)); return }
      const duplicate = !a.allowDuplicate && a.url ? sources.list(target.id).find(s => s.url === a.url || s.original_location === a.url) : undefined
      if (duplicate) { operations.complete(id, { ...compact(duplicate), existing: true }); return }
      let location: string | { filename: string; bytes: Buffer } = a.url
      if (a.file) {
        const bytes = Buffer.from(a.file.base64, 'base64')
        if (bytes.length > 25 * 1024 * 1024 || bytes.toString('base64') !== a.file.base64) throw new PdfpalError('INVALID_FILE', 'Supply a valid PDF of at most 25 MB.', 2)
        location = { filename: a.file.filename, bytes }
      }
      await sources.add(target.id, location, a.title, a.collection, { sourceId: resourceId, deduplicate: !a.allowDuplicate, committed: s => operations.complete(id, { ...compact(s), ...(s.id !== resourceId ? { existing: true } : {}) }) })
    } else if (action === 'trash.restore') {
      await trash.restoreWithFiles(config, a.id, a.asCopy, result => operations.complete(id, result))
    } else if (action === 'backup.create') {
      const previous = (await backups.list()).find(b => b.id === resourceId)
      const result = previous ? (await backups.verify(resourceId)).manifest : await backups.create('manual', resourceId)
      operations.complete(id, result)
    }
  }
  app.post('/api/cli/v1/command', { preHandler: gate, bodyLimit: 36 * 1024 * 1024 }, async request => {
    const body = z.strictObject({ action: z.string().max(100), args: z.record(z.string(), z.unknown()).default({}), operationId: z.uuid().optional(), retry: z.boolean().default(false) }).parse(request.body)
    if (!Object.hasOwn(schemas, body.action)) throw new PdfpalError('UNKNOWN_COMMAND', 'Unsupported local command.', 2)
    const args = schemas[body.action]!.parse(body.args)
    if (reads.has(body.action)) {
      if (body.action === 'backup.list') return page(await backups.list(), args)
      if (body.action === 'backup.verify') return { valid: true, backup: (await backups.verify(args.id)).manifest }
      return syncAction(body.action, args)
    }
    if (!body.operationId) throw new PdfpalError('OPERATION_ID_REQUIRED', 'Mutations require an operation UUID.', 2)
    if (asynchronous.has(body.action) && jobs.size >= 4) throw new PdfpalError('CLI_BUSY', 'Wait for an active import or recovery operation to finish.', 4)
    const id = body.operationId
    // Persist a digest instead of uploading file bytes or keeping request content in receipts.
    const fingerprintArgs = args.file ? { ...args, file: { filename: args.file.filename, sha256: createHash('sha256').update(args.file.base64).digest('hex') } } : args
    const begun = operations.begin(id, body.action, fingerprintArgs, body.retry)
    if (!begun.fresh) return begun.receipt
    const started = Date.now()
    if (asynchronous.has(body.action)) {
      const task = asyncAction(body.action, args, id, begun.resourceId).then(() => { changed() }, error => { failed(id, error, started) })
      jobs.add(task); void task.finally(() => jobs.delete(task))
      return operations.get(id)
    }
    try {
      db.transaction(() => {
        const before = new Set((trash.list() as { id: string }[]).map(t => t.id))
        let result = syncAction(body.action, args)
        if (body.action.endsWith('.delete') || body.action === 'source.remove') {
          const deleted = (trash.list() as { id: string }[]).find(t => !before.has(t.id))
          const packet = deleted ? db.prepare('SELECT payload FROM trash_items WHERE id=?').get(deleted.id) as { payload: string } : undefined
          const counts = packet ? Object.fromEntries(Object.entries(JSON.parse(packet.payload).rows).map(([key, rows]) => [key, (rows as unknown[]).length])) : {}
          result = { item: result, trashId: deleted?.id, counts }
        }
        operations.complete(id, result)
      }).immediate()
      changed()
    } catch (error) { failed(id, error, started) }
    return operations.get(id)
  })
  app.addHook('preClose', async () => { closing = true; await Promise.allSettled(jobs) })
}
