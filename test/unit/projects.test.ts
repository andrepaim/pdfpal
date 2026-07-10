import test from 'node:test'
import assert from 'node:assert/strict'
import { ProjectService } from '../../src/core/projects.js'
import { PdfpalError } from '../../src/core/types.js'
import { cleanup, testConfig, testDb } from '../helpers/test-utils.js'

test('projects resolve by id or unique case-insensitive title', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const service = new ProjectService(db)
    const project = service.create('Research')
    assert.equal(service.resolve('research').id, project.id)
    assert.throws(() => service.create(''), (error: unknown) => error instanceof PdfpalError && error.code === 'INVALID_TITLE')
  } finally { cleanup(config, db) }
})

test('ambiguous project titles are rejected', () => {
  const config = testConfig(), db = testDb(config)
  try {
    const service = new ProjectService(db)
    service.create('Same'); service.create('Same')
    assert.throws(() => service.resolve('same'), (error: unknown) => error instanceof PdfpalError && error.code === 'AMBIGUOUS_PROJECT')
  } finally { cleanup(config, db) }
})
