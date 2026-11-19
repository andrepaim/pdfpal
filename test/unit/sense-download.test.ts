import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { acquireLease } from '../../src/core/locking.js'
import { bundleUrl, installBundle, inspectInstall, leaseFile, modelTarget, parseDownloadAssets, runtimeTarget, type Bundle, type Fetch } from '../../src/core/sense-download.js'
import type { ModelIdentity, RuntimeIdentity } from '../../src/core/sense-model.js'

const sha256 = (bytes: Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex')
const pin = (files: Record<string, string>, platform?: string) => Object.entries(files).map(([name, content]) => ({ path: name, size: Buffer.byteLength(content), sha256: sha256(content), ...(platform ? { platform } : {}) }))
const modelFiles = { 'model_metadata.json': '{"model_revision":"abc123"}', 'tokenizer.json': '{"model":{}}', 'onnx/model.int8.onnx': crypto.randomBytes(24_000).toString('base64') }
const identity: ModelIdentity = { name: 'test model', revision: 'abc123', files: pin(modelFiles) }
const runtimeIdentity: RuntimeIdentity = {
  name: 'test runtime', packages: { stub: '1.0.0' },
  files: [...pin({ 'stub/package.json': '{"name":"stub"}', 'stub/index.js': 'module.exports = 1' }), ...pin({ 'stub/bin/linux.node': 'linux' }, 'linux-x64'), ...pin({ 'stub/bin/win.node': 'windows' }, 'win32-x64')],
}
const notices = { 'notices/THIRD_PARTY.txt': 'Apache-2.0 attribution' }

function bundle(entries: Record<string, string | Uint8Array>): { bytes: Uint8Array; bundle: Bundle } {
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, typeof content === 'string' ? strToU8(content) : content])))
  return { bytes, bundle: { name: 'model.zip', size: bytes.length, sha256: sha256(bytes) } }
}
/** A fetch that serves `bytes` in small chunks, optionally holding back after `stopAt` bytes. */
function serve(bytes: Uint8Array, options: { status?: number; stopAt?: number; chunk?: number; calls?: string[] } = {}): Fetch {
  return async (url, init) => {
    options.calls?.push(url)
    const chunk = options.chunk ?? 1024
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (options.stopAt !== undefined && sent >= options.stopAt) return new Promise(() => { /* stalls */ })
        if (sent >= bytes.length) return controller.close()
        await new Promise(resolve => setImmediate(resolve))
        const end = Math.min(bytes.length, sent + chunk, options.stopAt ?? Infinity)
        controller.enqueue(bytes.slice(sent, end)); sent = end
      },
    })
    init?.signal?.addEventListener('abort', () => body.cancel().catch(() => undefined))
    return new Response(body, { status: options.status ?? 200 })
  }
}
const never: Fetch = async () => { throw new Error('no network expected') }
const code = (expected: string) => (error: { code?: string }) => { assert.equal(error.code, expected); return true }

function withCache(work: (cache: string) => Promise<void>) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-sense-cache-'))
  return work(cache).finally(() => fs.rmSync(cache, { recursive: true, force: true }))
}
const tmpEntries = (cache: string) => { try { return fs.readdirSync(path.join(cache, 'v1', '.tmp')) } catch { return [] } }

test('the asset manifest is validated and names the project release URL', () => {
  const model = { name: 'pdfpal-sense-model-ettin-int8.zip', size: 1, sha256: 'a'.repeat(64) }
  const assets = parseDownloadAssets({ SENSE_ASSET_TAG: 'sense-assets-v1', MODEL_DOWNLOAD: model, RUNTIME_DOWNLOADS: { 'win32-x64': { ...model, name: 'rt-win.zip' }, 'linux-x64': { ...model, name: 'rt-linux.zip' }, 'darwin-arm64': { ...model, name: 'rt-mac.zip' } } })
  assert.deepEqual(Object.keys(assets!.runtimes).sort(), ['linux-x64', 'win32-x64'], 'downloadable runtimes only for the desktop platforms')
  assert.equal(bundleUrl(assets!.tag, assets!.model), 'https://github.com/andrepaim/pdfpal/releases/download/sense-assets-v1/pdfpal-sense-model-ettin-int8.zip')
  for (const bad of [undefined, {}, { SENSE_ASSET_TAG: '../x', MODEL_DOWNLOAD: model, RUNTIME_DOWNLOADS: {} }, { SENSE_ASSET_TAG: 't', MODEL_DOWNLOAD: { ...model, name: 'a/b.zip' }, RUNTIME_DOWNLOADS: {} }, { SENSE_ASSET_TAG: 't', MODEL_DOWNLOAD: { ...model, sha256: 'xyz' }, RUNTIME_DOWNLOADS: {} }, { SENSE_ASSET_TAG: 't', MODEL_DOWNLOAD: { ...model, size: -1 }, RUNTIME_DOWNLOADS: {} }]) {
    assert.equal(parseDownloadAssets(bad), undefined, JSON.stringify(bad))
  }
})

test('a model bundle is downloaded, verified on disk, extracted with its notices and reused offline', async () => {
  await withCache(async cache => {
    const { bytes, bundle: model } = bundle({ ...modelFiles, ...notices, 'onnx/': new Uint8Array() })
    const target = modelTarget(cache, identity)
    assert.match(path.relative(cache, target.directory), /^v1[\\/]model[\\/]abc123-[0-9a-f]{16}$/)
    assert.equal(await inspectInstall(target), 'missing')
    const progress: number[] = []
    const directory = await installBundle(target, { url: 'https://example.invalid/model.zip', bundle: model, fetch: serve(bytes), onProgress: received => progress.push(received) })
    assert.equal(directory, target.directory)
    assert.equal(progress.at(-1), bytes.length)
    assert.ok(progress.every((value, i) => i === 0 || value >= progress[i - 1]!))
    assert.equal(await inspectInstall(target), 'verified')
    assert.equal(fs.readFileSync(path.join(directory, 'notices', 'THIRD_PARTY.txt'), 'utf8'), 'Apache-2.0 attribution', 'attribution is kept with the files')
    assert.deepEqual(tmpEntries(cache), [])

    // Offline: a verified cache entry is used without the network.
    assert.equal(await installBundle(target, { url: 'https://example.invalid/model.zip', bundle: model, fetch: never }), directory)
  })
})

test('a truncated, oversized or altered download, or an HTTP error, leaves nothing behind', async () => {
  await withCache(async cache => {
    const { bytes, bundle: model } = bundle(modelFiles)
    const target = modelTarget(cache, identity)
    const install = (fetch: Fetch, override: Partial<Bundle> = {}) => installBundle(target, { url: 'https://example.invalid/m.zip', bundle: { ...model, ...override }, fetch })
    await assert.rejects(install(serve(bytes.slice(0, bytes.length - 100))), code('ASSET_CORRUPT'))
    await assert.rejects(install(serve(new Uint8Array([...bytes, 1, 2, 3]))), code('ASSET_CORRUPT'))
    const altered = Uint8Array.from(bytes); altered[100] = altered[100]! ^ 1
    await assert.rejects(install(serve(altered)), code('ASSET_CORRUPT'))
    await assert.rejects(install(serve(bytes, { status: 404 })), code('DOWNLOAD_FAILED'))
    await assert.rejects(install(async () => { throw new TypeError('fetch failed') }), code('DOWNLOAD_FAILED'))
    assert.equal(await inspectInstall(target), 'missing')
    assert.deepEqual(tmpEntries(cache), [])
  })
})

test('cancelling or stalling a download stops it and cleans up', async () => {
  await withCache(async cache => {
    const { bytes, bundle: model } = bundle(modelFiles)
    const target = modelTarget(cache, identity)
    const controller = new AbortController()
    const cancelled = installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes, { chunk: 64 }), signal: controller.signal, onProgress: received => { if (received > 500) controller.abort() } })
    await assert.rejects(cancelled, code('DOWNLOAD_CANCELLED'))
    await assert.rejects(installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes, { stopAt: 2000 }), stallMs: 100 }), code('DOWNLOAD_STALLED'))
    assert.equal(await inspectInstall(target), 'missing')
    assert.deepEqual(tmpEntries(cache), [])
  })
})

test('a well-formed bundle with unexpected, hostile, missing or altered entries is refused', async () => {
  await withCache(async cache => {
    const target = modelTarget(cache, identity)
    const attempt = (entries: Record<string, string | Uint8Array>) => { const { bytes, bundle: model } = bundle(entries); return installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes) }) }
    await assert.rejects(attempt({ ...modelFiles, 'run-me.js': 'evil' }), code('ASSET_UNEXPECTED'))
    await assert.rejects(attempt({ ...modelFiles, '../escape.txt': 'x' }), code('ASSET_UNEXPECTED'))
    await assert.rejects(attempt({ ...modelFiles, 'notices/../../escape.txt': 'x' }), code('ASSET_UNEXPECTED'))
    await assert.rejects(attempt({ ...modelFiles, '/etc/passwd': 'x' }), code('ASSET_UNEXPECTED'))
    await assert.rejects(attempt({ ...modelFiles, 'notices\\..\\x.txt': 'x' }), code('ASSET_UNEXPECTED'))
    await assert.rejects(attempt({ ...modelFiles, 'notices/huge.txt': 'x'.repeat(3 * 1024 * 1024) }), code('ASSET_UNEXPECTED'))
    const { 'tokenizer.json': _, ...incomplete } = modelFiles
    await assert.rejects(attempt(incomplete), code('ASSET_MISMATCH'))
    await assert.rejects(attempt({ ...modelFiles, 'tokenizer.json': '{"model":[]}' }), code('ASSET_MISMATCH'))
    assert.equal(await inspectInstall(target), 'missing')
    assert.deepEqual(tmpEntries(cache), [])
  })
})

test('a runtime bundle installs only its platform files under node_modules', async () => {
  await withCache(async cache => {
    const target = runtimeTarget(cache, runtimeIdentity, 'linux-x64')!
    assert.equal(runtimeTarget(cache, runtimeIdentity, 'sunos-sparc'), undefined)
    const entries = { 'node_modules/stub/package.json': '{"name":"stub"}', 'node_modules/stub/index.js': 'module.exports = 1', 'node_modules/stub/bin/linux.node': 'linux', ...notices }
    const { bytes, bundle: runtime } = bundle(entries)
    const directory = await installBundle(target, { url: 'https://example.invalid/r.zip', bundle: runtime, fetch: serve(bytes) })
    assert.match(path.relative(cache, directory), /^v1[\\/]runtime[\\/]linux-x64[\\/][0-9a-f]{16}$/)
    assert.equal(fs.readFileSync(path.join(directory, 'node_modules', 'stub', 'bin', 'linux.node'), 'utf8'), 'linux')
    assert.ok(fs.existsSync(path.join(directory, 'notices', 'THIRD_PARTY.txt')))
    assert.equal(await inspectInstall(target), 'verified')

    const other = bundle({ ...entries, 'node_modules/stub/bin/win.node': 'windows' })
    await assert.rejects(installBundle(runtimeTarget(cache, runtimeIdentity, 'linux-x64')!, { url: 'https://example.invalid/r.zip', bundle: other.bundle, fetch: never }).then(() => { throw Object.assign(new Error(), { code: 'REUSED' }) }), code('REUSED'), 'the verified install is reused, whatever the bundle')
    const wrong = bundle({ ...entries, 'node_modules/stub/bin/win.node': 'windows' })
    const fresh = runtimeTarget(path.join(cache, 'other'), runtimeIdentity, 'linux-x64')!
    await assert.rejects(installBundle(fresh, { url: 'https://example.invalid/r.zip', bundle: wrong.bundle, fetch: serve(wrong.bytes) }), code('ASSET_UNEXPECTED'), 'another platform\'s binary')
  })
})

test('a tampered cache entry is set aside and downloaded again', async () => {
  await withCache(async cache => {
    const { bytes, bundle: model } = bundle(modelFiles)
    const target = modelTarget(cache, identity)
    await installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes) })
    fs.appendFileSync(path.join(target.directory, 'tokenizer.json'), ' ')
    assert.equal(await inspectInstall(target), 'mismatch')
    const calls: string[] = []
    await installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes, { calls }) })
    assert.equal(calls.length, 1)
    assert.equal(await inspectInstall(target), 'verified')
    assert.deepEqual(fs.readdirSync(path.dirname(target.directory)), [path.basename(target.directory)])
  })
})

test('concurrent installs of the same bundle, as from several libraries, share one transfer and end with one verified copy', async () => {
  await withCache(async cache => {
    const { bytes, bundle: model } = bundle(modelFiles)
    const calls: string[] = []
    const fetch = serve(bytes, { chunk: 512, calls })
    const results = await Promise.all([1, 2, 3].map(() => installBundle(modelTarget(cache, identity), { url: 'https://example.invalid/m.zip', bundle: model, fetch })))
    assert.equal(new Set(results).size, 1)
    assert.equal(calls.length, 1, 'the others wait for the first download and reuse it')
    assert.equal(await inspectInstall(modelTarget(cache, identity)), 'verified')
    assert.deepEqual(fs.readdirSync(path.dirname(results[0]!)), [path.basename(results[0]!)])
    assert.equal(path.relative(results[0]!, leaseFile(modelTarget(cache, identity))).startsWith('..'), true, 'the lease is outside the target')
    assert.deepEqual(tmpEntries(cache), [])
  })
})

test('simultaneous repairs of a tampered cache entry download once and never replace the repaired copy', async () => {
  await withCache(async cache => {
    const { bytes, bundle: model } = bundle(modelFiles)
    const target = modelTarget(cache, identity)
    await installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes) })
    fs.appendFileSync(path.join(target.directory, 'tokenizer.json'), ' ')
    const calls: string[] = []
    const fetch = serve(bytes, { chunk: 256, calls })
    // Both see the mismatch before either holds the lease.
    assert.equal(await inspectInstall(target), 'mismatch')
    const repairs = [1, 2].map(() => installBundle(modelTarget(cache, identity), { url: 'https://example.invalid/m.zip', bundle: model, fetch }))
    const marker = async () => JSON.parse(fs.readFileSync(path.join(target.directory, '.pdfpal-install.json'), 'utf8'))
    await repairs[0]
    const repaired = { inode: fs.statSync(target.directory).ino, marker: await marker() }
    await repairs[1]
    assert.equal(calls.length, 1)
    assert.equal(fs.statSync(target.directory).ino, repaired.inode, 'the second repair rechecks under the lease and keeps the new copy')
    assert.equal(await inspectInstall(target), 'verified')
    assert.deepEqual(fs.readdirSync(path.dirname(target.directory)), [path.basename(target.directory)])
  })
})

test('waiting for another install can be cancelled without touching the network', async () => {
  await withCache(async cache => {
    const { bytes, bundle: model } = bundle(modelFiles)
    const target = modelTarget(cache, identity)
    fs.mkdirSync(path.dirname(leaseFile(target)), { recursive: true })
    const held = acquireLease(leaseFile(target))
    try {
      const calls: string[] = []
      const controller = new AbortController()
      const waiting = installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes, { calls }), signal: controller.signal })
      await new Promise(resolve => setTimeout(resolve, 150))
      const started = performance.now()
      controller.abort()
      await assert.rejects(waiting, code('DOWNLOAD_CANCELLED'))
      assert.ok(performance.now() - started < 100)
      assert.deepEqual(calls, [])
    } finally { held() }
    assert.equal(await installBundle(target, { url: 'https://example.invalid/m.zip', bundle: model, fetch: serve(bytes) }), target.directory)
  })
})
