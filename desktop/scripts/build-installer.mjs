import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { versionParts } from '../src/updates.mjs'

export const platforms = Object.freeze({
  win32: Object.freeze({ arches: ['x64'], defaultArch: 'x64', builderFlag: '--win' }),
  darwin: Object.freeze({ arches: ['arm64', 'x64'], defaultArch: 'arm64', builderFlag: '--mac' }),
})
function platformEntry(platform) {
  const entry = Object.hasOwn(platforms, platform) ? platforms[platform] : undefined
  if (!entry) throw new Error(`Unsupported desktop platform: ${platform}. Use win32 or darwin.`)
  return entry
}
export function resolveArch(platform, arch) {
  const entry = platformEntry(platform)
  const selected = arch ?? entry.defaultArch
  if (!entry.arches.includes(selected)) throw new Error(`Unsupported ${platform} architecture: ${selected}. Use ${entry.arches.join(' or ')}.`)
  return selected
}
export function installerName(platform, version, arch) {
  arch = resolveArch(platform, arch)
  return platform === 'darwin' ? `pdfpal-${version}-${arch}.dmg` : `pdfpal-Setup-${version}-${arch}.exe`
}
// The Windows name predates other platforms and installed Windows apps read it, so it never changes.
export function manifestName(platform, arch) {
  arch = resolveArch(platform, arch)
  return platform === 'darwin' ? `pdfpal-desktop-release-darwin-${arch}.json` : 'pdfpal-desktop-release.json'
}
export function configurationName(platform, arch) {
  arch = resolveArch(platform, arch)
  return platform === 'darwin' ? `installer-build-darwin-${arch}.json` : 'installer-build.json'
}
export function releaseManifest({ appId, version, platform, arch, installer, sha256, size }) {
  return { format: 1, appId, version, platform, arch: resolveArch(platform, arch), signed: false, publisher: null, installer, sha256, size }
}
export async function writeReleaseManifest(output, { appId, version, platform, arch }) {
  const installer = path.join(output, installerName(platform, version, arch))
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(installer)) hash.update(chunk)
  const manifest = releaseManifest({ appId, version, platform, arch, installer: path.basename(installer), sha256: hash.digest('hex'), size: fs.statSync(installer).size })
  fs.writeFileSync(path.join(output, manifestName(platform, arch)), JSON.stringify(manifest, null, 2))
  return manifest
}

export function signingConfiguration(signed, env = process.env) {
  if (!signed) return { forceCodeSigning: false, win: { signExecutable: false } }
  const publisher = env.PDFPAL_PUBLISHER_NAME?.trim()
  const thumbprint = env.PDFPAL_CERTIFICATE_SHA1?.replaceAll(' ', '')
  if (!publisher || /[\r\n]/.test(publisher) || !(env.CSC_LINK || env.WIN_CSC_LINK || /^[a-f0-9]{40}$/i.test(thumbprint ?? ''))) throw new Error('Signed builds require PDFPAL_PUBLISHER_NAME and CSC_LINK/WIN_CSC_LINK or PDFPAL_CERTIFICATE_SHA1. No signing credentials are configured.')
  return { forceCodeSigning: true, win: { signExecutable: true, signtoolOptions: { publisherName: publisher, ...(thumbprint ? { certificateSha1: thumbprint } : {}), signingHashAlgorithms: ['sha256'] } } }
}
export function buildConfiguration(project, { version, signed = false, acceptance = false, output, platform = 'win32' }, env = process.env) {
  versionParts(version)
  platformEntry(platform)
  if (platform === 'darwin') return macBuildConfiguration(project, { version, signed, acceptance, output })
  if (acceptance && signed) throw new Error('Acceptance fixtures must use isolated unsigned builds')
  const signing = signingConfiguration(signed, env)
  const appId = acceptance ? 'io.pdfpal.desktop.installer-acceptance' : 'io.pdfpal.desktop'
  return { extends: path.join(project, 'electron-builder.yml'), ...signing,
    ...(acceptance ? { compression: 'store', appId, productName: 'pdfpal Installer Test', executableName: 'pdfpal-test', nsis: { shortcutName: 'pdfpal Installer Test', uninstallDisplayName: 'pdfpal Installer Test' } } : {}),
    directories: { output: output ?? path.join(project, acceptance ? 'artifacts-acceptance' : 'artifacts') },
    extraMetadata: { version, pdfpalDesktop: { appId, distribution: signed ? 'signed' : 'unsigned' } } }
}
// Mac previews are ad-hoc signed and not notarized. Developer ID signing is milestone MAC-41.
function macBuildConfiguration(project, { version, signed, acceptance, output }) {
  if (signed) throw new Error('Signed macOS builds are not supported yet. Mac previews are ad-hoc signed and not notarized; Developer ID signing and notarization arrive with MAC-41. Build without --signed.')
  const appId = acceptance ? 'io.pdfpal.desktop.installer-acceptance' : 'io.pdfpal.desktop'
  return { extends: path.join(project, 'electron-builder.yml'), forceCodeSigning: false,
    mac: { identity: '-', hardenedRuntime: false, notarize: false },
    ...(acceptance ? { appId, productName: 'pdfpal Installer Test', executableName: 'pdfpal-test' } : {}),
    directories: { output: output ?? path.join(project, acceptance ? 'artifacts-acceptance' : 'artifacts') },
    extraMetadata: { version, pdfpalDesktop: { appId, distribution: 'unsigned' } } }
}
// Signing variables are removed from unsigned builds so an ambient certificate is never used.
export function builderEnvironment(platform, signed, env = process.env) {
  const result = { ...env, CSC_IDENTITY_AUTO_DISCOVERY: signed ? 'true' : 'false' }
  if (!signed) for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'CSC_NAME']) delete result[name]
  // electron-builder skips all macOS signing in pull-request builds unless asked. The ad-hoc
  // identity uses no credential, and Apple Silicon will not run an unsigned bundle.
  if (platform === 'darwin') {
    result.CSC_FOR_PULL_REQUEST = 'true'
    for (const name of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE', 'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD']) delete result[name]
  }
  return result
}
export function builderArguments({ tools, project, config, platform = 'win32', arch, prepackaged, dir = false }) {
  arch = resolveArch(platform, arch)
  const { builderFlag } = platformEntry(platform)
  if (platform !== 'darwin' && (dir || prepackaged)) throw new Error('Windows installer builds do not take --dir or --prepackaged here')
  if (dir && prepackaged) throw new Error('A prepackaged application is only used to build the disk image')
  // macOS builds name the disk image target explicitly so a --dir run and a disk image run share one configuration.
  const target = platform === 'darwin' && !dir ? ['dmg'] : []
  return [path.join(tools, 'node_modules/electron-builder/cli.js'), '--projectDir', project, '--config', config, builderFlag, ...target, `--${arch}`,
    ...(dir ? ['--dir'] : []), ...(prepackaged ? ['--prepackaged', prepackaged] : []), '--publish', 'never']
}
export function parseArguments(argv) {
  return Object.fromEntries(argv.map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.length ? rest.join('=') : true] }))
}

async function buildMac(args) {
  if (args.signed === true) buildConfiguration('', { version: '0.0.0', signed: true, platform: 'darwin' })
  if (process.platform !== 'darwin') throw new Error('Build the macOS disk image on a Mac (darwin). Windows and Linux cannot create or sign it.')
  const arch = resolveArch('darwin', args.arch === true ? undefined : args.arch)
  const project = path.resolve(args.project ?? fileURLToPath(new URL('../', import.meta.url)))
  const tools = path.resolve(args.tools ?? project)
  const version = args.version ?? JSON.parse(fs.readFileSync(path.join(project, 'stage/package.json'), 'utf8')).version
  const acceptance = args.acceptance === true
  const config = buildConfiguration(project, { version, acceptance, output: args.output && path.resolve(args.output), platform: 'darwin' })
  const filename = path.join(project, configurationName('darwin', arch))
  fs.writeFileSync(filename, JSON.stringify(config, null, 2))
  const output = config.directories.output
  fs.rmSync(path.join(output, manifestName('darwin', arch)), { force: true })
  const builderArgs = builderArguments({ tools, project, config: filename, platform: 'darwin', arch, prepackaged: args.prepackaged && path.resolve(args.prepackaged) })
  const result = spawnSync(process.execPath, builderArgs, { cwd: project, env: builderEnvironment('darwin', false), stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
  await writeReleaseManifest(output, { appId: config.extraMetadata.pdfpalDesktop.appId, version, platform: 'darwin', arch })
  console.log('Unsigned (ad-hoc signed, not notarized) macOS preview built. This artifact is for testing.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2))
  const platform = args.platform === undefined ? 'win32' : args.platform
  platformEntry(platform)
  if (platform === 'darwin') { await buildMac(args); process.exit(0) }
  if (process.platform !== 'win32') throw new Error('Build the Windows installer under native Windows Node.js')
  const project = path.resolve(args.project ?? fileURLToPath(new URL('../', import.meta.url)))
  const tools = path.resolve(args.tools ?? project)
  const version = args.version ?? JSON.parse(fs.readFileSync(path.join(project, 'stage/package.json'), 'utf8')).version
  const signed = args.signed === true, acceptance = args.acceptance === true
  const config = buildConfiguration(project, { version, signed, acceptance, output: args.output && path.resolve(args.output) })
  const filename = path.join(project, 'installer-build.json')
  fs.writeFileSync(filename, JSON.stringify(config, null, 2))
  fs.rmSync(path.join(config.directories.output, 'pdfpal-desktop-release.json'), { force: true })
  const env = builderEnvironment('win32', signed)
  const builderArgs = builderArguments({ tools, project, config: filename })
  let result
  for (let attempt = 0; attempt < 2; attempt++) {
    result = spawnSync(process.execPath, builderArgs, { cwd: project, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true })
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '')
    if (result.status === 0 || !/Can't open output file|spawn EPERM/i.test(`${result.stdout}\n${result.stderr}`) || attempt > 0) break
    // Windows scanners can briefly keep the intermediate NSIS stub open.
    console.log('Retrying the installer build after a transient output-file lock.')
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
  const output = config.directories.output
  const installer = path.join(output, installerName('win32', version))
  if (!signed) {
    await writeReleaseManifest(output, { appId: config.extraMetadata.pdfpalDesktop.appId, version, platform: 'win32', arch: 'x64' })
    console.log('Unsigned preview built. This artifact is for testing.')
    process.exit(0)
  }
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const verify = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./verify-release.ps1', import.meta.url)),
    '-Installer', installer, '-Application', path.join(output, 'win-unpacked', 'pdfpal.exe'), '-Version', version,
    '-Manifest', path.join(output, 'pdfpal-desktop-release.json'), '-Signed', '-Publisher', process.env.PDFPAL_PUBLISHER_NAME], { stdio: 'inherit', windowsHide: true, timeout: 120000 })
  if (verify.error) console.error('Signature verification did not complete. No signed release manifest was produced.')
  process.exit(verify.status ?? 1)
}
