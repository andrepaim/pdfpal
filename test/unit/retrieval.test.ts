import test from 'node:test'
import assert from 'node:assert/strict'
import { RetrievalService, splitPages } from '../../src/core/retrieval.js'
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
