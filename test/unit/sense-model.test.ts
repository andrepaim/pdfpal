import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ETTIN_ENGLISH_INT8, INSTALL_MARKER, installModel, installRuntime, runtimeRequire, verifyModel, verifyRuntime, type InstallOperations, type ModelIdentity, type RuntimeIdentity } from '../../src/core/sense-model.js'
import { SENSE_RUNTIME } from '../../src/core/sense-runtime-manifest.js'

const sha256 = (content: string) => crypto.createHash('sha256').update(content).digest('hex')

/** A small stand-in model: the same checks, with files that are quick to hash. */
function fixture(directory: string): ModelIdentity {
  const files = { 'model_metadata.json': '{"model_revision":"abc"}', 'tokenizer.json': '{"model":{}}', 'onnx/model.int8.onnx': 'weights' }
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true })
    fs.writeFileSync(path.join(directory, name), content)
  }
  return { name: 'test-model', revision: 'abc', files: Object.entries(files).map(([name, content]) => ({ path: name, size: Buffer.byteLength(content), sha256: sha256(content) })) }
}

test('the pinned English model identity names the checkpoint revision and every file it loads', () => {
  assert.equal(ETTIN_ENGLISH_INT8.revision, '8751b577199d1bb95b74fa2457da7065d57100ae')
  assert.deepEqual(ETTIN_ENGLISH_INT8.files.map(file => file.path).sort(), ['calibration.json', 'model_metadata.json', 'onnx/model.int8.onnx', 'tokenizer.json', 'tokenizer_config.json'])
  for (const file of ETTIN_ENGLISH_INT8.files) assert.match(file.sha256, /^[0-9a-f]{64}$/)
  assert.equal(ETTIN_ENGLISH_INT8.files.find(file => file.path === 'onnx/model.int8.onnx')!.sha256, '8649a1139b81a56b16ec6853d6127882a1b9539a4c33c09e3fce93ab62822d68')
})

test('a model directory is accepted only when every pinned file matches', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-sense-model-'))
  try {
    const identity = fixture(directory)
    assert.deepEqual(await verifyModel(directory, identity), { ok: true })
    assert.deepEqual(await verifyModel(path.join(directory, 'absent'), identity), { ok: false, code: 'MODEL_MISSING' })
    fs.writeFileSync(path.join(directory, 'tokenizer.json'), '{"model":[]}')
    assert.deepEqual(await verifyModel(directory, identity), { ok: false, code: 'MODEL_MISMATCH' }, 'same size, different content')
    fs.writeFileSync(path.join(directory, 'tokenizer.json'), '{}')
    assert.deepEqual(await verifyModel(directory, identity), { ok: false, code: 'MODEL_MISMATCH' })
    fs.rmSync(path.join(directory, 'onnx'), { recursive: true })
    assert.deepEqual(await verifyModel(directory, identity), { ok: false, code: 'MODEL_MISSING' })
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('installing copies only the pinned files from a local directory and verifies the copy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-sense-install-'))
  try {
    const from = path.join(root, 'export'), to = path.join(root, 'library', 'models', 'test-model')
    fs.mkdirSync(from)
    const identity = fixture(from)
    fs.writeFileSync(path.join(from, 'model.safetensors'), 'not needed')
    const installed = await installModel(from, to, identity)
    assert.deepEqual(installed, { directory: to, revision: 'abc', files: 3 })
    assert.deepEqual(await verifyModel(to, identity), { ok: true })
    assert.equal(fs.existsSync(path.join(to, 'model.safetensors')), false)
    assert.deepEqual(fs.readdirSync(path.dirname(to)), ['test-model'], 'no partial copies are left behind')

    // A mismatched source is refused and the working install is kept.
    fs.writeFileSync(path.join(from, 'tokenizer.json'), '{"model":[]}')
    await assert.rejects(installModel(from, to, identity), (error: { code?: string }) => error.code === 'MODEL_MISMATCH')
    assert.deepEqual(await verifyModel(to, identity), { ok: true })
    await assert.rejects(installModel(path.join(root, 'nowhere'), to, identity), (error: { code?: string }) => error.code === 'MODEL_MISSING')
    assert.deepEqual(fs.readdirSync(path.dirname(to)), ['test-model'])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the pinned runtime covers the desktop platforms and matches the installed development packages', async () => {
  assert.deepEqual(SENSE_RUNTIME.packages, { 'onnxruntime-node': '1.30.0', 'onnxruntime-common': '1.30.0', '@huggingface/tokenizers': '0.2.0' })
  for (const platform of ['win32-x64', 'linux-x64']) {
    assert.ok(SENSE_RUNTIME.files.some(file => file.platform === platform && file.path.endsWith('/onnxruntime_binding.node')), platform)
  }
  // The checkout's own node_modules is a valid runtime source for this platform.
  assert.deepEqual(await verifyRuntime(path.resolve('.'), SENSE_RUNTIME), { ok: true })
})

test('a runtime is installed for one platform from a node_modules folder and loads only from there', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-sense-runtime-'))
  try {
    const modules = path.join(root, 'source', 'node_modules')
    const content: Record<string, [string, string?]> = {
      'stub/package.json': ['{"name":"stub","main":"index.js"}'],
      'stub/index.js': ['module.exports = "loaded from the provisioned runtime"'],
      'stub/bin/linux-x64.node': ['linux', 'linux-x64'],
      'stub/bin/win32-x64.node': ['windows', 'win32-x64'],
    }
    for (const [name, [text]] of Object.entries(content)) { fs.mkdirSync(path.dirname(path.join(modules, name)), { recursive: true }); fs.writeFileSync(path.join(modules, name), text) }
    const identity: RuntimeIdentity = { name: 'stub', packages: { stub: '1.0.0' }, files: Object.entries(content).map(([name, [text, platform]]) => ({ path: name, size: text.length, sha256: sha256(text), ...(platform ? { platform } : {}) })) }
    const to = path.join(root, 'library', 'models', 'sense-runtime')

    assert.deepEqual(await verifyRuntime(to, identity, 'win32-x64'), { ok: false, code: 'RUNTIME_MISSING' })
    assert.deepEqual(await installRuntime(path.dirname(modules), to, identity, 'win32-x64'), { directory: to, platform: 'win32-x64', files: 3 })
    assert.equal(fs.existsSync(path.join(to, 'node_modules', 'stub', 'bin', 'linux-x64.node')), false, 'other platforms are not copied')
    assert.deepEqual(await verifyRuntime(to, identity, 'win32-x64'), { ok: true })
    assert.deepEqual(await verifyRuntime(to, identity, 'linux-x64'), { ok: false, code: 'RUNTIME_MISSING' })
    assert.deepEqual(await verifyRuntime(to, identity, 'sunos-sparc'), { ok: false, code: 'RUNTIME_UNSUPPORTED_PLATFORM' })
    assert.equal(runtimeRequire(to)('stub'), 'loaded from the provisioned runtime')

    // Reinstalling from the node_modules folder itself replaces the install.
    await installRuntime(modules, to, identity, 'linux-x64')
    assert.deepEqual(await verifyRuntime(to, identity, 'linux-x64'), { ok: true })
    assert.deepEqual(fs.readdirSync(to).sort(), [INSTALL_MARKER, 'node_modules'])
    fs.appendFileSync(path.join(to, 'node_modules', 'stub', 'index.js'), ';')
    assert.deepEqual(await verifyRuntime(to, identity, 'linux-x64'), { ok: false, code: 'RUNTIME_MISMATCH' })
    await assert.rejects(installRuntime(path.join(root, 'nowhere'), to, identity, 'linux-x64'), (error: { code?: string }) => error.code === 'RUNTIME_MISSING')
    await assert.rejects(installRuntime(modules, to, identity, 'sunos-sparc'), (error: { code?: string }) => error.code === 'RUNTIME_UNSUPPORTED_PLATFORM')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

const errno = (code: string) => Object.assign(new Error(code), { code })
const operations = (rename: (from: string, to: string) => void, remove = (directory: string) => fs.rmSync(directory, { recursive: true, force: true })): InstallOperations => ({ rename, remove })

test('a failed or repeated install never loses the working install', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-sense-swap-'))
  try {
    const from = path.join(root, 'export'), to = path.join(root, 'models', 'test-model'), parent = path.dirname(to)
    fs.mkdirSync(from)
    const identity = fixture(from)
    const listing = () => fs.readdirSync(parent).sort()
    await installModel(from, to, identity)
    assert.equal(JSON.parse(fs.readFileSync(path.join(to, INSTALL_MARKER), 'utf8')).kind, 'model')

    // Windows refuses to move a directory while the running app holds a DLL or file in it.
    const locked = operations((a, b) => { if (a === to) throw errno('EPERM'); fs.renameSync(a, b) })
    await assert.rejects(installModel(from, to, identity, { operations: locked }), (error: { code?: string }) => error.code === 'INSTALL_TARGET_BUSY')
    assert.deepEqual(await verifyModel(to, identity), { ok: true })
    assert.deepEqual(listing(), ['test-model'])

    // The old install was moved aside but the new copy could not take its place: it is moved back.
    const unpromoted = operations((a, b) => { if (a.includes('.partial-')) throw errno('EIO'); fs.renameSync(a, b) })
    await assert.rejects(installModel(from, to, identity, { operations: unpromoted }), (error: { code?: string }) => error.code === 'INSTALL_FAILED')
    assert.deepEqual(await verifyModel(to, identity), { ok: true })
    assert.deepEqual(listing(), ['test-model'])

    // Moving it back failed too: the previous copy is kept, reported, and restored by the next install.
    const stuck = operations((a, b) => { if (a.includes('.partial-') || a.includes('.previous-')) throw errno('EIO'); fs.renameSync(a, b) })
    let previous = ''
    await assert.rejects(installModel(from, to, identity, { operations: stuck }), (error: { code?: string; details?: { previous: string } }) => { previous = error.details?.previous ?? ''; return error.code === 'INSTALL_ROLLBACK_FAILED' })
    assert.equal(fs.existsSync(to), false)
    assert.deepEqual(await verifyModel(previous, identity), { ok: true }, 'the previous install is not deleted')
    const restored: string[] = []
    await installModel(from, to, identity, { operations: operations((a, b) => { restored.push(path.basename(a)); fs.renameSync(a, b) }) })
    assert.equal(restored[0], path.basename(previous), 'the previous install is moved back before anything else')
    assert.deepEqual(await verifyModel(to, identity), { ok: true })
    assert.deepEqual(listing(), ['test-model'])

    // A leftover still locked after a successful swap does not fail the install, and goes next time.
    const lockedLeftover = operations((a, b) => fs.renameSync(a, b), directory => { if (directory.includes('.previous-')) throw errno('EBUSY'); fs.rmSync(directory, { recursive: true, force: true }) })
    await installModel(from, to, identity, { operations: lockedLeftover })
    assert.equal(listing().length, 2)
    await installModel(from, to, identity)
    assert.deepEqual(listing(), ['test-model'])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('only an empty or pdfpal-installed directory is replaced', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-sense-owned-'))
  try {
    const from = path.join(root, 'export')
    fs.mkdirSync(from)
    const identity = fixture(from)
    const refused = (code: string) => (error: { code?: string }) => error.code === code

    const shared = path.join(root, 'Documents')
    fs.mkdirSync(shared); fs.writeFileSync(path.join(shared, 'notes.txt'), 'mine')
    await assert.rejects(installModel(from, shared, identity), refused('INSTALL_TARGET_NOT_OWNED'))
    assert.deepEqual(fs.readdirSync(shared), ['notes.txt'])

    const other = path.join(root, 'runtime')
    await installModel(from, other, identity)
    fs.writeFileSync(path.join(other, INSTALL_MARKER), JSON.stringify({ kind: 'runtime' }))
    await assert.rejects(installModel(from, other, identity), refused('INSTALL_TARGET_NOT_OWNED'), 'a directory installed for something else')

    const file = path.join(root, 'file')
    fs.writeFileSync(file, 'x')
    await assert.rejects(installModel(from, file, identity), refused('INSTALL_TARGET_NOT_OWNED'))

    await assert.rejects(installModel(from, from, identity), refused('INSTALL_SAME_DIRECTORY'))
    await assert.rejects(installModel(from, path.join(from, 'copy'), identity), refused('INSTALL_SAME_DIRECTORY'))
    await assert.rejects(installModel(from, root, identity), refused('INSTALL_SAME_DIRECTORY'))

    const empty = path.join(root, 'empty')
    fs.mkdirSync(empty)
    await installModel(from, empty, identity)
    assert.deepEqual(await verifyModel(empty, identity), { ok: true })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
