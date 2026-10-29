import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { AgentService } from '../../src/core/agents.js'
import { PdfpalError } from '../../src/core/types.js'
import { testConfig } from '../helpers/test-utils.js'

test('agent listing reports configured absolute binary availability', () => {
  const config = testConfig()
  config.claudeBin = '/bin/echo'
  const agents = new AgentService(config).list()
  assert.equal(agents.find(agent => agent.id === 'claude')?.available, true)
})

test('missing agent binary produces a typed error', async () => {
  const config = testConfig()
  config.claudeBin = '/does/not/exist'
  await assert.rejects(() => new AgentService(config).invoke('hello'), (error: unknown) => error instanceof PdfpalError && error.code === 'AGENT_NOT_FOUND')
})

test('Claude receives the configured model', async () => {
  const config = testConfig()
  const argsPath = path.join(config.dataDir, 'claude-args')
  config.model = 'claude-sonnet'
  config.claudeBin = executable(config, 'claude', `printf '%s\\n' "$@" > ${argsPath}; cat >/dev/null; printf 'claude answer'`)

  assert.equal(await new AgentService(config).invoke('prompt', 'claude'), 'claude answer')
  assert.deepEqual(fs.readFileSync(argsPath, 'utf8').trim().split(/\r?\n/), ['--print', '--model', 'claude-sonnet'])
})

function executable(config: ReturnType<typeof testConfig>, name: string, body: string): string {
  const file = path.join(config.dataDir, name)
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o700 })
  return file
}

test('shutdown cancels active agent requests and removes them from activity tracking', async () => {
  const config = testConfig()
  config.claudeBin = executable(config, 'slow-agent', 'sleep 60; printf answer')
  const request = new AgentService(config).invoke('prompt')
  const rejected = assert.rejects(request, { code: 'AGENT_CANCELLED' })
  assert.equal(AgentService.activeCount, 1)
  await new Promise(resolve => setTimeout(resolve, 50))
  await AgentService.cancelAll()
  await rejected
  assert.equal(AgentService.activeCount, 0)
  fs.rmSync(config.dataDir, { recursive: true, force: true })
})

test('Codex and OpenCode output adapters parse successful responses', async () => {
  const config = testConfig()
  config.codexBin = executable(config, 'codex', "cat >/dev/null; printf 'codex answer'")
  config.opencodeBin = executable(config, 'opencode', `printf '%s\\n' '{"type":"text","part":{"type":"text","text":"open answer"}}'`)
  assert.equal(await new AgentService(config).invoke('prompt', 'codex', 'model-x'), 'codex answer')
  assert.equal(await new AgentService(config).invoke('prompt', 'opencode', 'model-x'), 'open answer')
})

test('Codex global approval option precedes the exec subcommand', async () => {
  const config = testConfig()
  const argsPath = path.join(config.dataDir, 'codex-args')
  config.codexBin = executable(config, 'codex', `printf '%s\\n' "$@" > ${argsPath}; cat >/dev/null; printf 'codex answer'`)

  assert.equal(await new AgentService(config).invoke('prompt', 'codex'), 'codex answer')
  assert.deepEqual(fs.readFileSync(argsPath, 'utf8').trim().split(/\r?\n/), [
    '--ask-for-approval',
    'never',
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-',
  ])
})

test('nonzero agent exits become AGENT_FAILED errors', async () => {
  const config = testConfig()
  config.claudeBin = executable(config, 'failed-agent', "printf 'failure' >&2; exit 2")
  await assert.rejects(() => new AgentService(config).invoke('prompt'),
    (error: unknown) => error instanceof PdfpalError && error.code === 'AGENT_FAILED' && /failure/.test(error.message))
})

test('an agent error printed to stdout is not accepted as an answer', async () => {
  const config = testConfig()
  try {
    config.claudeBin = executable(config, 'expired-agent', "printf 'Failed to authenticate: OAuth session expired and could not be refreshed'; exit 1")
    await assert.rejects(() => new AgentService(config).invoke('prompt'),
      (error: unknown) => error instanceof PdfpalError && error.code === 'AGENT_FAILED' && /OAuth session expired/.test(error.message))
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})
