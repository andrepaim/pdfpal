import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareLinuxRelease, verifyDebianIdentity } from '../scripts/linux-release.mjs'
import { linuxHooks } from '../scripts/package-linux.mjs'
const run = promisify(execFile)

test('Linux launcher preserves arguments and uses the packaged runtime through a symlink', { skip: process.platform === 'win32' }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal launcher '))
  try {
    await fs.mkdir(path.join(temp, 'app/bin'), { recursive: true })
    await fs.copyFile(new URL('../build/linux-cli.sh', import.meta.url), path.join(temp, 'app/bin/pdfpal-desktop-cli'))
    await fs.chmod(path.join(temp, 'app/bin/pdfpal-desktop-cli'), 0o755)
    await fs.writeFile(path.join(temp, 'app/pdfpal-desktop'), '#!/bin/sh\nprintf "%s\\n" "$ELECTRON_RUN_AS_NODE" "$@"\n', { mode: 0o755 })
    await fs.symlink(path.join(temp, 'app/bin/pdfpal-desktop-cli'), path.join(temp, 'command'))
    const { stdout } = await run(path.join(temp, 'command'), ['--json', 'a b', '$(unsafe)', 'quote"'])
    assert.deepEqual(stdout.trimEnd().split('\n'), ['1', path.join(temp, 'app/resources/app.asar/cli.mjs'), '--json', 'a b', '$(unsafe)', 'quote"'])
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})

test('Linux provenance validates artifact identity and records unsigned manual distribution', { skip: process.platform !== 'linux' }, async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-linux-release-'))
  try {
    const options = { version: '2.8.0-beta.4', commit: 'a'.repeat(40) }
    const packageDir = path.join(temp, 'package'); await fs.mkdir(path.join(packageDir, 'DEBIAN'), { recursive: true })
    await fs.writeFile(path.join(packageDir, 'DEBIAN/control'), 'Package: pdfpal-desktop\nVersion: 2.8.0~beta.4\nArchitecture: amd64\nMaintainer: Test <test@example.invalid>\nDescription: Temporary synthetic package\n')
    await run('dpkg-deb', ['--build', '--root-owner-group', packageDir, path.join(temp, 'pdfpal-2.8.0-beta.4-amd64.deb')])
    const manifest = await prepareLinuxRelease(temp, options)
    assert.equal(manifest.platform, 'linux'); assert.equal(manifest.signed, false); assert.equal(manifest.upgrade, 'manual')
    assert.match(await fs.readFile(path.join(temp, 'SHA256SUMS-linux.txt'), 'utf8'), /^[a-f0-9]{64}  pdfpal-/)
    await assert.rejects(prepareLinuxRelease(temp, { ...options, commit: 'HEAD' }))
    await assert.rejects(prepareLinuxRelease(temp, { ...options, arch: '../x64' }))
    await fs.writeFile(path.join(temp, 'pdfpal-2.8.0-beta.4-amd64.deb'), 'foreign executable')
    await assert.rejects(prepareLinuxRelease(temp, options), /Invalid Debian/)
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})

test('Debian provenance rejects renamed packages with a foreign name, version or architecture', () => {
  const metadata = ['pdfpal-desktop', '2.8.0~beta.4', 'amd64']
  verifyDebianIdentity(metadata, '2.8.0-beta.4', 'x64')
  for (let index = 0; index < 3; index++) assert.throws(() => verifyDebianIdentity(metadata.map((value, i) => i === index ? 'foreign' : value), '2.8.0-beta.4', 'x64'), /identity/)
})

test('Debian hooks extend upstream sandbox and desktop integration scripts', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-linux-hooks-'))
  try {
    const templates = path.join(temp, 'templates'); await fs.mkdir(templates)
    for (const name of ['after-install', 'after-remove']) await fs.writeFile(path.join(templates, name + '.tpl'), '#!/bin/bash\n# upstream sandbox/AppArmor integration\n')
    const hooks = await linuxHooks(temp, templates)
    for (const filename of Object.values(hooks)) {
      const body = await fs.readFile(filename, 'utf8')
      assert.ok(body.startsWith('#!/bin/bash\n# upstream sandbox/AppArmor integration\n'))
      assert.ok(body.includes('pdfpal-desktop-cli'))
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})
