import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { extractEntry, listZip } from '../../src/core/zip-extract.js'

const malformed = (error: { code?: string }) => error.code === 'ASSET_MALFORMED'

function withArchive(files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]>, work: (file: string, directory: string) => Promise<void>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-zip-'))
  const file = path.join(directory, 'bundle.zip')
  fs.writeFileSync(file, zipSync(files as never))
  return work(file, directory).finally(() => fs.rmSync(directory, { recursive: true, force: true }))
}
/** Offset of the central directory header for the first entry. */
function centralHeader(bytes: Buffer): number {
  const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(offset > 0)
  return offset
}

test('stored and deflated entries are listed from the central directory and extracted by streaming', async () => {
  const large = crypto.randomBytes(256 * 1024)
  const text = strToU8('hello '.repeat(5000))
  await withArchive({ 'onnx/model.bin': [large, { level: 0 }], 'notices/LICENSE.txt': [text, { level: 6 }], 'empty.txt': new Uint8Array() }, async (file, directory) => {
    const entries = await listZip(file)
    assert.deepEqual(entries.map(entry => [entry.name, entry.method, entry.uncompressedSize]), [['onnx/model.bin', 0, large.length], ['notices/LICENSE.txt', 8, text.length], ['empty.txt', 8, 0]])
    for (const entry of entries) {
      const destination = path.join(directory, 'out', entry.name)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      await extractEntry(file, entry, destination)
    }
    assert.deepEqual(fs.readFileSync(path.join(directory, 'out', 'onnx/model.bin')), large)
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(directory, 'out', 'notices/LICENSE.txt'))), text)
    assert.equal(fs.statSync(path.join(directory, 'out', 'empty.txt')).size, 0)
  })
})

test('truncated, foreign and corrupt archives are rejected', async () => {
  await withArchive({ 'a.txt': strToU8('a'.repeat(10_000)) }, async (file, directory) => {
    const bytes = fs.readFileSync(file)
    fs.writeFileSync(file, bytes.subarray(0, bytes.length - 10))
    await assert.rejects(listZip(file), malformed, 'truncated end record')
    fs.writeFileSync(file, Buffer.from('this is not a zip file at all, just text'))
    await assert.rejects(listZip(file), malformed)
    fs.writeFileSync(file, Buffer.alloc(0))
    await assert.rejects(listZip(file), malformed)

    // Damaged compressed data: the CRC or the inflater catches it.
    const damaged = Buffer.from(bytes)
    damaged[45] = damaged[45]! ^ 0xff
    fs.writeFileSync(file, damaged)
    const [entry] = await listZip(file)
    await assert.rejects(extractEntry(file, entry!, path.join(directory, 'out.txt')), malformed)
  })
})

test('encrypted entries, unknown methods and inconsistent headers are rejected', async () => {
  await withArchive({ 'a.txt': strToU8('abc') }, async file => {
    const bytes = fs.readFileSync(file), at = centralHeader(bytes)
    const encrypted = Buffer.from(bytes); encrypted.writeUInt16LE(encrypted.readUInt16LE(at + 8) | 1, at + 8)
    fs.writeFileSync(file, encrypted)
    await assert.rejects(listZip(file), malformed, 'encrypted')
    const method = Buffer.from(bytes); method.writeUInt16LE(12, at + 10)
    fs.writeFileSync(file, method)
    await assert.rejects(listZip(file), malformed, 'bzip2')
    const zip64 = Buffer.from(bytes); zip64.writeUInt32LE(0xffffffff, at + 20)
    fs.writeFileSync(file, zip64)
    await assert.rejects(listZip(file), malformed, 'ZIP64 sizes')
    const offset = Buffer.from(bytes); offset.writeUInt32LE(bytes.length, at + 42)
    fs.writeFileSync(file, offset)
    await assert.rejects(listZip(file), malformed, 'local header outside the archive')
  })
})

test('a local header that disagrees with the central directory is rejected', async () => {
  await withArchive({ 'a.txt': strToU8('abc') }, async (file, directory) => {
    const bytes = Buffer.from(fs.readFileSync(file))
    bytes.write('b', 30) // the name in the local header
    fs.writeFileSync(file, bytes)
    const [entry] = await listZip(file)
    await assert.rejects(extractEntry(file, entry!, path.join(directory, 'out.txt')), malformed)
  })
})
