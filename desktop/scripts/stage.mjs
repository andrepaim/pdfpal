import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const desktop = fileURLToPath(new URL('../', import.meta.url))
const root = path.resolve(desktop, '..')
const stage = path.join(desktop, 'stage')
const version = process.env.PDFPAL_DESKTOP_VERSION ?? JSON.parse(await fs.readFile(path.join(desktop, 'version.json'), 'utf8')).version
const { versionParts } = await import('../src/updates.mjs')
versionParts(version)
await fs.mkdir(stage, { recursive: true })
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'pdfpal-desktop', version,
  private: true, type: 'module', main: 'main.mjs', description: 'Read PDFs and Kindle with your AI assistant', author: 'pdfpal contributors', license: 'MIT', homepage: 'https://github.com/andrepaim/pdfpal',
  pdfpalDesktop: { appId: 'io.pdfpal.desktop', distribution: 'unsigned' },
  // v13 uses N-API and ships platform binaries; v12 fails against Electron 45's V8.
  dependencies: { ...pkg.dependencies, 'better-sqlite3': '13.0.3', '@napi-rs/canvas': '0.1.100' } }, null, 2))
await fs.copyFile(path.join(desktop, 'runtime-lock.json'), path.join(stage, 'package-lock.json'))
for (const [source, destination] of [
  ['dist', 'dist'], ['frontend/dist', 'frontend/dist'], ['extension/package', 'extension/package'],
  ['test/fixtures/sample.pdf', 'sample.pdf'], ['desktop/src/main.mjs', 'main.mjs'], ['desktop/src/backend.mjs', 'backend.mjs'],
  ['desktop/src/preload.cjs', 'preload.cjs'],
  ...['setup.mjs', 'updates.mjs', 'installer-acceptance.mjs', 'recovery.html', 'recovery.js', 'recovery.css'].map(name => [`desktop/src/${name}`, name]), ['desktop/src/preferences.mjs', 'preferences.mjs'],
  ['desktop/test/runtime.test.mjs', 'test/runtime.test.mjs'],
  ['desktop/test/setup-native.mjs', 'test/setup-native.mjs'],
  ['desktop/test/setup.test.mjs', 'test/setup.test.mjs'],
]) await fs.cp(path.join(root, source), path.join(stage, destination), { recursive: true })
const runtimeTest = path.join(stage, 'test/runtime.test.mjs')
await fs.writeFile(runtimeTest, (await fs.readFile(runtimeTest, 'utf8')).replaceAll('../stage/dist/', '../dist/'))
const setupTest = path.join(stage, 'test/setup.test.mjs')
await fs.writeFile(setupTest, (await fs.readFile(setupTest, 'utf8')).replace('../src/setup.mjs', '../setup.mjs'))
const tests = await fs.readFile(path.join(root, 'test/unit/agent-discovery.test.ts'), 'utf8')
await fs.writeFile(path.join(stage, 'discovery.test.mjs'), ts.transpileModule(tests.replace('../../src/core/', './dist/core/'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText)
await fs.writeFile(path.join(stage, 'providers.mjs'), (await fs.readFile(path.join(desktop, 'scripts/check-providers.mjs'), 'utf8')).replace('../../dist/core/', './dist/core/'))
console.log('Desktop staging prepared; install/rebuild dependencies only inside desktop/stage.')

const { writeNotices } = await import('./notices.mjs')
try { console.log(`Third-party notices: ${writeNotices(stage, root)} packages`) } catch { console.log('Generate runtime notices after installing staged dependencies.') }
