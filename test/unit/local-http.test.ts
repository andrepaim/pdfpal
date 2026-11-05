import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { localJson } from '../../src/cli/local-http.js'

test('local command requests close their sockets, preserve UTF-8 and never follow redirects', async () => {
  const sockets = new Set(), bodies: string[] = []
  const server = http.createServer(async (request, response) => {
    sockets.add(request.socket)
    assert.equal(request.headers.connection, 'close')
    let body = ''; for await (const chunk of request) body += chunk.toString('utf8')
    bodies.push(body)
    response.writeHead(request.url === '/redirect' ? 302 : 200, { 'content-type': 'application/json', ...(request.url === '/redirect' ? { location: 'https://example.com/' } : {}) })
    response.end(JSON.stringify({ title: 'ação 🧪' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + (server.address() as {port:number}).port
  try {
    assert.equal((await localJson(origin, {}, { content: 'Olá 🧪' })).value.title, 'ação 🧪')
    const redirected = await localJson(origin + '/redirect', {})
    assert.equal(redirected.status, 302); assert.equal(redirected.ok, false)
    assert.equal(JSON.parse(bodies[0]!).content, 'Olá 🧪')
    assert.equal(sockets.size, 2)
    assert.throws(() => localJson('https://example.com/', {}), /Invalid loopback/)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('loopback deadlines abort hung reads without leaving an open socket', async () => {
  const server = http.createServer(() => {})
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await assert.rejects(localJson('http://127.0.0.1:' + (server.address() as {port:number}).port, {}, undefined, 30), { code: 'ETIMEDOUT' })
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
