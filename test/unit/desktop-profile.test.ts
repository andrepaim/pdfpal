import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { defaultDesktopProfile } from '../../src/shared/desktop-profile.js'

test('Linux desktop preferences follow absolute XDG configuration without moving the library', () => {
  const home = path.resolve('temporary-user')
  assert.equal(defaultDesktopProfile({ platform: 'linux', home, env: {} }), path.join(home, '.config', 'pdfpal-desktop'))
  assert.equal(defaultDesktopProfile({ platform: 'linux', home, env: { XDG_CONFIG_HOME: '/tmp/settings' } }), path.join('/tmp/settings', 'pdfpal-desktop'))
  assert.equal(defaultDesktopProfile({ platform: 'linux', home, env: { XDG_CONFIG_HOME: 'relative' } }), path.join(home, '.config', 'pdfpal-desktop'))
  assert.equal(defaultDesktopProfile({ platform: 'linux', home, env: {}, preview: true }), path.join(home, '.config', 'pdfpal-cloud-preview'))
})

test('explicit profiles and Windows roaming defaults retain their existing precedence', () => {
  const home = path.resolve('temporary-user'), roaming = path.resolve('roaming')
  assert.equal(defaultDesktopProfile({ platform: 'win32', home, env: { APPDATA: roaming } }), path.join(roaming, 'pdfpal-desktop'))
  assert.equal(defaultDesktopProfile({ platform: 'win32', home, env: {} }), path.join(home, 'AppData', 'Roaming', 'pdfpal-desktop'))
  for (const platform of ['win32', 'linux']) assert.equal(defaultDesktopProfile({ platform, home, env: { PDFPAL_DESKTOP_PROFILE: './custom-profile', XDG_CONFIG_HOME: '/tmp/ignored', APPDATA: roaming } }), path.resolve('custom-profile'))
})
