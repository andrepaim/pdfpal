import test from 'node:test'
import assert from 'node:assert/strict'
import { buildServer } from '../../src/server/app.js'
import { openDatabase } from '../../src/core/database.js'
import { SourceService } from '../../src/core/sources.js'
import { ExtensionAuth } from '../../src/core/extension-auth.js'
import { kindleBookUrl, kindleLaunchUrl, sameLocalServer } from '../../src/shared/kindle-book.js'
import { cleanup, testConfig } from '../helpers/test-utils.js'

const book = { url: 'https://read.amazon.com/?asin=TESTBOOK01', title: 'A Kindle book', author: 'Test Author' }

test('Kindle references persist as sources, deduplicate, file into collections, and never fetch PDF data', async () => {
  const config = testConfig(), app = await buildServer(config), db = openDatabase(config)
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Books' } })).json()
    const other = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Other project' } })).json()
    const collection = (await app.inject({ method: 'POST', url: `/api/projects/${project.id}/collections`, payload: { name: 'Reading' } })).json()
    const add = (projectId: string, payload: object) => app.inject({ method: 'POST', url: `/api/projects/${projectId}/kindle-books`, payload })
    const response = await add(project.id, { ...book, collection_id: collection.id })
    assert.equal(response.statusCode, 200)
    const source = response.json()
    assert.equal(source.type, 'kindle'); assert.equal(source.author, book.author)
    assert.equal(source.collection_id, collection.id); assert.equal(source.pdf_text, null)
    assert.equal(source.pages, 0); assert.equal(source.local_path, null)
    assert.equal(source.kindle_book_key, 'https://read.amazon.com/TESTBOOK01')
    const again = await add(project.id, { ...book, url: 'https://read.amazon.com/reader/testbook01?tracking=no#anything' })
    assert.equal(again.json().id, source.id)
    const second = (await add(other.id, book)).json()
    assert.notEqual(second.id, source.id)
    assert.equal((await app.inject({ url: '/api/projects' })).json().find((item: { id: string }) => item.id === project.id).source_count, 1)
    assert.equal((await app.inject({ url: `/api/projects/${project.id}/sources` })).json()[0].type, 'kindle')
    const service = new SourceService(db, config)
    assert.equal(await service.reindex(project.id, undefined, true), 0)
    assert.equal((db.prepare('SELECT COUNT(*) n FROM source_chunks WHERE source_id=?').get(source.id) as { n: number }).n, 0)
    assert.equal((await app.inject({ url: `/api/projects/${project.id}/sources/${source.id}/file` })).statusCode, 400)
    assert.throws(() => service.move(project.id, source.id, other.id), /already in the target project/)
    const edited = await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}/sources/${source.id}`, payload: { title: 'Renamed book', collection_id: null } })
    assert.equal(edited.statusCode, 200)
    const reopened = openDatabase(config)
    try { assert.equal((reopened.prepare('SELECT title FROM sources WHERE id=?').get(source.id) as { title: string }).title, 'Renamed book') }
    finally { reopened.close() }
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}/sources/${source.id}` })).statusCode, 200)
    assert.equal((await app.inject({ url: `/api/projects/${project.id}/sources` })).json().length, 0)
    assert.equal((await app.inject({ url: `/api/projects/${other.id}/sources` })).json().length, 1)
  } finally { await app.close(); cleanup(config, db) }
})

test('Kindle book endpoints validate links and require an authenticated companion', async () => {
  const config = testConfig(), app = await buildServer(config), db = openDatabase(config)
  try {
    const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Reading' } })).json()
    const url = `/api/projects/${project.id}/kindle-books`
    for (const value of ['https://read.amazon.com/', 'http://read.amazon.com/?asin=TESTBOOK01', 'https://read.amazon.com.evil.test/?asin=TESTBOOK01',
      'https://user:password@read.amazon.com/?asin=TESTBOOK01', 'https://read.amazon.com:1234/?asin=TESTBOOK01', 'javascript:alert(1)', 'https://example.org/book.pdf']) {
      assert.equal((await app.inject({ method: 'POST', url, payload: { ...book, url: value } })).statusCode, 400, value)
    }
    assert.equal((await app.inject({ method: 'POST', url, payload: { ...book, title: ' ' } })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/api/projects/missing/kindle-books', payload: book })).statusCode, 404)
    const bridgeUrl = `/api/extension/projects/${project.id}/books`
    assert.equal((await app.inject({ method: 'POST', url: bridgeUrl, payload: book })).statusCode, 401)
    const origin = `chrome-extension://${'a'.repeat(32)}`
    const pair = (await app.inject({ method: 'POST', url: '/api/extension/pair', payload: { code: new ExtensionAuth(db).pairCode().code, origin }, headers: { origin } })).json()
    const headers = { origin, authorization: `Bearer ${pair.token}` }
    const response = await app.inject({ method: 'POST', url: bridgeUrl, payload: book, headers })
    assert.equal(response.statusCode, 200)
    const lookup = `/api/extension/books?url=${encodeURIComponent(book.url)}`
    assert.equal((await app.inject({ url: lookup })).statusCode, 401)
    assert.deepEqual((await app.inject({ url: lookup, headers })).json(), [{ project_id: project.id, source_id: response.json().id }])
    assert.equal((await app.inject({ method: 'POST', url: bridgeUrl, payload: book, headers: { ...headers, origin: 'https://read.amazon.com' } })).statusCode, 403)
    assert.equal((await app.inject({ url: '/api/extension/books?url=not-a-book', headers })).json().length, 0)
  } finally { await app.close(); cleanup(config, db) }
})

test('Kindle reader links preserve the regional origin and keep project hints in the fragment', () => {
  for (const origin of ['https://read.amazon.com', 'https://ler.amazon.com.br', 'https://read.amazon.co.uk']) {
    const normalized = kindleBookUrl(`${origin}/reader/TESTBOOK01?unrelated=value`)
    assert.equal(normalized.url, `${origin}/?asin=TESTBOOK01`)
    const link = new URL(kindleLaunchUrl(normalized.url, 'project-123', 'http://localhost:8200'))
    assert.equal(link.search, '?asin=TESTBOOK01')
    assert.equal(new URLSearchParams(link.hash.slice(1)).get('pdfpal_project'), 'project-123')
  }
  assert.ok(sameLocalServer('http://localhost:8200', 'http://127.0.0.1:8200'))
  assert.ok(!sameLocalServer('http://localhost:8200', 'http://localhost:8201'))
  assert.ok(!sameLocalServer('https://example.org', 'https://example.org'))
})
