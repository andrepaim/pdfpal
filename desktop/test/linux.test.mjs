import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { closeToTray, initiallyHidden, linuxAutostart, linuxMenuTemplate } from '../src/linux.mjs'
import { startupArguments } from '../src/preferences.mjs'

test('Linux never depends on a potentially invisible tray for close or hidden startup', () => {
  const tray = { isDestroyed: () => false }
  for (const available of [undefined, tray, { isDestroyed: () => true }]) {
    assert.equal(closeToTray('linux', available), false)
    assert.equal(initiallyHidden('linux', { hidden: true, tray: available, setupComplete: true }), false)
  }
  assert.equal(closeToTray('win32', tray), true)
  assert.equal(closeToTray('win32', undefined), false)
  assert.equal(initiallyHidden('win32', { hidden: true, tray, setupComplete: true }), true)
  assert.equal(initiallyHidden('win32', { hidden: true, tray, setupComplete: false }), false)
})

test('native menus expose settings and recovery controls even without a tray', () => {
  const invoked = [], actions = new Proxy({}, { get: (_target, name) => (...args) => invoked.push([name, ...args]) })
  const items = state => linuxMenuTemplate(actions, state).flatMap(menu => menu.submenu)
  const ready = items({ ready: true, startup: false })
  for (const label of ['All projects', 'AI settings', 'Command line & ChatGPT', 'Cloud library', 'Backups & recovery', 'Privacy & diagnostics', 'Kindle extension', 'Software updates', 'Diagnostics', 'Third-party licenses', 'Quit pdfpal']) {
    const item = ready.find(item => item.label === label)
    assert.ok(item, label); assert.equal(item.enabled, true); item.click()
  }
  assert.ok(invoked.some(([action]) => action === 'cloud'))
  assert.ok(invoked.some(([action]) => action === 'backups'))
  const startup = ready.find(item => item.label === 'Start at login')
  assert.equal(startup.checked, false); startup.click({ checked: true }); assert.deepEqual(invoked.at(-1), ['startup', true])
  const failed = items({ ready: false, starting: false })
  for (const label of ['Retry service', 'Diagnostics', 'Quit pdfpal']) assert.equal(failed.find(item => item.label === label).enabled, true)
  assert.equal(items({ starting: true }).find(item => item.label === 'Retry service').enabled, false)
})

test('autostart defaults off, changes only the owned desktop entry, and removes reversibly', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-autostart-'))
  try {
    const startup = linuxAutostart({ home, env: { XDG_CONFIG_HOME: 'ignored-relative' } })
    assert.equal(startup.filename, path.join(home, '.config', 'autostart', 'io.pdfpal.desktop.desktop'))
    assert.equal(startup.enabled(), false); assert.deepEqual(fs.readdirSync(home), [])
    startup.set(true, '/opt/pdfpal/pdfpal-desktop', ['--profile=/tmp/Reader profile', '--port=8200'])
    assert.equal(startup.enabled(), true)
    if (process.platform !== 'win32') assert.equal(fs.statSync(startup.filename).mode & 0o777, 0o600)
    const other = path.join(path.dirname(startup.filename), 'other.desktop')
    fs.writeFileSync(other, 'keep me')
    const original = fs.readFileSync(startup.filename, 'utf8')
    assert.throws(() => startup.set(true, '/app', ['--profile=/tmp/unsafe\nHidden=true']), /control characters/)
    assert.equal(fs.readFileSync(startup.filename, 'utf8'), original)
    startup.set(false); startup.set(false)
    assert.equal(startup.enabled(), false); assert.equal(fs.readFileSync(other, 'utf8'), 'keep me')
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('Linux startup arguments preserve literal paths without Windows command-line quoting or hiding', () => {
  const startup = { dataDir: '/tmp/Library "100%"', dbPath: '/tmp/Library "100%"/pdfpal.db', port: 8200 }
  assert.deepEqual(startupArguments(startup, '/tmp/Settings', { platform: 'linux' }), [`--data-dir=${startup.dataDir}`, `--db=${startup.dbPath}`, '--port=8200', '--profile=/tmp/Settings'])
})

test('autostart refuses to replace or remove unmanaged entries and symlinks', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-autostart-owner-'))
  try {
    const startup = linuxAutostart({ home, env: {} })
    fs.mkdirSync(path.dirname(startup.filename), { recursive: true })
    fs.writeFileSync(startup.filename, '[Desktop Entry]\nExec=/some/other/app\n')
    assert.equal(startup.enabled(), false)
    for (const enabled of [true, false]) assert.throws(() => startup.set(enabled, '/app'), /unmanaged/)
    assert.match(fs.readFileSync(startup.filename, 'utf8'), /other\/app/)
    fs.rmSync(startup.filename)
    const target = path.join(home, 'unrelated'); fs.writeFileSync(target, 'X-pdfpal-Autostart=true\n')
    if (process.platform !== 'win32') {
      fs.symlinkSync(target, startup.filename)
      for (const enabled of [true, false]) assert.throws(() => startup.set(enabled, '/app'), /regular file/)
      assert.equal(fs.readFileSync(target, 'utf8'), 'X-pdfpal-Autostart=true\n')
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('GIO launches the actual desktop entry with literal hostile-looking arguments', { skip: process.platform !== 'linux' }, async t => {
  const python = '/usr/bin/python3'
  if (spawnSync(python, ['-c', 'from gi.repository import Gio; assert Gio.DesktopAppInfo']).status !== 0) return t.skip('GIO Python bindings unavailable')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-desktop-exec-'))
  try {
    const executable = path.join(home, 'app \' " %f $HOME `echo` \\ ; tool'), output = path.join(home, 'argv.json')
    fs.writeFileSync(executable, '#!/usr/bin/python3\nimport sys,json\nwith open(' + JSON.stringify(output) + ',"w") as f: json.dump(sys.argv[1:],f)\n', { mode: 0o700 })
    const args = ['--profile=' + path.join(home, 'quoted " apostrophe \' backslash \\ dollar $HOME `touch INJECTED` percent %f %u %% ; end'), '', '--data-dir=/tmp/ação']
    const startup = linuxAutostart({ home, env: {} }); startup.set(true, executable, args)
    const launched = spawnSync(python, ['-c', 'from gi.repository import Gio\nimport sys\na=Gio.DesktopAppInfo.new_from_filename(sys.argv[1])\nassert a is not None\nassert a.launch([],None)', startup.filename], { encoding: 'utf8' })
    assert.equal(launched.status, 0, launched.stderr)
    for (let i = 0; i < 100 && !fs.existsSync(output); i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), args)
    assert.equal(fs.existsSync(path.join(home, 'INJECTED')), false)
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})
