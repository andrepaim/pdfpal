import test from 'node:test'
import assert from 'node:assert/strict'
import { paperIdFromUrl, relatedPapers } from '../../src/core/research.js'
import { cleanup, createProject, testConfig, testDb } from '../helpers/test-utils.js'

test('recognizes standard DOI resolver URLs', () => {
  assert.equal(paperIdFromUrl('https://doi.org/10.5555/example'), 'DOI:10.5555/example')
})

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

test('falls back to OpenAlex references and citations when Semantic Scholar has no record', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://doi.org/10.5555/not-in-s2', 'A Paper Missing from Semantic Scholar', 'text', 1, timestamp, timestamp)
    let calls = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls++
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') {
        if (url.pathname.endsWith('/references')) return new Response('', { status: 404 })
        if (url.pathname === '/graph/v1/paper/search') return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        throw new Error('Unexpected Semantic Scholar request: ' + url)
      }
      if (url.hostname === 'api.openalex.org' && url.pathname.startsWith('/works/doi:')) {
        return new Response(JSON.stringify({
          id: 'https://openalex.org/W100',
          title: 'A Paper Missing from Semantic Scholar',
          referenced_works: ['https://openalex.org/W101'],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.hostname === 'api.openalex.org' && url.searchParams.get('filter')?.startsWith('openalex_id:')) {
        return new Response(JSON.stringify({ results: [{
          id: 'https://openalex.org/W101',
          title: 'OpenAlex Reference',
          authorships: [{ author: { display_name: 'Ada' } }],
          publication_year: 2022,
          best_oa_location: { pdf_url: 'https://example.test/reference.pdf' },
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.hostname === 'api.openalex.org' && url.searchParams.get('filter') === 'cites:W100') {
        return new Response(JSON.stringify({ results: [{
          id: 'https://openalex.org/W102',
          title: 'OpenAlex Citation',
          authorships: [{ author: { display_name: 'Grace' } }],
          publication_year: 2024,
          ids: { arxiv: 'https://arxiv.org/abs/2401.00001' },
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error('Unexpected request: ' + url)
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.provider, 'openalex')
    assert.equal(fetched.references[0]?.title, 'OpenAlex Reference')
    assert.equal(fetched.references[0]?.s2_paper_id, 'openalex:W101')
    assert.equal(fetched.citations[0]?.title, 'OpenAlex Citation')
    assert.equal(fetched.citations[0]?.arxiv_url, 'https://arxiv.org/abs/2401.00001')

    const cached = await relatedPapers(db, projectId, 'paper')
    assert.equal(cached.cached, true)
    assert.equal(cached.provider, 'openalex')
    assert.equal(calls, 5)
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('pages through Semantic Scholar to collect more references than fit in one response', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://arxiv.org/abs/1801.07698', 'ArcFace', 'text', 1, timestamp, timestamp)
    const referenceOffsets: number[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/citations')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'))
      referenceOffsets.push(offset)
      // 130 references in total, so the last page comes back short.
      const remaining = Math.max(0, Math.min(limit, 130 - offset))
      const data = Array.from({ length: remaining }, (_, i) => ({ citedPaper: { paperId: `ref${offset + i}`, title: `Reference ${offset + i}`, authors: [{ name: 'Ada' }], year: 2020 } }))
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.deepEqual(referenceOffsets, [0, 100])
    assert.equal(fetched.references.length, 130)
    assert.equal(fetched.references[0]?.title, 'Reference 0')
    assert.equal(fetched.references[129]?.title, 'Reference 129')

    const cached = await relatedPapers(db, projectId, 'paper')
    assert.equal(cached.references.length, 130, 'the full set should survive the cache round-trip')
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('keeps earlier Semantic Scholar pages when a later page fails', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://arxiv.org/abs/1801.07698', 'ArcFace', 'text', 1, timestamp, timestamp)
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.semanticscholar.org') throw new Error('should not fall through to OpenAlex: ' + url)
      if (url.pathname.endsWith('/citations')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.searchParams.get('offset') !== '0') return new Response('', { status: 500 })
      const data = Array.from({ length: 100 }, (_, i) => ({ citedPaper: { paperId: `ref${i}`, title: `Reference ${i}`, authors: [{ name: 'Ada' }], year: 2020 } }))
      return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.provider, 'semantic_scholar')
    assert.equal(fetched.references.length, 100)
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('batches OpenAlex reference lookups and preserves bibliography order', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://doi.org/10.5555/many-refs', 'A Paper With Many References', 'text', 1, timestamp, timestamp)
    const referencedWorks = Array.from({ length: 120 }, (_, i) => `https://openalex.org/W${1000 + i}`)
    const batchSizes: number[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') {
        if (url.pathname.endsWith('/references')) return new Response('', { status: 404 })
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname.startsWith('/works/doi:')) {
        return new Response(JSON.stringify({ id: 'https://openalex.org/W100', title: 'A Paper With Many References', referenced_works: referencedWorks }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const filter = url.searchParams.get('filter') ?? ''
      if (filter.startsWith('openalex_id:')) {
        const ids = filter.slice('openalex_id:'.length).split('|')
        batchSizes.push(ids.length)
        // Returned in reverse so the assertion below checks ordering, not luck.
        return new Response(JSON.stringify({ results: [...ids].reverse().map(id => ({ id: `https://openalex.org/${id}`, title: `Reference ${id}`, publication_year: 2021 })) }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (filter === 'cites:W100') return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      throw new Error('Unexpected request: ' + url)
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.provider, 'openalex')
    assert.deepEqual(batchSizes, [50, 50, 20], 'reference IDs should be requested in batches of at most 50')
    assert.equal(fetched.references.length, 120)
    assert.equal(fetched.references[0]?.title, 'Reference W1000')
    assert.equal(fetched.references[119]?.title, 'Reference W1119')
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('caps OpenAlex references at 200 even when the paper cites more', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://doi.org/10.5555/huge', 'A Survey', 'text', 1, timestamp, timestamp)
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') {
        if (url.pathname.endsWith('/references')) return new Response('', { status: 404 })
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.pathname.startsWith('/works/doi:')) {
        return new Response(JSON.stringify({ id: 'https://openalex.org/W100', title: 'A Survey', referenced_works: Array.from({ length: 400 }, (_, i) => `https://openalex.org/W${2000 + i}`) }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const filter = url.searchParams.get('filter') ?? ''
      if (filter.startsWith('openalex_id:')) {
        const ids = filter.slice('openalex_id:'.length).split('|')
        return new Response(JSON.stringify({ results: ids.map(id => ({ id: `https://openalex.org/${id}`, title: `Reference ${id}`, publication_year: 2021 })) }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.references.length, 200)
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('uses an OpenAlex title match when the source URL has no paper identifier', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db), timestamp = new Date().toISOString()
    db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('paper', projectId, 'pdf', 'https://example.test/download/paper.pdf', 'A Title Only Fallback Paper', 'text', 1, timestamp, timestamp)
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.hostname === 'api.openalex.org' && url.searchParams.has('search')) {
        return new Response(JSON.stringify({ results: [{
          id: 'https://openalex.org/W200',
          title: 'A Title Only Fallback Paper',
          referenced_works: [],
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.hostname === 'api.openalex.org' && url.searchParams.get('filter') === 'cites:W200') {
        return new Response(JSON.stringify({ results: [{
          id: 'https://openalex.org/W201',
          title: 'A Paper That Cites It',
          publication_year: 2025,
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error('Unexpected request: ' + url)
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.provider, 'openalex')
    assert.equal(fetched.citations[0]?.title, 'A Paper That Cites It')
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
