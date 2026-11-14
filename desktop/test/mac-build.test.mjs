import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { buildConfiguration, signingConfiguration, builderArguments, builderEnvironment, installerName, manifestName, configurationName, releaseManifest, writeReleaseManifest, resolveArch } from '../scripts/build-installer.mjs'
import { parseArguments, buildPlan, appOutputDirectory, copyList, commandList, smokeEnvironment, fixtureProvider, preflight, checkManifest, checkReceipt, smokeFlags, systemPath } from '../scripts/mac-build.mjs'
import { macArtwork, icns, readIcns, icnsTypes, macGrid } from '../scripts/icons.mjs'

const require = createRequire(import.meta.url)
const prepareCli = require('../build/prepare-cli.cjs')
const desktop = fileURLToPath(new URL('../', import.meta.url))
const temporary = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix))
const quote = value => `'${value.replaceAll("'", "'\\''")}'`

test('Windows build configuration is unchanged by the platform parameter', () => {
  const project = path.join(path.sep, 'fixture')
  const extend = path.join(project, 'electron-builder.yml')
  assert.deepEqual(buildConfiguration(project, { version: '2.8.0-beta.1' }), { extends: extend, forceCodeSigning: false, win: { signExecutable: false },
    directories: { output: path.join(project, 'artifacts') }, extraMetadata: { version: '2.8.0-beta.1', pdfpalDesktop: { appId: 'io.pdfpal.desktop', distribution: 'unsigned' } } })
  assert.deepEqual(buildConfiguration(project, { version: '2.8.0-beta.1', platform: 'win32' }), buildConfiguration(project, { version: '2.8.0-beta.1' }))
  assert.deepEqual(buildConfiguration(project, { version: '2.1.0-preview.1', acceptance: true, output: '/out' }), { extends: extend, forceCodeSigning: false, win: { signExecutable: false },
    compression: 'store', appId: 'io.pdfpal.desktop.installer-acceptance', productName: 'pdfpal Installer Test', executableName: 'pdfpal-test',
    nsis: { shortcutName: 'pdfpal Installer Test', uninstallDisplayName: 'pdfpal Installer Test' }, directories: { output: '/out' },
    extraMetadata: { version: '2.1.0-preview.1', pdfpalDesktop: { appId: 'io.pdfpal.desktop.installer-acceptance', distribution: 'unsigned' } } })
  const env = { PDFPAL_PUBLISHER_NAME: 'Publisher', PDFPAL_CERTIFICATE_SHA1: 'a'.repeat(40) }
  assert.deepEqual(buildConfiguration(project, { version: '2.8.0', signed: true }, env), { extends: extend, forceCodeSigning: true,
    win: { signExecutable: true, signtoolOptions: { publisherName: 'Publisher', certificateSha1: 'a'.repeat(40), signingHashAlgorithms: ['sha256'] } },
    directories: { output: path.join(project, 'artifacts') }, extraMetadata: { version: '2.8.0', pdfpalDesktop: { appId: 'io.pdfpal.desktop', distribution: 'signed' } } })
  assert.deepEqual(signingConfiguration(false, {}), { forceCodeSigning: false, win: { signExecutable: false } })
  assert.throws(() => buildConfiguration(project, { version: '2.8.0', signed: true }, {}), /require.*PDFPAL_PUBLISHER_NAME/)
})

test('Windows installer command, environment and file names are unchanged', () => {
  assert.deepEqual(builderArguments({ tools: '/tools', project: '/project', config: '/project/installer-build.json' }),
    [path.join('/tools', 'node_modules/electron-builder/cli.js'), '--projectDir', '/project', '--config', '/project/installer-build.json', '--win', '--x64', '--publish', 'never'])
  const ambient = { PATH: '/bin', CSC_LINK: 'SECRET', CSC_KEY_PASSWORD: 'SECRET', WIN_CSC_LINK: 'SECRET', WIN_CSC_KEY_PASSWORD: 'SECRET', CSC_NAME: 'SECRET' }
  assert.deepEqual(builderEnvironment('win32', false, ambient), { PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  assert.deepEqual(builderEnvironment('win32', true, ambient), { ...ambient, CSC_IDENTITY_AUTO_DISCOVERY: 'true' })
  assert.equal(installerName('win32', '2.8.0'), 'pdfpal-Setup-2.8.0-x64.exe')
  assert.equal(manifestName('win32'), 'pdfpal-desktop-release.json')
  assert.equal(configurationName('win32'), 'installer-build.json')
  assert.throws(() => resolveArch('win32', 'arm64'), /Unsupported win32 architecture/)
  assert.throws(() => builderArguments({ tools: '/t', project: '/p', config: '/c', dir: true }), /Windows/)
})

test('Mac build configuration is ad-hoc signed, unsigned in metadata, and refuses signed builds', () => {
  const project = path.join(path.sep, 'fixture')
  assert.deepEqual(buildConfiguration(project, { version: '2.8.0-beta.1', platform: 'darwin' }), { extends: path.join(project, 'electron-builder.yml'), forceCodeSigning: false,
    mac: { identity: '-', hardenedRuntime: false, notarize: false }, directories: { output: path.join(project, 'artifacts') },
    extraMetadata: { version: '2.8.0-beta.1', pdfpalDesktop: { appId: 'io.pdfpal.desktop', distribution: 'unsigned' } } })
  const acceptance = buildConfiguration(project, { version: '2.8.0-beta.1', platform: 'darwin', acceptance: true })
  assert.equal(acceptance.executableName, 'pdfpal-test'); assert.equal(acceptance.appId, 'io.pdfpal.desktop.installer-acceptance')
  assert.equal(acceptance.extraMetadata.pdfpalDesktop.appId, acceptance.appId); assert.equal(acceptance.nsis, undefined); assert.equal(acceptance.win, undefined)
  assert.throws(() => buildConfiguration(project, { version: '2.8.0', platform: 'darwin', signed: true }, { PDFPAL_PUBLISHER_NAME: 'P', CSC_LINK: 'SECRET' }), /Signed macOS builds are not supported/)
  assert.throws(() => buildConfiguration(project, { version: '2.8.0', platform: 'linux' }), /Unsupported desktop platform/)
  assert.throws(() => buildConfiguration(project, { version: '2.8/0', platform: 'darwin' }))
  assert.equal(resolveArch('darwin'), 'arm64'); assert.equal(resolveArch('darwin', 'x64'), 'x64')
  assert.throws(() => resolveArch('darwin', 'universal'), /Unsupported darwin architecture/)
})

test('Mac builder commands package a directory or a disk image from the smoke-tested app', () => {
  const cli = path.join('/tools', 'node_modules/electron-builder/cli.js')
  assert.deepEqual(builderArguments({ tools: '/tools', project: '/w', config: '/w/c.json', platform: 'darwin', dir: true }),
    [cli, '--projectDir', '/w', '--config', '/w/c.json', '--mac', '--arm64', '--dir', '--publish', 'never'])
  assert.deepEqual(builderArguments({ tools: '/tools', project: '/w', config: '/w/c.json', platform: 'darwin', arch: 'x64' }),
    [cli, '--projectDir', '/w', '--config', '/w/c.json', '--mac', 'dmg', '--x64', '--publish', 'never'])
  assert.deepEqual(builderArguments({ tools: '/tools', project: '/w', config: '/w/c.json', platform: 'darwin', prepackaged: '/w/artifacts/mac-arm64/pdfpal.app' }),
    [cli, '--projectDir', '/w', '--config', '/w/c.json', '--mac', 'dmg', '--arm64', '--prepackaged', '/w/artifacts/mac-arm64/pdfpal.app', '--publish', 'never'])
  assert.throws(() => builderArguments({ tools: '/t', project: '/p', config: '/c', platform: 'darwin', dir: true, prepackaged: '/a' }))
  const env = builderEnvironment('darwin', false, { PATH: '/bin', CSC_LINK: 'SECRET', CSC_NAME: 'Someone', APPLE_ID: 'SECRET', APPLE_API_KEY: 'SECRET', APPLE_KEYCHAIN_PROFILE: 'SECRET' })
  assert.deepEqual(env, { PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_FOR_PULL_REQUEST: 'true' })
  assert.equal(installerName('darwin', '2.8.0-beta.1'), 'pdfpal-2.8.0-beta.1-arm64.dmg')
  assert.equal(manifestName('darwin'), 'pdfpal-desktop-release-darwin-arm64.json')
  assert.equal(manifestName('darwin', 'x64'), 'pdfpal-desktop-release-darwin-x64.json')
})

test('electron-builder.yml has the Mac target and keeps the Windows sections', () => {
  const config = yaml.load(fs.readFileSync(path.join(desktop, 'electron-builder.yml'), 'utf8'))
  assert.deepEqual(config.mac, { target: 'dmg', category: 'public.app-category.productivity', icon: 'build/icon.icns', identity: '-', hardenedRuntime: false,
    gatekeeperAssess: false, notarize: false, files: [...config.files, '!node_modules/better-sqlite3/prebuilds/{linux,linuxmusl,win32}-*'],
    extraResources: [{ from: 'stage/cli-bin', to: 'bin' }] })
  assert.deepEqual(config.files, ['**/*', '!test/**', '!discovery.test.mjs', '!cli-bin/**'])
  assert.deepEqual(config.dmg, { artifactName: 'pdfpal-${version}-${arch}.dmg', writeUpdateInfo: false })
  // The Windows console launcher is copied beside pdfpal.exe only; a Mac bundle must not get Contents/bin.
  assert.equal(config.extraFiles, undefined)
  assert.deepEqual(config.win.extraFiles, [{ from: 'stage/cli-bin', to: 'bin' }])
  assert.equal(config.win.target, 'nsis'); assert.equal(config.win.icon, 'build/icon.ico')
  assert.equal(config.nsis.artifactName, 'pdfpal-Setup-${version}-${arch}.exe')
  assert.ok(config.files.includes('!cli-bin/**'))
  assert.equal(config.beforePack, 'build/prepare-cli.cjs'); assert.equal(config.publish, null)
  assert.deepEqual(config.extraResources.map(entry => entry.to), ['THIRD_PARTY_NOTICES.txt', 'LICENSE.pdfpal.txt'])
  assert.ok(fs.statSync(path.join(desktop, config.mac.icon)).size > 0)
})

test('release manifests have the shared shape for both platforms', async () => {
  const output = temporary('pdfpal-mac-manifest-')
  try {
    for (const [platform, arch] of [['darwin', 'arm64'], ['win32', 'x64']]) {
      const bytes = Buffer.from(`fixture installer ${platform}`)
      fs.writeFileSync(path.join(output, installerName(platform, '2.8.0-beta.1', arch)), bytes)
      await writeReleaseManifest(output, { appId: 'io.pdfpal.desktop', version: '2.8.0-beta.1', platform, arch })
      const text = fs.readFileSync(path.join(output, manifestName(platform, arch)), 'utf8')
      assert.equal(text, JSON.stringify({ format: 1, appId: 'io.pdfpal.desktop', version: '2.8.0-beta.1', platform, arch, signed: false, publisher: null,
        installer: installerName(platform, '2.8.0-beta.1', arch), sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }, null, 2))
    }
    const plan = buildPlan(parseArguments([], { tmpdir: output, source: '/src' }), { version: '2.8.0-beta.1' })
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'pdfpal-desktop-release-darwin-arm64.json'), 'utf8'))
    assert.equal(checkManifest(manifest, plan, manifest.size), manifest)
    assert.throws(() => checkManifest({ ...manifest, signed: true }, plan, manifest.size), /signed/)
    assert.throws(() => checkManifest({ ...manifest, installer: 'pdfpal.exe' }, plan, manifest.size), /installer/)
    assert.throws(() => checkManifest(manifest, plan, manifest.size + 1), /size/)
    assert.throws(() => checkManifest({ extra: 1, ...manifest }, plan, manifest.size), /keys/)
    assert.deepEqual(Object.keys(releaseManifest({ appId: 'a', version: '1.0.0', platform: 'darwin', installer: 'x', sha256: 'y', size: 1 })),
      ['format', 'appId', 'version', 'platform', 'arch', 'signed', 'publisher', 'installer', 'sha256', 'size'])
  } finally { fs.rmSync(output, { recursive: true, force: true }) }
})

test('driver arguments have contract defaults and reject anything else', () => {
  assert.deepEqual(parseArguments([], { tmpdir: '/tmp', source: '/repo' }), { source: '/repo', work: '/tmp/pdfpal-mac-build', arch: 'arm64', skipInstall: false, smoke: 'm0' })
  assert.deepEqual(parseArguments(['--source=/a b', '--work=/w', '--arch=x64', '--skip-install', '--smoke=m2'], { tmpdir: '/tmp' }),
    { source: '/a b', work: '/w', arch: 'x64', skipInstall: true, smoke: 'm2' })
  assert.equal(parseArguments(['--smoke=none'], { tmpdir: '/tmp' }).smoke, 'none')
  assert.equal(parseArguments(['--work=relative'], { tmpdir: '/tmp' }).work, path.resolve('relative'))
  for (const argv of [['--arch=ia32'], ['--smoke=m1'], ['--signed'], ['--work='], ['--skip-install=yes'], ['extra'], ['-x']]) assert.throws(() => parseArguments(argv, { tmpdir: '/tmp' }), /Usage|must|Unsupported/)
})

test('driver plan places every output where the contract says', () => {
  const plan = buildPlan(parseArguments([], { tmpdir: '/tmp', source: '/repo' }), { version: '2.8.0-beta.1' })
  assert.equal(plan.dmg, '/tmp/pdfpal-mac-build/artifacts/pdfpal-2.8.0-beta.1-arm64.dmg')
  assert.equal(plan.manifest, '/tmp/pdfpal-mac-build/artifacts/pdfpal-desktop-release-darwin-arm64.json')
  assert.equal(plan.app, '/tmp/pdfpal-mac-build/artifacts/mac-arm64/pdfpal.app')
  assert.equal(plan.receipt, '/tmp/pdfpal-mac-build/packaged-receipt.json')
  assert.equal(plan.executable, '/tmp/pdfpal-mac-build/artifacts/mac-arm64/pdfpal.app/Contents/MacOS/pdfpal')
  assert.equal(plan.launcher, '/tmp/pdfpal-mac-build/artifacts/mac-arm64/pdfpal.app/Contents/Resources/bin/pdfpal')
  assert.equal(appOutputDirectory('x64'), 'mac'); assert.equal(appOutputDirectory('arm64'), 'mac-arm64')
  const x64 = buildPlan(parseArguments(['--arch=x64', '--work=/w'], { source: '/repo' }), { version: '2.8.0' })
  assert.equal(x64.app, '/w/artifacts/mac/pdfpal.app'); assert.equal(x64.dmg, '/w/artifacts/pdfpal-2.8.0-x64.dmg')
})

test('driver copies tools and stage like the Windows driver, without node_modules or a stale CLI', () => {
  const source = temporary('pdfpal-mac-copy-')
  try {
    fs.mkdirSync(path.join(source, 'desktop/stage/node_modules'), { recursive: true })
    for (const name of ['dist', 'cli-bin']) fs.mkdirSync(path.join(source, 'desktop/stage', name))
    fs.writeFileSync(path.join(source, 'desktop/stage/package.json'), '{}')
    const plan = buildPlan({ source, work: '/w', arch: 'arm64' }, { version: '2.8.0' })
    assert.deepEqual(copyList(plan).map(entry => [path.relative(source, entry.from), entry.to]), [
      ['desktop/package.json', '/w/tools/package.json'], ['desktop/package-lock.json', '/w/tools/package-lock.json'],
      ['desktop/electron-builder.yml', '/w/electron-builder.yml'], ['desktop/build', '/w/build'],
      ['desktop/stage/dist', '/w/stage/dist'], ['desktop/stage/package.json', '/w/stage/package.json']])
  } finally { fs.rmSync(source, { recursive: true, force: true }) }
})

test('driver steps mirror windows-m0.ps1 and state why Windows-only checks are skipped', () => {
  const env = { PATH: '/usr/local/bin:/usr/bin', HOME: '/Users/reader', CSC_LINK: 'SECRET' }
  const m0 = buildPlan(parseArguments(['--work=/w'], { source: '/repo' }), { version: '2.8.0-beta.1' })
  const steps = commandList(m0, { node: '/node', npm: 'npm', env })
  assert.deepEqual(steps.map(step => step.id), ['install-tools', 'install-stage', 'notices', 'discovery-test', 'runtime-test', 'setup-native', 'setup-test', 'package', 'launcher-present',
    'codesign-verify', 'codesign-adhoc', 'launcher-version', 'smoke', 'smoke-no-system-node', 'providers', 'codesign-after-smoke', 'disk-image', 'disk-image-verify', 'manifest'])
  const step = id => steps.find(item => item.id === id)
  assert.deepEqual(step('install-tools').args, ['ci', '--prefix', '/w/tools', '--ignore-scripts', '--no-audit', '--no-fund'])
  assert.deepEqual(step('install-stage').args, ['ci', '--prefix', '/w/stage', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'])
  assert.deepEqual(step('notices').args, ['/repo/desktop/scripts/notices.mjs', '/w/stage', '/repo'])
  assert.deepEqual(step('discovery-test').args, ['/w/stage/discovery.test.mjs'])
  assert.deepEqual(step('runtime-test').args, ['/w/stage/test/runtime.test.mjs'])
  assert.match(step('setup-native').skip, /m2/); assert.equal(step('setup-native').command, undefined)
  assert.ok(step('package').args.join(' ').endsWith('--config /w/installer-build-darwin-arm64.json --mac --arm64 --dir --publish never'))
  assert.equal(step('package').env.CSC_LINK, undefined); assert.equal(step('package').env.CSC_FOR_PULL_REQUEST, 'true')
  assert.deepEqual(step('codesign-verify').args, ['--verify', '--deep', '--strict', '--verbose=2', '/w/artifacts/mac-arm64/pdfpal.app'])
  assert.ok(step('codesign-adhoc').expect.pattern.test('Executable=/x\nSignature=adhoc\nTeamIdentifier=not set'))
  assert.ok(!step('codesign-adhoc').expect.pattern.test('Authority=Developer ID Application: X'))
  assert.equal(step('launcher-version').command, '/w/cli-link/pdfpal')
  assert.ok(step('launcher-version').expect.pattern.test('2.8.0-beta.1\n')); assert.ok(!step('launcher-version').expect.pattern.test('2.8.0-beta.10\n'))
  assert.equal(step('launcher-version').env.PDFPAL_DATA_DIR, '/w/cli-check')
  assert.equal(step('smoke').command, '/w/artifacts/mac-arm64/pdfpal.app/Contents/MacOS/pdfpal'); assert.deepEqual(step('smoke').args, ['--m0-smoke'])
  assert.deepEqual(Object.fromEntries(['PDFPAL_M0_RECEIPT', 'PDFPAL_M2_FAILURE_FIXTURE', 'PDFPAL_M0_LIVE', 'PDFPAL_DESKTOP_PROFILE', 'PDFPAL_SETTINGS_PREVIEW', 'CLAUDE_BIN', 'PATH'].map(name => [name, step('smoke').env[name]])),
    { PDFPAL_M0_RECEIPT: '/w/packaged-receipt.json', PDFPAL_M2_FAILURE_FIXTURE: '0', PDFPAL_M0_LIVE: '0', PDFPAL_DESKTOP_PROFILE: '/w/smoke-profile', PDFPAL_SETTINGS_PREVIEW: '/w/ai-settings.png', CLAUDE_BIN: undefined, PATH: env.PATH })
  assert.equal(step('smoke').timeoutMs, 300000)
  assert.equal(step('smoke-no-system-node').env.PATH, systemPath); assert.equal(step('smoke-no-system-node').env.PDFPAL_M0_RECEIPT, '/w/no-system-node-receipt.json')
  assert.ok(!systemPath.split(':').includes('/usr/local/bin') && !systemPath.split(':').includes('/opt/homebrew/bin'))
  assert.deepEqual(step('disk-image').args, ['/repo/desktop/scripts/build-installer.mjs', '--platform=darwin', '--arch=arm64', '--project=/w', '--tools=/w/tools', '--prepackaged=/w/artifacts/mac-arm64/pdfpal.app'])
  assert.deepEqual(step('disk-image-verify').args, ['verify', '/w/artifacts/pdfpal-2.8.0-beta.1-arm64.dmg'])
  // Every skipped step says why; none is silently dropped.
  for (const skipped of steps.filter(item => item.skip)) assert.ok(skipped.skip.length > 10 && !skipped.command, skipped.id)

  const m2 = buildPlan(parseArguments(['--work=/w', '--smoke=m2', '--skip-install'], { source: '/repo' }), { version: '2.8.0' })
  const m2Steps = commandList(m2, { node: '/node', env })
  const m2Step = id => m2Steps.find(item => item.id === id)
  assert.match(m2Step('install-tools').skip, /--skip-install/); assert.match(m2Step('install-stage').skip, /--skip-install/)
  assert.match(m2Step('setup-native').skip, /not applicable on macOS.*win32/s)
  assert.deepEqual(m2Step('setup-test').args, ['--test', '/w/stage/test/setup.test.mjs'])
  assert.deepEqual(m2Step('smoke').args, ['--m2-smoke'])
  for (const id of ['smoke', 'smoke-no-system-node', 'setup-test', 'providers']) {
    assert.equal(m2Step(id).env.CLAUDE_BIN, '/w/fixture-provider', id); assert.equal(m2Step(id).env.PDFPAL_AGENT, 'claude', id)
  }
  assert.equal(m2Step('smoke').env.PDFPAL_M2_FAILURE_FIXTURE, '1')
  assert.equal(smokeEnvironment(m2, {}).PDFPAL_M1_LIVE_CODEX, '0')

  const none = commandList(buildPlan(parseArguments(['--work=/w', '--smoke=none'], { source: '/repo' }), { version: '2.8.0' }), { env })
  for (const id of ['smoke', 'smoke-no-system-node']) assert.match(none.find(item => item.id === id).skip, /--smoke=none/)
  assert.deepEqual(smokeFlags, { m0: '--m0-smoke', m2: '--m2-smoke' })
})

test('driver refuses to run off a Mac or across architectures, with a reason', () => {
  const source = temporary('pdfpal-mac-preflight-')
  try {
    const plan = buildPlan({ source, work: '/w', arch: 'arm64' }, { version: '2.8.0' })
    const linux = preflight(plan, { platform: 'linux', hostArch: 'x64' })
    assert.equal(linux.length, 2); assert.match(linux[0], /only on macOS \(this is linux\)/); assert.match(linux[1], /stage\.mjs/)
    fs.mkdirSync(path.join(source, 'desktop/stage'), { recursive: true }); fs.writeFileSync(path.join(source, 'desktop/stage/package.json'), '{}')
    assert.deepEqual(preflight(plan, { platform: 'darwin', hostArch: 'arm64' }), [])
    assert.match(preflight(plan, { platform: 'darwin', hostArch: 'x64' })[0], /This Mac is x64/)
    const run = spawnSync(process.execPath, [path.join(desktop, 'scripts/mac-build.mjs'), `--source=${source}`, '--work=' + path.join(source, 'work')], { encoding: 'utf8' })
    if (process.platform !== 'darwin') { assert.equal(run.status, 1); assert.match(run.stderr, /runs only on macOS/); assert.ok(!fs.existsSync(path.join(source, 'work'))) }
    const bad = spawnSync(process.execPath, [path.join(desktop, 'scripts/mac-build.mjs'), '--smoke=m9'], { encoding: 'utf8' })
    assert.equal(bad.status, 1); assert.match(bad.stderr, /--smoke must be m0, m2 or none/)
  } finally { fs.rmSync(source, { recursive: true, force: true }) }
})

test('build-installer rejects signed and off-Mac disk image builds clearly', () => {
  const script = path.join(desktop, 'scripts/build-installer.mjs')
  const signed = spawnSync(process.execPath, [script, '--platform=darwin', '--signed'], { encoding: 'utf8' })
  assert.notEqual(signed.status, 0); assert.match(signed.stderr, /Signed macOS builds are not supported/)
  if (process.platform !== 'darwin') {
    const unsigned = spawnSync(process.execPath, [script, '--platform=darwin'], { encoding: 'utf8' })
    assert.notEqual(unsigned.status, 0); assert.match(unsigned.stderr, /on a Mac/)
  }
  const unknown = spawnSync(process.execPath, [script, '--platform=linux'], { encoding: 'utf8' })
  assert.notEqual(unknown.status, 0); assert.match(unknown.stderr, /Unsupported desktop platform/)
})

test('packaged smoke receipts must describe this Mac and architecture', () => {
  const plan = { arch: 'arm64' }
  const receipt = { status: 'passed', platform: 'darwin', arch: 'arm64', checks: ['packaged-reader'] }
  assert.equal(checkReceipt(receipt, plan), receipt)
  assert.throws(() => checkReceipt({ ...receipt, status: 'provider_gate_failed' }, plan), /status/)
  assert.throws(() => checkReceipt({ ...receipt, platform: 'win32' }, plan), /expected darwin\/arm64/)
  assert.throws(() => checkReceipt({ ...receipt, arch: 'x64' }, plan), /expected darwin\/arm64/)
  assert.throws(() => checkReceipt({ ...receipt, checks: [] }, plan), /no checks/)
})

test('the m2 fixture assistant answers like the Windows C# fixture', async () => {
  const directory = temporary('pdfpal-mac-fixture-')
  const fixture = path.join(directory, 'fixture-provider')
  fs.writeFileSync(fixture, fixtureProvider(), { mode: 0o755 })
  const run = (args, mode, input = '') => new Promise((resolve, reject) => {
    const child = spawn(fixture, args, { env: { PATH: systemPath, ...(mode ? { PDFPAL_FIXTURE_MODE: mode } : {}) } })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }))
    // Like a real assistant, the fixture may exit before reading its input.
    child.stdin.on('error', () => {}); child.stdin.end(input)
  })
  try {
    assert.deepEqual(await run(['--version']), { code: 0, stdout: '1.0.0 (Claude Code)\n', stderr: '' })
    assert.equal((await run(['--help'])).stdout, '--tools --strict-mcp-config --disallowedTools\n')
    assert.equal((await run(['--help'], 'unsupported')).stdout, 'old help\n')
    assert.equal((await run(['auth', 'status'])).stdout, '{"loggedIn":true,"authMethod":"claude.ai"}\n')
    assert.equal((await run(['auth', 'status'], 'signed_out')).stdout, '{"loggedIn":false}\n')
    assert.equal((await run(['auth', 'status'], 'api')).stdout, '{"authMethod":"api_key","token":"SECRET"}\n')
    assert.equal((await run(['auth', 'status'], 'unknown')).stdout, 'unrecognized SECRET\n')
    assert.deepEqual(await run(['--print', '--tools', ''], 'offline', 'question'), { code: 1, stdout: '', stderr: 'ECONNRESET token=SECRET\n' })
    const [check, answer] = await Promise.all([run(['--print', '--tools', ''], undefined, 'Reply exactly PDFPAL_CONNECTION_OK. Do not use tools.'), run(['--print', '--tools', ''], undefined, 'Explain the source briefly.')])
    assert.deepEqual(check, { code: 0, stdout: 'PDFPAL_CONNECTION_OK\n', stderr: '' })
    assert.deepEqual(answer, { code: 0, stdout: 'M1 background answer\n', stderr: '' })
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

// A fake pdfpal.app whose Contents/MacOS executable is a stub that reports what it received.
function fakeBundle(root, executable = 'pdfpal') {
  const contents = path.join(root, `${executable}.app`, 'Contents')
  for (const directory of ['MacOS', 'Resources/bin', 'Resources/app.asar']) fs.mkdirSync(path.join(contents, directory), { recursive: true })
  fs.writeFileSync(path.join(contents, 'Resources/app.asar/cli.mjs'), '')
  const stub = path.join(root, 'stub.cjs')
  fs.writeFileSync(stub, `let stdin = ''
process.stdin.on('data', chunk => { stdin += chunk }).on('end', () => {
  const pick = ['ELECTRON_RUN_AS_NODE', 'PDFPAL_CLI_DESKTOP', 'PDFPAL_CLI_LAUNCHER', 'NODE_OPTIONS', 'NODE_PATH', 'KEEP_ME']
  process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), env: Object.fromEntries(pick.map(name => [name, process.env[name] ?? null])), stdin }))
  process.exitCode = Number(process.env.STUB_EXIT ?? 0)
})
`)
  fs.writeFileSync(path.join(contents, 'MacOS', executable), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(stub)} "$@"\n`, { mode: 0o755 })
  const launcher = path.join(contents, 'Resources/bin/pdfpal')
  fs.writeFileSync(launcher, prepareCli.macLauncher(executable), { mode: 0o755 })
  return { contents, launcher }
}
function launch(command, args, { env = {}, input = '', shell } = {}) {
  const result = spawnSync(shell ?? command, shell ? [command, ...args] : args, { input, encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_OPTIONS: '--no-deprecation', NODE_PATH: '/nonexistent', KEEP_ME: 'kept', ...env } })
  return { status: result.status, stderr: result.stderr, report: result.stdout ? JSON.parse(result.stdout) : undefined }
}

test('the macOS CLI launcher runs the bundled cli.mjs with the app runtime, directly and through symlinks', () => {
  const root = temporary('pdfpal-mac-launcher-')
  try {
    const apps = path.join(root, 'My Apps')
    const { contents, launcher } = fakeBundle(apps)
    const realContents = fs.realpathSync(contents), realLauncher = fs.realpathSync(launcher)
    assert.equal(fs.statSync(launcher).mode & 0o777, 0o755)
    const tricky = ['status', '--json', 'two words', '', '$(touch pwned)', '`id`', '*', "it's", 'line\nbreak', '--profile=/a b', '-', '"quoted"']
    const expected = { argv: [path.join(realContents, 'Resources/app.asar/cli.mjs'), ...tricky],
      env: { ELECTRON_RUN_AS_NODE: '1', PDFPAL_CLI_DESKTOP: '1', PDFPAL_CLI_LAUNCHER: realLauncher, NODE_OPTIONS: null, NODE_PATH: null, KEEP_ME: 'kept' }, stdin: 'piped input' }
    assert.deepEqual(launch(launcher, tricky, { input: 'piped input' }), { status: 0, stderr: '', report: expected })
    assert.ok(!fs.existsSync(path.join(root, 'pwned')) && !fs.existsSync('pwned'))

    // ~/.local/bin/pdfpal -> absolute symlink, and a chain through a relative symlink.
    const bin = path.join(root, 'home/.local/bin'); fs.mkdirSync(bin, { recursive: true })
    fs.symlinkSync(launcher, path.join(bin, 'pdfpal'))
    assert.deepEqual(launch(path.join(bin, 'pdfpal'), tricky, { input: 'piped input' }).report, expected)
    fs.mkdirSync(path.join(root, 'other'))
    fs.symlinkSync(path.relative(path.join(root, 'other'), launcher), path.join(root, 'other/pdfpal-relative'))
    fs.symlinkSync('../../../other/pdfpal-relative', path.join(bin, 'pdfpal-chain'))
    assert.deepEqual(launch(path.join(bin, 'pdfpal-chain'), tricky, { input: 'piped input' }).report, expected)
    // Found on PATH, as a reader's shell would run it.
    assert.deepEqual(launch('pdfpal', tricky, { input: 'piped input', env: { PATH: `${bin}:${process.env.PATH}` } }).report, expected)
    // The bundle reached through a symlinked folder still reports the real launcher path.
    fs.symlinkSync(apps, path.join(root, 'Applications'))
    assert.deepEqual(launch(path.join(root, 'Applications/pdfpal.app/Contents/Resources/bin/pdfpal'), ['doctor']).report.env.PDFPAL_CLI_LAUNCHER, realLauncher)
    // No arguments, and the child's exit code is returned unchanged.
    const none = launch(launcher, [], { env: { STUB_EXIT: '7' } })
    assert.equal(none.status, 7); assert.deepEqual(none.report.argv, [path.join(realContents, 'Resources/app.asar/cli.mjs')])
    // macOS /bin/sh is bash in POSIX mode; Linux /bin/sh is often dash. Run whichever exist.
    for (const shell of ['/bin/sh', '/bin/bash', '/bin/dash', '/bin/zsh'].filter(file => fs.existsSync(file))) {
      assert.deepEqual(launch(path.join(bin, 'pdfpal-chain'), tricky, { input: 'piped input', shell, env: shell.endsWith('bash') ? { POSIXLY_CORRECT: '1' } : {} }).report, expected, shell)
    }
    // A missing runtime fails with the launcher's own message.
    fs.rmSync(path.join(contents, 'MacOS/pdfpal'))
    const missing = launch(launcher, ['status'])
    assert.equal(missing.status, 1); assert.match(missing.stderr, /^pdfpal: The bundled CLI could not start\. Reinstall pdfpal from its disk image\.\n$/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('beforePack writes the macOS launcher for the configured executable name only on darwin', async () => {
  const project = temporary('pdfpal-mac-prepare-')
  try {
    fs.mkdirSync(path.join(project, 'stage/cli-bin'), { recursive: true })
    fs.writeFileSync(path.join(project, 'stage/cli-bin/pdfpal.exe'), 'stale Windows launcher')
    const context = (electronPlatformName, productFilename, executableName) => ({ electronPlatformName, packager: { projectDir: project, appInfo: { productFilename }, config: { executableName } } })
    await prepareCli(context('darwin', 'pdfpal-test', 'pdfpal-test'))
    assert.deepEqual(fs.readdirSync(path.join(project, 'stage/cli-bin')), ['pdfpal'])
    const launcher = path.join(project, 'stage/cli-bin/pdfpal')
    assert.equal(fs.statSync(launcher).mode & 0o777, 0o755)
    const text = fs.readFileSync(launcher, 'utf8')
    assert.ok(text.startsWith('#!/bin/sh\n')); assert.ok(text.includes('executable=$contents/MacOS/pdfpal-test\n')); assert.ok(!text.includes('__PDFPAL_EXECUTABLE__'))
    assert.equal(prepareCli.macExecutableName({ config: {} }), 'pdfpal')
    assert.equal(prepareCli.macExecutableName({ appInfo: { productFilename: 'pdfpal' }, config: { executableName: 'other' } }), 'pdfpal')
    for (const name of ['pdfpal test', '$(id)', '../pdfpal', '-pdfpal', "pdf'pal"]) assert.throws(() => prepareCli.macLauncher(name), /Invalid application executable name/)
    await assert.rejects(prepareCli(context('darwin', 'bad name')), /Invalid application executable name/)
    fs.rmSync(path.join(project, 'stage/cli-bin'), { recursive: true })
    await prepareCli(context('linux', 'pdfpal'))
    assert.ok(!fs.existsSync(path.join(project, 'stage/cli-bin')))
    if (process.platform !== 'win32') await assert.rejects(prepareCli(context('win32', 'pdfpal')), /native Windows/)
  } finally { fs.rmSync(project, { recursive: true, force: true }) }
})

test('the Mac icon is a real ICNS with the artwork on Apple\'s icon grid', () => {
  const svg = fs.readFileSync(path.join(desktop, '../frontend/public/favicon.svg'), 'utf8')
  const framed = macArtwork(svg, 1024)
  const [minX, minY, width, height] = /viewBox="([^"]+)"/.exec(framed)[1].split(' ').map(Number)
  const body = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/.exec(svg).slice(1).map(Number)
  // The body's left edge sits 100 px in from the canvas edge, and it is 824 px wide.
  assert.ok(Math.abs((body[0] - minX) / width * 1024 - 100) < 0.01)
  assert.ok(Math.abs(body[2] / width * 1024 - 824) < 0.01)
  assert.equal(width, height); assert.equal(minX, minY)
  assert.match(framed, /width="1024" height="1024"/)
  assert.throws(() => macArtwork('<svg viewBox="0 0 1 1"><circle r="1"/></svg>', 16), /rounded-square/)
  assert.equal(macGrid.body / macGrid.canvas, 824 / 1024)

  const elements = readIcns(fs.readFileSync(path.join(desktop, 'build/icon.icns')))
  assert.deepEqual(elements.map(element => [element.type, element.width]), icnsTypes)
  for (const element of elements) {
    assert.equal(element.width, element.height)
    assert.equal(element.data.subarray(1, 4).toString('latin1'), 'PNG')
  }
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000100000001008060000001f', 'hex')
  assert.deepEqual(readIcns(icns([['ic07', png]])).map(element => [element.type, element.width, element.height]), [['ic07', 16, 16]])
  assert.throws(() => icns([['ic07', Buffer.from('not a png')]]), /not PNG/)
  assert.throws(() => icns([['bad', png]]), /Invalid ICNS element type/)
  assert.throws(() => readIcns(Buffer.from('icnx0000')), /Not an ICNS/)
})
