import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { provider, setupScript, trustedSender, diagnostics, recoveryMessage, cliLauncher, cliCommandLink, cliSetupCommand, cliLinkState, installCliLink, posixQuote } from '../src/setup.mjs'
import { execFileSync } from 'node:child_process'

test('the bundled CLI launcher and setup command keep the Windows form and use the app bundle and POSIX quoting on a Mac', () => {
  const windows = cliLauncher('win32', { execPath: 'C:\\Program Files\\pdfpal\\pdfpal.exe', resourcesPath: 'C:\\Program Files\\pdfpal\\resources' })
  assert.equal(windows, path.join(path.dirname('C:\\Program Files\\pdfpal\\pdfpal.exe'), 'bin', 'pdfpal.exe'))
  const launcher = "C:\\Reader's apps\\bin\\pdfpal.exe"
  assert.equal(cliSetupCommand('win32', launcher), "& '" + launcher.replaceAll("'", "''") + "' --desktop skill install")
  assert.equal(cliLauncher('darwin', { execPath: '/Applications/pdfpal.app/Contents/MacOS/pdfpal', resourcesPath: '/Applications/pdfpal.app/Contents/Resources' }), path.join('/Applications/pdfpal.app/Contents/Resources', 'bin', 'pdfpal'))
  assert.equal(cliCommandLink('/Users/reader'), path.join('/Users/reader', '.local', 'bin', 'pdfpal'))
  assert.equal(cliSetupCommand('darwin', '/Applications/pdfpal.app/Contents/Resources/bin/pdfpal'), "'/Applications/pdfpal.app/Contents/Resources/bin/pdfpal' --desktop skill install")
  assert.equal(posixQuote("/Volumes/Reader's $(touch x) `id` \"apps\"/pdfpal"), "'/Volumes/Reader'\\''s $(touch x) `id` \"apps\"/pdfpal'")
})

test('POSIX quoting survives a real shell unchanged', { skip: process.platform === 'win32' && 'needs /bin/sh' }, () => {
  for (const value of ["/Volumes/Reader's $(echo pwned) `id` \"apps\"/pdfpal", "a'b''c", '$HOME ~ * ? \\ ; | &', ''])
    assert.equal(execFileSync('/bin/sh', ['-c', `printf '%s' ${posixQuote(value)}`], { encoding: 'utf8' }), value)
})

test('the Mac command link is created once and never replaces another file or link', { skip: process.platform === 'win32' && 'creating symlinks needs extra privileges on Windows' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-link-'))
  try {
    const launcher = path.join(home, 'pdfpal.app', 'Contents', 'Resources', 'bin', 'pdfpal')
    fs.mkdirSync(path.dirname(launcher), { recursive: true }); fs.writeFileSync(launcher, '#!/bin/sh\n', { mode: 0o755 })
    const link = cliCommandLink(home)
    assert.equal(cliLinkState(link, launcher), 'missing')
    assert.deepEqual(installCliLink(link, launcher), { path: link, state: 'installed' })
    assert.equal(fs.readlinkSync(link), launcher)
    assert.deepEqual(installCliLink(link, launcher), { path: link, state: 'installed' }, 'installing again is a no-op')
    // A relative link to the same launcher counts as installed.
    fs.unlinkSync(link); fs.symlinkSync(path.relative(path.dirname(link), launcher), link)
    assert.equal(cliLinkState(link, launcher), 'installed')
    // A link to another pdfpal (for example the npm CLI) is reported, not replaced.
    const other = path.join(home, 'other-pdfpal'); fs.writeFileSync(other, 'other')
    fs.unlinkSync(link); fs.symlinkSync(other, link)
    assert.deepEqual(installCliLink(link, launcher), { path: link, state: 'conflict' })
    assert.equal(fs.readlinkSync(link), other)
    // A regular file is reported, not replaced.
    fs.unlinkSync(link); fs.writeFileSync(link, 'user script')
    assert.deepEqual(installCliLink(link, launcher), { path: link, state: 'conflict' })
    assert.equal(fs.readFileSync(link, 'utf8'), 'user script')
    // A dangling link to a moved copy of the app is a conflict too.
    fs.unlinkSync(link); fs.symlinkSync(path.join(home, 'Downloads', 'pdfpal.app', 'Contents', 'Resources', 'bin', 'pdfpal'), link)
    assert.equal(cliLinkState(link, launcher), 'conflict')
    // A path that cannot be created reports failure instead of throwing.
    const blocked = path.join(home, 'blocked'); fs.writeFileSync(blocked, '')
    assert.deepEqual(installCliLink(cliCommandLink(blocked), launcher), { path: cliCommandLink(blocked), state: 'failed' })
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('setup actions allow only official providers, fixed commands and safely quoted native paths', () => {
  assert.throws(() => provider('constructor'))
  assert.throws(() => setupScript('codex', 'arbitrary'))
  assert.throws(() => setupScript('codex', 'login', 'codex.cmd'))
  const file = "C:\\Reader's tools\\$(untrusted)\\codex.exe"
  const script = setupScript('codex', 'login', file)
  assert.ok(script.includes("& 'C:\\Reader''s tools\\$(untrusted)\\codex.exe' login"))
  assert.ok(setupScript('claude', 'install').includes("Invoke-RestMethod 'https://claude.ai/install.ps1'"))
  assert.ok(setupScript('codex', 'install').includes("Invoke-RestMethod 'https://chatgpt.com/codex/install.ps1'"))
})

test('privileged IPC requires the owned top-level frame and exact recovery document', () => {
  const mainFrame = { url: 'http://127.0.0.1:8200/projects' }, webContents = { mainFrame }, window = { webContents }
  const event = { sender: webContents, senderFrame: mainFrame }
  assert.equal(trustedSender(event, window, 'http://127.0.0.1:8200'), true)
  assert.equal(trustedSender({ ...event, senderFrame: { url: mainFrame.url } }, window, 'http://127.0.0.1:8200'), false)
  mainFrame.url = 'https://attacker.example'
  assert.equal(trustedSender(event, window, 'http://127.0.0.1:8200'), false)
  mainFrame.url = 'file:///app/recovery.html'
  assert.equal(trustedSender(event, window, undefined, mainFrame.url), true)
  assert.equal(trustedSender(event, window, undefined, 'file:///other/recovery.html'), false)
  assert.equal(trustedSender(event, window, 'http://127.0.0.1:8200'), false)
})

test('diagnostics retain only bounded allowlisted metadata, including after a corrupt log', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-diagnostics-')), filename = path.join(directory, 'events.json')
  try {
    fs.writeFileSync(filename, JSON.stringify([{ at: 'SECRET', code: 'READY', message: 'SECRET' }]))
    const log = diagnostics(filename)
    for (let i = 0; i < 70; i++) log.record('READY')
    log.record('SECRET')
    const report = log.preview('2.1.0', [{ id: 'codex', state: 'installed', auth: 'account', version: '0.164.0', path: 'SECRET', token: 'SECRET' }, { id: 'claude', version: 'SECRET', auth: 'SECRET', state: 'SECRET' }])
    assert.equal(report.events.length, 50)
    assert.ok(!JSON.stringify(report).includes('SECRET'))
    assert.equal(diagnostics(filename).preview('2.1.0').events.length, 50)
    assert.equal(recoveryMessage('EADDRINUSE').title, 'Another local service is already running')
    assert.match(recoveryMessage('NEWER_DATABASE').title, /newer/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
