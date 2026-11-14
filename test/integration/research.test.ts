import test from 'node:test'
import assert from 'node:assert/strict'
import { paperIdFromUrl, relatedPapers, s2RateLimit, titleFromUrl } from '../../src/core/research.js'
import { cleanup, createProject, testConfig, testDb } from '../helpers/test-utils.js'

// Keep the real retry and pacing behaviour, but with waits short enough for tests.
Object.assign(s2RateLimit, { retryDelaysMs: [5, 5, 5], maxRetryAfterMs: 50, keyedIntervalMs: 5 })

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const tooMany = (headers: Record<string, string> = {}) => new Response('', { status: 429, headers })

function insertSource(db: ReturnType<typeof testDb>, projectId: string, url: string, title: string) {
  const timestamp = new Date().toISOString()
  db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('paper', projectId, 'pdf', url, title, 'text', 1, timestamp, timestamp)
}

const s2Paper = (title: string) => ({ paperId: title, title, authors: [{ name: 'Ada' }], year: 2024 })
const openAlexFocal = { id: 'https://openalex.org/W100', title: 'Rate Limited Paper Title', referenced_works: ['https://openalex.org/W101'] }

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

test('retries a Semantic Scholar 429, honouring Retry-After, and then uses its answer', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://arxiv.org/abs/1706.03762', 'Attention')
    const refusals = new Map<string, number>()
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.semanticscholar.org') throw new Error('should not fall back to OpenAlex: ' + url)
      const relation = url.pathname.endsWith('/citations') ? 'citations' : 'references'
      // Each endpoint refuses twice before answering.
      const seen = refusals.get(relation) ?? 0
      if (seen < 2) { refusals.set(relation, seen + 1); return tooMany({ 'retry-after': '0' }) }
      return json({ data: [relation === 'citations' ? { citingPaper: s2Paper('Citing') } : { citedPaper: s2Paper('Referenced') }] })
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.provider, 'semantic_scholar')
    assert.equal(fetched.references[0]?.title, 'Referenced')
    assert.equal(fetched.citations[0]?.title, 'Citing')
    assert.equal('error' in fetched, false)
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('falls back to OpenAlex when Semantic Scholar keeps rate limiting, without a title search there', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://doi.org/10.5555/rate-limited', 'Rate Limited Paper Title')
    const s2Paths: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') { s2Paths.push(url.pathname); return tooMany() }
      if (url.pathname === '/works/doi:10.5555%2Frate-limited' || url.pathname === '/works/doi:10.5555/rate-limited') return json(openAlexFocal)
      if (url.searchParams.get('filter') === 'openalex_id:W101') return json({ results: [{ id: 'https://openalex.org/W101', title: 'OpenAlex Reference' }] })
      if (url.searchParams.get('filter') === 'cites:W100') return json({ results: [] })
      throw new Error('Unexpected request: ' + url)
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.provider, 'openalex')
    assert.equal(fetched.references[0]?.title, 'OpenAlex Reference')
    assert.equal('error' in fetched, false)
    // One request plus three retries, all on the references endpoint; no /paper/search.
    assert.equal(s2Paths.length, 4)
    assert.ok(s2Paths.every(p => p.endsWith('/references')), JSON.stringify(s2Paths))
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('explains the rate limit when OpenAlex cannot find the paper either', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://arxiv.org/abs/2401.99999', 'Unknown To OpenAlex Entirely')
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') return tooMany()
      return json({ results: [] })
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.match(String((fetched as { error?: string }).error), /rate limit/)
    assert.equal(fetched.references.length, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_related').get().n, 0, 'nothing should be cached')
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('a refresh that is rate limited keeps the saved papers and reports the error', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://arxiv.org/abs/2401.99999', 'Unknown To OpenAlex Entirely')
    let limited = false, openAlexCalls = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') {
        if (limited) return tooMany()
        return json({ data: [url.pathname.endsWith('/citations') ? { citingPaper: s2Paper('Saved Citing') } : { citedPaper: s2Paper('Saved Reference') }] })
      }
      openAlexCalls++
      return json({ results: [] })
    }) as typeof fetch

    await relatedPapers(db, projectId, 'paper')
    limited = true
    const refreshed = await relatedPapers(db, projectId, 'paper', '', true)
    assert.equal((refreshed as { error?: string }).error, 'Semantic Scholar is busy (rate limit). Try again in a minute.')
    assert.equal(openAlexCalls, 0, 'saved Semantic Scholar results are not replaced by OpenAlex results')
    assert.equal(refreshed.provider, 'semantic_scholar')
    assert.equal(refreshed.cached, true)
    assert.equal(refreshed.references[0]?.title, 'Saved Reference')
    assert.equal(refreshed.citations[0]?.title, 'Saved Citing')
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('spaces out keyed Semantic Scholar requests to respect the per-key rate', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch, interval = s2RateLimit.keyedIntervalMs
  try {
    s2RateLimit.keyedIntervalMs = 60
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://arxiv.org/abs/1706.03762', 'Attention')
    const keyed: number[] = [], anonymous: number[] = []
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const key = (init?.headers as Record<string, string> | undefined)?.['x-api-key']
      ;(key ? keyed : anonymous).push(performance.now())
      return json({ data: [] })
    }) as typeof fetch

    await relatedPapers(db, projectId, 'paper', 'a-key', true)
    await relatedPapers(db, projectId, 'paper', '', true)
    assert.equal(keyed.length, 2)
    assert.ok(keyed[1]! - keyed[0]! >= 55, `keyed requests ${keyed[1]! - keyed[0]!}ms apart`)
    assert.equal(anonymous.length, 2)
    assert.ok(anonymous[1]! - anonymous[0]! < 55, 'requests without a key are not delayed')
  } finally { s2RateLimit.keyedIntervalMs = interval; globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('looking up a title while adding a source does not wait out a rate limit', async () => {
  const originalFetch = globalThis.fetch, delays = s2RateLimit.retryDelaysMs
  try {
    s2RateLimit.retryDelaysMs = [5_000, 5_000, 5_000]
    let calls = 0
    globalThis.fetch = (async () => { calls++; return tooMany() }) as typeof fetch
    const started = performance.now()
    assert.equal(await titleFromUrl('https://arxiv.org/abs/1706.03762'), null)
    assert.equal(calls, 1)
    assert.ok(performance.now() - started < 1_000)
  } finally { s2RateLimit.retryDelaysMs = delays; globalThis.fetch = originalFetch }
})

test('finds an arXiv paper in OpenAlex by its arXiv DOI, not by a title another work shares', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://arxiv.org/abs/1406.2661', 'Generative Adversarial Networks')
    const openAlexPaths: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') return tooMany()
      openAlexPaths.push(decodeURIComponent(url.pathname) + url.search)
      if (decodeURIComponent(url.pathname) === '/works/doi:10.48550/arXiv.1406.2661') {
        return json({ id: 'https://openalex.org/W4298289240', title: 'Generative Adversarial Networks', referenced_works: ['https://openalex.org/W1'] })
      }
      // A title search would find this later article with the same title first.
      if (url.searchParams.get('search')) return json({ results: [{ id: 'https://openalex.org/W3096831136', title: 'Generative adversarial networks', referenced_works: ['https://openalex.org/W9'] }] })
      if (url.searchParams.get('filter') === 'openalex_id:W1') return json({ results: [{ id: 'https://openalex.org/W1', title: 'Right Reference' }] })
      if (url.searchParams.get('filter') === 'openalex_id:W9') return json({ results: [{ id: 'https://openalex.org/W9', title: 'Wrong Reference' }] })
      return json({ results: [] })
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal(fetched.provider, 'openalex')
    assert.equal((fetched as { paper_id?: string }).paper_id, 'openalex:W4298289240')
    assert.equal(fetched.references[0]?.title, 'Right Reference')
    assert.ok(!openAlexPaths.some(p => p.includes('search=')), JSON.stringify(openAlexPaths))
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('falls back to an OpenAlex title search when the arXiv DOI is not indexed', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://arxiv.org/abs/2401.00002', 'A Recent Preprint Without A DOI Record')
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') return tooMany()
      if (url.pathname.startsWith('/works/doi:')) return json({ error: 'not found' }, 404)
      if (url.searchParams.get('search')) return json({ results: [{ id: 'https://openalex.org/W7', title: 'A Recent Preprint Without A DOI Record', referenced_works: [] }] })
      return json({ results: [] })
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal((fetched as { paper_id?: string }).paper_id, 'openalex:W7')
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('a refresh while Semantic Scholar is busy still updates results that came from OpenAlex', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://doi.org/10.5555/rate-limited', 'Rate Limited Paper Title')
    let referenceTitle = 'First OpenAlex Reference'
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.semanticscholar.org') return tooMany()
      if (url.pathname.startsWith('/works/doi:')) return json(openAlexFocal)
      if (url.searchParams.get('filter') === 'openalex_id:W101') return json({ results: [{ id: 'https://openalex.org/W101', title: referenceTitle }] })
      return json({ results: [] })
    }) as typeof fetch

    await relatedPapers(db, projectId, 'paper')
    referenceTitle = 'Updated OpenAlex Reference'
    const refreshed = await relatedPapers(db, projectId, 'paper', '', true)
    assert.equal('error' in refreshed, false)
    assert.equal(refreshed.references[0]?.title, 'Updated OpenAlex Reference')
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})

test('says OpenAlex could not be reached, rather than could not find the paper, when it fails', async () => {
  const config = testConfig(), db = testDb(config), originalFetch = globalThis.fetch
  try {
    const projectId = createProject(db)
    insertSource(db, projectId, 'https://arxiv.org/abs/1706.03762', 'Attention Is All You Need')
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (new URL(String(input)).hostname === 'api.semanticscholar.org') return tooMany()
      throw new TypeError('fetch failed')
    }) as typeof fetch

    const fetched = await relatedPapers(db, projectId, 'paper')
    assert.equal((fetched as { error?: string }).error, 'Semantic Scholar is busy (rate limit) and OpenAlex could not be reached. Try again in a minute.')
  } finally { globalThis.fetch = originalFetch; cleanup(config, db) }
})
