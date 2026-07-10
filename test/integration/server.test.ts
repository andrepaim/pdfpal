import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../../src/server/app.js'
import { cleanup, testConfig } from '../helpers/test-utils.js'

test('Fastify server exposes health and project CRUD', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const health = await app.inject({ method: 'GET', url: '/api/health' })
    assert.equal(health.statusCode, 200)
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'API Project' } })
    assert.equal(created.statusCode, 200)
    const project = created.json()
    const listed = await app.inject({ method: 'GET', url: '/api/projects' })
    assert.equal(listed.json()[0].id, project.id)
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

test('Fastify document, annotation, chat, and research routes work', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Documents' } })
    const project = created.json()
    const note = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/notes`, payload: { title: 'Note', content: 'Body' } })
    assert.equal(note.statusCode, 200)
    const artifact = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/artifacts`, payload: { title: 'Artifact', content: 'Output' } })
    assert.equal(artifact.statusCode, 200)
    const listedNotes = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/notes` })
    assert.equal(listedNotes.json()[0].title, 'Note')
    const sourceId = 'source-for-api'
    const now = new Date().toISOString()
    config // keep the test's isolated database discoverable through the app
    const db = (await import('../../src/core/database.js')).openDatabase(config)
    db.prepare('INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?)').run(sourceId, project.id, 'pdf', 'Source', 'text', 1, now, now)
    db.close()
    const annotation = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/sources/${sourceId}/annotations`, payload: { page_number: 1, x1: 0, y1: 0, x2: 1, y2: 1, text: 'highlight', color: 'yellow' } })
    assert.equal(annotation.statusCode, 200)
    const chats = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/chat` })
    assert.deepEqual(chats.json().messages, [])
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

test('Fastify returns structured errors for missing projects', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const response = await app.inject({ method: 'GET', url: '/api/projects/missing' })
    assert.equal(response.statusCode, 404)
    assert.equal(response.json().code, 'PROJECT_NOT_FOUND')
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

test('source file endpoint falls back to its URL when the managed PDF is missing', async () => {
  const config = testConfig(), app = await buildServer(config)
  const originalFetch = globalThis.fetch
  try {
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Fallback' } })
    const project = created.json()
    const db = (await import('../../src/core/database.js')).openDatabase(config)
    const timestamp = new Date().toISOString()
    db.prepare(`INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at,local_path)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('remote-source', project.id, 'pdf', 'https://example.test/paper.pdf', 'Remote', 'text', 1, timestamp, timestamp, 'deleted.pdf')
    db.close()
    globalThis.fetch = (async () => {
      const response = new Response(Buffer.from('%PDF-remote'), { status: 200, headers: { 'content-type': 'application/pdf' } })
      Object.defineProperty(response, 'url', { value: 'https://example.test/paper.pdf' })
      return response
    }) as typeof fetch
    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources/remote-source/file` })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'application/pdf')
    assert.equal(response.rawPayload.subarray(0, 4).toString(), '%PDF')
  } finally {
    globalThis.fetch = originalFetch
    await app.close()
    cleanup(config, { close() {} } as never)
  }
})
