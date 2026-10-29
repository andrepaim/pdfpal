import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const desktop = fileURLToPath(new URL('../', import.meta.url))
const root = path.resolve(desktop, '..')
const stage = path.join(desktop, 'stage')
await fs.mkdir(stage, { recursive: true })
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'pdfpal-desktop-m0', version: pkg.version,
  private: true, type: 'module', main: 'main.mjs', description: 'pdfpal Windows feasibility build', author: 'pdfpal contributors',
  // v13 uses N-API and ships platform binaries; v12 fails against Electron 45's V8.
  dependencies: { ...pkg.dependencies, 'better-sqlite3': '13.0.3', '@napi-rs/canvas': '0.1.100' } }, null, 2))
await fs.copyFile(path.join(desktop, 'runtime-lock.json'), path.join(stage, 'package-lock.json'))
for (const [source, destination] of [
  ['dist', 'dist'], ['frontend/dist', 'frontend/dist'], ['extension/package', 'extension/package'],
  ['test/fixtures/sample.pdf', 'sample.pdf'], ['desktop/src/main.mjs', 'main.mjs'], ['desktop/src/backend.mjs', 'backend.mjs'],
]) await fs.cp(path.join(root, source), path.join(stage, destination), { recursive: true })
const tests = await fs.readFile(path.join(root, 'test/unit/agent-discovery.test.ts'), 'utf8')
await fs.writeFile(path.join(stage, 'discovery.test.mjs'), ts.transpileModule(tests.replace('../../src/core/', './dist/core/'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText)
await fs.writeFile(path.join(stage, 'providers.mjs'), (await fs.readFile(path.join(desktop, 'scripts/check-providers.mjs'), 'utf8')).replace('../../dist/core/', './dist/core/'))
console.log('Desktop staging prepared; install/rebuild dependencies only inside desktop/stage.')
