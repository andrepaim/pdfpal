import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { versionParts } from '../src/updates.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const escapeXML = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')
export function sandboxConfiguration(directory) {
  if (!/^[A-Za-z]:[\\/]/.test(directory) || /[\r\n]/.test(directory)) throw new Error('Use a local Windows drive for the Sandbox kit')
  return `<Configuration>\n  <Networking>Enable</Networking>\n  <ClipboardRedirection>Disable</ClipboardRedirection>\n  <AudioInput>Disable</AudioInput>\n  <VideoInput>Disable</VideoInput>\n  <PrinterRedirection>Disable</PrinterRedirection>\n  <MemoryInMB>8192</MemoryInMB>\n  <MappedFolders>\n    <MappedFolder><HostFolder>${escapeXML(path.win32.join(directory,'payload'))}</HostFolder><SandboxFolder>C:\\PDFPalTest</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>\n    <MappedFolder><HostFolder>${escapeXML(path.win32.join(directory,'results'))}</HostFolder><SandboxFolder>C:\\PDFPalResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>\n  </MappedFolders>\n  <LogonCommand><Command>explorer.exe &quot;C:\\PDFPalTest&quot;</Command></LogonCommand>\n</Configuration>\n`
}
export async function createBetaKit(artifacts, output) {
  const manifest = JSON.parse(await fs.readFile(path.join(artifacts,'pdfpal-desktop-release.json'),'utf8'))
  versionParts(manifest.version)
  if (manifest.format !== 1 || manifest.appId !== 'io.pdfpal.desktop' || manifest.platform !== 'win32' || manifest.arch !== 'x64' || typeof manifest.signed !== 'boolean' ||
      !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.installer !== `pdfpal-Setup-${manifest.version}-x64.exe` || !/^[a-f0-9]{64}$/i.test(manifest.sha256 ?? '')) throw new Error('Invalid production desktop installer manifest')
  const installer = path.join(artifacts,manifest.installer)
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(installer)) hash.update(chunk)
  if (hash.digest('hex') !== manifest.sha256 || (await fs.stat(installer)).size !== manifest.size) throw new Error('Installer bytes do not match the release manifest')
  const payload = path.join(output,'payload')
  await fs.mkdir(payload,{recursive:true}); await fs.mkdir(path.join(output,'results'),{recursive:true})
  await fs.copyFile(installer,path.join(payload,manifest.installer))
  await fs.copyFile(path.join(artifacts,'pdfpal-desktop-release.json'),path.join(payload,'pdfpal-desktop-release.json'))
  for (const obsolete of ['Start test.cmd','Start-Test.ps1']) {
    try { await fs.rm(path.join(payload,obsolete),{force:true}) }
    catch { throw new Error('An obsolete launcher in the old kit cannot be removed. Build into a fresh folder and leave security protection enabled.') }
  }
  const template=await fs.readFile(path.join(root,'desktop/beta/Session recorder.html'),'utf8')
  const seed={version:manifest.version,installer:{name:manifest.installer,size:manifest.size,sha256:manifest.sha256.toLowerCase()}}
  await fs.writeFile(path.join(payload,'Session recorder.html'),template.replace('@@PDFPAL_SESSION@@',JSON.stringify(seed)))
  for (const file of ['Open Sandbox.cmd','Open-Sandbox.ps1']) await fs.copyFile(path.join(root,'desktop/beta',file),path.join(output,file))
  await fs.copyFile(path.join(root,'test/fixtures/sample.pdf'),path.join(payload,'Sample PDF.pdf'))
  await fs.copyFile(path.join(root,'docs/windows-quickstart.md'),path.join(payload,'Windows quickstart.txt'))
  await fs.copyFile(path.join(root,'docs/windows-beta-guide.md'),path.join(output,'Read me first.txt'))
  // Portable copying to another drive needs regeneration of these host mappings.
  if (/^[A-Za-z]:[\\/]/.test(output)) await fs.writeFile(path.join(output,'Fresh Windows test.wsb'),sandboxConfiguration(output))
  return { version: manifest.version, signed: manifest.signed, installer: manifest.installer, sha256: manifest.sha256 }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [artifacts,output] = process.argv.slice(2)
  if (!artifacts || !output) throw new Error('Usage: node create-beta-kit.mjs <artifacts> <output-directory>')
  console.log(JSON.stringify(await createBetaKit(path.resolve(artifacts),path.resolve(output)),null,2))
}
