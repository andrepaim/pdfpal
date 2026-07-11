import test from 'node:test'
import assert from 'node:assert/strict'
import { CollectionService } from '../../src/core/collections.js'
import { SourceService } from '../../src/core/sources.js'
import { cleanup, createProject, createSource, testConfig, testDb } from '../helpers/test-utils.js'

test('nests collections and scopes sources to a subtree', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const projectId = createProject(db, 'Research')
    const service = new CollectionService(db)
    const parent = service.create(projectId, 'Diffusion')
    const child = service.create(projectId, 'Samplers', parent.id)
    const sourceId = createSource(db, projectId)
    new SourceService(db, config).setCollection(projectId, sourceId, child.id)

    const tree = service.list(projectId)
    assert.equal(tree.length, 2)
    assert.equal(tree.find(c => c.id === child.id)?.parent_id, parent.id)
    assert.equal(tree.find(c => c.id === child.id)?.source_count, 1)
    // A source filed in the child is in scope when asking the parent.
    assert.deepEqual(service.descendantSourceIds(parent.id), [sourceId])
  } finally { cleanup(config, db) }
})

test('rejects moving a collection into its own descendant', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const projectId = createProject(db, 'Research')
    const service = new CollectionService(db)
    const parent = service.create(projectId, 'Parent')
    const child = service.create(projectId, 'Child', parent.id)
    assert.throws(() => service.move(projectId, parent.id, child.id), /COLLECTION_CYCLE|descendant/)
  } finally { cleanup(config, db) }
})

test('deleting a collection unfiles its sources instead of removing them', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const projectId = createProject(db, 'Research')
    const service = new CollectionService(db)
    const parent = service.create(projectId, 'Parent')
    const child = service.create(projectId, 'Child', parent.id)
    const sourceId = createSource(db, projectId)
    new SourceService(db, config).setCollection(projectId, sourceId, child.id)

    service.delete(projectId, parent.id)
    assert.equal(service.list(projectId).length, 0)
    const source = db.prepare('SELECT collection_id FROM sources WHERE id=?').get(sourceId) as { collection_id: string | null }
    assert.equal(source.collection_id, null)
    assert.equal((db.prepare('SELECT COUNT(*) n FROM sources WHERE id=?').get(sourceId) as { n: number }).n, 1)
  } finally { cleanup(config, db) }
})

test('reorder sets a collection\'s position among its siblings', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const projectId = createProject(db, 'Research')
    const service = new CollectionService(db)
    const first = service.create(projectId, 'First')
    const second = service.create(projectId, 'Second')
    assert.equal(first.position, 0)
    assert.equal(second.position, 1)
    const reordered = service.reorder(projectId, first.id, 5)
    assert.equal(reordered.position, 5)
    assert.equal(service.resolve(projectId, first.id).position, 5)
  } finally { cleanup(config, db) }
})

test('moving a source across projects clears its collection', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const from = createProject(db, 'From'), to = createProject(db, 'To')
    const collection = new CollectionService(db).create(from, 'Bucket')
    const sources = new SourceService(db, config)
    const sourceId = createSource(db, from)
    sources.setCollection(from, sourceId, collection.id)
    const moved = sources.move(from, sourceId, to)
    assert.equal(moved.project_id, to)
    assert.equal((db.prepare('SELECT collection_id FROM sources WHERE id=?').get(sourceId) as { collection_id: string | null }).collection_id, null)
  } finally { cleanup(config, db) }
})
