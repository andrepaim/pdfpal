import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { PdfpalError } from '../core/types.js'

type Manifest = { format: 1; files: Record<string, string> }
const manifestName = '.pdfpal-managed.json'
function files(root: string, prefix = ''): Record<string, string> {
  if (!fs.existsSync(root)) return {}
  return Object.fromEntries(fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === manifestName) return []
    const relative = prefix + entry.name, full = path.join(root, entry.name)
    if (entry.isSymbolicLink()) throw new PdfpalError('SKILL_SYMLINK', 'The skill folder contains a symbolic link. Keep a regular copy before replacing it.', 4)
    return entry.isDirectory() ? Object.entries(files(full, relative + '/')) : [[relative, createHash('sha256').update(fs.readFileSync(full)).digest('hex')]]
  }))
}
export function skillStatus(home = os.homedir()) {
  const directory = path.join(home, '.agents', 'skills', 'pdfpal-cli')
  let manifest: Manifest | undefined
  try { const parsed = JSON.parse(fs.readFileSync(path.join(directory, manifestName), 'utf8')); if (parsed.format === 1 && parsed.files && typeof parsed.files === 'object') manifest = parsed } catch {}
  const actual = files(directory), managed = Boolean(manifest)
  const edited = managed && JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(manifest!.files).sort())
  const legacy = [path.join(home, '.codex', 'skills', 'pdfpal-cli'), path.join(home, '.claude', 'skills', 'pdfpal-cli')].filter(p => fs.existsSync(path.join(p, 'SKILL.md')))
  return { directory, installed: fs.existsSync(path.join(directory, 'SKILL.md')), managed, edited, legacy, verifiedInChatGPT: false }
}
export function installSkill(options: { replace?: boolean; managedOnly?: boolean; home?: string; source?: string } = {}) {
  const home = options.home ?? os.homedir(), status = skillStatus(home)
  if (options.managedOnly && (!status.managed || status.edited)) return { ...status, updated: false }
  if ((status.installed && (!status.managed || status.edited)) && !options.replace)
    throw new PdfpalError('SKILL_CUSTOMIZED', 'An existing skill has custom or unmanaged files. Use skill install --replace to back it up and replace it.', 4)
  if (status.legacy.length && !status.managed) throw new PdfpalError('SKILL_LEGACY_CONFLICT', 'A legacy pdfpal skill already exists. Remove or relocate that copy before installing another discoverable skill.', 4, { directories: status.legacy })
  const source = options.source ?? fileURLToPath(new URL('../../skills/pdfpal-cli/', import.meta.url))
  const hashes = files(source)
  if (!hashes['SKILL.md']) throw new PdfpalError('SKILL_NOT_BUNDLED', 'This installation does not include the pdfpal skill.', 3)
  if (status.managed && !status.edited && JSON.stringify(Object.entries(files(status.directory)).sort()) === JSON.stringify(Object.entries(hashes).sort())) return { ...status, updated: false }
  const parent = path.dirname(status.directory)
  fs.mkdirSync(parent, { recursive: true })
  const temporary = path.join(home, '.agents', 'pdfpal-skill-install-' + process.pid + '-' + Date.now())
  fs.cpSync(source, temporary, { recursive: true, dereference: false })
  fs.writeFileSync(path.join(temporary, manifestName), JSON.stringify({ format: 1, files: hashes }), { mode: 0o600 })
  let backup: string | undefined
  try {
    if (fs.existsSync(status.directory)) {
      backup = path.join(home, '.agents', 'skill-backups', 'pdfpal-cli-' + randomUUID())
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      fs.renameSync(status.directory, backup)
    }
    try { fs.renameSync(temporary, status.directory) }
    catch (error) { if (backup) fs.renameSync(backup, status.directory); throw error }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  return { ...skillStatus(home), updated: true, ...(backup ? { backup } : {}) }
}
export function uninstallSkill(home = os.homedir()) {
  const status = skillStatus(home)
  if (!status.managed) return { removed: false, preserved: status.installed }
  if (status.edited) return { removed: false, preserved: true }
  fs.rmSync(status.directory, { recursive: true })
  return { removed: true, preserved: false }
}
