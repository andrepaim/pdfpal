import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { desktopProfile } from '../../src/cli/desktop-connection.js'
import { findCommands, sameCommand } from '../../src/cli/desktop.js'
import { PdfpalError } from '../../src/core/types.js'

test('the desktop profile resolves on Windows and macOS and is refused elsewhere', () => {
  assert.equal(desktopProfile(undefined, { platform: 'darwin', env: {}, home: '/Users/reader' }), path.join('/Users/reader', 'Library', 'Application Support', 'pdfpal-desktop'))
  assert.equal(desktopProfile(undefined, { platform: 'win32', env: { APPDATA: '/roaming' }, home: '/home' }), path.join('/roaming', 'pdfpal-desktop'))
  assert.equal(desktopProfile(undefined, { platform: 'win32', env: {}, home: '/home' }), path.join('/home', 'AppData', 'Roaming', 'pdfpal-desktop'))
  assert.equal(desktopProfile(undefined, { platform: 'darwin', env: { PDFPAL_DESKTOP_PROFILE: '/preview' } }), path.resolve('/preview'))
  assert.equal(desktopProfile('/explicit', { platform: 'linux', env: {} }), path.resolve('/explicit'))
  assert.throws(() => desktopProfile(undefined, { platform: 'linux', env: {} }), (error: unknown) =>
    error instanceof PdfpalError && error.code === 'WINDOWS_HOST_REQUIRED' && error.exitCode === 2)
})

test('doctor compares Windows commands case-insensitively and Mac commands by real path', { skip: process.platform === 'win32' }, async () => {
  assert.equal(sameCommand('C:\\Apps\\PDFPAL.exe', 'c:\\apps\\pdfpal.exe', 'win32'), true)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-doctor-'))
  try {
    const bundle = path.join(directory, 'pdfpal.app', 'Contents', 'Resources', 'bin'), local = path.join(directory, 'local-bin'), other = path.join(directory, 'other-bin')
    for (const folder of [bundle, local, other]) fs.mkdirSync(folder, { recursive: true })
    const launcher = path.join(bundle, 'pdfpal')
    fs.writeFileSync(launcher, '#!/bin/sh\n', { mode: 0o755 })
    fs.symlinkSync(launcher, path.join(local, 'pdfpal'))
    fs.writeFileSync(path.join(other, 'pdfpal'), '#!/bin/sh\n', { mode: 0o755 })
    const found = await findCommands('pdfpal', { platform: 'darwin', env: { PATH: [other, local].join(':') } })
    assert.deepEqual(found, [path.join(other, 'pdfpal'), path.join(local, 'pdfpal')])
    assert.equal(sameCommand(found[1]!, fs.realpathSync.native(launcher), 'darwin'), true)
    assert.equal(sameCommand(found[0]!, launcher, 'darwin'), false)
    assert.deepEqual(await findCommands('pdfpal-missing-command', { platform: 'darwin', env: { PATH: local } }), [])
    assert.deepEqual(await findCommands('pdfpal', { platform: 'linux', env: { PATH: local } }), [])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
