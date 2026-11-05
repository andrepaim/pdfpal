import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PdfpalConfig } from '../core/config.js'
import { acquireServerLease, databasePath } from '../core/locking.js'
import { AgentService } from '../core/agents.js'
import { buildServer } from './app.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildVersion } from '../shared/build-info.js'
import { cliPipeName } from '../shared/cli-protocol.js'
import { createCliPipe } from './cli-pipe.js'
import type { Socket } from 'node:net'
import { identityProof } from '../shared/cli-auth.js'
import { localJson } from '../cli/local-http.js'

export async function startRuntime(config: PdfpalConfig, port = config.port) {
  const release = acquireServerLease(config.dbPath)
  AgentService.resume()
  let server: Awaited<ReturnType<typeof buildServer>> | undefined
  const canonical = databasePath(config.dbPath)
  const filename = `${canonical}.server.json`
  const secret = randomUUID()
  const cliSecret = randomUUID()
  const identity = { protocol: 1, instance: randomUUID(), library: createHash('sha256').update(canonical).digest('hex') }
  const pipeSockets = new WeakSet<Socket>()
  const cliPipe = process.platform === 'win32' ? cliPipeName(identity.instance) : undefined
  try {
    server = await buildServer(config, { identity, credential: cliSecret, build: buildVersion(), privateSocket: socket => pipeSockets.has(socket) })
    server.get('/api/runtime/identity', async (request, reply) => {
      const challenge = request.headers['x-pdfpal-challenge']
      if (typeof challenge === 'string' && /^[a-f0-9]{64}$/.test(challenge)) return { ...identity, proof: identityProof(secret, challenge, identity) }
      if (request.headers['x-pdfpal-owner'] !== secret) return reply.code(403).send({ code: 'FORBIDDEN' })
      return identity
    })
    const pipe = cliPipe ? createCliPipe(server, cliPipe, pipeSockets) : undefined
    server.addHook('preClose', async () => { await pipe?.close() })
    server.addHook('onClose', async () => {
      try { if (JSON.parse(fs.readFileSync(filename, 'utf8')).instance === identity.instance) fs.unlinkSync(filename) } catch {}
      release()
    })
    const origin = await server.listen({ host: config.host, port })
    await pipe?.listen()
    const temporary = `${filename}.${process.pid}.tmp`
    try {
      fs.writeFileSync(temporary, '', { mode: 0o600, flag: 'wx' })
      if (process.platform === 'win32') {
        const account = process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' + process.env.USERNAME : process.env.USERNAME
        if (!account) throw new Error('Windows account could not be determined for private runtime discovery.')
        await promisify(execFile)(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [temporary, '/inheritance:r', '/grant:r', account + ':(F)'], { windowsHide: true })
      }
      fs.writeFileSync(temporary, JSON.stringify({ ...identity, origin, secret, cliSecret, ...(cliPipe ? { cliPipe } : {}) }), { mode: 0o600 })
      fs.renameSync(temporary, filename)
    } finally { fs.rmSync(temporary, { force: true }) }
    return { server, origin, identity, async close(onPhase: (phase: string) => void = () => {}) {
      onPhase('closing-http')
      AgentService.stopAccepting()
      const closing = server!.close()
      // Fastify begins raw HTTP close asynchronously. Drain connections that
      // become idle after the initial close call without aborting active writes.
      const drain = setInterval(() => server!.server.closeIdleConnections(), 100)
      try {
        await AgentService.cancelAll()
        onPhase('agents-stopped')
        server!.server.closeIdleConnections()
        await closing
        onPhase('database-closed')
      } finally { clearInterval(drain) }
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
    const challenge = randomBytes(32).toString('hex')
    const pipe = process.platform === 'win32' && owner.cliPipe === cliPipeName(owner.instance) ? owner.cliPipe : undefined
    const response = await localJson(`${url.origin}/api/runtime/identity`, { 'x-pdfpal-challenge': challenge }, undefined, 1500, pipe)
    const actual = response.value
    if (response.ok && actual?.protocol === 1 && actual.instance === owner.instance && actual.library === createHash('sha256').update(canonical).digest('hex')
      && typeof actual.proof === 'string' && /^[a-f0-9]{64}$/.test(actual.proof) && typeof owner.secret === 'string'
      && timingSafeEqual(Buffer.from(actual.proof, 'hex'), Buffer.from(identityProof(owner.secret, challenge, actual), 'hex'))) return url.origin
  } catch {}
}
