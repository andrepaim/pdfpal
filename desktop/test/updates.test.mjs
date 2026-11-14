import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, versionParts, verifyRelease, checkDesktopUpdates, releasePage, desktopTarget } from '../src/updates.mjs'
import { buildConfiguration, signingConfiguration } from '../scripts/build-installer.mjs'

// The checks select files by the running platform, so tests name it explicitly.
const windows = { platform: 'win32', arch: 'x64' }
const mac = { platform: 'darwin', arch: 'arm64' }
const asset = (tag, name, size = 1234) => ({ name, state: 'uploaded', size, browser_download_url: `${releasePage}/download/${tag}/${name}` })
function fixture(version = '2.2.0') {
  const tag = `desktop-v${version}`, installer = `pdfpal-Setup-${version}-x64.exe`
  return { release: { tag_name: tag, draft: false, prerelease: false, body: 'New reading features.', assets: [asset(tag, installer), asset(tag, 'pdfpal-desktop-release.json')] }, manifest: { format: 1, appId: 'io.pdfpal.desktop', version, platform: 'win32', arch: 'x64', signed: true, publisher: 'Test Publisher', installer, sha256: 'a'.repeat(64), size: 1234 } }
}
/** A release carrying both platforms, as the two-platform pipeline publishes it. */
function twoPlatform(version = '2.2.0', { macSigned = true } = {}) {
  const { release, manifest } = fixture(version)
  const tag = release.tag_name, dmg = `pdfpal-${version}-arm64.dmg`
  const macManifest = { format: 1, appId: 'io.pdfpal.desktop', version, platform: 'darwin', arch: 'arm64', signed: macSigned, publisher: macSigned ? 'Test Publisher' : null, installer: dmg, sha256: 'c'.repeat(64), size: 5678 }
  return { release: { ...release, assets: [...release.assets, asset(tag, dmg, 5678), asset(tag, 'pdfpal-desktop-release-darwin-arm64.json')] }, windows: manifest, mac: macManifest }
}
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
/** Serves the release list and each manifest by its file name. */
function server(releases, manifests) {
  const calls = []
  const request = async url => {
    calls.push(url)
    if (url.includes('api.github.com')) return response(releases)
    const name = decodeURIComponent(url.split('/').at(-1))
    if (!(name in manifests)) throw new Error(`Unexpected download ${name}`)
    return response(manifests[name])
  }
  return { request, calls }
}

test('desktop versions compare stable/preview and multi-digit versions without permitting malformed tags', () => {
  for (const [a, b] of [['2.1.0-preview.1', '2.1.0'], ['2.1.0-preview.2', '2.1.0-preview.10'], ['2.9.0', '2.10.0'], ['2.1.0-alpha', '2.1.0-beta'], ['2.1.0-preview', '2.1.0-preview.1']]) assert.equal(compareVersions(a, b), -1)
  assert.equal(compareVersions('2.1.0', '2.1.0'), 0)
  for (const version of ['v2.1.0', '2.1', '02.1.0', '2.1.0-preview.01', '2.1.0/evil', '65536.0.0']) assert.throws(() => versionParts(version))
})

test('release verification rejects unsigned artifacts, foreign download URLs, mismatched hashes and metadata', () => {
  const { release, manifest } = fixture()
  assert.equal(verifyRelease(release, manifest, windows).version, '2.2.0')
  for (const patch of [{ appId: 'another.application' }, { signed: false }, { publisher: '' }, { sha256: 'wrong' }, { installer: 'attacker.exe' }, { size: 100 }, { version: '2.3.0' }, { platform: 'linux' }]) assert.throws(() => verifyRelease(release, { ...manifest, ...patch }, windows))
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v2.2.0' }]) assert.throws(() => verifyRelease({ ...release, ...patch }, manifest, windows))
  assert.throws(() => verifyRelease({ ...release, assets: release.assets.map(asset => ({ ...asset, browser_download_url: 'https://attacker.example/payload.exe' })) }, manifest, windows))
  assert.throws(() => verifyRelease({ ...release, assets: release.assets.map(asset => ({ ...asset, digest: 'sha256:' + 'b'.repeat(64) })) }, manifest, windows))
})

test('update checks select only verified stable desktop releases, never npm or unsigned previews', async () => {
  const { release, manifest } = fixture()
  const calls = []
  const request = async (url, options) => { calls.push(url); assert.ok(options.signal); return response(url.includes('api.github.com') ? [{ ...release, tag_name: 'v99.0.0' }, release] : manifest) }
  assert.equal((await checkDesktopUpdates('2.1.0-preview.1', request, windows)).state, 'available')
  assert.equal(calls.length, 2)
  assert.equal((await checkDesktopUpdates('2.2.0', request, windows)).state, 'current')
  assert.equal((await checkDesktopUpdates('3.0.0', request, windows)).state, 'current')
  assert.equal((await checkDesktopUpdates('2.1.0', async url => response(url.includes('api.github.com') ? [release] : { ...manifest, signed: false }), windows)).state, 'unpublished')
  assert.equal((await checkDesktopUpdates('2.1.0', async () => response([]), windows)).state, 'unpublished')
})

test('preview.4 never offers preview.5 as a stable update', async () => {
  const { release } = fixture('2.1.0-preview.5')
  for (const target of [windows, mac]) {
    for (const prerelease of [true, false]) {
      const calls = []
      const result = await checkDesktopUpdates('2.1.0-preview.4', async url => {
        calls.push(url)
        return response([{ ...release, prerelease }])
      }, target)
      assert.deepEqual(result, { state: 'unpublished', currentVersion: '2.1.0-preview.4' })
      assert.deepEqual(calls, ['https://api.github.com/repos/andrepaim/pdfpal/releases?per_page=100'])
    }
  }
})

test('offline, rate-limited, hostile, and oversized metadata fail without exposing transport details', async () => {
  for (const target of [windows, mac]) {
    for (const request of [async () => { throw new Error('network token=SECRET') }, async () => new Response('', { status: 403 }), async () => response('invalid'), async () => new Response('x'.repeat(1024 * 1024 + 1))]) {
      const result = await checkDesktopUpdates('2.1.0', request, target)
      assert.equal(result.state, 'error'); assert.ok(!result.message.includes('SECRET'))
    }
  }
})

test('each platform selects its own manifest and installer; unknown platforms have no release', () => {
  assert.equal(desktopTarget('win32', 'x64').manifest, 'pdfpal-desktop-release.json')
  assert.equal(desktopTarget('win32', 'x64').installer('2.9.0'), 'pdfpal-Setup-2.9.0-x64.exe')
  assert.equal(desktopTarget('darwin', 'arm64').manifest, 'pdfpal-desktop-release-darwin-arm64.json')
  assert.equal(desktopTarget('darwin', 'arm64').installer('2.9.0'), 'pdfpal-2.9.0-arm64.dmg')
  for (const [platform, arch] of [['darwin', 'x64'], ['win32', 'arm64'], ['linux', 'x64'], ['constructor', ''], ['__proto__', '']]) assert.equal(desktopTarget(platform, arch), undefined)
  assert.equal(desktopTarget(process.platform, process.arch), desktopTarget())
})

test('Windows is never offered a disk image and a Mac is never offered a Windows installer', async () => {
  const both = twoPlatform()
  // Each platform verifies only its own manifest and file.
  assert.match(verifyRelease(both.release, both.windows, windows).downloadURL, /\/pdfpal-Setup-2\.2\.0-x64\.exe$/)
  assert.match(verifyRelease(both.release, both.mac, mac).downloadURL, /\/pdfpal-2\.2\.0-arm64\.dmg$/)
  // The other platform's manifest, or a manifest pointing at the other file, is rejected.
  assert.throws(() => verifyRelease(both.release, both.mac, windows), /Unverified/)
  assert.throws(() => verifyRelease(both.release, both.windows, mac), /Unverified/)
  assert.throws(() => verifyRelease(both.release, { ...both.windows, installer: 'pdfpal-2.2.0-arm64.dmg', size: 5678 }, windows), /Unverified/)
  assert.throws(() => verifyRelease(both.release, { ...both.mac, installer: 'pdfpal-Setup-2.2.0-x64.exe', size: 1234 }, mac), /Unverified/)
  assert.throws(() => verifyRelease(both.release, { ...both.mac, platform: 'win32', arch: 'x64' }, mac), /Unverified/)
  assert.throws(() => verifyRelease(both.release, { ...both.mac, arch: 'x64' }, mac), /Unverified/)
  assert.throws(() => verifyRelease(both.release, both.mac, { platform: 'linux', arch: 'x64' }), /No desktop release/)
  // A Mac disk image digest that differs from its manifest is rejected.
  const tampered = { ...both.release, assets: both.release.assets.map(item => item.name.endsWith('.dmg') ? { ...item, digest: 'sha256:' + 'd'.repeat(64) } : item) }
  assert.throws(() => verifyRelease(tampered, both.mac, mac), /Unverified/)

  const manifests = { 'pdfpal-desktop-release.json': both.windows, 'pdfpal-desktop-release-darwin-arm64.json': both.mac }
  const onWindows = server([both.release], manifests)
  const fromWindows = await checkDesktopUpdates('2.1.0', onWindows.request, windows)
  assert.equal(fromWindows.state, 'available')
  assert.ok(fromWindows.downloadURL.endsWith('.exe'))
  assert.ok(!onWindows.calls.some(url => url.includes('darwin')))
  const onMac = server([both.release], manifests)
  const fromMac = await checkDesktopUpdates('2.1.0', onMac.request, mac)
  assert.equal(fromMac.state, 'available')
  assert.ok(fromMac.downloadURL.endsWith('/pdfpal-2.2.0-arm64.dmg'))
  assert.ok(onMac.calls.every(url => !url.endsWith('/pdfpal-desktop-release.json')))
  // A manifest file swapped between platforms is refused, not offered.
  assert.equal((await checkDesktopUpdates('2.1.0', server([both.release], { 'pdfpal-desktop-release.json': both.mac }).request, windows)).state, 'error')
  assert.equal((await checkDesktopUpdates('2.1.0', server([both.release], { 'pdfpal-desktop-release-darwin-arm64.json': both.windows }).request, mac)).state, 'error')
})

test('a Windows-only stable release is unpublished on a Mac and unchanged on Windows', async () => {
  const { release, manifest } = fixture()
  const onMac = server([release], { 'pdfpal-desktop-release.json': manifest })
  assert.deepEqual(await checkDesktopUpdates('2.1.0', onMac.request, mac), { state: 'unpublished', currentVersion: '2.1.0' })
  assert.deepEqual(onMac.calls, ['https://api.github.com/repos/andrepaim/pdfpal/releases?per_page=100'])
  const onWindows = server([release], { 'pdfpal-desktop-release.json': manifest })
  const result = await checkDesktopUpdates('2.1.0', onWindows.request, windows)
  assert.equal(result.state, 'available')
  assert.equal(result.downloadURL, `${releasePage}/download/desktop-v2.2.0/pdfpal-Setup-2.2.0-x64.exe`)
  // A newer two-platform release wins on both; an older Windows-only one stays reachable on Windows.
  const newer = twoPlatform('2.3.0')
  const manifests = { 'pdfpal-desktop-release.json': newer.windows, 'pdfpal-desktop-release-darwin-arm64.json': newer.mac }
  assert.equal((await checkDesktopUpdates('2.1.0', server([release, newer.release], manifests).request, mac)).version, '2.3.0')
  assert.equal((await checkDesktopUpdates('2.1.0', server([release, newer.release], manifests).request, windows)).version, '2.3.0')
})

test('unsigned manifests are skipped on both platforms, and unknown platforms make no request', async () => {
  const unsigned = twoPlatform('2.3.0', { macSigned: false })
  const older = twoPlatform('2.2.0')
  const manifests = { 'pdfpal-desktop-release-darwin-arm64.json': unsigned.mac }
  // The newest Mac manifest is unsigned, so the Mac falls back to the older signed release.
  const fallback = await checkDesktopUpdates('2.1.0', async url => {
    if (url.includes('api.github.com')) return response([unsigned.release, older.release])
    return response(url.includes('desktop-v2.3.0') ? manifests[decodeURIComponent(url.split('/').at(-1))] : older.mac)
  }, mac)
  assert.equal(fallback.version, '2.2.0')
  assert.equal((await checkDesktopUpdates('2.1.0', server([unsigned.release], manifests).request, mac)).state, 'unpublished')
  assert.equal((await checkDesktopUpdates('2.1.0', server([unsigned.release], { 'pdfpal-desktop-release.json': { ...unsigned.windows, signed: false } }).request, windows)).state, 'unpublished')
  for (const target of [{ platform: 'linux', arch: 'x64' }, { platform: 'darwin', arch: 'x64' }, { platform: 'win32', arch: 'arm64' }]) {
    assert.deepEqual(await checkDesktopUpdates('2.1.0', async () => { throw new Error('Must not contact GitHub') }, target), { state: 'unpublished', currentVersion: '2.1.0' })
  }
})

test('signed releases fail closed without credentials and acceptance keeps a separate app identity', () => {
  assert.throws(() => signingConfiguration(true, {}), /require.*PDFPAL_PUBLISHER_NAME/)
  assert.equal(signingConfiguration(false, {}).win.signExecutable, false)
  const signed = signingConfiguration(true, { PDFPAL_PUBLISHER_NAME: 'Publisher', CSC_LINK: 'SECRET' })
  assert.equal(signed.forceCodeSigning, true); assert.equal(signed.win.signExecutable, true)
  assert.ok(!JSON.stringify(signed).includes('SECRET'))
  const config = buildConfiguration('/fixture', { version: '2.1.0-preview.1', acceptance: true })
  assert.equal(config.appId, 'io.pdfpal.desktop.installer-acceptance')
  assert.equal(config.extraMetadata.pdfpalDesktop.appId, config.appId)
  assert.equal(config.executableName, 'pdfpal-test')
  assert.throws(() => buildConfiguration('/fixture', { version: '2.1.0', acceptance: true, signed: true }))
})
