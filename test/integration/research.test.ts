import test from 'node:test'
import assert from 'node:assert/strict'
import { relatedPapers } from '../../src/core/research.js'
import { cleanup, createProject, testConfig, testDb } from '../helpers/test-utils.js'

test('related papers fetches Semantic Scholar data and reuses its cache', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://arxiv.org/abs/1706.03762', 'Attention', 'text', 1, timestamp, timestamp)
    let calls = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls++
      const citation = String(input).includes('/citations')
      const paper = { paperId: citation ? 'cite' : 'ref', title: citation ? 'Citing Paper' : 'Referenced Paper', authors: [{ name: 'Ada' }], year: 2024, externalIds: { ArXiv: '2401.00001' }, openAccessPdf: { url: 'https://example.test/paper.pdf' } }
      return new Response(JSON.stringify({ data: [citation ? { citingPaper: paper } : { citedPaper: paper }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.references[0]?.title, 'Referenced Paper')
    assert.equal(fetched.citations[0]?.title, 'Citing Paper')
    const cached = await relatedPapers(db, projectId, 'paper')
    assert.equal(cached.cached, true)
    assert.equal(calls, 2)
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('sends the configured Semantic Scholar API key as a header, and omits it when unset', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://arxiv.org/abs/1706.03762', 'Attention', 'text', 1, timestamp, timestamp)
    const seenKeys: Array<string | null> = []
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      seenKeys.push((init?.headers as Record<string, string> | undefined)?.['x-api-key'] ?? null)
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    await relatedPapers(db, projectId, 'paper', 'refresh-key-1', true)
    assert.ok(seenKeys.every(k => k === 'refresh-key-1'), `expected every call to carry the key, got ${JSON.stringify(seenKeys)}`)

    seenKeys.length = 0
    await relatedPapers(db, projectId, 'paper', '', true)
    assert.ok(seenKeys.every(k => k === null), `expected no key header when unset, got ${JSON.stringify(seenKeys)}`)
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})
