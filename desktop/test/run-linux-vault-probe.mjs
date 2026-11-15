// Optional real-Electron proof. Requires a display, dbus-run-session and
// gnome-keyring-daemon. All keyring/profile files and credentials are synthetic.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const script = fileURLToPath(import.meta.url)
const probe = fileURLToPath(new URL('./linux-vault-probe.mjs', import.meta.url))
const session = process.argv[2] === '--private-session'
const electron = path.resolve(process.argv[session ? 4 : 2] ?? '/tmp/pdfpal-linux-tooling/electron-v45.1.0/electron')

if (!session) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-keyring-proof-'))
  const receipt = path.resolve(process.argv[3] ?? 'desktop/evidence/linux-keyring.json')
  try {
    const env = { ...process.env, HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_RUNTIME_DIR: path.join(root, 'run'), PDFPAL_VAULT_TEST_ROOT: root }
    for (const key of ['DBUS_SESSION_BUS_ADDRESS', 'GNOME_KEYRING_CONTROL', 'SSH_AUTH_SOCK', 'ELECTRON_RUN_AS_NODE']) delete env[key]
    for (const key of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR']) await fs.mkdir(env[key], { mode: 0o700, recursive: true })
    await exec('dbus-run-session', ['--', process.execPath, script, '--private-session', root, electron], { env, timeout: 120000, maxBuffer: 1024 * 1024 })
    const checks = await Promise.all(['secure', 'fallback'].map(async mode => JSON.parse(await fs.readFile(path.join(root, mode + '.json'), 'utf8'))))
    const result = { status: 'passed', privateDbus: true, temporaryHomeAndXdg: true, checks }
    await fs.mkdir(path.dirname(receipt), { recursive: true }); await fs.writeFile(receipt, JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
} else {
  const root = process.argv[3]
  if (root !== process.env.PDFPAL_VAULT_TEST_ROOT || process.env.HOME !== path.join(root, 'home')) throw new Error('Temporary isolation is required')
  const control = path.join(root, 'run', 'keyring')
  await fs.mkdir(control, { mode: 0o700 })
  const daemon = spawn('gnome-keyring-daemon', ['--foreground', '--unlock', '--components=secrets', '--control-directory', control], { stdio: ['pipe', 'ignore', 'ignore'] })
  daemon.stdin.end('synthetic-pdfpal-acceptance-password')
  const daemonExit = new Promise(resolve => daemon.once('exit', resolve))
  try {
    let running = false
    for (let i = 0; i < 50 && !running; i++) {
      try { await exec('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetNameOwner', 'org.freedesktop.secrets'], { timeout: 1000 }); running = true }
      catch { await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    if (!running) throw new Error('The isolated Secret Service did not start')
    await exec(electron, ['--password-store=gnome-libsecret', probe], { env: { ...process.env, PDFPAL_VAULT_TEST_MODE: 'secure' }, timeout: 45000 })
    await exec(electron, ['--password-store=gnome-libsecret', probe], { env: { ...process.env, PDFPAL_VAULT_TEST_MODE: 'secure', PDFPAL_VAULT_TEST_EXISTING: '1' }, timeout: 45000 })
  } finally { daemon.kill('SIGTERM'); await daemonExit }
  await exec(electron, ['--password-store=basic', probe], { env: { ...process.env, PDFPAL_VAULT_TEST_MODE: 'fallback' }, timeout: 45000 })
}
