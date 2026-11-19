import fs from 'node:fs'
import zlib from 'node:zlib'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// A minimal ZIP reader for the contextual-definitions bundles. It reads the
// central directory from disk and streams each entry from its byte range,
// so an archive of hundreds of megabytes is never held in memory. Only
// stored and deflated entries are accepted; ZIP64, encryption, multi-disk
// archives and inconsistent headers are refused.

export type ZipEntry = { name: string; method: 0 | 8; flags: number; crc32: number; compressedSize: number; uncompressedSize: number; localOffset: number }

export class ZipError extends Error {
  readonly code = 'ASSET_MALFORMED'
  constructor(reason: string) { super(`The archive is malformed: ${reason}.`) }
}
const bad = (reason: string): never => { throw new ZipError(reason) }

const END = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50
const MAX_COMMENT = 0xffff, END_SIZE = 22

function read(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const count = fs.readSync(fd, buffer, done, length - done, position + done)
    if (count === 0) bad('unexpected end of file')
    done += count
  }
  return buffer
}

/** The entries of the archive at `file`, from its central directory. */
export async function listZip(file: string): Promise<ZipEntry[]> {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    if (size < END_SIZE) bad('too short')
    const tailLength = Math.min(size, END_SIZE + MAX_COMMENT)
    const tail = read(fd, size - tailLength, tailLength)
    let end = -1
    for (let i = tail.length - END_SIZE; i >= 0; i--) {
      if (tail.readUInt32LE(i) === END && i + END_SIZE + tail.readUInt16LE(i + 20) === tail.length) { end = i; break }
    }
    if (end < 0) bad('no end of central directory')
    const endOffset = size - tailLength + end
    const disk = tail.readUInt16LE(end + 4), centralDisk = tail.readUInt16LE(end + 6)
    const onDisk = tail.readUInt16LE(end + 8), count = tail.readUInt16LE(end + 10)
    const centralSize = tail.readUInt32LE(end + 12), centralOffset = tail.readUInt32LE(end + 16)
    if (disk !== 0 || centralDisk !== 0 || onDisk !== count) bad('multi-disk archive')
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) bad('ZIP64 is not supported')
    if (centralOffset + centralSize !== endOffset) bad('central directory out of place')

    const central = read(fd, centralOffset, centralSize)
    const entries: ZipEntry[] = []
    let at = 0
    for (let i = 0; i < count; i++) {
      if (at + 46 > central.length || central.readUInt32LE(at) !== CENTRAL) bad('bad central directory header')
      const flags = central.readUInt16LE(at + 8), method = central.readUInt16LE(at + 10)
      const crc32 = central.readUInt32LE(at + 16), compressedSize = central.readUInt32LE(at + 20), uncompressedSize = central.readUInt32LE(at + 24)
      const nameLength = central.readUInt16LE(at + 28), extraLength = central.readUInt16LE(at + 30), commentLength = central.readUInt16LE(at + 32)
      const entryDisk = central.readUInt16LE(at + 34), localOffset = central.readUInt32LE(at + 42)
      if (at + 46 + nameLength + extraLength + commentLength > central.length) bad('bad central directory header')
      const nameBytes = central.subarray(at + 46, at + 46 + nameLength)
      if (flags & 0x41) bad('encrypted entry')
      if (method !== 0 && method !== 8) bad('unsupported compression method')
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) bad('ZIP64 is not supported')
      if (method === 0 && compressedSize !== uncompressedSize) bad('stored entry sizes differ')
      if (entryDisk !== 0 || localOffset + 30 + nameLength + compressedSize > centralOffset) bad('entry outside the archive')
      if (nameBytes.some(byte => byte < 0x20 || byte > 0x7e)) bad('entry names must be printable ASCII')
      entries.push({ name: nameBytes.toString('ascii'), method: method as 0 | 8, flags, crc32, compressedSize, uncompressedSize, localOffset })
      at += 46 + nameLength + extraLength + commentLength
    }
    if (at !== central.length) bad('trailing central directory data')
    return entries
  } finally { fs.closeSync(fd) }
}

/**
 * Streams one entry into a new file at `destination`, checking its size and
 * CRC-32. The destination must not exist yet.
 */
export async function extractEntry(file: string, entry: ZipEntry, destination: string, signal?: AbortSignal): Promise<void> {
  const fd = fs.openSync(file, 'r')
  let start: number
  try {
    const header = read(fd, entry.localOffset, 30)
    if (header.readUInt32LE(0) !== LOCAL) bad('bad local header')
    const nameLength = header.readUInt16LE(26), extraLength = header.readUInt16LE(28)
    if (header.readUInt16LE(8) !== entry.method) bad('local header disagrees with the central directory')
    if (read(fd, entry.localOffset + 30, nameLength).toString('latin1') !== entry.name) bad('local header disagrees with the central directory')
    start = entry.localOffset + 30 + nameLength + extraLength
    if (start + entry.compressedSize > fs.fstatSync(fd).size) bad('entry outside the archive')
  } finally { fs.closeSync(fd) }

  let written = 0, crc = 0
  const check = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length
      if (written > entry.uncompressedSize) return done(new ZipError('entry larger than declared'))
      crc = zlib.crc32(chunk, crc)
      done(null, chunk)
    },
  })
  const output = fs.createWriteStream(destination, { flags: 'wx' })
  try {
    const source = entry.compressedSize === 0
      ? [] as Buffer[]
      : fs.createReadStream(file, { start, end: start + entry.compressedSize - 1, highWaterMark: 1 << 20 })
    if (entry.method === 8) await pipeline(source, zlib.createInflateRaw(), check, output, { signal })
    else await pipeline(source, check, output, { signal })
  } catch (error) {
    if (error instanceof ZipError || (error as { name?: string }).name === 'AbortError') throw error
    if ((error as { code?: string }).code?.startsWith('Z_')) bad('compressed data is damaged')
    throw error
  }
  if (written !== entry.uncompressedSize) bad('entry size differs from the central directory')
  if ((crc >>> 0) !== entry.crc32) bad('entry checksum differs')
}
