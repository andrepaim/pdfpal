// Real packaged Electron and authenticated CLI; every mutation uses temporary data.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const application = path.resolve(process.argv[2] ?? 'desktop/artifacts/linux-unpacked/pdfpal-desktop')
const receiptFile = path.resolve(process.argv[3] ?? 'desktop/evidence/linux-acceptance.json')
if (process.platform !== 'linux') throw new Error('Run packaged Linux acceptance on Linux')
if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('A display is required; run under dbus-run-session -- xvfb-run -a in CI')
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-linux-acceptance-'))
const profile = path.join(work, 'profile')
const env = { ...process.env, HOME: path.join(work, 'home'), XDG_CONFIG_HOME: path.join(work, 'config'),
  XDG_CACHE_HOME: path.join(work, 'cache'), XDG_DATA_HOME: path.join(work, 'data'),
  PDFPAL_DESKTOP_PROFILE: profile, PDFPAL_DATA_DIR: path.join(work, 'library'), PDFPAL_AGENT: 'claude' }
for (const key of ['PDFPAL_DB', 'PDFPAL_CLI_DESKTOP', 'PDFPAL_DESKTOP_BUILD', 'ELECTRON_RUN_AS_NODE', 'CLAUDE_BIN', 'CODEX_BIN', 'OPENCODE_BIN', 'PDFPAL_M0_LIVE', 'PDFPAL_M2_FAILURE_FIXTURE']) delete env[key]
// The renderer inspects provider availability. Never probe installed accounts.
for (const [key, name] of [['CLAUDE_BIN', 'claude'], ['CODEX_BIN', 'codex'], ['OPENCODE_BIN', 'opencode']]) env[key] = path.join(work, 'missing-providers', name)
for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'PDFPAL_DATA_DIR']) await fs.mkdir(env[key], { recursive: true })
const checks = []
let child, output = ''
const runApp = args => {
  child = spawn(application, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  output = ''
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
  return child
}
const finished = process => process.exitCode !== null || process.signalCode !== null
  ? Promise.resolve({ code: process.exitCode, signal: process.signalCode })
  : new Promise((resolve, reject) => { process.once('error', reject); process.once('exit', (code, signal) => resolve({ code, signal })) })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  const smokeReceipt = path.join(work, 'smoke.json')
  // This smoke verifies the shared reader, after onboarding. First-run setup has
  // its own acceptance flow; never let its modal obscure menu screenshots.
  await fs.mkdir(profile, { recursive: true })
  await fs.writeFile(path.join(profile, 'desktop.json'), JSON.stringify({ setupComplete: true }))
  env.PDFPAL_M0_RECEIPT = smokeReceipt
  const smoke = runApp(['--m0-smoke'])
  const timer = setTimeout(() => smoke.kill('SIGKILL'), 120000)
  let result
  try { result = await finished(smoke) } finally { clearTimeout(timer) }
  assert.equal(result.code, 0, `Packaged smoke failed: ${output}`)
  const smokeResult = JSON.parse(await fs.readFile(smokeReceipt, 'utf8'))
  assert.equal(smokeResult.status, 'passed')
  checks.push(...smokeResult.checks, 'packaged-renderer-mounted-normal-sandbox')
  delete env.PDFPAL_M0_RECEIPT
  // Normal startup and the CLI must agree on the default XDG profile.
  delete env.PDFPAL_DESKTOP_PROFILE
  // Let the OS select a temporary unoccupied port, then release it to the app.
  const listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  env.PDFPAL_PORT = String(listener.address().port)
  await new Promise(resolve => listener.close(resolve))
  runApp([])
  let ready = false
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Normal packaged startup exited (${child.exitCode ?? child.signalCode}): ${output}`)
    try { const response = await fetch(`http://127.0.0.1:${env.PDFPAL_PORT}/api/health`); if (response.ok) { ready = true; break } } catch {}
    await pause(100)
  }
  assert.ok(ready, `Normal packaged startup did not become ready: ${output}`)
  const cli = path.join(path.dirname(application), 'bin/pdfpal-desktop-cli')
  // PATH deliberately has only shell utilities and this launcher, with no Node.
  const bin = path.join(work, 'no-node-bin')
  await fs.mkdir(bin)
  for (const command of ['dirname', 'readlink']) await fs.symlink(`/usr/bin/${command}`, path.join(bin, command))
  await fs.symlink(cli, path.join(bin, 'pdfpal-desktop-cli'))
  const cliEnv = { ...env, PATH: bin }
  delete cliEnv.PDFPAL_DATA_DIR; delete cliEnv.PDFPAL_DB; delete cliEnv.PDFPAL_PORT
  const command = async args => JSON.parse((await exec(path.join(bin, 'pdfpal-desktop-cli'), ['--json', ...args], { env: cliEnv, timeout: 30000, maxBuffer: 1024 * 1024 })).stdout)
  const status = await command(['status'])
  assert.equal(status.transport, 'loopback-http'); assert.equal(status.libraryId, 'original')
  const doctor = await command(['doctor'])
  assert.equal(doctor.ok, true); assert.equal(doctor.pathReady, true); assert.equal(doctor.pathConflict, false)
  const libraries = await command(['library', 'list'])
  assert.equal(libraries.active, 'original'); assert.equal(libraries.libraries.length, 1)
  checks.push('normal-packaged-startup', 'authenticated-loopback-cli', 'bundled-cli-without-system-node', 'cli-doctor-and-xdg-profile', 'cli-library-list')
  const evidence = { status: 'passed', platform: process.platform, arch: process.arch,
    electron: smokeResult.electron, node: smokeResult.node, sandboxDisabled: false, checks,
    manualGates: ['Interactive native menus/tray on GNOME/Wayland', 'Unlocked Secret Service and real OAuth', 'Real assistant sign-in/generation', 'Clean-VM Debian install/upgrade/uninstall'],
    timestamp: new Date().toISOString() }
  await fs.mkdir(path.dirname(receiptFile), { recursive: true }); await fs.writeFile(receiptFile, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exit = finished(child); child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    await exit; clearTimeout(timer)
  }
  await fs.rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
