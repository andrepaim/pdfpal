// Runs only against the deterministic native Windows fixture, never personal accounts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverAgent, refreshWindowsPath } from '../dist/core/agent-discovery.js'
import { AgentService } from '../dist/core/agents.js'
import { loadConfig } from '../dist/core/config.js'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-setup-fixtures-'))
try {
  assert.equal(process.platform, 'win32')
  assert.ok(process.env.CLAUDE_BIN?.endsWith('fixture-provider.exe'))
  const config = loadConfig({ dataDir: directory })
  for (const auth of ['signed_out', 'api', 'unknown', 'account']) {
    process.env.PDFPAL_FIXTURE_MODE = auth
    const found = await discoverAgent('claude', config.claudeBin)
    assert.equal(found.state, 'installed'); assert.equal(found.auth, auth)
    assert.ok(!JSON.stringify({ auth: found.auth }).includes('SECRET'))
  }
  process.env.PDFPAL_FIXTURE_MODE = 'unsupported'
  assert.equal((await discoverAgent('claude', config.claudeBin)).state, 'unsupported')
  assert.equal((await discoverAgent('claude', path.join(directory, 'missing.exe'))).state, 'missing')
  process.env.PDFPAL_FIXTURE_MODE = 'offline'
  await assert.rejects(new AgentService(config).invoke('fixed fixture test'), error => error.code === 'AGENT_OFFLINE' && !error.message.includes('SECRET'))
  const original = process.env.PATH
  process.env.PATH = path.join(process.env.SystemRoot, 'System32')
  await refreshWindowsPath()
  assert.ok(process.env.PATH.split(';').includes(path.join(process.env.SystemRoot, 'System32')))
  assert.ok(process.env.PATH.length >= path.join(process.env.SystemRoot, 'System32').length)
  process.env.PATH = original
  console.log('Native Windows setup fixtures passed: account, API, signed out, unknown, missing, unsupported, offline, refreshed PATH.')
} finally { delete process.env.PDFPAL_FIXTURE_MODE; fs.rmSync(directory, { recursive: true, force: true }) }
