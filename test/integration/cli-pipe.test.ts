import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import { buildServer } from '../../src/server/app.js'
import { createCliPipe } from '../../src/server/cli-pipe.js'
import { localJson } from '../../src/cli/local-http.js'
import { cliPipeName } from '../../src/shared/cli-protocol.js'
import { testConfig } from '../helpers/test-utils.js'

test('private IPC routes share command validation and receipts without exposing reader/account routes', async () => {
  const config = testConfig(), sockets = new WeakSet<Socket>()
  const identity = { protocol: 1, instance: randomUUID(), library: 'fixture-library' }, token = randomUUID()
  const app = await buildServer(config, { identity, credential: token, build: 'fixture', privateSocket: socket => sockets.has(socket) })
  const filename = process.platform === 'win32' ? cliPipeName(identity.instance) : path.join(config.dataDir, 'cli.sock')
  const pipe = createCliPipe(app, filename, sockets)
  await app.ready(); await pipe.listen()
  const headers = { 'x-pdfpal-cli': token, 'x-pdfpal-library': identity.library, 'x-pdfpal-instance': identity.instance }
  const request = (route: string, body?: unknown, custom = headers) => localJson('http://localhost' + route, custom, body, 2000, filename)
  try {
    assert.equal((await request('/api/cli/v1/status')).status, 200)
    assert.equal((await request('/api/cli/v1/status', undefined, { ...headers, 'x-pdfpal-cli': 'wrong' })).status, 403)
    assert.equal((await request('/api/cli/v1/status', undefined, { ...headers, 'x-pdfpal-library': 'wrong' })).status, 409)
    assert.equal((await request('/api/projects')).status, 404)
    assert.equal((await request('/api/cloud/status')).status, 404)
    const operation = { action: 'project.create', args: { title: 'IPC project' }, operationId: randomUUID() }
    const result = (await request('/api/cli/v1/command', operation)).value
    assert.equal(result.state, 'completed')
    assert.deepEqual((await request('/api/cli/v1/command', operation)).value, result)
    const listed = (await request('/api/cli/v1/command', { action: 'project.list', args: {} })).value
    assert.equal(listed.total, 1); assert.equal(listed.items[0].id, result.result.id)
  } finally { await pipe.close(); await app.close(); fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})
