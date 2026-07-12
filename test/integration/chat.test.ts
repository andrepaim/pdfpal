import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatService } from '../../src/core/chat.js'
import { ProjectService } from '../../src/core/projects.js'
import { RetrievalService } from '../../src/core/retrieval.js'
import { cleanup, createSource, testConfig, testDb } from '../helpers/test-utils.js'

test('chat retrieves context, invokes an agent, and persists history', async () => {
  const config = testConfig(), db = testDb(config)
  config.claudeBin = '/bin/echo'
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error('unexpected external web search') }) as typeof fetch
  try {
    const project = new ProjectService(db).create('Chat Project')
    const source = createSource(db, project.id, '[Page 2]\nTesting makes research reliable.')
    new RetrievalService(db).index(source, '[Page 2]\nTesting makes research reliable.')
    const result = await new ChatService(db, config).ask(project.id, 'testing research')
    assert.equal(result.project.id, project.id)
    assert.deepEqual(result.sources[0]?.pages, [2])
    assert.ok(result.chat_session_id)
    assert.equal((db.prepare('SELECT COUNT(*) count FROM chat_messages').get() as { count: number }).count, 2)
  } finally {
    globalThis.fetch = originalFetch
    cleanup(config, db)
  }
})

test('failed agent requests do not persist chat messages', async () => {
  const config = testConfig(), db = testDb(config)
  config.claudeBin = '/does/not/exist'
  try {
    const project = new ProjectService(db).create('Failed Chat')
    const source = createSource(db, project.id, '[Page 1]\nFailure context is indexed.')
    new RetrievalService(db).index(source, '[Page 1]\nFailure context is indexed.')
    await assert.rejects(() => new ChatService(db, config).ask(project.id, 'failure context'))
    assert.equal((db.prepare('SELECT COUNT(*) count FROM chat_messages').get() as { count: number }).count, 0)
  } finally { cleanup(config, db) }
})
