import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cleanup, testConfig } from '../helpers/test-utils.js'
import path from 'node:path'
import { defaultAgentModel, loadConfig, saveAIModePreference, saveAgentBinary, saveContextualDefinitionsPreference } from '../../src/core/config.js'

test('loads and imports legacy config.env', () => {
  const initial = testConfig()
  fs.writeFileSync(`${initial.dataDir}/config.env`, 'PDFPAL_PORT=9123\nPDFPAL_AGENT=codex\nPDFPAL_MODEL=test-model\nTAVILY_API_KEY=obsolete\n')
  const loaded = loadConfig({ dataDir: initial.dataDir })
  try {
    assert.equal(loaded.port, 9123)
    assert.equal(loaded.agent, 'codex')
    assert.equal(loaded.model, 'test-model')
    assert.ok(fs.existsSync(`${initial.dataDir}/config.json`))
    assert.equal(Object.hasOwn(loaded, 'tavilyApiKey'), false)
    assert.equal(JSON.parse(fs.readFileSync(`${initial.dataDir}/config.json`, 'utf8')).tavily_api_key, undefined)
  } finally { cleanup(initial, { close() {} } as never) }
})

test('does not load Tavily from the environment', () => {
  const initial = testConfig()
  const previous = process.env.TAVILY_API_KEY
  process.env.TAVILY_API_KEY = 'obsolete'
  try {
    const loaded = loadConfig({ dataDir: initial.dataDir })
    assert.equal(Object.hasOwn(loaded, 'tavilyApiKey'), false)
  } finally {
    if (previous === undefined) delete process.env.TAVILY_API_KEY
    else process.env.TAVILY_API_KEY = previous
    cleanup(initial, { close() {} } as never)
  }
})

test('explicit configuration overrides environment values', () => {
  const initial = testConfig()
  const previous = process.env.PDFPAL_PORT
  process.env.PDFPAL_PORT = '9001'
  try { assert.equal(loadConfig({ dataDir: initial.dataDir, port: 9002 }).port, 9002) }
  finally { if (previous === undefined) delete process.env.PDFPAL_PORT; else process.env.PDFPAL_PORT = previous; cleanup(initial, { close() {} } as never) }
})

test('choosing an assistant executable preserves unrelated configuration and environment precedence', () => {
  const initial = testConfig(), previous = process.env.CODEX_BIN
  try {
    delete process.env.CODEX_BIN
    fs.writeFileSync(`${initial.dataDir}/config.json`, JSON.stringify({ agent: 'claude', extra: 'keep' }))
    saveAgentBinary(initial, 'codex', '/chosen/codex')
    assert.equal(loadConfig({ dataDir: initial.dataDir }).codexBin, '/chosen/codex')
    assert.equal(JSON.parse(fs.readFileSync(`${initial.dataDir}/config.json`, 'utf8')).extra, 'keep')
    process.env.CODEX_BIN = '/fixed/codex'
    assert.throws(() => saveAgentBinary(initial, 'codex', '/different/codex'))
    assert.equal(loadConfig({ dataDir: initial.dataDir }).codexBin, '/fixed/codex')
  } finally { if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous; cleanup(initial, { close() {} } as never) }
})

test('saving an assistant and model together preserves other preferences and supports Automatic', () => {
  const initial = testConfig(), previous = process.env.PDFPAL_AGENT
  const filename = path.join(initial.dataDir, 'config.json')
  const stored = { agent: 'claude', model: 'legacy-model', agent_models: { claude: 'sonnet' }, extra: 'keep' }
  try {
    delete process.env.PDFPAL_AGENT
    fs.writeFileSync(filename, JSON.stringify(stored))
    const config = loadConfig({ dataDir: initial.dataDir, model: stored.model })
    assert.equal(defaultAgentModel(config, 'codex'), 'legacy-model')

    assert.equal(saveAIModePreference(config, 'codex', ' fixture/custom:1 '), 'codex')
    assert.equal(config.agent, 'codex')
    assert.equal(defaultAgentModel(config, 'codex'), 'fixture/custom:1')
    assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), { ...stored, ai_mode: 'agent', agent: 'codex', agent_models: { claude: 'sonnet', codex: 'fixture/custom:1' } })

    saveAIModePreference(config, 'codex', '')
    saveAIModePreference(config, 'claude')
    const restarted = loadConfig({ dataDir: initial.dataDir, model: stored.model })
    assert.equal(restarted.agent, 'claude')
    assert.equal(defaultAgentModel(restarted, 'claude'), 'sonnet')
    assert.equal(defaultAgentModel(restarted, 'codex'), '')
  } finally {
    if (previous === undefined) delete process.env.PDFPAL_AGENT
    else process.env.PDFPAL_AGENT = previous
    cleanup(initial, { close() {} } as never)
  }
})

test('invalid or environment-blocked assistant and model changes leave stored and running settings intact', () => {
  const config = testConfig(), previous = process.env.PDFPAL_AGENT
  const filename = path.join(config.dataDir, 'config.json')
  const stored = JSON.stringify({ agent: 'claude', agent_models: { claude: 'sonnet' } })
  const before = structuredClone(config)
  try {
    delete process.env.PDFPAL_AGENT
    fs.writeFileSync(filename, stored)
    assert.throws(() => saveAIModePreference(config, 'codex', '--config'), /valid model ID/)
    assert.throws(() => saveAIModePreference(config, 'chatgpt', 'model'), /Model selection is unavailable/)
    assert.throws(() => saveAIModePreference(config, 'opencode', ''), /Model selection is unavailable/)
    process.env.PDFPAL_AGENT = 'claude'
    assert.throws(() => saveAIModePreference(config, 'codex', 'fixture-model'), /PDFPAL_AGENT/)
    assert.equal(fs.readFileSync(filename, 'utf8'), stored)
    assert.deepEqual(config, before)
  } finally {
    if (previous === undefined) delete process.env.PDFPAL_AGENT
    else process.env.PDFPAL_AGENT = previous
    cleanup(config, { close() {} } as never)
  }
})

test('contextual definitions are off by default and enabled by config.json or the environment', () => {
  const initial = testConfig(), previous = { flag: process.env.PDFPAL_CONTEXTUAL_DEFINITIONS, dir: process.env.PDFPAL_SENSE_MODEL_DIR, runtime: process.env.PDFPAL_SENSE_RUNTIME_DIR, budget: process.env.PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS }
  try {
    delete process.env.PDFPAL_CONTEXTUAL_DEFINITIONS; delete process.env.PDFPAL_SENSE_MODEL_DIR; delete process.env.PDFPAL_SENSE_RUNTIME_DIR; delete process.env.PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS
    const defaults = loadConfig({ dataDir: initial.dataDir })
    assert.equal(defaults.contextualDefinitions, false)
    assert.equal(defaults.senseModelDir, path.join(initial.dataDir, 'models', 'ettin-150m-wsd-int8'))
    assert.equal(defaults.senseRuntimeDir, path.join(initial.dataDir, 'models', 'sense-runtime'))
    assert.equal(defaults.contextualDefinitionsBudgetMs, 120)

    fs.writeFileSync(`${initial.dataDir}/config.json`, JSON.stringify({ contextual_definitions: true, sense_model_dir: '/models/ettin', sense_runtime_dir: '/models/runtime' }))
    assert.equal(loadConfig({ dataDir: initial.dataDir }).senseRuntimeDir, '/models/runtime')
    assert.equal(loadConfig({ dataDir: initial.dataDir }).contextualDefinitions, true)
    assert.equal(loadConfig({ dataDir: initial.dataDir }).senseModelDir, '/models/ettin')

    process.env.PDFPAL_CONTEXTUAL_DEFINITIONS = '0'
    assert.equal(loadConfig({ dataDir: initial.dataDir }).contextualDefinitions, false, 'the environment overrides the file')
    process.env.PDFPAL_CONTEXTUAL_DEFINITIONS = '1'
    process.env.PDFPAL_SENSE_MODEL_DIR = '/elsewhere'
    fs.writeFileSync(`${initial.dataDir}/config.json`, '{}')
    assert.equal(loadConfig({ dataDir: initial.dataDir }).contextualDefinitions, true)
    assert.equal(loadConfig({ dataDir: initial.dataDir }).senseModelDir, '/elsewhere')
    fs.writeFileSync(`${initial.dataDir}/config.json`, JSON.stringify({ contextual_definitions_budget_ms: 200 }))
    assert.equal(loadConfig({ dataDir: initial.dataDir }).contextualDefinitionsBudgetMs, 200)
    process.env.PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS = '5000'
    assert.equal(loadConfig({ dataDir: initial.dataDir }).contextualDefinitionsBudgetMs, 1000, 'kept within bounds')
    process.env.PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS = 'soon'
    assert.equal(loadConfig({ dataDir: initial.dataDir }).contextualDefinitionsBudgetMs, 200)
    delete process.env.PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS
    process.env.PDFPAL_CONTEXTUAL_DEFINITIONS = 'perhaps'
    assert.equal(loadConfig({ dataDir: initial.dataDir }).contextualDefinitions, false, 'an unrecognised value stays off')
  } finally {
    for (const [key, value] of [['PDFPAL_CONTEXTUAL_DEFINITIONS', previous.flag], ['PDFPAL_SENSE_MODEL_DIR', previous.dir], ['PDFPAL_SENSE_RUNTIME_DIR', previous.runtime], ['PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS', previous.budget]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    cleanup(initial, { close() {} } as never)
  }
})

test('saving the contextual definitions preference keeps the rest of config.json', () => {
  const initial = testConfig()
  try {
    fs.writeFileSync(`${initial.dataDir}/config.json`, JSON.stringify({ agent: 'codex', extra: 'keep' }))
    saveContextualDefinitionsPreference(initial, true)
    assert.deepEqual(JSON.parse(fs.readFileSync(`${initial.dataDir}/config.json`, 'utf8')), { agent: 'codex', extra: 'keep', contextual_definitions: true })
    saveContextualDefinitionsPreference(initial, false)
    assert.equal(JSON.parse(fs.readFileSync(`${initial.dataDir}/config.json`, 'utf8')).contextual_definitions, false)
  } finally { cleanup(initial, { close() {} } as never) }
})
