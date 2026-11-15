import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ChatService } from '../../src/core/chat.js'
import { ProjectService } from '../../src/core/projects.js'
import { RetrievalService } from '../../src/core/retrieval.js'
import { cleanup, createSource, testConfig, testDb } from '../helpers/test-utils.js'

test('chat retrieves context, invokes an agent, and persists history', async () => {
  const config = testConfig(), db = testDb(config)
  config.claudeBin = path.join(config.dataDir, 'mock-claude')
  fs.writeFileSync(config.claudeBin, `#!/bin/sh\ncase "$*" in\n--version) echo '2.1.0 (Claude Code)';;\n--help) echo '--tools --strict-mcp-config --disallowedTools';;\n'auth status') echo '{"authMethod":"claude.ai"}';;\n*) cat >/dev/null; echo 'mock answer';;\nesac\n`, { mode: 0o700 })
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

test('a selection page sent by the reader puts that page and its neighbours in the context', async () => {
  const config = testConfig(), db = testDb(config)
  config.claudeBin = path.join(config.dataDir, 'mock-claude')
  fs.writeFileSync(config.claudeBin, `#!/bin/sh\ncase "$*" in\n--version) echo '2.1.0 (Claude Code)';;\n--help) echo '--tools --strict-mcp-config --disallowedTools';;\n'auth status') echo '{"authMethod":"claude.ai"}';;\n*) cat >/dev/null; echo 'mock answer';;\nesac\n`, { mode: 0o700 })
  try {
    const project = new ProjectService(db).create('Selection Chat')
    const text = '[Page 1]\nBackground on optimisers.\n[Page 2]\nGradient clipping limits update size.\n[Page 3]\nWhy it matters: exploding gradients.\n[Page 4]\nUnrelated appendix.'
    const source = createSource(db, project.id, text)
    new RetrievalService(db).index(source, text)
    const chat = new ChatService(db, config)
    // Nothing in a Portuguese question matches, but the selection's pages still arrive.
    const withPage = await chat.ask(project.id, 'Por que isso?\n\n> Gradient clipping limits update size.', { sourceSelectors: [source], selectionPage: 2 })
    assert.deepEqual(withPage.sources[0]?.pages, [1, 2, 3])
    // Without the field, behaviour is unchanged: search alone.
    const without = await chat.ask(project.id, 'appendix', { sourceSelectors: [source] })
    assert.deepEqual(without.sources[0]?.pages, [4])
    // Project chat over several sources ignores the field.
    const other = createSource(db, project.id, '[Page 1]\nAnother appendix.')
    new RetrievalService(db).index(other, '[Page 1]\nAnother appendix.')
    const project_ = await chat.ask(project.id, 'appendix', { sourceSelectors: [source, other], selectionPage: 2 })
    assert.ok(project_.sources.every(entry => !entry.pages.includes(2)))
  } finally { cleanup(config, db) }
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
