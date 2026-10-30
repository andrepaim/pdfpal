import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { provider, setupScript, trustedSender, diagnostics, recoveryMessage } from '../src/setup.mjs'

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
