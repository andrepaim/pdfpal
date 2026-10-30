import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { buildConfiguration } from './build-installer.mjs'
if (process.platform !== 'win32') throw new Error('Use native Windows Node.js')
const project = path.resolve(process.argv[2])
const version = JSON.parse(fs.readFileSync(path.join(project, 'stage/package.json'), 'utf8')).version
const output = path.join(project, 'beta-artifacts')
const config = buildConfiguration(project, { version, acceptance: true, output })
const filename = path.join(project, 'beta-build.json')
fs.writeFileSync(filename, JSON.stringify(config, null, 2))
const result = spawnSync(process.execPath, [path.join(project, 'tools/node_modules/electron-builder/cli.js'), '--projectDir', project, '--config', filename, '--win', '--x64', '--dir', '--publish', 'never'], { cwd: project, stdio: 'inherit', windowsHide: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
if (result.status !== 0) process.exit(result.status ?? 1)
const exe = path.join(output, 'win-unpacked/pdfpal-test.exe')
const hash = createHash('sha256')
for await (const chunk of fs.createReadStream(exe)) hash.update(chunk)
fs.writeFileSync(path.join(output, 'beta-build-receipt.json'), JSON.stringify({ version, appId: config.appId, executable: 'pdfpal-test.exe', sha256: hash.digest('hex') }, null, 2))
