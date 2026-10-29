import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { versionParts } from '../src/updates.mjs'

export function signingConfiguration(signed, env = process.env) {
  if (!signed) return { forceCodeSigning: false, win: { signExecutable: false } }
  const publisher = env.PDFPAL_PUBLISHER_NAME?.trim()
  const thumbprint = env.PDFPAL_CERTIFICATE_SHA1?.replaceAll(' ', '')
  if (!publisher || /[\r\n]/.test(publisher) || !(env.CSC_LINK || env.WIN_CSC_LINK || /^[a-f0-9]{40}$/i.test(thumbprint ?? ''))) throw new Error('Signed builds require PDFPAL_PUBLISHER_NAME and CSC_LINK/WIN_CSC_LINK or PDFPAL_CERTIFICATE_SHA1. No signing credentials are configured.')
  return { forceCodeSigning: true, win: { signExecutable: true, signtoolOptions: { publisherName: publisher, ...(thumbprint ? { certificateSha1: thumbprint } : {}), signingHashAlgorithms: ['sha256'] } } }
}
export function buildConfiguration(project, { version, signed = false, acceptance = false, output }, env = process.env) {
  versionParts(version)
  if (acceptance && signed) throw new Error('Acceptance fixtures must use isolated unsigned builds')
  const signing = signingConfiguration(signed, env)
  const appId = acceptance ? 'io.pdfpal.desktop.installer-acceptance' : 'io.pdfpal.desktop'
  return { extends: path.join(project, 'electron-builder.yml'), ...signing,
    ...(acceptance ? { compression: 'store', appId, productName: 'pdfpal Installer Test', executableName: 'pdfpal-test', nsis: { shortcutName: 'pdfpal Installer Test', uninstallDisplayName: 'pdfpal Installer Test' } } : {}),
    directories: { output: output ?? path.join(project, acceptance ? 'artifacts-acceptance' : 'artifacts') },
    extraMetadata: { version, pdfpalDesktop: { appId, distribution: signed ? 'signed' : 'unsigned' } } }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.length ? rest.join('=') : true] }))
  if (process.platform !== 'win32') throw new Error('Build the Windows installer under native Windows Node.js')
  const project = path.resolve(args.project ?? fileURLToPath(new URL('../', import.meta.url)))
  const tools = path.resolve(args.tools ?? project)
  const version = args.version ?? JSON.parse(fs.readFileSync(path.join(project, 'stage/package.json'), 'utf8')).version
  const signed = args.signed === true, acceptance = args.acceptance === true
  const config = buildConfiguration(project, { version, signed, acceptance, output: args.output && path.resolve(args.output) })
  const filename = path.join(project, 'installer-build.json')
  fs.writeFileSync(filename, JSON.stringify(config, null, 2))
  fs.rmSync(path.join(config.directories.output, 'pdfpal-desktop-release.json'), { force: true })
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: signed ? 'true' : 'false' }
  if (!signed) for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'CSC_NAME']) delete env[name]
  const builderArgs = [path.join(tools, 'node_modules/electron-builder/cli.js'), '--projectDir', project, '--config', filename, '--win', '--x64', '--publish', 'never']
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
  const installer = path.join(output, `pdfpal-Setup-${version}-x64.exe`)
  if (!signed) {
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(installer)) hash.update(chunk)
    fs.writeFileSync(path.join(output, 'pdfpal-desktop-release.json'), JSON.stringify({ format: 1, appId: config.extraMetadata.pdfpalDesktop.appId, version, platform: 'win32', arch: 'x64', signed: false, publisher: null,
      installer: path.basename(installer), sha256: hash.digest('hex'), size: fs.statSync(installer).size }, null, 2))
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
