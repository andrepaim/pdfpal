import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cleanup, testConfig } from '../helpers/test-utils.js'
import { loadConfig } from '../../src/core/config.js'

test('loads and imports legacy config.env', () => {
  const initial = testConfig()
  fs.writeFileSync(`${initial.dataDir}/config.env`, 'PDFPAL_PORT=9123\nPDFPAL_AGENT=codex\nPDFPAL_MODEL=test-model\n')
  const loaded = loadConfig({ dataDir: initial.dataDir })
  try {
    assert.equal(loaded.port, 9123)
    assert.equal(loaded.agent, 'codex')
    assert.equal(loaded.model, 'test-model')
    assert.ok(fs.existsSync(`${initial.dataDir}/config.json`))
  } finally { cleanup(initial, { close() {} } as never) }
})

test('explicit configuration overrides environment values', () => {
  const initial = testConfig()
  const previous = process.env.PDFPAL_PORT
  process.env.PDFPAL_PORT = '9001'
  try { assert.equal(loadConfig({ dataDir: initial.dataDir, port: 9002 }).port, 9002) }
  finally { if (previous === undefined) delete process.env.PDFPAL_PORT; else process.env.PDFPAL_PORT = previous; cleanup(initial, { close() {} } as never) }
})
