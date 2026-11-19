import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PdfpalError } from './types.js'

// The local files behind contextual definition order: an English word-sense
// model and the runtime that executes it. Both are copied from directories
// the user supplies, never downloaded, and every file is checked against a
// pinned SHA-256 before it is used.

export type PinnedFile = { path: string; size: number; sha256: string; platform?: string }
export type ModelIdentity = { name: string; revision: string; files: PinnedFile[] }
export type RuntimeIdentity = { name: string; packages: Record<string, string>; files: PinnedFile[] }
export type ModelCode = 'MODEL_MISSING' | 'MODEL_MISMATCH'
export type RuntimeCode = 'RUNTIME_MISSING' | 'RUNTIME_MISMATCH' | 'RUNTIME_UNSUPPORTED_PLATFORM'
export type Verification<Code extends string> = { ok: true } | { ok: false; code: Code }

/** sign/Ettin-150m-WSD as exported by sense-model: dynamic INT8 ONNX, compact-v1 prompts. */
export const ETTIN_ENGLISH_INT8: ModelIdentity = {
  name: 'Ettin-150m-WSD dynamic INT8 ONNX',
  revision: '8751b577199d1bb95b74fa2457da7065d57100ae',
  files: [
    { path: 'model_metadata.json', size: 1552, sha256: '7a07cdd82572cada84061c1cdb61670b2d220d9cc422397d18244874d9fb7707' },
    { path: 'calibration.json', size: 101, sha256: '84f67365897b09a6d6b7d2289f16dd6582d07e7e6e0f1b2094491a72b636d8ab' },
    { path: 'tokenizer.json', size: 3583228, sha256: '6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30' },
    { path: 'tokenizer_config.json', size: 487, sha256: 'd0ec2c8141eec0fa98e31a43c3a453f9c40dcde862762762b0f1898bfb793183' },
    { path: 'onnx/model.int8.onnx', size: 266954889, sha256: '8649a1139b81a56b16ec6853d6127882a1b9539a4c33c09e3fce93ab62822d68' },
  ],
}
export const MODEL_FOLDER = 'ettin-150m-wsd-int8'
export const RUNTIME_FOLDER = 'sense-runtime'

export const platformTag = (platform: string = process.platform, arch: string = process.arch) => `${platform}-${arch}`

async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Every file present with the pinned size and content. Sizes are checked before anything is hashed. */
async function verifyFiles<Code extends string>(directory: string, files: PinnedFile[], missing: Code, mismatch: Code): Promise<Verification<Code>> {
  const sizes = files.map(file => { try { return fs.statSync(path.join(directory, file.path)).size } catch { return undefined } })
  if (sizes.some(size => size === undefined)) return { ok: false, code: missing }
  if (files.some((file, i) => sizes[i] !== file.size)) return { ok: false, code: mismatch }
  for (const file of files) if (await sha256(path.join(directory, file.path)) !== file.sha256) return { ok: false, code: mismatch }
  return { ok: true }
}

export function verifyModel(directory: string, identity: ModelIdentity = ETTIN_ENGLISH_INT8): Promise<Verification<ModelCode>> {
  return verifyFiles(directory, identity.files, 'MODEL_MISSING', 'MODEL_MISMATCH')
}

/** The runtime files one platform loads: shared JavaScript plus that platform's native binaries. */
export function runtimeFiles(identity: RuntimeIdentity, platform = platformTag()): PinnedFile[] | undefined {
  if (!identity.files.some(file => file.platform === platform)) return undefined
  return identity.files.filter(file => !file.platform || file.platform === platform)
}

/** A provisioned runtime keeps its packages in `<directory>/node_modules`. */
export async function verifyRuntime(directory: string, identity: RuntimeIdentity, platform = platformTag()): Promise<Verification<RuntimeCode>> {
  const files = runtimeFiles(identity, platform)
  if (!files) return { ok: false, code: 'RUNTIME_UNSUPPORTED_PLATFORM' }
  return verifyFiles(path.join(directory, 'node_modules'), files, 'RUNTIME_MISSING', 'RUNTIME_MISMATCH')
}

export type RuntimeStatus = 'verified' | 'bundled' | RuntimeCode
/**
 * Which runtime the worker would load: a provisioned one (verified here),
 * otherwise the packages installed beside pdfpal, if any.
 */
export async function inspectRuntime(directory: string, identity: RuntimeIdentity): Promise<RuntimeStatus> {
  if (fs.existsSync(path.join(directory, 'node_modules'))) {
    const verified = await verifyRuntime(directory, identity)
    return verified.ok ? 'verified' : verified.code
  }
  try {
    const local = createRequire(import.meta.url)
    local.resolve('onnxruntime-node'); local.resolve('@huggingface/tokenizers')
    return 'bundled'
  } catch { return 'RUNTIME_MISSING' }
}

/** Loads packages from a verified provisioned runtime and nowhere else. */
export function runtimeRequire(directory: string): NodeJS.Require {
  return createRequire(path.join(directory, 'node_modules', 'pdfpal-runtime.cjs'))
}

export type InstallCode = 'INSTALL_TARGET_NOT_OWNED' | 'INSTALL_SAME_DIRECTORY' | 'INSTALL_TARGET_BUSY' | 'INSTALL_FAILED' | 'INSTALL_ROLLBACK_FAILED'
const messages: Record<ModelCode | RuntimeCode | InstallCode, string> = {
  MODEL_MISSING: 'The directory does not contain every file of the pinned model.',
  MODEL_MISMATCH: 'A model file differs from the pinned model.',
  RUNTIME_MISSING: 'The directory does not contain every file of the pinned runtime (it needs a node_modules folder).',
  RUNTIME_MISMATCH: 'A runtime file differs from the pinned runtime.',
  RUNTIME_UNSUPPORTED_PLATFORM: 'The pinned runtime has no binaries for this platform.',
  INSTALL_TARGET_NOT_OWNED: 'The destination already holds files pdfpal did not install. Choose an empty or pdfpal-installed directory.',
  INSTALL_SAME_DIRECTORY: 'The source and destination directories overlap. Install from a separate directory.',
  INSTALL_TARGET_BUSY: 'The existing install is in use. Quit pdfpal (including the desktop app) and try again.',
  INSTALL_FAILED: 'The new files could not be put in place. The existing install was restored.',
  INSTALL_ROLLBACK_FAILED: 'The new files could not be put in place, and the previous install could not be moved back.',
}

/** Written into every directory pdfpal installs; only such a directory is ever replaced. */
export const INSTALL_MARKER = '.pdfpal-install.json'
type InstallKind = 'model' | 'runtime'
/** Filesystem operations, replaceable in tests to simulate locked or failing renames. */
export type InstallOperations = { rename(from: string, to: string): void; remove(directory: string): void }
const nodeOperations: InstallOperations = {
  rename: (from, to) => fs.renameSync(from, to),
  remove: directory => fs.rmSync(directory, { recursive: true, force: true }),
}
const fail = (code: ModelCode | RuntimeCode | InstallCode, details?: Record<string, string>): never => { throw new PdfpalError(code, messages[code], 2, details) }
const busy = (error: unknown) => ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')
const inside = (parent: string, child: string) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) }

function owned(directory: string, kind: InstallKind): boolean {
  try { return JSON.parse(fs.readFileSync(path.join(directory, INSTALL_MARKER), 'utf8')).kind === kind } catch { return false }
}

/**
 * Copies `files` from `from` into a temporary sibling of `to`, verifies the
 * copy and swaps it in. `to` is replaced only when it is missing, empty or
 * was installed by pdfpal as the same kind. When the swap fails, the
 * previous install is moved back; nothing is deleted until the new copy is
 * in place.
 */
async function installFiles(from: string, to: string, files: PinnedFile[], kind: InstallKind, prefix: string, codes: [ModelCode, ModelCode] | [RuntimeCode, RuntimeCode], identity: string, operations: InstallOperations): Promise<void> {
  const [missing, mismatch] = codes
  from = path.resolve(from); to = path.resolve(to)
  if (inside(from, to) || inside(to, from)) fail('INSTALL_SAME_DIRECTORY')
  for (const file of files) if (!fs.existsSync(path.join(from, file.path))) fail(missing)
  if (fs.existsSync(to) && !(fs.statSync(to).isDirectory() && (fs.readdirSync(to).length === 0 || owned(to, kind)))) fail('INSTALL_TARGET_NOT_OWNED')

  const parent = path.dirname(to), name = path.basename(to)
  fs.mkdirSync(parent, { recursive: true })
  // Leftovers of an interrupted or partly failed earlier install of this
  // directory. A previous install whose rollback failed is moved back
  // first, so that it is never deleted while it is the only copy.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const leftovers = fs.readdirSync(parent).filter(entry => new RegExp(`^\\.${escaped}\\.(?:partial|previous)-[0-9a-f]{8}$`).test(entry))
  if (!fs.existsSync(to)) {
    const restorable = leftovers.filter(entry => entry.includes('.previous-') && owned(path.join(parent, entry), kind))
    const newest = restorable.sort((a, b) => fs.statSync(path.join(parent, b)).mtimeMs - fs.statSync(path.join(parent, a)).mtimeMs)[0]
    if (newest) try { operations.rename(path.join(parent, newest), to) } catch { fail('INSTALL_TARGET_BUSY') }
  }
  for (const entry of leftovers) if (fs.existsSync(path.join(parent, entry))) try { operations.remove(path.join(parent, entry)) } catch { /* still locked; try next time */ }

  const suffix = crypto.randomBytes(4).toString('hex')
  const partial = path.join(parent, `.${name}.partial-${suffix}`), previous = path.join(parent, `.${name}.previous-${suffix}`)
  let promoted = false
  try {
    for (const file of files) {
      const destination = path.join(partial, prefix, file.path)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(path.join(from, file.path), destination)
    }
    const verified = await verifyFiles(path.join(partial, prefix), files, missing, mismatch)
    if (!verified.ok) fail(verified.code)
    fs.writeFileSync(path.join(partial, INSTALL_MARKER), `${JSON.stringify({ kind, identity, installed_at: new Date().toISOString() }, null, 2)}\n`)

    const replacing = fs.existsSync(to)
    if (replacing) {
      try { operations.rename(to, previous) } catch (error) { fail(busy(error) ? 'INSTALL_TARGET_BUSY' : 'INSTALL_FAILED') }
    }
    try { operations.rename(partial, to); promoted = true } catch {
      if (!replacing) fail('INSTALL_FAILED')
      try { operations.rename(previous, to) } catch { fail('INSTALL_ROLLBACK_FAILED', { previous }) }
      fail('INSTALL_FAILED')
    }
    if (replacing) try { operations.remove(previous) } catch { /* A locked leftover is removed by the next install. */ }
  } finally {
    if (!promoted) try { operations.remove(partial) } catch { /* removed by the next install */ }
  }
}

export type InstallOptions = { operations?: InstallOperations }

export async function installModel(from: string, to: string, identity: ModelIdentity = ETTIN_ENGLISH_INT8, options: InstallOptions = {}) {
  await installFiles(from, to, identity.files, 'model', '', ['MODEL_MISSING', 'MODEL_MISMATCH'], `${identity.name} ${identity.revision}`, options.operations ?? nodeOperations)
  return { directory: path.resolve(to), revision: identity.revision, files: identity.files.length }
}

/**
 * Copies one platform's runtime from `from`, a directory holding a
 * node_modules folder (or the node_modules folder itself), into
 * `<to>/node_modules`.
 */
export async function installRuntime(from: string, to: string, identity: RuntimeIdentity, platform = platformTag(), options: InstallOptions = {}) {
  const files = runtimeFiles(identity, platform)
  if (!files) fail('RUNTIME_UNSUPPORTED_PLATFORM')
  const source = path.resolve(from)
  const modules = path.basename(source) === 'node_modules' ? source : path.join(source, 'node_modules')
  await installFiles(modules, to, files!, 'runtime', 'node_modules', ['RUNTIME_MISSING', 'RUNTIME_MISMATCH'], `${identity.name} ${platform}`, options.operations ?? nodeOperations)
  return { directory: path.resolve(to), platform, files: files!.length }
}
