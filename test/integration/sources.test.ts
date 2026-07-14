import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { SourceService } from '../../src/core/sources.js'
import { ProjectService } from '../../src/core/projects.js'
import { RetrievalService } from '../../src/core/retrieval.js'
import { cleanup, testConfig, testDb } from '../helpers/test-utils.js'

test('adds a local PDF, stores a managed copy, and indexes it', async () => {
  const config = testConfig(), db = testDb(config)
  try {
    const project = new ProjectService(db).create('PDF Project')
    const source = await new SourceService(db, config).add(project.id, path.resolve('test/fixtures/sample.pdf'))
    assert.equal(source.pages, 2)
    assert.ok(source.local_path)
    assert.equal((db.prepare('SELECT COUNT(*) count FROM source_chunks WHERE source_id=?').get(source.id) as { count: number }).count, 2)
  } finally { cleanup(config, db) }
})

test('removes a source, its managed PDF, and indexed passages', async () => {
  const config = testConfig(), db = testDb(config)
  try {
    const project = new ProjectService(db).create('PDF Project')
    const sources = new SourceService(db, config)
    const source = await sources.add(project.id, path.resolve('test/fixtures/sample.pdf'))
    const retrieval = new RetrievalService(db)

    assert.ok(sources.pdfPath(source))
    assert.equal((db.prepare('SELECT COUNT(*) count FROM source_chunks WHERE source_id=?').get(source.id) as { count: number }).count, 2)

    sources.remove(project.id, source.id)

    assert.equal(sources.list(project.id).length, 0)
    assert.equal(sources.pdfPath(source), null)
    assert.equal((db.prepare('SELECT COUNT(*) count FROM source_chunks WHERE source_id=?').get(source.id) as { count: number }).count, 0)
    assert.equal((db.prepare('SELECT COUNT(*) count FROM source_chunks_fts').get() as { count: number }).count, 0)
    assert.deepEqual(retrieval.search(project.id, 'research'), [])
  } finally { cleanup(config, db) }
})

test('moves a source and its source-scoped records atomically', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const projects = new ProjectService(db)
    const sourceService = new SourceService(db, config)
    const from = projects.create('From'), to = projects.create('To')
    const source = db.prepare(`INSERT INTO sources(id,project_id,type,title,pdf_text,pages,created_at,accessed_at)
      VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?,?) RETURNING id`).get(from.id, 'pdf', 'Move me', 'text', 1, new Date().toISOString(), new Date().toISOString()) as { id: string }
    db.prepare('INSERT INTO notes(id,project_id,source_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('note', from.id, source.id, 'Note', '', '', '')
    const moved = sourceService.move(from.id, source.id, to.id)
    assert.equal(moved.project_id, to.id)
    assert.equal((db.prepare('SELECT project_id FROM notes WHERE id=?').get('note') as { project_id: string }).project_id, to.id)
  } finally { cleanup(config, db) }
})
