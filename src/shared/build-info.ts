import fs from 'node:fs'

export function buildVersion(): string {
  try { return String(JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version) }
  catch { return 'development' }
}
