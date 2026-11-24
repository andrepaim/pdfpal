import { open, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  openWiktionaryDictionary, WiktionaryDictionary, type ByteSource, type Dictionary, type DictionaryResult, type Selection,
} from '@andrepaim/contextual-dictionary-core'

const PACK_FILE = 'wiktionary-en-v1.pack'
const DEFAULT_PATH = fileURLToPath(new URL(`../../data/dictionary/${PACK_FILE}`, import.meta.url))
const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
const emptyDictionary = new WiktionaryDictionary({ get: async () => undefined })

/** Open the installed pack outside Electron's ASAR so the file supports range reads. */
function openPackFile(file?: string): Promise<FileHandle> {
  if (file !== undefined) return open(file, 'r')
  if (resourcesPath) {
    return open(path.join(resourcesPath, 'data', 'dictionary', PACK_FILE), 'r').catch(() => open(DEFAULT_PATH, 'r'))
  }
  return open(DEFAULT_PATH, 'r')
}

async function fileByteSource(file: FileHandle): Promise<ByteSource> {
  const { size } = await file.stat()
  return {
    size,
    async read(start, end) {
      const bytes = Buffer.alloc(end - start)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, start + offset)
        if (bytesRead === 0) throw new Error('Incomplete dictionary pack read')
        offset += bytesRead
      }
      return bytes
    },
  }
}

// PDF text may use typographic ligatures or dashes inside a word. Normalize
// these for lookup while the native scorer receives the original selection.
const normalizePdfText = (text: string) => text.normalize('NFKC').replace(/[‐-―]/gu, '-')

export class DictionaryService implements Dictionary {
  private opened?: Promise<{ file: FileHandle; dictionary: Dictionary } | undefined>

  constructor(private readonly file?: string) {}

  private async load() {
    let file: FileHandle | undefined
    try {
      file = await openPackFile(this.file)
      const dictionary = await openWiktionaryDictionary(await fileByteSource(file))
      return { file, dictionary }
    } catch {
      await file?.close().catch(() => undefined)
      return undefined
    }
  }

  async close(): Promise<void> {
    const opened = this.opened
    this.opened = undefined
    await (await opened)?.file.close()
  }

  async define(selection: Selection): Promise<DictionaryResult> {
    const lookup = {
      text: normalizePdfText(selection.text),
      before: normalizePdfText(selection.before ?? ''),
      after: normalizePdfText(selection.after ?? ''),
    }
    const opened = await (this.opened ??= this.load())
    if (opened) {
      try { return await opened.dictionary.define(lookup) } catch { /* The reader can still offer Explain. */ }
    }
    return emptyDictionary.define(lookup)
  }
}
