import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { INSTALL_MARKER, runtimeFiles, verifyFiles, type ModelIdentity, type PinnedFile, type RuntimeIdentity } from './sense-model.js'
import { extractEntry, listZip, ZipError } from './zip-extract.js'
import { acquireLease } from './locking.js'

// One-time downloads of the contextual-definitions model and runtime into a
// per-user cache that every library reuses. Downloads start only from an
// explicit request in the local UI. A bundle is written to disk while it is
// hashed, checked for its pinned size and SHA-256 before it is opened, and
// extracted entry by entry against an allowlist. The extracted files are
// verified against their own pins, then the directory appears in the cache
// with one rename. Cache directories are never modified afterwards.

export type Bundle = { name: string; size: number; sha256: string }
export type DownloadAssets = { tag: string; model: Bundle; runtimes: Record<string, Bundle> }
export type Fetch = (url: string, init?: { signal?: AbortSignal; redirect?: 'follow' }) => Promise<Response>
/** Runtimes are published for the desktop platforms only. */
export const DOWNLOAD_PLATFORMS = ['win32-x64', 'linux-x64']
export const RELEASE_BASE = 'https://github.com/andrepaim/pdfpal/releases/download'

export type DownloadCode = 'DOWNLOAD_FAILED' | 'DOWNLOAD_STALLED' | 'DOWNLOAD_CANCELLED' | 'ASSET_CORRUPT' | 'ASSET_MALFORMED'
  | 'ASSET_UNEXPECTED' | 'ASSET_MISMATCH' | 'DISK_FULL' | 'INSTALL_TARGET_BUSY' | 'INSTALL_FAILED'
export class DownloadError extends Error {
  readonly code: DownloadCode
  constructor(code: DownloadCode) { super(code); this.code = code }
}
const fail = (code: DownloadCode): never => { throw new DownloadError(code) }

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
function parseBundle(value: unknown): Bundle | undefined {
  const bundle = value as Partial<Bundle> | null
  if (!bundle || typeof bundle.name !== 'string' || !SAFE_NAME.test(bundle.name)) return undefined
  if (!Number.isSafeInteger(bundle.size) || bundle.size! <= 0) return undefined
  if (typeof bundle.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(bundle.sha256)) return undefined
  return { name: bundle.name, size: bundle.size!, sha256: bundle.sha256 }
}

/** Validates the release manifest module (`SENSE_ASSET_TAG`, `MODEL_DOWNLOAD`, `RUNTIME_DOWNLOADS`). */
export function parseDownloadAssets(module: unknown): DownloadAssets | undefined {
  const value = module as { SENSE_ASSET_TAG?: unknown; MODEL_DOWNLOAD?: unknown; RUNTIME_DOWNLOADS?: unknown } | null
  if (!value || typeof value.SENSE_ASSET_TAG !== 'string' || !SAFE_NAME.test(value.SENSE_ASSET_TAG)) return undefined
  const model = parseBundle(value.MODEL_DOWNLOAD)
  if (!model || !value.RUNTIME_DOWNLOADS || typeof value.RUNTIME_DOWNLOADS !== 'object') return undefined
  const runtimes: Record<string, Bundle> = {}
  for (const platform of DOWNLOAD_PLATFORMS) {
    const bundle = (value.RUNTIME_DOWNLOADS as Record<string, unknown>)[platform]
    if (bundle === undefined) continue
    const parsed = parseBundle(bundle)
    if (!parsed) return undefined
    runtimes[platform] = parsed
  }
  return { tag: value.SENSE_ASSET_TAG, model, runtimes }
}

/** The manifest the release coordinator publishes with the bundles; undefined when this build has none. */
export async function loadDownloadAssets(): Promise<DownloadAssets | undefined> {
  const specifier = './sense-download-assets.js'
  try { return parseDownloadAssets(await import(specifier)) } catch { return undefined }
}

export const bundleUrl = (tag: string, bundle: Bundle) => `${RELEASE_BASE}/${tag}/${bundle.name}`

/** A per-user cache outside every library: %LOCALAPPDATA%, ~/Library/Caches or $XDG_CACHE_HOME. */
export function defaultSenseCacheDir(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'pdfpal', 'sense-cache')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'pdfpal', 'sense-cache')
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'pdfpal', 'sense-cache')
}

export type InstallTarget = { kind: 'model' | 'runtime'; cache: string; directory: string; files: PinnedFile[]; prefix: '' | 'node_modules' }
const key = (files: PinnedFile[]) => crypto.createHash('sha256').update(files.map(file => `${file.path}\0${file.size}\0${file.sha256}`).sort().join('\n')).digest('hex').slice(0, 16)
const versioned = (cache: string) => path.join(path.resolve(cache), 'v1')

/** The cache directory for a model, named by its revision and the digest of its pinned files. */
export function modelTarget(cache: string, identity: ModelIdentity): InstallTarget {
  return { kind: 'model', cache: versioned(cache), directory: path.join(versioned(cache), 'model', `${identity.revision.slice(0, 12)}-${key(identity.files)}`), files: identity.files, prefix: '' }
}

/** The cache directory for one platform's runtime; undefined when the runtime has no binaries for it. */
export function runtimeTarget(cache: string, identity: RuntimeIdentity, platform: string): InstallTarget | undefined {
  const files = runtimeFiles(identity, platform)
  if (!files) return undefined
  return { kind: 'runtime', cache: versioned(cache), directory: path.join(versioned(cache), 'runtime', platform, key(files)), files, prefix: 'node_modules' }
}

export async function inspectInstall(target: InstallTarget): Promise<'verified' | 'missing' | 'mismatch'> {
  if (!fs.existsSync(target.directory)) return 'missing'
  return (await verifyFiles(path.join(target.directory, target.prefix), target.files, 'missing', 'mismatch')).ok ? 'verified' : 'mismatch'
}

const NOTICE_LIMIT = 2 * 1024 * 1024, NOTICES_LIMIT = 8 * 1024 * 1024
const STALE_MS = 24 * 60 * 60 * 1000

function temporary(target: InstallTarget): string {
  const directory = path.join(target.cache, '.tmp')
  fs.mkdirSync(directory, { recursive: true })
  // Leftovers of a crashed process; current downloads keep their files fresh.
  for (const entry of fs.readdirSync(directory)) {
    const file = path.join(directory, entry)
    try { if (Date.now() - fs.statSync(file).mtimeMs > STALE_MS) fs.rmSync(file, { recursive: true, force: true }) } catch { /* in use */ }
  }
  return directory
}

async function download(url: string, bundle: Bundle, file: string, options: InstallOptions): Promise<void> {
  const stall = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, stall.signal]) : stall.signal
  let timer: NodeJS.Timeout | undefined
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), options.stallMs ?? 60_000) }
  const reason = (): DownloadCode => options.signal?.aborted ? 'DOWNLOAD_CANCELLED' : stall.signal.aborted ? 'DOWNLOAD_STALLED' : 'DOWNLOAD_FAILED'
  arm()
  try {
    let response: Response
    try { response = await options.fetch(url, { signal, redirect: 'follow' }) } catch { return fail(reason()) }
    if (!response.ok || !response.body) fail('DOWNLOAD_FAILED')
    const hash = crypto.createHash('sha256')
    let received = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length
        if (received > bundle.size) return done(new DownloadError('ASSET_CORRUPT'))
        hash.update(chunk)
        arm()
        options.onProgress?.(received)
        done(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>), meter, fs.createWriteStream(file, { flags: 'wx' }), { signal })
    } catch (error) {
      if (error instanceof DownloadError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') fail('DISK_FULL')
      fail(reason())
    }
    if (received !== bundle.size || hash.digest('hex') !== bundle.sha256) fail('ASSET_CORRUPT')
  } finally { clearTimeout(timer) }
}

/** Where each archive entry goes, refusing anything outside the allowlist. */
function plan(entries: Awaited<ReturnType<typeof listZip>>, target: InstallTarget) {
  const pinned = new Map(target.files.map(file => [target.prefix ? `${target.prefix}/${file.path}` : file.path, file]))
  const directories = new Set<string>(['notices'])
  for (const name of pinned.keys()) for (let at = name.indexOf('/'); at > 0; at = name.indexOf('/', at + 1)) directories.add(name.slice(0, at))
  const seen = new Set<string>(), files: Array<{ entry: (typeof entries)[number]; name: string }> = []
  let notices = 0
  for (const entry of entries) {
    const directory = entry.name.endsWith('/')
    const name = directory ? entry.name.slice(0, -1) : entry.name
    const segments = name.split('/')
    if (!name || name.includes('\\') || name.includes(':') || segments.some(segment => !segment || segment === '.' || segment === '..')) fail('ASSET_UNEXPECTED')
    if (seen.has(name.toLowerCase())) fail('ASSET_UNEXPECTED')
    seen.add(name.toLowerCase())
    if (directory) {
      if (!directories.has(name) && !(segments[0] === 'notices' && segments.length <= 4)) fail('ASSET_UNEXPECTED')
      continue
    }
    const file = pinned.get(name)
    if (file) {
      if (entry.uncompressedSize !== file.size) fail('ASSET_MISMATCH')
    } else if (segments[0] === 'notices' && segments.length >= 2 && segments.length <= 4) {
      notices += entry.uncompressedSize
      if (entry.uncompressedSize > NOTICE_LIMIT || notices > NOTICES_LIMIT) fail('ASSET_UNEXPECTED')
    } else fail('ASSET_UNEXPECTED')
    files.push({ entry, name })
  }
  for (const name of pinned.keys()) if (!seen.has(name.toLowerCase())) fail('ASSET_MISMATCH')
  return files
}

export type InstallOptions = {
  url: string
  bundle: Bundle
  fetch: Fetch
  signal?: AbortSignal
  /** Bytes of the bundle received so far. */
  onProgress?: (received: number) => void
  /** Abandon a download that receives nothing for this long. */
  stallMs?: number
}

/**
 * The verified cache directory for `target`, downloading and installing
 * `bundle` first when the cache has no verified copy. A cache entry that no
 * longer verifies is set aside and replaced.
 */
/** The lease file serialising installs of one target, kept outside the target directory. */
export const leaseFile = (target: InstallTarget) => path.join(target.cache, '.locks', `${path.relative(target.cache, target.directory).split(path.sep).join('-')}.lock`)

/**
 * Waits, without blocking the event loop, for the SQLite-backed lease on
 * `target`. Every app and library installing the same target takes turns,
 * so one downloads while the others wait and then find the verified copy.
 */
async function lease(target: InstallTarget, signal?: AbortSignal): Promise<() => void> {
  const file = leaseFile(target)
  for (;;) {
    if (signal?.aborted) fail('DOWNLOAD_CANCELLED')
    try { return acquireLease(file) } catch (error) {
      if (!String((error as { code?: string }).code ?? '').startsWith('SQLITE_BUSY')) throw error
    }
    await new Promise<void>(resolve => {
      const timer = setTimeout(done, 100)
      function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
      signal?.addEventListener('abort', done, { once: true })
    })
  }
}

export async function installBundle(target: InstallTarget, options: InstallOptions): Promise<string> {
  if (await inspectInstall(target) === 'verified') return target.directory
  const release = await lease(target, options.signal)
  try { return await installLocked(target, options) } finally { release() }
}

/** Runs while holding the target's lease: rechecks, repairs and installs. */
async function installLocked(target: InstallTarget, options: InstallOptions): Promise<string> {
  // Another holder of the lease may have installed or repaired it meanwhile.
  const state = await inspectInstall(target)
  if (state === 'verified') return target.directory
  const scratch = temporary(target)
  const id = crypto.randomBytes(8).toString('hex')
  if (state === 'mismatch') {
    const discarded = path.join(scratch, `${id}.discarded`)
    try { fs.renameSync(target.directory, discarded) } catch (error) { if (fs.existsSync(target.directory)) fail('INSTALL_TARGET_BUSY') }
    fs.rmSync(discarded, { recursive: true, force: true })
  }
  const archive = path.join(scratch, `${id}.zip`), work = path.join(scratch, `${id}.dir`)
  try {
    await download(options.url, options.bundle, archive, options)
    let entries
    try { entries = await listZip(archive) } catch (error) { if (error instanceof ZipError) fail('ASSET_MALFORMED'); throw error }
    const files = plan(entries, target)
    for (const { entry, name } of files) {
      const destination = path.join(work, ...name.split('/'))
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      try { await extractEntry(archive, entry, destination, options.signal) } catch (error) {
        if (error instanceof ZipError) fail('ASSET_MALFORMED')
        if (options.signal?.aborted) fail('DOWNLOAD_CANCELLED')
        if ((error as NodeJS.ErrnoException).code === 'ENOSPC') fail('DISK_FULL')
        throw error
      }
    }
    if (!(await verifyFiles(path.join(work, target.prefix), target.files, 'missing', 'mismatch')).ok) fail('ASSET_MISMATCH')
    fs.writeFileSync(path.join(work, INSTALL_MARKER), `${JSON.stringify({ kind: target.kind, source: 'download', bundle: options.bundle.name, sha256: options.bundle.sha256 }, null, 2)}\n`)
    if (options.signal?.aborted) fail('DOWNLOAD_CANCELLED')
    fs.mkdirSync(path.dirname(target.directory), { recursive: true })
    try { fs.renameSync(work, target.directory) } catch {
      // Only an app without the lease could have put a copy here meanwhile.
      if (await inspectInstall(target) !== 'verified') fail('INSTALL_FAILED')
    }
    return target.directory
  } catch (error) {
    if (error instanceof DownloadError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOSPC') fail('DISK_FULL')
    return fail(options.signal?.aborted ? 'DOWNLOAD_CANCELLED' : 'INSTALL_FAILED')
  } finally {
    fs.rmSync(archive, { force: true })
    fs.rmSync(work, { recursive: true, force: true })
  }
}
