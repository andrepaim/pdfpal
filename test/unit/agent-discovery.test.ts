import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { agentCandidates, applyLoginShellPath, loginShell, loginShellPathCommand, mergePathEntries, parseAuth, parseLoginShellPath, refreshMacPath, runProbe, usesNativeDiscovery } from '../../src/core/agent-discovery.js'

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

// Mac (MAC-03). Self-contained: desktop/scripts/stage.mjs runs this file with plain Node on the target
// platform and rewrites only the first core import path, so keep a single core import above.
test('macOS discovery adds Homebrew and the native installer location after absolute PATH entries', () => {
  const found = agentCandidates('claude', { platform: 'darwin', home: '/Users/reader', env: { PATH: '/usr/bin:relative:/opt/homebrew/bin:/bin' } })
  assert.deepEqual(found, ['/usr/bin/claude', '/opt/homebrew/bin/claude', '/bin/claude', '/usr/local/bin/claude', '/Users/reader/.local/bin/claude'])
  assert.deepEqual(agentCandidates('codex', { platform: 'darwin', home: '/Users/reader', env: {} }), ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', '/Users/reader/.local/bin/codex'])
  assert.deepEqual(agentCandidates('codex', { platform: 'darwin', binary: '/Applications/Tools/codex' }), ['/Applications/Tools/codex'])
})

test('Linux discovery locations are unchanged', () => {
  assert.deepEqual(agentCandidates('claude', { platform: 'linux', home: '/home/reader', env: { PATH: '/usr/bin:bin' } }), ['/usr/bin/claude', '/home/reader/.local/bin/claude'])
})

test('native discovery runs on Windows and only inside the macOS desktop backend', () => {
  assert.equal(usesNativeDiscovery({ platform: 'win32', env: {} }), true)
  assert.equal(usesNativeDiscovery({ platform: 'win32', env: { PDFPAL_APP_VERSION: '2.8.0' } }), true)
  assert.equal(usesNativeDiscovery({ platform: 'darwin', env: { PDFPAL_APP_VERSION: '2.8.0' } }), true)
  assert.equal(usesNativeDiscovery({ platform: 'darwin', env: {} }), false)
  assert.equal(usesNativeDiscovery({ platform: 'darwin', env: { PDFPAL_APP_VERSION: '' } }), false)
  assert.equal(usesNativeDiscovery({ platform: 'linux', env: { PDFPAL_APP_VERSION: '2.8.0' } }), false)
})

test('the login shell is an existing absolute $SHELL, otherwise zsh', () => {
  // A Windows drive path is not a POSIX absolute path, so this part needs a POSIX host.
  if (process.platform !== 'win32') assert.equal(loginShell({ SHELL: process.execPath }), process.execPath)
  assert.equal(loginShell({}), '/bin/zsh')
  assert.equal(loginShell({ SHELL: 'zsh' }), '/bin/zsh')
  assert.equal(loginShell({ SHELL: '/missing/pdfpal-shell' }), '/bin/zsh')
  assert.equal(loginShell({ SHELL: path.dirname(process.execPath) }), '/bin/zsh')
})

test('login-shell PATH parsing reads only between the markers', () => {
  const nonce = 'abc123', begin = 'PDFPAL-LOGIN-PATH-BEGIN-abc123\n', end = 'PDFPAL-LOGIN-PATH-END-abc123'
  assert.ok(!loginShellPathCommand(nonce).includes(begin.trim()), 'an echoed command line must not contain a complete marker')
  // Normal zsh.
  assert.deepEqual(parseLoginShellPath(`${begin}/Users/reader/.local/bin:/opt/homebrew/bin:/usr/bin:/bin\n${end}`, nonce),
    ['/Users/reader/.local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'])
  // Profile output before and after, a fake marker for another run, relative and duplicate entries.
  assert.deepEqual(parseLoginShellPath(`Last login: today\nPATH=/evil PDFPAL-LOGIN-PATH-BEGIN-other\n/evil\nnvm: using node 22${begin}/a b/bin:.:bin:/usr/bin:/usr/bin\r\n${end}\nbye /tmp:/x\n`, nonce),
    ['/a b/bin', '/usr/bin'])
  // fish: greeting, and the exported PATH is colon-joined even though $PATH is a list there.
  assert.deepEqual(parseLoginShellPath(`Welcome to fish, the friendly interactive shell\n${begin}/opt/homebrew/bin:/usr/bin:/bin\n${end}\n`, nonce),
    ['/opt/homebrew/bin', '/usr/bin', '/bin'])
  // Empty, missing markers, or only relative entries.
  for (const output of [`${begin}\n${end}`, '', 'noise only', `${begin}/usr/bin`, `${end}${begin}/usr/bin`, `${begin}relative:bin\n${end}`, `${begin.replace(nonce, 'zzz')}/usr/bin\n${end}`])
    assert.equal(parseLoginShellPath(output, nonce), undefined, JSON.stringify(output))
})

test('merged PATH puts shell entries first, keeps absolute entries once', () => {
  assert.equal(mergePathEntries(['/opt/homebrew/bin', '/usr/bin'], '/usr/bin:/bin:relative::/usr/sbin'), '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin')
  assert.equal(mergePathEntries([], undefined), '')
})

function fakeShell(directory: string, name: string, body: string): string {
  const file = path.join(directory, name)
  fs.writeFileSync(file, `#!/bin/sh\n[ "$1" = -l ] && [ "$2" = -i ] && [ "$3" = -c ] || exit 9\n${body}\n`, { mode: 0o700 })
  return file
}

test('login-shell PATH merges on success and keeps PATH on any failure', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-login-shell-'))
  try {
    const noisy = fakeShell(directory, 'noisy', 'echo "profile says hello"; printf "no newline"; PATH=/opt/login/bin:/usr/bin:/bin; export PATH; /bin/sh -c "$4"; echo "goodbye /tmp:/x"')
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin:/usr/sbin' }
    assert.equal(await applyLoginShellPath({ shell: noisy, env }), true)
    assert.equal(env.PATH, '/opt/login/bin:/usr/bin:/bin:/usr/sbin')

    const failures: Array<[string, Parameters<typeof applyLoginShellPath>[0]]> = [
      ['slow', { shell: fakeShell(directory, 'slow', 'sleep 30'), timeoutMs: 200 }],
      ['no markers', { shell: fakeShell(directory, 'silent', 'echo /usr/local/bin; exit 0') }],
      ['empty PATH', { shell: fakeShell(directory, 'empty', 'unset PATH; /bin/sh -c "$4"') }],
      ['exit in profile', { shell: fakeShell(directory, 'exits', 'exit 1') }],
      ['flooding', { shell: fakeShell(directory, 'flood', 'yes noise') }],
      ['missing', { shell: path.join(directory, 'missing-shell') }],
    ]
    for (const [label, options] of failures) {
      const unchanged: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' }
      assert.equal(await applyLoginShellPath({ ...options, env: unchanged }), false, label)
      assert.equal(unchanged.PATH, '/usr/bin:/bin', label)
    }
    const controller = new AbortController(), cancelled: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    const pending = applyLoginShellPath({ shell: fakeShell(directory, 'waits', 'sleep 30'), env: cancelled, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    assert.equal(await pending, 'cancelled')
    assert.equal(cancelled.PATH, '/usr/bin')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('assistant processes inherit the merged PATH', { skip: process.platform === 'win32' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-login-shell-'))
  const original = process.env.PATH
  try {
    const shell = fakeShell(directory, 'login', 'PATH=/opt/pdfpal-login/bin:$PATH; export PATH; /bin/sh -c "$4"')
    assert.equal(await applyLoginShellPath({ shell }), true)
    const child = await runProbe('/usr/bin/printenv', ['PATH'])
    assert.equal(child.stdout.split(':')[0], '/opt/pdfpal-login/bin')
  } finally { process.env.PATH = original; fs.rmSync(directory, { recursive: true, force: true }) }
})

test('login-shell PATH refresh is a no-op outside the macOS desktop backend', { skip: usesNativeDiscovery() && process.platform === 'darwin' }, async () => {
  const before = process.env.PATH
  await refreshMacPath(undefined, { force: true })
  await refreshMacPath()
  assert.equal(process.env.PATH, before)
})
