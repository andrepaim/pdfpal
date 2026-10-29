import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildServer } from '../../src/server/app.js'
import { cleanup, testConfig } from '../helpers/test-utils.js'

async function uploadFile(app: Awaited<ReturnType<typeof buildServer>>, url: string, bytes?: Buffer) {
  const body = new FormData()
  if (bytes) body.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'paper.pdf')
  const request = new Request(`http://localhost${url}`, { method: 'POST', body })
  return app.inject({
    method: 'POST', url,
    headers: { 'content-type': request.headers.get('content-type')! },
    payload: Buffer.from(await request.arrayBuffer()),
  })
}

test('uploaded PDFs are stored, indexed, filed, and served without a remote URL', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Uploads' } })).json()
    const collection = (await app.inject({ method: 'POST', url: `/api/projects/${project.id}/collections`, payload: { name: 'Papers' } })).json()
    const bytes = fs.readFileSync('test/fixtures/sample.pdf')
    const uploaded = await uploadFile(app, `/api/projects/${project.id}/sources/upload?collection_id=${collection.id}`, bytes)
    assert.equal(uploaded.statusCode, 200)
    const source = uploaded.json()
    assert.equal(source.pages, 2)
    assert.equal(source.url, null)
    assert.equal(source.original_location, null)
    assert.equal(source.collection_id, collection.id)
    assert.ok(source.local_path)
    assert.ok(source.pdf_text.length > 0)

    const file = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources/${source.id}/file` })
    assert.equal(file.headers['content-type'], 'application/pdf')
    assert.deepEqual(file.rawPayload, bytes)
    const db = (await import('../../src/core/database.js')).openDatabase(config)
    try {
      assert.equal((db.prepare('SELECT COUNT(*) count FROM source_chunks WHERE source_id=?').get(source.id) as { count: number }).count, 2)
      // Browser uploads have no original filesystem path. Refresh extraction
      // must read the managed copy rather than requiring a URL or temp file.
      const { SourceService } = await import('../../src/core/sources.js')
      assert.equal(await new SourceService(db, config).reindex(project.id, source.id, true), 2)
    } finally { db.close() }
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

test('upload rejects missing, non-PDF, and oversized files without creating sources', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Invalid uploads' } })).json()
    const url = `/api/projects/${project.id}/sources/upload`
    const missing = await uploadFile(app, url)
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().code, 'FILE_REQUIRED')
    const invalid = await uploadFile(app, url, Buffer.from('This is HTML, despite the PDF filename and MIME type.'))
    assert.equal(invalid.statusCode, 400)
    assert.equal(invalid.json().code, 'NOT_A_PDF')
    const oversized = await uploadFile(app, url, Buffer.alloc(25 * 1024 * 1024 + 1))
    assert.equal(oversized.statusCode, 413)
    assert.equal(oversized.json().code, 'FILE_TOO_LARGE')
    const listed = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources` })
    assert.deepEqual(listed.json(), [])
    assert.deepEqual(fs.existsSync(config.filesDir) ? fs.readdirSync(config.filesDir) : [], [])
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

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
    assert.equal(annotation.json().rects, null)
    const chats = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/chat` })
    assert.deepEqual(chats.json().messages, [])

    // A highlight spanning two lines stores one rect per line, not just the
    // x1..y2 union, so the highlight overlay hugs each line's actual selection.
    const multiline = await app.inject({
      method: 'POST', url: `/api/projects/${project.id}/sources/${sourceId}/annotations`,
      payload: { page_number: 1, x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.2, text: 'two lines', color: 'yellow', rects: [{ x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.15 }, { x1: 0.1, y1: 0.15, x2: 0.5, y2: 0.2 }] },
    })
    assert.equal(multiline.statusCode, 200)
    assert.deepEqual(multiline.json().rects, [{ x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.15 }, { x1: 0.1, y1: 0.15, x2: 0.5, y2: 0.2 }])
    const listed = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources/${sourceId}/annotations` })
    assert.deepEqual(listed.json().map((a: { rects: unknown }) => a.rects), [null, [{ x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.15 }, { x1: 0.1, y1: 0.15, x2: 0.5, y2: 0.2 }]])
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

test('Fastify collection routes create, nest, and file sources', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Organized' } })).json()
    const parent = (await app.inject({ method: 'POST', url: `/api/projects/${project.id}/collections`, payload: { name: 'Diffusion' } })).json()
    const child = (await app.inject({ method: 'POST', url: `/api/projects/${project.id}/collections`, payload: { name: 'Samplers', parent_id: parent.id } })).json()
    assert.equal(child.parent_id, parent.id)

    const now = new Date().toISOString()
    const db = (await import('../../src/core/database.js')).openDatabase(config)
    db.prepare('INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?)').run('s1', project.id, 'pdf', 'Paper', '[Page 1]\nbody', 1, now, now)
    db.close()

    const filed = await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}/sources/s1`, payload: { collection_id: child.id } })
    assert.equal(filed.statusCode, 200)
    const listed = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/collections` })).json()
    assert.equal(listed.find((c: { id: string }) => c.id === child.id).source_count, 1)

    // Deleting the parent unfiles the source rather than deleting it.
    await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}/collections/${parent.id}` })
    assert.equal((await app.inject({ method: 'GET', url: `/api/projects/${project.id}/collections` })).json().length, 0)
    const source = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources/s1` })).json()
    assert.equal(source.collection_id, null)
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

test('Fastify source updates persist and validate reading progress', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Reading' } })).json()
    const now = new Date().toISOString()
    const db = (await import('../../src/core/database.js')).openDatabase(config)
    db.prepare('INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('book', project.id, 'pdf', 'Long Book', '[Page 1]\nbody', 10, now, now)
    db.close()

    const updated = await app.inject({
      method: 'PATCH', url: `/api/projects/${project.id}/sources/book`, payload: { last_page_read: 7 },
    })
    assert.equal(updated.statusCode, 200)
    const source = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources/book` })).json()
    assert.equal(source.last_page_read, 7)
    assert.equal(source.title, 'Long Book')

    for (const page of [0, 11, 1.5]) {
      const invalid = await app.inject({
        method: 'PATCH', url: `/api/projects/${project.id}/sources/book`, payload: { last_page_read: page },
      })
      assert.equal(invalid.statusCode, 400)
      assert.equal(invalid.json().code, 'INVALID_PAGE')
    }
    const unchanged = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/sources/book` })).json()
    assert.equal(unchanged.last_page_read, 7)
  } finally { await app.close(); cleanup(config, { close() {} } as never) }
})

test('Fastify project search and highlights aggregate across sources', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Findable' } })).json()
    const db = (await import('../../src/core/database.js')).openDatabase(config)
    const now = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?)').run('s1', project.id, 'pdf', 'Transformers', '[Page 1]\nattention mechanisms scale well', 1, now, now)
    const { RetrievalService } = await import('../../src/core/retrieval.js')
    new RetrievalService(db).index('s1', '[Page 1]\nattention mechanisms scale well')
    db.prepare('INSERT INTO annotations(id,source_id,project_id,page_number,x1,y1,x2,y2,text,color,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('a1', 's1', project.id, 1, 0, 0, 1, 1, 'attention mechanisms', 'green', now)
    db.close()

    const search = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/search?q=attention` })).json()
    assert.ok(search.results.length >= 1)
    assert.equal(search.results[0].source_title, 'Transformers')

    const highlights = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}/highlights` })).json()
    assert.equal(highlights.length, 1)
    assert.equal(highlights[0].text, 'attention mechanisms')
    assert.equal(highlights[0].source_title, 'Transformers')
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

test('reader API refuses cross-site and rebinding requests while preserving same-origin access', async () => {
  const config = testConfig(), app = await buildServer(config)
  try {
    const create = { method: 'POST' as const, url: '/api/projects', payload: { title: 'Untrusted document' } }
    for (const headers of [{ host: 'attacker.example' }, { host: 'localhost:8200', origin: 'https://attacker.example' }, { host: 'localhost:8200', origin: 'null' }, { host: 'localhost:8200', 'sec-fetch-site': 'cross-site' }])
      assert.equal((await app.inject({ ...create, headers })).statusCode, 403)
    assert.equal((await app.inject({ url: '/api/projects' })).json().length, 0)
    assert.equal((await app.inject({ ...create, headers: { host: 'localhost:8200', origin: 'http://localhost:8200' } })).statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: '/api/desktop/install', payload: { command: 'arbitrary' } })).statusCode, 404)
  } finally { await app.close(); fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})
