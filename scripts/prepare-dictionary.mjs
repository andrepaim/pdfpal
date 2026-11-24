import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

export const dictionaryDirectory = 'data/dictionary'
export const dictionaryNotice = 'NOTICES-dictionary.txt'

// Contextual Dictionary asset release, Kaikki English snapshot 2026-10-30.
const release = 'https://github.com/andrepaim/contextual-dictionary/releases'
const tag = 'assets-v1'
const pack = { name: 'wiktionary-en-v1.pack', bytes: 66467698, sha256: 'e698a7117d4a684d554c1c5850674ed9035c2daab7dbd8125c6c63758b6e6c32' }
const notice = { name: dictionaryNotice, bytes: 23850, sha256: 'b107fc851a5cad95af090f8c23dca2385bd185f1e205c531cadac44a5dd1cda1' }

async function verifyAsset(directory, { name, bytes, sha256 }) {
  const filename = path.join(directory, name)
  const info = await stat(filename)
  const hash = createHash('sha256')
  if (info.isFile() && info.size === bytes) {
    for await (const chunk of createReadStream(filename)) hash.update(chunk)
    if (hash.digest('hex') === sha256) return
  }
  throw new Error(`Bundled dictionary asset failed verification: ${filename}. See ${release}/tag/${tag}`)
}

export async function verifyDictionary(root) {
  const directory = path.join(root, dictionaryDirectory)
  await verifyAsset(directory, notice)
  await verifyAsset(directory, pack)
}

export async function prepareDictionary(root) {
  const directory = path.join(root, dictionaryDirectory)
  await verifyAsset(directory, notice)
  try {
    await verifyAsset(directory, pack)
    return
  } catch (error) {
    if (process.env.npm_config_offline === 'true') throw error
  }

  const url = `${release}/download/${tag}/${pack.name}`
  const temporary = await mkdtemp(path.join(directory, '.pack-download-'))
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok || !response.body) throw new Error(`Dictionary pack download failed (HTTP ${response.status}): ${url}`)
    const filename = path.join(temporary, pack.name)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(filename, { flags: 'wx' }))
    await verifyAsset(temporary, pack)
    await rename(filename, path.join(directory, pack.name))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDictionary(fileURLToPath(new URL('../', import.meta.url)))
}
