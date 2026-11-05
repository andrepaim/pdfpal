import http from 'node:http'
import type { Socket } from 'node:net'
import type { FastifyInstance } from 'fastify'

/** The Windows command channel shares handlers, but exposes only the CLI routes. */
export function createCliPipe(app: FastifyInstance, filename: string, sockets: WeakSet<Socket>) {
  const server = http.createServer((request, response) => {
    const route = request.url?.split('?')[0] ?? ''
    if (route !== '/api/runtime/identity' && !route.startsWith('/api/cli/v1/')) {
      response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"code":"NOT_FOUND"}'); return
    }
    app.routing(request, response)
  })
  server.on('connection', socket => sockets.add(socket))
  server.on('clientError', (_error, socket) => socket.destroy())
  server.on('error', () => { app.log.error({ code: 'CLI_PIPE_FAILED' }, 'The private command channel could not accept a connection.') })
  server.headersTimeout = 15000
  server.requestTimeout = 120000
  server.keepAliveTimeout = 1000
  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error)
        server.once('error', failed)
        server.listen({ path: filename, readableAll: false, writableAll: false }, () => { server.removeListener('error', failed); resolve() })
      })
    },
    async close() {
      if (!server.listening) return
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      server.closeIdleConnections()
      await closed
    },
  }
}
