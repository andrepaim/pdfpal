import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { AgentService, providerError } from '../../src/core/agents.js'
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
  assert.deepEqual(fs.readFileSync(argsPath, 'utf8').trim().split(/\r?\n/), ['--print', '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--model', 'claude-sonnet'])
})

function executable(config: ReturnType<typeof testConfig>, name: string, body: string): string {
  const file = path.join(config.dataDir, name)
  const version = name.startsWith('codex') ? 'codex-cli 0.164.0' : name.startsWith('opencode') ? '1.2.3' : '2.1.0 (Claude Code)'
  fs.writeFileSync(file, `#!/bin/sh\ncase "$*" in\n  --version) printf '%s\\n' '${version}'; exit 0;;\n  *--help*) printf '%s\\n' '--tools --strict-mcp-config --disallowedTools --ignore-user-config --ignore-rules --ephemeral --disable --agent --format'; exit 0;;\n  'auth status'|'login status') printf '%s\\n' 'Not logged in'; exit 1;;\nesac\n${body}\n`, { mode: 0o700 })
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

test('shutdown rejects late inference and discovery until the service resumes', async () => {
  const service = new AgentService(testConfig())
  AgentService.stopAccepting()
  try {
    assert.deepEqual(await service.inspect(), [])
    await assert.rejects(service.invoke('late request'), { code: 'AGENT_CANCELLED' })
    assert.equal(AgentService.activeCount, 0)
  } finally { AgentService.resume() }
})

test('Codex and OpenCode output adapters parse successful responses', async () => {
  const config = testConfig()
  config.codexBin = executable(config, 'codex', "cat >/dev/null; printf 'codex answer'")
  config.opencodeBin = executable(config, 'opencode', `printf '%s\\n' '{"type":"text","part":{"type":"text","text":"open answer"}}'`)
  assert.equal(await new AgentService(config).invoke('prompt', 'codex', 'model-x'), 'codex answer')
  assert.equal(await new AgentService(config).invoke('prompt', 'opencode', 'model-x'), 'open answer')
})

test('Linux inspection probes all providers without reading account files or running inference', async () => {
  const config = testConfig()
  try {
    config.claudeBin = executable(config, 'claude', 'exit 99')
    config.codexBin = executable(config, 'codex', 'exit 99')
    config.opencodeBin = executable(config, 'opencode', 'exit 99')
    const agents = await new AgentService(config).inspect()
    assert.equal(agents.length, 3)
    for (const agent of agents) {
      assert.equal(agent.available, true)
      assert.equal('state' in agent && agent.state, 'installed')
      assert.equal('version' in agent && typeof agent.version, 'string')
    }
    assert.equal('auth' in agents[2]! && agents[2].auth, 'unknown')
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})

test('assistant invocation uses an isolated cwd and removes OpenCode permissions afterward', async () => {
  const config = testConfig(), cwdPath = path.join(config.dataDir, 'cwd'), permissionPath = path.join(config.dataDir, 'permissions')
  try {
    config.opencodeBin = executable(config, 'opencode', `pwd > '${cwdPath}'; cat .opencode/agent/pdfpal.md > '${permissionPath}'; printf '%s\\n' '{"type":"text","part":{"type":"text","text":"answer"}}'`)
    assert.equal(await new AgentService(config).invoke('prompt', 'opencode'), 'answer')
    const cwd = fs.readFileSync(cwdPath, 'utf8').trim()
    assert.notEqual(cwd, process.cwd())
    assert.notEqual(cwd, config.dataDir)
    assert.equal(fs.existsSync(cwd), false)
    assert.match(fs.readFileSync(permissionPath, 'utf8'), /permissions: \[\]/)
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
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
    '--ephemeral', '--ignore-user-config', '--ignore-rules', '--disable', 'shell_tool', '--config', 'web_search="disabled"',
    '-',
  ])
})

test('nonzero agent exits become AGENT_FAILED errors', async () => {
  const config = testConfig()
  config.claudeBin = executable(config, 'failed-agent', "printf 'failure' >&2; exit 2")
  await assert.rejects(() => new AgentService(config).invoke('prompt'),
    (error: unknown) => error instanceof PdfpalError && error.code === 'AGENT_FAILED' && !/failure/.test(error.message))
})

test('an agent error printed to stdout is not accepted as an answer', async () => {
  const config = testConfig()
  try {
    config.claudeBin = executable(config, 'expired-agent', "printf 'Failed to authenticate: OAuth session expired and could not be refreshed'; exit 1")
    await assert.rejects(() => new AgentService(config).invoke('prompt'),
      (error: unknown) => error instanceof PdfpalError && error.code === 'AGENT_SIGN_IN' && !/OAuth session expired/.test(error.message))
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})

test('provider failures return useful typed recovery without leaking output', () => {
  for (const [text, code] of [['401 OAuth expired token=SECRET', 'AGENT_SIGN_IN'], ['429 quota SECRET', 'AGENT_LIMIT'], ['ECONNRESET SECRET', 'AGENT_OFFLINE'], ['sandbox setup SECRET', 'AGENT_SETUP'], ['unknown failure SECRET', 'AGENT_FAILED']]) {
    const error = providerError(text!)
    assert.equal(error.code, code)
    assert.ok(!error.message.includes('SECRET'))
  }
})

test('cancelling a connection test preserves an unrelated request', async () => {
  const config = testConfig()
  config.claudeBin = executable(config, 'test-agent', 'sleep 1; printf answer')
  const controller = new AbortController()
  const testRequest = new AgentService(config).invoke('fixed test', 'claude', '', { signal: controller.signal })
  const rejected = assert.rejects(testRequest, { code: 'AGENT_CANCELLED' })
  const other = new AgentService(config).invoke('other request')
  controller.abort()
  await rejected
  assert.equal(await other, 'answer')
  fs.rmSync(config.dataDir, { recursive: true, force: true })
})
