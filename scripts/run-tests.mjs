import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve('test')
const files = []
function visit(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) visit(full)
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(full)
  }
}
visit(root)
if (!files.length) {
  console.error('No TypeScript test files found under test/**/*.test.ts')
  process.exit(1)
}
files.sort()
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
