import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { zipSync, strToU8 } from 'fflate'
import { buildServer } from '../../src/server/app.js'
import { loadConfig } from '../../src/core/config.js'
import type { ContextualServiceOptions } from '../../src/core/contextual-service.js'
import type { DownloadAssets, Fetch } from '../../src/core/sense-download.js'
import type { ModelIdentity, RuntimeIdentity } from '../../src/core/sense-model.js'

const sha256 = (bytes: Uint8Array | string) => crypto.createHash('sha256').update(bytes).digest('hex')
const pin = (files: Record<string, string>, platform?: string) => Object.entries(files).map(([name, content]) => ({ path: name, size: Buffer.byteLength(content), sha256: sha256(content), ...(platform ? { platform } : {}) }))
const modelFiles = { 'model_metadata.json': '{"model_revision":"abc123"}', 'onnx/model.int8.onnx': 'weights '.repeat(2000) }
const runtimeFiles = { 'stub/package.json': '{"name":"stub"}', 'stub/bin/linux.node': 'linux' }
const modelIdentity: ModelIdentity = { name: 'test model', revision: 'abc123', files: pin(modelFiles) }
const runtimeIdentity: RuntimeIdentity = { name: 'test runtime', packages: {}, files: [...pin({ 'stub/package.json': '{"name":"stub"}' }), ...pin({ 'stub/bin/linux.node': 'linux' }, 'linux-x64')] }
const zip = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, strToU8(content)])))
const modelZip = zip({ ...modelFiles, 'notices/NOTICE.txt': 'model notice' })
const runtimeZip = zip({ ...Object.fromEntries(Object.entries(runtimeFiles).map(([name, content]) => [`node_modules/${name}`, content])), 'notices/NOTICE.txt': 'runtime notice' })
const assets: DownloadAssets = {
  tag: 'sense-test-v1',
  model: { name: 'model.zip', size: modelZip.length, sha256: sha256(modelZip) },
  runtimes: { 'linux-x64': { name: 'runtime-linux-x64.zip', size: runtimeZip.length, sha256: sha256(runtimeZip) } },
}
const files: Record<string, Uint8Array> = { 'model.zip': modelZip, 'runtime-linux-x64.zip': runtimeZip }

/** A mocked release server; `mode` can be changed between requests. */
function release() {
  const state = { calls: [] as string[], mode: 'ok' as 'ok' | 'missing' | 'slow' | 'offline' }
  const fetch: Fetch = async (url, init) => {
    state.calls.push(url)
    if (state.mode === 'offline') throw new TypeError('fetch failed')
    if (state.mode === 'missing') return new Response('not found', { status: 404 })
    const bytes = files[url.split('/').at(-1)!]!
    let sent = 0
    const slow = state.mode === 'slow'
    return new Response(new ReadableStream({
      async pull(controller) {
        if (init?.signal?.aborted) return controller.error(new DOMException('aborted', 'AbortError'))
        if (sent >= bytes.length) return controller.close()
        await sleep(slow ? 20 : 0)
        controller.enqueue(bytes.slice(sent, sent + (slow ? 16 : 4096))); sent += slow ? 16 : 4096
      },
    }))
  }
  return { state, fetch }
}

const fakeWorker = { url: new URL('../fixtures/fake-sense-worker.mjs', import.meta.url), data: { fake: { prefer: 'branch office', requireFile: 'onnx/model.int8.onnx' } } }
type Library = { dataDir: string; cache: string }
function library(cache?: string): Library {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-contextual-'))
  return { dataDir, cache: cache ?? path.join(dataDir, 'cache') }
}
async function server(lib: Library, fetch: Fetch, options: Partial<ContextualServiceOptions> = {}) {
  const config = loadConfig({ dataDir: lib.dataDir, senseCacheDir: lib.cache })
  const app = await buildServer(config, undefined, { contextual: { fetch, assets, modelIdentity, runtimeIdentity, platform: 'linux-x64', packageRuntime: false, worker: fakeWorker, ...options } })
  const json = { 'content-type': 'application/json' }
  return {
    app, config,
    status: async () => (await app.inject({ url: '/api/dictionary/contextual' })).json(),
    post: (url: string, payload: object, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: JSON.stringify(payload), headers: { ...json, ...headers } }),
    define: async () => (await app.inject({ url: `/api/dictionary/define?${new URLSearchParams({ text: 'bank', before: 'After lunch he walked over and deposited the money at the ', after: ' before it closed for the day.' })}` })).json(),
    async until(states: string[]) {
      for (let i = 0; i < 200; i++) { const status = await this.status(); if (states.includes(status.state)) return status; await sleep(20) }
      throw new Error(`still ${(await this.status()).state}`)
    },
  }
}
const firstSense = (result: { entries: Array<{ senses: Array<{ definition: string }> }> }) => result.entries[0]!.senses[0]!.definition
const preference = (lib: Library) => JSON.parse(fs.readFileSync(path.join(lib.dataDir, 'config.json'), 'utf8')).contextual_definitions
function environment(value?: string) {
  const previous = process.env.PDFPAL_CONTEXTUAL_DEFINITIONS
  if (value === undefined) delete process.env.PDFPAL_CONTEXTUAL_DEFINITIONS; else process.env.PDFPAL_CONTEXTUAL_DEFINITIONS = value
  return () => { if (previous === undefined) delete process.env.PDFPAL_CONTEXTUAL_DEFINITIONS; else process.env.PDFPAL_CONTEXTUAL_DEFINITIONS = previous }
}

test('turning on shows the download size first, downloads only when confirmed and applies at once', async () => {
  const restore = environment(), lib = library(), { state, fetch } = release(), s = await server(lib, fetch)
  try {
    const off = await s.status()
    assert.equal(off.enabled, false); assert.equal(off.state, 'off'); assert.equal(off.locked, false)
    assert.equal(off.download.required_bytes, modelZip.length + runtimeZip.length)
    assert.match(firstSense(await s.define()), /place and borrow money/)

    const refused = await s.post('/api/dictionary/contextual', { enabled: true })
    assert.equal(refused.statusCode, 409)
    assert.equal(refused.json().code, 'DOWNLOAD_REQUIRED')
    assert.equal((await s.post('/api/dictionary/contextual/download', { accept_bytes: 1 })).json().code, 'DOWNLOAD_SIZE_CHANGED')
    assert.deepEqual(state.calls, [], 'no network before the size is confirmed')

    const started = await s.post('/api/dictionary/contextual/download', { accept_bytes: off.download.required_bytes })
    assert.equal(started.statusCode, 202)
    assert.ok(['downloading', 'installing', 'loading', 'ready'].includes(started.json().state))
    const ready = await s.until(['ready', 'failed'])
    assert.equal(ready.state, 'ready', JSON.stringify(ready))
    assert.equal(ready.enabled, true)
    assert.equal(ready.download.required_bytes, 0)
    assert.deepEqual(state.calls, ['https://github.com/andrepaim/pdfpal/releases/download/sense-test-v1/model.zip', 'https://github.com/andrepaim/pdfpal/releases/download/sense-test-v1/runtime-linux-x64.zip'])
    assert.equal(preference(lib), true, 'saved for this library')
    assert.match(firstSense(await s.define()), /branch office/, 'no restart needed')
    assert.ok(fs.readdirSync(path.join(lib.cache, 'v1', 'model')).length === 1)
  } finally { await s.app.close(); restore(); fs.rmSync(lib.dataDir, { recursive: true, force: true }) }
})

test('turning off applies at once and keeps the cache, which this and other libraries reuse offline', async () => {
  const restore = environment(), lib = library(), { state, fetch } = release(), s = await server(lib, fetch)
  const other = library(lib.cache)
  try {
    await s.post('/api/dictionary/contextual/download', { accept_bytes: (await s.status()).download.required_bytes })
    await s.until(['ready'])
    const off = await s.post('/api/dictionary/contextual', { enabled: false })
    assert.equal(off.statusCode, 200); assert.equal(off.json().state, 'off')
    assert.match(firstSense(await s.define()), /place and borrow money/)
    assert.equal(preference(lib), false)

    state.mode = 'offline'; state.calls.length = 0
    const on = await s.post('/api/dictionary/contextual', { enabled: true })
    assert.equal(on.statusCode, 200)
    await s.until(['ready'])
    assert.match(firstSense(await s.define()), /branch office/)

    const second = await server(other, fetch)
    try {
      const status = await second.status()
      assert.equal(status.enabled, false, 'each library keeps its own preference')
      assert.equal(status.download.required_bytes, 0)
      assert.equal((await second.post('/api/dictionary/contextual', { enabled: true })).statusCode, 200)
      await second.until(['ready'])
      assert.match(firstSense(await second.define()), /branch office/)
    } finally { await second.app.close() }
    assert.deepEqual(state.calls, [], 'reuse needs no network')
  } finally { await s.app.close(); restore(); for (const dir of [lib.dataDir, other.dataDir]) fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a failed download reports its code and can be retried; a cancelled one stops cleanly', async () => {
  const restore = environment(), lib = library(), { state, fetch } = release(), s = await server(lib, fetch)
  try {
    const bytes = (await s.status()).download.required_bytes
    state.mode = 'missing'
    await s.post('/api/dictionary/contextual/download', { accept_bytes: bytes })
    const failed = await s.until(['failed'])
    assert.equal(failed.error, 'DOWNLOAD_FAILED'); assert.equal(failed.enabled, false)
    assert.match(firstSense(await s.define()), /place and borrow money/)

    state.mode = 'slow'
    await s.post('/api/dictionary/contextual/download', { accept_bytes: bytes })
    const downloading = await s.until(['downloading'])
    assert.ok(downloading.download.total_bytes === bytes)
    await sleep(100)
    const progressed = await s.status()
    assert.ok(progressed.download.received_bytes > 0 && progressed.download.received_bytes < bytes)
    const cancelled = await s.post('/api/dictionary/contextual/download/cancel', {})
    assert.equal(cancelled.statusCode, 200)
    const off = await s.until(['off'])
    assert.equal(off.error, 'DOWNLOAD_CANCELLED')
    const models = path.join(lib.cache, 'v1', 'model')
    assert.equal(fs.existsSync(models) ? fs.readdirSync(models).length : 0, 0, 'nothing reaches the cache')

    state.mode = 'ok'
    await s.post('/api/dictionary/contextual/download', { accept_bytes: bytes })
    assert.equal((await s.until(['ready', 'failed'])).state, 'ready')
  } finally { await s.app.close(); restore(); fs.rmSync(lib.dataDir, { recursive: true, force: true }) }
})

test('turning off during a download cancels it; closing the server stops everything', async () => {
  const restore = environment(), lib = library(), { state, fetch } = release(), s = await server(lib, fetch)
  try {
    state.mode = 'slow'
    await s.post('/api/dictionary/contextual/download', { accept_bytes: (await s.status()).download.required_bytes })
    await s.until(['downloading'])
    assert.equal((await s.post('/api/dictionary/contextual', { enabled: false })).json().state, 'off')
    await s.post('/api/dictionary/contextual/download', { accept_bytes: (await s.status()).download.required_bytes })
    await s.until(['downloading'])
  } finally { await s.app.close(); restore(); fs.rmSync(lib.dataDir, { recursive: true, force: true }) }
})

test('the environment fixes the setting, and an existing library install is used before the cache', async () => {
  const lib = library(), { state, fetch } = release()
  let restore = environment('0')
  let s = await server(lib, fetch)
  try {
    const locked = await s.status()
    assert.equal(locked.locked, true); assert.equal(locked.enabled, false)
    assert.equal((await s.post('/api/dictionary/contextual', { enabled: true })).json().code, 'SETTING_LOCKED')
    assert.equal((await s.post('/api/dictionary/contextual/download', { accept_bytes: locked.download.required_bytes })).json().code, 'SETTING_LOCKED')
  } finally { await s.app.close(); restore() }

  restore = environment()
  for (const [name, content] of Object.entries(modelFiles)) {
    const file = path.join(lib.dataDir, 'models', 'ettin-150m-wsd-int8', name)
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content)
  }
  s = await server(lib, fetch)
  try {
    const status = await s.status()
    assert.equal(status.model_source, 'library')
    assert.equal(status.download.required_bytes, runtimeZip.length, 'only the runtime is missing')
    await s.post('/api/dictionary/contextual/download', { accept_bytes: runtimeZip.length })
    assert.equal((await s.until(['ready', 'failed'])).state, 'ready')
    assert.deepEqual(state.calls.map(url => url.split('/').at(-1)), ['runtime-linux-x64.zip'])
    assert.equal(fs.existsSync(path.join(lib.cache, 'v1', 'model')), false)
  } finally { await s.app.close(); restore(); fs.rmSync(lib.dataDir, { recursive: true, force: true }) }
})

test('without a downloadable runtime or a release manifest the option is unavailable', async () => {
  const restore = environment(), { state, fetch } = release()
  const mac = library(), unpublished = library()
  const s = await server(mac, fetch, { platform: 'darwin-arm64' })
  const t = await server(unpublished, fetch, { assets: null })
  try {
    for (const target of [s, t]) {
      const status = await target.status()
      assert.equal(status.state, 'unavailable')
      assert.equal(status.download.required_bytes, null)
      assert.equal((await target.post('/api/dictionary/contextual/download', { accept_bytes: 0 })).json().code, 'DOWNLOAD_UNAVAILABLE')
    }
    assert.deepEqual(state.calls, [])
  } finally { await s.app.close(); await t.app.close(); restore(); for (const dir of [mac.dataDir, unpublished.dataDir]) fs.rmSync(dir, { recursive: true, force: true }) }
})

test('only a same-origin JSON request can change the setting or start a download', async () => {
  const restore = environment(), lib = library(), { state, fetch } = release(), s = await server(lib, fetch)
  try {
    const bytes = (await s.status()).download.required_bytes
    const download = '/api/dictionary/contextual/download'
    const attempts = [
      { headers: { 'content-type': 'application/json', origin: 'https://attacker.example' }, payload: JSON.stringify({ accept_bytes: bytes }), status: 403 },
      { headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' }, payload: JSON.stringify({ accept_bytes: bytes }), status: 403 },
      { headers: { 'content-type': 'application/json', origin: 'null' }, payload: JSON.stringify({ accept_bytes: bytes }), status: 403 },
      { headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `accept_bytes=${bytes}`, status: 415 },
      { headers: { 'content-type': 'text/plain' }, payload: JSON.stringify({ accept_bytes: bytes }), status: 415 },
      { headers: { 'content-type': 'multipart/form-data; boundary=x' }, payload: `--x\r\nContent-Disposition: form-data; name="accept_bytes"\r\n\r\n${bytes}\r\n--x--\r\n`, status: 415 },
      { headers: { 'content-type': 'application/json', host: 'attacker.example' }, payload: JSON.stringify({ accept_bytes: bytes }), status: 403 },
    ]
    for (const attempt of attempts) {
      for (const url of [download, '/api/dictionary/contextual', '/api/dictionary/contextual/download/cancel']) {
        const response = await s.app.inject({ method: 'POST', url, headers: attempt.headers, payload: attempt.payload })
        assert.equal(response.statusCode, attempt.status, `${url} ${JSON.stringify(attempt.headers)}`)
      }
    }
    assert.deepEqual(state.calls, [])
    assert.equal((await s.status()).state, 'off')
    const allowed = await s.post(download, { accept_bytes: bytes }, { origin: 'http://localhost:80', host: 'localhost:80', 'sec-fetch-site': 'same-origin' })
    assert.equal(allowed.statusCode, 202)
  } finally { await s.app.close(); restore(); fs.rmSync(lib.dataDir, { recursive: true, force: true }) }
})

test('a cached copy missing a file is downloaded again, and a failed activation after a good transfer can be retried', async () => {
  const restore = environment(), lib = library(), { state, fetch } = release()
  let s = await server(lib, fetch)
  try {
    await s.post('/api/dictionary/contextual/download', { accept_bytes: (await s.status()).download.required_bytes })
    await s.until(['ready'])
  } finally { await s.app.close() }
  const cached = path.join(lib.cache, 'v1', 'model', fs.readdirSync(path.join(lib.cache, 'v1', 'model'))[0]!)
  fs.rmSync(path.join(cached, 'onnx', 'model.int8.onnx'))

  s = await server(lib, fetch)
  try {
    const broken = await s.until(['failed'])
    assert.equal(broken.error, 'MODEL_MISSING')
    assert.equal(broken.download.required_bytes, modelZip.length, 'only the model is downloaded again')
    assert.match(firstSense(await s.define()), /place and borrow money/)
    state.calls.length = 0
    await s.post('/api/dictionary/contextual/download', { accept_bytes: modelZip.length })
    assert.equal((await s.until(['ready', 'failed'])).state, 'ready')
    assert.deepEqual(state.calls.map(url => url.split('/').at(-1)), ['model.zip'])
    assert.ok(fs.existsSync(path.join(cached, 'onnx', 'model.int8.onnx')))
    assert.match(firstSense(await s.define()), /branch office/)
  } finally { await s.app.close(); restore(); fs.rmSync(lib.dataDir, { recursive: true, force: true }) }

  // The transfer succeeds but the library's config.json cannot be written.
  const restoreAgain = environment(), other = library(), second = release(), t = await server(other, second.fetch)
  try {
    second.state.mode = 'slow'
    await t.post('/api/dictionary/contextual/download', { accept_bytes: (await t.status()).download.required_bytes })
    await t.until(['downloading'])
    const config = path.join(other.dataDir, 'config.json')
    fs.rmSync(config, { force: true }); fs.mkdirSync(config)
    const failed = await t.until(['failed'])
    assert.equal(failed.error, 'ACTIVATION_FAILED')
    assert.equal(failed.enabled, false)
    assert.equal(failed.download.required_bytes, 0, 'the files are kept; retrying needs no download')
    fs.rmSync(config, { recursive: true })
    second.state.calls.length = 0
    const retried = await t.post('/api/dictionary/contextual/download', { accept_bytes: 0 })
    assert.equal(retried.statusCode, 202)
    assert.equal((await t.until(['ready', 'failed'])).state, 'ready')
    assert.equal(preference(other), true)
    assert.deepEqual(second.state.calls, [])
  } finally { await t.app.close(); restoreAgain(); fs.rmSync(other.dataDir, { recursive: true, force: true }) }
})
