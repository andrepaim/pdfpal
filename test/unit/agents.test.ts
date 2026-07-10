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

function executable(config: ReturnType<typeof testConfig>, name: string, body: string): string {
  const file = path.join(config.dataDir, name)
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o700 })
  return file
}

test('Codex and OpenCode output adapters parse successful responses', async () => {
  const config = testConfig()
  config.codexBin = executable(config, 'codex', "cat >/dev/null; printf 'codex answer'")
  config.opencodeBin = executable(config, 'opencode', `printf '%s\\n' '{"type":"text","part":{"type":"text","text":"open answer"}}'`)
  assert.equal(await new AgentService(config).invoke('prompt', 'codex', 'model-x'), 'codex answer')
  assert.equal(await new AgentService(config).invoke('prompt', 'opencode', 'model-x'), 'open answer')
})

test('nonzero agent exits become AGENT_FAILED errors', async () => {
  const config = testConfig()
  config.claudeBin = executable(config, 'failed-agent', "printf 'failure' >&2; exit 2")
  await assert.rejects(() => new AgentService(config).invoke('prompt'),
    (error: unknown) => error instanceof PdfpalError && error.code === 'AGENT_FAILED' && /failure/.test(error.message))
})
