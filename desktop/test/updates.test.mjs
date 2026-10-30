import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, versionParts, verifyRelease, checkDesktopUpdates, releasePage } from '../src/updates.mjs'
import { buildConfiguration, signingConfiguration } from '../scripts/build-installer.mjs'

function fixture(version = '2.2.0') {
  const tag = `desktop-v${version}`, installer = `pdfpal-Setup-${version}-x64.exe`
  const asset = name => ({ name, state: 'uploaded', size: 1234, browser_download_url: `${releasePage}/download/${tag}/${name}` })
  return { release: { tag_name: tag, draft: false, prerelease: false, body: 'New reading features.', assets: [asset(installer), asset('pdfpal-desktop-release.json')] }, manifest: { format: 1, appId: 'io.pdfpal.desktop', version, platform: 'win32', arch: 'x64', signed: true, publisher: 'Test Publisher', installer, sha256: 'a'.repeat(64), size: 1234 } }
}
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('desktop versions compare stable/preview and multi-digit versions without permitting malformed tags', () => {
  for (const [a, b] of [['2.1.0-preview.1', '2.1.0'], ['2.1.0-preview.2', '2.1.0-preview.10'], ['2.9.0', '2.10.0'], ['2.1.0-alpha', '2.1.0-beta'], ['2.1.0-preview', '2.1.0-preview.1']]) assert.equal(compareVersions(a, b), -1)
  assert.equal(compareVersions('2.1.0', '2.1.0'), 0)
  for (const version of ['v2.1.0', '2.1', '02.1.0', '2.1.0-preview.01', '2.1.0/evil', '65536.0.0']) assert.throws(() => versionParts(version))
})

test('release verification rejects unsigned artifacts, foreign download URLs, mismatched hashes and metadata', () => {
  const { release, manifest } = fixture()
  assert.equal(verifyRelease(release, manifest).version, '2.2.0')
  for (const patch of [{ appId: 'another.application' }, { signed: false }, { publisher: '' }, { sha256: 'wrong' }, { installer: 'attacker.exe' }, { size: 100 }, { version: '2.3.0' }, { platform: 'linux' }]) assert.throws(() => verifyRelease(release, { ...manifest, ...patch }))
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v2.2.0' }]) assert.throws(() => verifyRelease({ ...release, ...patch }, manifest))
  assert.throws(() => verifyRelease({ ...release, assets: release.assets.map(asset => ({ ...asset, browser_download_url: 'https://attacker.example/payload.exe' })) }, manifest))
  assert.throws(() => verifyRelease({ ...release, assets: release.assets.map(asset => ({ ...asset, digest: 'sha256:' + 'b'.repeat(64) })) }, manifest))
})

test('update checks select only verified stable desktop releases, never npm or unsigned previews', async () => {
  const { release, manifest } = fixture()
  const calls = []
  const request = async (url, options) => { calls.push(url); assert.ok(options.signal); return response(url.includes('api.github.com') ? [{ ...release, tag_name: 'v99.0.0' }, release] : manifest) }
  assert.equal((await checkDesktopUpdates('2.1.0-preview.1', request)).state, 'available')
  assert.equal(calls.length, 2)
  assert.equal((await checkDesktopUpdates('2.2.0', request)).state, 'current')
  assert.equal((await checkDesktopUpdates('3.0.0', request)).state, 'current')
  assert.equal((await checkDesktopUpdates('2.1.0', async url => response(url.includes('api.github.com') ? [release] : { ...manifest, signed: false }))).state, 'unpublished')
  assert.equal((await checkDesktopUpdates('2.1.0', async () => response([]))).state, 'unpublished')
})

test('preview.4 never offers preview.5 as a stable update', async () => {
  const { release } = fixture('2.1.0-preview.5')
  for (const prerelease of [true, false]) {
    const calls = []
    const result = await checkDesktopUpdates('2.1.0-preview.4', async url => {
      calls.push(url)
      return response([{ ...release, prerelease }])
    })
    assert.deepEqual(result, { state: 'unpublished', currentVersion: '2.1.0-preview.4' })
    assert.deepEqual(calls, ['https://api.github.com/repos/andrepaim/pdfpal/releases?per_page=100'])
  }
})

test('offline, rate-limited, hostile, and oversized metadata fail without exposing transport details', async () => {
  for (const request of [async () => { throw new Error('network token=SECRET') }, async () => new Response('', { status: 403 }), async () => response('invalid'), async () => new Response('x'.repeat(1024 * 1024 + 1))]) {
    const result = await checkDesktopUpdates('2.1.0', request)
    assert.equal(result.state, 'error'); assert.ok(!result.message.includes('SECRET'))
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
