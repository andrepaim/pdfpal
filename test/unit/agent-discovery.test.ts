import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { agentCandidates, parseAuth, runProbe } from '../../src/core/agent-discovery.js'

test('Windows discovery excludes relative PATH entries and Claude Desktop aliases, includes native fallback', () => {
  const found = agentCandidates('claude', { platform: 'win32', home: 'C:\\Users\\Reader', env: {
    PATH: '.;relative;C:\\Tools;C:\\Users\\Reader\\AppData\\Local\\Microsoft\\WindowsApps',
  } })
  assert.deepEqual(found, ['C:\\Tools\\claude.exe', 'C:\\Users\\Reader\\.local\\bin\\claude.exe'])
})

test('an explicit broken installation remains authoritative', () => {
  assert.deepEqual(agentCandidates('claude', { binary: 'C:\\Missing\\claude.exe', platform: 'win32' }), ['C:\\Missing\\claude.exe'])
})

test('Codex npm native binary can be discovered without executing a shell launcher', () => {
  const found = agentCandidates('codex', { platform: 'win32', home: 'C:\\Users\\Reader', env: { PATH: 'C:\\npm' } })
  assert.ok(found.some(file => /codex-win32-.*\\vendor\\.*\\bin\\codex.exe$/.test(file)))
})

test('authentication distinguishes account, API, signed out and unknown without returning secrets', () => {
  const result = (stdout: string, code = 0) => ({ code, stdout, stderr: '' })
  assert.equal(parseAuth('claude', result('{"loggedIn":true,"authMethod":"claude.ai","token":"secret"}')), 'account')
  assert.equal(parseAuth('claude', result('{"authMethod":"api_key"}')), 'api')
  assert.equal(parseAuth('claude', result('{"loggedIn":false}', 1)), 'signed_out')
  assert.equal(parseAuth('claude', result('{"authMethod":"oauth_token"}')), 'unknown')
  assert.equal(parseAuth('claude', result('unexpected output', 1)), 'unknown')
  assert.equal(parseAuth('codex', result('Logged in using ChatGPT')), 'account')
  assert.equal(parseAuth('codex', result('Logged in using an API key - secret')), 'api')
  assert.equal(parseAuth('codex', result('Not logged in', 1)), 'signed_out')
})

test('process probes preserve stdin and arguments with shell metacharacters', async () => {
  const tricky = 'space & | % ! " café $()'
  const result = await runProbe(process.execPath, ['-e', 'process.stdin.on("data", d => process.stdout.write(process.argv[1] + d))', tricky], { stdin: tricky })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, tricky + tricky)
})

test('probes bound time and output and report spawn failures', async () => {
  assert.equal((await runProbe(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 })).failure, 'timeout')
  assert.equal((await runProbe(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxBytes: 100 })).failure, 'output_limit')
  assert.equal((await runProbe('/missing/pdfpal-agent', [])).failure, 'spawn')
})

test('a timed-out probe terminates its descendants and preserves an unrelated session', { timeout: 8000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-process-tree-'))
  const pidFile = path.join(directory, 'child.pid')
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  let descendant: number | undefined
  try {
    const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`
    const parentCode = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:'inherit'}); setInterval(() => {}, 1000)`
    const result = await runProbe(process.execPath, ['-e', parentCode], { timeoutMs: 1500 })
    assert.equal(result.failure, 'timeout')
    descendant = Number(fs.readFileSync(pidFile, 'utf8'))
    const alive = () => {
      try {
        process.kill(descendant!, 0)
        // A reaped Unix descendant can briefly remain as a zombie under WSL.
        if (process.platform === 'linux' && /State:\s+Z/.test(fs.readFileSync(`/proc/${descendant}/status`, 'utf8'))) return false
        return true
      } catch { return false }
    }
    for (let retry = 0; retry < 20 && alive(); retry++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(alive(), false, 'owned descendant survived the timeout')
    assert.equal(unrelated.exitCode, null)
    assert.equal(unrelated.signalCode, null)
  } finally {
    unrelated.kill()
    if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch {} }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 })
  }
})
