import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { AgentService } from '../../src/core/agents.js'
import { loadConfig, saveAIModePreference } from '../../src/core/config.js'
import { buildServer } from '../../src/server/app.js'
import { createProject, createSource, testConfig, testDb } from '../helpers/test-utils.js'

const codexEndpoint = '/api/agent-models/codex'
const claudeEndpoint = '/api/agent-models/claude'
const bundled = {
  models: [
    { slug: 'fixture-codex', display_name: 'Fixture Codex', visibility: 'list' },
    { slug: 'fixture-codex', display_name: 'Duplicate', visibility: 'list' },
    { slug: 'fixture-hidden', display_name: 'Hidden', visibility: 'hide' },
    { slug: '--config', display_name: 'Invalid', visibility: 'list' },
  ],
}

async function setup(t: TestContext, claudeModelHelp = '') {
  const config = testConfig()
  const oldHome = process.env.CODEX_HOME
  const oldModel = process.env.PDFPAL_MODEL
  const oldAgent = process.env.PDFPAL_AGENT
  const codexHome = path.join(config.dataDir, 'codex-home')
  let app: Awaited<ReturnType<typeof buildServer>> | undefined
  fs.mkdirSync(codexHome)
  process.env.CODEX_HOME = codexHome
  delete process.env.PDFPAL_MODEL
  delete process.env.PDFPAL_AGENT
  t.after(async () => {
    try { await app?.close() } finally {
      if (oldHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = oldHome
      if (oldModel === undefined) delete process.env.PDFPAL_MODEL
      else process.env.PDFPAL_MODEL = oldModel
      if (oldAgent === undefined) delete process.env.PDFPAL_AGENT
      else process.env.PDFPAL_AGENT = oldAgent
      fs.rmSync(config.dataDir, { recursive: true, force: true })
    }
  })

  const calls = path.join(config.dataDir, 'calls.jsonl')
  const definition = JSON.parse(fs.readFileSync(path.resolve('test/fixtures/visual-v2/pq.codex.json'), 'utf8')).definition
  for (const agent of ['codex', 'claude'] as const) {
    const executable = path.join(config.dataDir, agent)
    const version = agent === 'codex' ? 'codex-cli 0.164.0' : '2.1.0 (Claude Code)'
    fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
switch (args.join(' ')) {
  case '--version': console.log(${JSON.stringify(version)}); process.exit(0)
  case '--help': console.log(${JSON.stringify(`--tools --strict-mcp-config --disallowedTools\n${claudeModelHelp}`)}); process.exit(0)
  case 'exec --help': console.log('--ignore-user-config --ignore-rules --ephemeral --disable'); process.exit(0)
  case 'auth status': case 'login status': process.exit(1)
  case 'debug models --bundled': console.log(${JSON.stringify(JSON.stringify(bundled))}); process.exit(0)
}
const index = args.findIndex(arg => arg === '--model' || arg === '-m')
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ agent: ${JSON.stringify(agent)}, model: index < 0 ? '' : args[index + 1] }) + '\\n')
const prompt = fs.readFileSync(0, 'utf8')
console.log(prompt.startsWith(${JSON.stringify("You are pdfpal's visual teacher")}) ? ${JSON.stringify(JSON.stringify(definition))} : 'Fixture answer')`, { mode: 0o700 })
    if (agent === 'codex') config.codexBin = executable
    else config.claudeBin = executable
  }
  config.model = 'legacy-model'
  fs.writeFileSync(path.join(config.dataDir, 'config.json'), JSON.stringify({ model: config.model, port: 8900 }))
  const db = testDb(config)
  const projectId = createProject(db, 'Model test')
  createSource(db, projectId)
  db.close()
  app = await buildServer(config)
  return { app, config, projectId, codeCache: path.join(codexHome, 'models_cache.json'), readCalls: () => fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}

test('model settings use real CLI catalog entries, persist independently, and can clear a legacy model', { skip: process.platform === 'win32' }, async t => {
  const { app, config, readCalls } = await setup(t)
  const initial = await app.inject({ url: codexEndpoint })
  assert.equal(initial.statusCode, 200)
  assert.deepEqual(initial.json(), { models: [{ id: 'fixture-codex', name: 'Fixture Codex' }], model: 'legacy-model' })
  const claude = (await app.inject({ url: claudeEndpoint })).json()
  assert.equal(claude.model, 'legacy-model')
  assert.ok(claude.models.some((model: { id: string }) => model.id === 'sonnet'))
  assert.ok(!claude.models.some((model: { id: string }) => model.id === 'fable'))

  saveAIModePreference(config, 'codex', 'fixture-codex')
  saveAIModePreference(config, 'claude', 'alias/custom-model[1m]')
  assert.equal((await app.inject({ url: codexEndpoint })).json().model, 'fixture-codex')
  saveAIModePreference(config, 'codex', '')
  assert.equal((await app.inject({ url: codexEndpoint })).json().model, '')
  assert.equal((await app.inject({ url: claudeEndpoint })).json().model, 'alias/custom-model[1m]')

  const restarted = loadConfig({ dataDir: config.dataDir, claudeBin: config.claudeBin, codexBin: config.codexBin })
  const restartedAgent = new AgentService(restarted)
  await restartedAgent.invoke('automatic', 'codex')
  await restartedAgent.invoke('custom', 'claude')
  assert.deepEqual(readCalls(), [{ agent: 'codex', model: '' }, { agent: 'claude', model: 'alias/custom-model[1m]' }])
  assert.equal(restarted.port, 8900)
  assert.equal(restarted.model, 'legacy-model')

  const crossOrigin = await app.inject({ url: codexEndpoint, headers: { origin: 'https://example.com' } })
  assert.equal(crossOrigin.statusCode, 403)
  assert.equal((await app.inject({ url: '/api/agent-models/opencode' })).statusCode, 404)
})

test('Claude offers Fable when its installed CLI advertises that model alias', { skip: process.platform === 'win32' }, async t => {
  const { app } = await setup(t, "  --model <model>  Model for the current session. Use an\n                   alias (e.g. 'fable', 'opus', or 'sonnet').")
  const { models } = (await app.inject({ url: claudeEndpoint })).json()
  assert.ok(models.some((model: { id: string }) => model.id === 'fable'))
})

test('Codex prefers selectable cached models and falls back when the cache is unreadable', { skip: process.platform === 'win32' }, async t => {
  const { app, codeCache } = await setup(t)
  fs.writeFileSync(codeCache, JSON.stringify({ models: [{ slug: 'fixture-cached', display_name: 'Cached Choice', visibility: 'list' }] }))
  assert.deepEqual((await app.inject({ url: codexEndpoint })).json().models, [{ id: 'fixture-cached', name: 'Cached Choice' }])
  fs.writeFileSync(codeCache, 'partial write')
  assert.deepEqual((await app.inject({ url: codexEndpoint })).json().models, [{ id: 'fixture-codex', name: 'Fixture Codex' }])
})

test('chat and visual overrides take precedence over provider defaults for each request', { skip: process.platform === 'win32' }, async t => {
  const { app, config, projectId, readCalls } = await setup(t)
  saveAIModePreference(config, 'codex', 'fixture-codex')
  for (const model of [undefined, 'fixture-chat', '']) {
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { project_id: projectId, message: 'testing', model } })
    assert.equal(response.statusCode, 200)
    assert.match(response.body, /Fixture answer/)
  }
  const visualUrl = `/api/projects/${projectId}/visuals`
  const start = await app.inject({ method: 'POST', url: visualUrl, payload: { request_id: randomUUID(), question: 'Testing', agent: 'codex', model: 'fixture-visual' } })
  assert.equal(start.statusCode, 202)
  const visualId = start.json().id
  let status = ''
  for (let i = 0; i < 120; i++) {
    status = (await app.inject({ url: `${visualUrl}/${visualId}` })).json().status
    if (status === 'complete' || status === 'failed') break
    await setTimeout(25)
  }
  assert.equal(status, 'complete')
  assert.deepEqual(readCalls(), ['fixture-codex', 'fixture-chat', '', 'fixture-visual'].map(model => ({ agent: 'codex', model })))
})
