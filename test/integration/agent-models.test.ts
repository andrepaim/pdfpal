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
    { slug: 'fixture-codex', display_name: 'Fixture Codex', visibility: 'list', default_reasoning_level: 'low',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }, { effort: 'high' }, { effort: 'unrecognized' }, null] },
    { slug: 'fixture-codex', display_name: 'Duplicate', visibility: 'list' },
    { slug: 'fixture-hidden', display_name: 'Hidden', visibility: 'hide' },
    { slug: '--config', display_name: 'Invalid', visibility: 'list' },
  ],
}

async function setup(t: TestContext, claudeModelHelp = '', claudeVersion = '2.1.0') {
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
    const version = agent === 'codex' ? 'codex-cli 0.164.0' : claudeVersion + ' (Claude Code)'
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
const effortIndex = args.indexOf('--effort')
const effortConfig = args.find(arg => arg.startsWith('model_reasoning_effort='))
const effort = effortIndex >= 0 ? args[effortIndex + 1] : effortConfig?.match(/^model_reasoning_effort="([a-z]+)"$/)?.[1]
if (effortConfig && !args.includes('--ignore-user-config')) process.exit(1)
if (effort === 'ultra' && (!args.includes('multi_agent_v2') || !args.includes('agents.enabled=false'))) process.exit(1)
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ agent: ${JSON.stringify(agent)}, model: index < 0 ? '' : args[index + 1], effort }) + '\\n')
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
  assert.deepEqual(initial.json(), { models: [{ id: 'fixture-codex', name: 'Fixture Codex', efforts: ['low', 'high', 'ultra'], defaultEffort: 'low' }], model: 'legacy-model', effortDefaults: {} })
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
  fs.writeFileSync(codeCache, JSON.stringify({ models: [{
    slug: 'fixture-cached', display_name: 'Cached Choice', visibility: 'list', supported_reasoning_levels: [{ effort: 'minimal' }],
  }] }))
  assert.deepEqual((await app.inject({ url: codexEndpoint })).json().models, [{ id: 'fixture-cached', name: 'Cached Choice', efforts: ['minimal'] }])
  fs.writeFileSync(codeCache, 'partial write')
  assert.deepEqual((await app.inject({ url: codexEndpoint })).json().models[0].efforts, ['low', 'high', 'ultra'])
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

test('Codex revalidates per-model defaults and applies supported chat and visual effort overrides', { skip: process.platform === 'win32' }, async t => {
  const { app, config, projectId, codeCache, readCalls } = await setup(t)
  saveAIModePreference(config, 'codex', 'fixture-codex', { 'fixture-codex': 'high' })
  assert.deepEqual((await app.inject({ url: codexEndpoint })).json().effortDefaults, { 'fixture-codex': 'high' })

  const chat = (model?: string, effort?: string) => app.inject({
    method: 'POST', url: '/api/chat', payload: { project_id: projectId, message: 'testing', model, effort },
  })
  assert.equal((await chat()).statusCode, 200)
  assert.equal((await chat('fixture-codex', '')).statusCode, 200)
  assert.equal((await chat('fixture-codex', 'low')).statusCode, 200)
  assert.equal((await chat('fixture-codex', 'ultra')).statusCode, 200)
  assert.equal((await chat('fixture-codex', 'unsupported')).statusCode, 400)
  assert.equal((await chat('fixture-codex', 'medium')).statusCode, 400)
  assert.equal((await chat('', 'high')).statusCode, 400)
  assert.equal((await chat('fixture-custom', 'high')).statusCode, 400)

  const url = `/api/projects/${projectId}/visuals`
  const payload = { request_id: randomUUID(), question: 'Testing', agent: 'codex', model: 'fixture-codex' }
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...payload, effort: '--config' } })).statusCode, 400)
  const start = await app.inject({ method: 'POST', url, payload: { ...payload, effort: 'low' } })
  assert.equal(start.statusCode, 202)
  const visualUrl = `${url}/${start.json().id}`
  let status = ''
  for (let i = 0; i < 120; i++) {
    status = (await app.inject({ url: visualUrl })).json().status
    if (status === 'complete' || status === 'failed') break
    await setTimeout(25)
  }
  assert.equal(status, 'complete')

  // The installed catalog can change while the app and its saved preferences stay open.
  fs.writeFileSync(codeCache, JSON.stringify({ models: [{ ...bundled.models[0], supported_reasoning_levels: [{ effort: 'low' }] }] }))
  assert.equal((await chat()).statusCode, 200)
  assert.equal((await chat('fixture-codex', 'high')).statusCode, 400)
  assert.deepEqual(readCalls(), ['high', undefined, 'low', 'ultra', 'low', undefined].map(effort => ({
    agent: 'codex', model: 'fixture-codex', ...(effort ? { effort } : {}),
  })))
})

test('Claude CLI effort requires an advertised level and known support for the selected model', { skip: process.platform === 'win32' }, async t => {
  const { app, config, readCalls } = await setup(t, '  --effort <level>  Effort level (low, medium, high, max)', '2.1.280')
  const { models } = (await app.inject({ url: claudeEndpoint })).json()
  assert.deepEqual(models.find((entry: { id: string }) => entry.id === 'opus')?.efforts, ['low', 'medium', 'high', 'max'])
  assert.equal(models.find((entry: { id: string }) => entry.id === 'haiku')?.efforts, undefined)
  const service = new AgentService(config)
  await service.invoke('known model', 'claude', 'opus', { effort: 'max' })
  await assert.rejects(service.invoke('unknown model', 'claude', 'alias/custom-model', { effort: 'high' }), { code: 'UNSUPPORTED_EFFORT' })
  await assert.rejects(service.invoke('unknown CLI level', 'claude', 'opus', { effort: 'xhigh' }), { code: 'UNSUPPORTED_EFFORT' })
  assert.deepEqual(readCalls(), [{ agent: 'claude', model: 'opus', effort: 'max' }])
})


test('Claude leaves effort to startup configuration when its effort environment variable is set', { skip: process.platform === 'win32' }, async t => {
  const { app, config, readCalls } = await setup(t, '  --effort <level>  Effort level (low, medium, high, xhigh, max)', '2.1.331')
  const previous = process.env.CLAUDE_CODE_EFFORT_LEVEL
  process.env.CLAUDE_CODE_EFFORT_LEVEL = 'high'
  t.after(() => {
    if (previous === undefined) delete process.env.CLAUDE_CODE_EFFORT_LEVEL
    else process.env.CLAUDE_CODE_EFFORT_LEVEL = previous
  })
  const { models } = (await app.inject({ url: claudeEndpoint })).json()
  assert.deepEqual(models.find((entry: { id: string }) => entry.id === 'opus'), { id: 'opus', name: 'Opus' })
  saveAIModePreference(config, 'claude', 'opus', { opus: 'max' })
  const service = new AgentService(config)
  await service.invoke('inherited', 'claude')
  await assert.rejects(service.invoke('explicit', 'claude', 'opus', { effort: 'max' }), { code: 'UNSUPPORTED_EFFORT' })
  assert.deepEqual(readCalls(), [{ agent: 'claude', model: 'opus' }])
})
