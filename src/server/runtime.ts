import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import type { PdfpalConfig } from '../core/config.js'
import { acquireServerLease, databasePath } from '../core/locking.js'
import { AgentService } from '../core/agents.js'
import { buildServer } from './app.js'

export async function startRuntime(config: PdfpalConfig, port = config.port) {
  const release = acquireServerLease(config.dbPath)
  let server: Awaited<ReturnType<typeof buildServer>> | undefined
  const canonical = databasePath(config.dbPath)
  const filename = `${canonical}.server.json`
  const secret = randomUUID()
  const identity = { protocol: 1, instance: randomUUID(), library: createHash('sha256').update(canonical).digest('hex') }
  try {
    server = await buildServer(config)
    server.get('/api/runtime/identity', async (request, reply) => {
      if (request.headers['x-pdfpal-owner'] !== secret) return reply.code(403).send({ code: 'FORBIDDEN' })
      return identity
    })
    server.addHook('onClose', async () => {
      try { if (JSON.parse(fs.readFileSync(filename, 'utf8')).instance === identity.instance) fs.unlinkSync(filename) } catch {}
      release()
    })
    const origin = await server.listen({ host: config.host, port })
    const temporary = `${filename}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ ...identity, origin, secret }), { mode: 0o600 })
    fs.renameSync(temporary, filename)
    return { server, origin, identity, async close(onPhase: (phase: string) => void = () => {}) {
      onPhase('closing-http')
      const closing = server!.close()
      await AgentService.cancelAll()
      onPhase('agents-stopped')
      server!.server.closeIdleConnections()
      await closing
      onPhase('database-closed')
    } }
  } catch (error) {
    await server?.close().catch(() => {})
    release()
    throw error
  }
}

/** Validate the private owner record against the live endpoint before offering its URL. */
export async function existingServer(dbPath: string): Promise<string | undefined> {
  try {
    const canonical = databasePath(dbPath)
    const owner = JSON.parse(fs.readFileSync(`${canonical}.server.json`, 'utf8'))
    const url = new URL(owner.origin)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) return
    const response = await fetch(`${url.origin}/api/runtime/identity`, { headers: { 'x-pdfpal-owner': owner.secret }, signal: AbortSignal.timeout(1500) })
    const actual = await response.json() as typeof owner
    if (response.ok && actual.protocol === 1 && actual.instance === owner.instance && actual.library === createHash('sha256').update(canonical).digest('hex')) return url.origin
  } catch {}
}
