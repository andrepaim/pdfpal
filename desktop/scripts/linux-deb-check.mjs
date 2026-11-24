// Inspect and exercise an extracted Debian installation without changing the OS.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { verifyDebianIdentity } from './linux-release.mjs'
import { verifyDictionary } from '../../scripts/prepare-dictionary.mjs'
const exec = promisify(execFile)
const version = JSON.parse(await fs.readFile(new URL('../version.json', import.meta.url), 'utf8')).version
const artifact = path.resolve(process.argv[2] ?? `desktop/artifacts/pdfpal-${version}-amd64.deb`)
const receipt = path.resolve(process.argv[3] ?? 'desktop/evidence/linux-deb.json')
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-deb-acceptance-'))
const hash = async filename => { const value = createHash('sha256'); for await (const chunk of createReadStream(filename)) value.update(chunk); return value.digest('hex') }
try {
  const metadata = (await exec('dpkg-deb', ['--show', '--showformat=${Package}\n${Version}\n${Architecture}', artifact])).stdout.split('\n')
  verifyDebianIdentity(metadata, version, 'x64')
  await exec('dpkg-deb', ['--extract', artifact, work])
  await exec('dpkg-deb', ['--control', artifact, path.join(work, 'control')])
  const application = path.join(work, 'opt/pdfpal')
  for (const name of ['pdfpal-desktop', 'bin/pdfpal-desktop-cli', 'chrome-sandbox', 'resources/app.asar', 'resources/apparmor-profile']) assert.ok((await fs.stat(path.join(application, name))).isFile(), name)
  await verifyDictionary(path.join(application, 'resources'))
  for (const [name, required] of [['postinst', ['update-alternatives', 'chrome-sandbox', 'APPARMOR_PROFILE_SOURCE', 'pdfpal-desktop-cli']], ['postrm', ['APPARMOR_PROFILE_DEST', 'pdfpal-desktop-cli']]]) {
    const filename = path.join(work, 'control', name), body = await fs.readFile(filename, 'utf8')
    await exec('bash', ['-n', filename])
    for (const text of required) assert.ok(body.includes(text), `${name} missing ${text}`)
  }
  const entry = path.join(work, 'usr/share/applications/io.pdfpal.desktop.desktop')
  await exec('desktop-file-validate', [entry])
  assert.ok(!(await fs.readFile(entry, 'utf8')).includes('--no-sandbox'))
  const bin = path.join(work, 'bin'); await fs.mkdir(bin)
  for (const name of ['dirname', 'readlink']) await fs.symlink(`/usr/bin/${name}`, path.join(bin, name))
  const { stdout } = await exec(path.join(application, 'bin/pdfpal-desktop-cli'), ['--help'], { env: { ...process.env, HOME: path.join(work, 'home'), XDG_CONFIG_HOME: path.join(work, 'config'), PATH: bin }, timeout: 15000 })
  assert.match(stdout, /desktop library/)
  const evidence = { status: 'passed', package: path.basename(artifact), version: metadata[1], architecture: metadata[2],
    size: (await fs.stat(artifact)).size, sha256: await hash(artifact),
    checks: ['debian-identity', 'installed-layout', 'bundled-wiktionary-pack-and-notice-integrity', 'desktop-entry-valid', 'upstream-sandbox-and-apparmor-hooks-preserved', 'bundled-cli-from-extracted-package-without-system-node'],
    installedOnHost: false }
  await fs.mkdir(path.dirname(receipt), { recursive: true }); await fs.writeFile(receipt, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally { await fs.rm(work, { recursive: true, force: true }) }
