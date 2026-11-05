import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CliOperations } from '../../src/core/cli-operations.js'
import { cleanup, testConfig, testDb } from '../helpers/test-utils.js'

test('committed mutation receipts and writes roll back together; interrupted work requires explicit retry', () => {
  const config = testConfig(), db = testDb(config)
  try {
    let operations = new CliOperations(db, 'fixture-library')
    const id = randomUUID(), args = { title: 'Project', description: '' }
    assert.equal(operations.begin(id, 'project.create', args, false).fresh, true)
    assert.throws(() => db.transaction(() => {
      db.prepare("INSERT INTO projects VALUES('fixture','Title','','now','now')").run()
      operations.complete(id, { id: 'fixture' })
      throw Error('Rollback fixture')
    })())
    assert.equal(operations.get(id).state, 'running')
    assert.equal(db.prepare("SELECT id FROM projects WHERE id='fixture'").get(), undefined)
    operations = new CliOperations(db, 'fixture-library')
    assert.equal(operations.get(id).state, 'interrupted')
    assert.equal(operations.begin(id, 'project.create', args, false).fresh, false)
    assert.equal(operations.begin(id, 'project.create', args, true).fresh, true)
    operations.complete(id, { id: 'created' })
    assert.equal(operations.begin(id, 'project.create', { description: '', title: 'Project' }, false).receipt.state, 'completed')
    assert.throws(() => operations.begin(id, 'project.create', { title: 'Other' }, true), { code: 'OPERATION_CONFLICT' })
  } finally { cleanup(config, db) }
})

test('expired results retain anti-replay identity and never execute completed work again', () => {
  const config = testConfig(), db = testDb(config)
  try {
    let operations = new CliOperations(db, 'fixture-library')
    const id = randomUUID()
    operations.begin(id, 'project.create', { title: 'Once' }, false)
    operations.complete(id, { id: 'created' })
    db.prepare('UPDATE cli_operations SET updated_at=? WHERE id=?').run(new Date(Date.now() - 31 * 86400000).toISOString(), id)
    operations = new CliOperations(db, 'fixture-library')
    assert.equal(operations.get(id).result, undefined)
    assert.equal(operations.get(id).state, 'completed')
    assert.throws(() => operations.begin(id, 'project.create', { title: 'Once' }, true), { code: 'OPERATION_EXPIRED' })
    assert.throws(() => operations.begin(randomUUID(), 'project.create', {}, true), { code: 'OPERATION_NOT_FOUND' })
  } finally { cleanup(config, db) }
})
