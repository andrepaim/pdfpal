import type { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import { ExtensionAuth, ExtensionError } from '../core/extension-auth.js'
import { localWeb, rateLimit } from './extension-security.js'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const packageRoot = fileURLToPath(new URL('../../extension/package/', import.meta.url))
export async function extensionPackage(directory = packageRoot) {
  try {
    const archive = path.join(directory, 'companion.zip')
    const metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8')) as { version: string; filename: string; size: number; sha256: string; extension_id: string }
    if ((await stat(archive)).size !== metadata.size) throw new Error('Archive is incomplete')
    return { archive, metadata }
  } catch { throw new ExtensionError(503, 'Extension package is missing. Update pdfpal, or run npm run build in your source checkout.', 'PACKAGE_MISSING') }
}

export async function registerExtensionManagement(app: FastifyInstance, db: Database) {
  const auth = new ExtensionAuth(db)
  await app.register(async web => {
    const limit = rateLimit(1200), mutations = rateLimit(60)
    web.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      localWeb(request); limit()
      if (!['GET', 'HEAD'].includes(request.method)) mutations()
    })
    web.get<{ Params: { id: string } }>('/requests/:id', async request => auth.inspect(z.string().uuid().parse(request.params.id), localWeb(request)))
    web.post<{ Params: { id: string } }>('/requests/:id/decision', { bodyLimit: 4000 }, async request => {
      const body = z.object({ allow: z.boolean() }).strict().parse(request.body)
      return auth.decide(z.string().uuid().parse(request.params.id), localWeb(request), body.allow)
    })
    web.get('/connections', async () => auth.list())
    web.get('/package', async () => (await extensionPackage()).metadata)
    web.get('/download', async (_request, reply) => {
      const { metadata, archive } = await extensionPackage()
      return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${metadata.filename}"`)
        .header('Content-Length', metadata.size).send(createReadStream(archive))
    })
    web.patch<{ Params: { id: string } }>('/connections/:id', { bodyLimit: 4000 }, async request => {
      const body = z.object({ label: z.string().trim().max(80) }).strict().parse(request.body)
      auth.rename(z.string().uuid().parse(request.params.id), body.label)
      return { ok: true }
    })
    web.delete<{ Params: { id: string } }>('/connections/:id', async request => {
      auth.revoke(z.string().uuid().parse(request.params.id)); return { ok: true }
    })
  }, { prefix: '/api/extensions' })
}
