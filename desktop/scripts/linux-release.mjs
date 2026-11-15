import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { versionParts } from '../src/updates.mjs'

export function verifyDebianIdentity(metadata, version, arch) {
  const expected = ['pdfpal-desktop', version.replace('-', '~'), arch === 'x64' ? 'amd64' : arch]
  if (!Array.isArray(metadata) || metadata.length !== 3 || metadata.some((value, index) => value !== expected[index])) throw new Error('Debian package identity does not match the requested release')
}

/** Integrity/provenance for manual Debian distribution; never an updater trust assertion. */
export async function prepareLinuxRelease(directory, { version, commit, arch = 'x64', sourceDirty = true }) {
  versionParts(version)
  if (!/^[a-f0-9]{40}$/i.test(commit) || !['x64', 'arm64'].includes(arch)) throw new Error('A source commit and supported architecture are required')
  const filename = `pdfpal-${version}-${arch === 'x64' ? 'amd64' : arch}.deb`
  const bytes = await fs.readFile(path.join(directory, filename))
  if (!bytes.subarray(0, 8).equals(Buffer.from('!<arch>\n'))) throw new Error('Invalid Debian archive')
  const metadata = execFileSync('dpkg-deb', ['--show', '--showformat=${Package}\n${Version}\n${Architecture}', path.join(directory, filename)], { encoding: 'utf8', maxBuffer: 65536 }).split('\n')
  verifyDebianIdentity(metadata, version, arch)
  const manifest = { format: 1, appId: 'io.pdfpal.desktop', version, platform: 'linux', arch,
    installer: filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceCommit: commit, sourceDirty: Boolean(sourceDirty), signed: false, upgrade: 'manual' }
  const name = 'pdfpal-linux-release.json'
  const body = JSON.stringify(manifest, null, 2) + '\n'
  await fs.writeFile(path.join(directory, name), body)
  await fs.writeFile(path.join(directory, 'SHA256SUMS-linux.txt'), `${manifest.sha256}  ${filename}\n${createHash('sha256').update(body).digest('hex')}  ${name}\n`)
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, commit, arch] = process.argv.slice(2)
  if (!directory || !commit) throw new Error('Usage: node linux-release.mjs <artifact-directory> <source-commit> [x64|arm64]')
  const version = JSON.parse(await fs.readFile(new URL('../version.json', import.meta.url), 'utf8')).version
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim() !== commit) throw new Error('Linux source commit does not match the actual checkout')
  const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }).trim())
  console.log(JSON.stringify(await prepareLinuxRelease(directory, { version, commit, arch, sourceDirty }), null, 2))
}
