import test from 'node:test'
import assert from 'node:assert/strict'
import { joinOverlapping, PAGE_CONTEXT_CHARS, RetrievalService, selectionPages, splitPages } from '../../src/core/retrieval.js'
import { cleanup, createProject, createSource, testConfig, testDb } from '../helpers/test-utils.js'

test('splitPages preserves page numbers and content', () => {
  assert.deepEqual(splitPages('[Page 2]\nAlpha\n[Page 4]\nBeta'), [
    { page: 2, text: 'Alpha' }, { page: 4, text: 'Beta' },
  ])
})

test('retrieval indexes and filters passages by project/source', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const project = createProject(db), other = createProject(db)
    const source = createSource(db, project, '[Page 3]\nSQLite indexing makes research searchable.')
    const otherSource = createSource(db, other, '[Page 1]\nSQLite indexing in another project.')
    const retrieval = new RetrievalService(db)
    retrieval.index(source, '[Page 3]\nSQLite indexing makes research searchable.')
    retrieval.index(otherSource, '[Page 1]\nSQLite indexing in another project.')
    const results = retrieval.search(project, 'SQLite indexing')
    assert.equal(results.length, 1)
    assert.equal(results[0]?.source_id, source)
    assert.equal(results[0]?.page_number, 3)
  } finally { cleanup(config, db) }
})

test('query terms keep one-character symbols and, for long queries, the rarest matching terms', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const project = createProject(db)
    const text = '[Page 1]\nThe temperature τ is set to 0.01. The model uses the encoder and the decoder.\n[Page 2]\nThe encoder reads the input. The decoder writes the output with the encoder states.'
    const source = createSource(db, project, text)
    const retrieval = new RetrievalService(db)
    retrieval.index(source, text)
    assert.deepEqual(retrieval.queryTerms('What is τ?'), ['what', 'is', 'τ'])
    assert.equal(retrieval.search(project, 'τ')[0]?.page_number, 1)
    // 20 unique words: absent words are dropped and the rarest 16 are kept in their original order.
    const long = 'the encoder decoder model temperature input output states writes reads uses set alpha beta gamma delta epsilon zeta eta theta'
    assert.deepEqual(retrieval.queryTerms(long), ['the', 'encoder', 'decoder', 'model', 'temperature', 'input', 'output', 'states', 'writes', 'reads', 'uses', 'set'])
  } finally { cleanup(config, db) }
})

test('equal scores are ordered by chunk id', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const project = createProject(db)
    const retrieval = new RetrievalService(db)
    const ids = [1, 2, 3].map(() => createSource(db, project, '[Page 1]\nIdentical sentence about tokenizers.'))
    for (const id of ids) retrieval.index(id, '[Page 1]\nIdentical sentence about tokenizers.')
    assert.deepEqual(retrieval.search(project, 'tokenizers').map(passage => passage.source_id), ids)
  } finally { cleanup(config, db) }
})

test('chat context leads with the selection page and its neighbours and merges overlapping chunks', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const project = createProject(db)
    const filler = Array.from({ length: 260 }, (_, i) => `gradients filler${i}`).join(' ')
    const text = `[Page 1]\nIntroduction mentions gradients once.\n[Page 2]\nSelected passage about clipping.\n[Page 3]\nNext page discusses gradients.\n[Page 4]\n${filler}\n[Page 5]\nUnrelated closing remarks.`
    const sourceId = createSource(db, project, text)
    const retrieval = new RetrievalService(db)
    retrieval.index(sourceId, text)
    const source = { id: sourceId, title: 'Test Source', pdf_text: text }
    const passages = retrieval.context(project, 'Why gradients?', [sourceId], 16, { source, page: 2, selection: 'Selected passage' })
    assert.deepEqual(passages.slice(0, 3).map(passage => passage.page_number), [2, 1, 3])
    assert.equal(passages.filter(passage => passage.page_number === 1 || passage.page_number === 3).length, 2, 'search results from guaranteed pages are skipped')
    const page4 = passages.filter(passage => passage.page_number === 4)
    assert.equal(page4.length, 1, 'consecutive chunks of one page are merged')
    assert.equal(page4[0]!.content, filler, 'merging restores the page text without repeating the overlap')
    assert.ok(retrieval.search(project, 'gradients', [sourceId]).filter(passage => passage.page_number === 4).length > 1, 'search itself still returns chunks')
    assert.deepEqual(retrieval.context(project, 'Why gradients?', [sourceId], 16).map(passage => passage.page_number).sort(), [1, 3, 4])
  } finally { cleanup(config, db) }
})

test('guaranteed pages are trimmed around the selection on very long pages', () => {
  const long = `${'a '.repeat(5000)}NEEDLE here ${'b '.repeat(5000)}`.trim()
  const pages = selectionPages({ source: { id: 's', title: 'T', pdf_text: `[Page 1]\n${long}\n[Page 2]\n${long}` }, page: 2, selection: 'NEEDLE here' })
  assert.equal(pages[0]!.page_number, 2)
  assert.ok(pages[0]!.content.length <= PAGE_CONTEXT_CHARS && pages[0]!.content.includes('NEEDLE'))
  assert.equal(pages[1]!.page_number, 1)
  assert.ok(pages[1]!.content.endsWith('b') && pages[1]!.content.length === PAGE_CONTEXT_CHARS)
  assert.deepEqual(selectionPages({ source: { id: 's', title: 'T', pdf_text: null }, page: 1 }), [])
  assert.equal(joinOverlapping('one two three', 'three four'), 'one two three four')
  assert.equal(joinOverlapping('abc', 'xyz'), 'abc xyz')
})
