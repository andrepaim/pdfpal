import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'

// Builds the offline dictionary the reader's definition card looks words up
// in: a small read-only SQLite file made from Princeton WordNet's text
// database. It runs at build time (scripts/build-dictionary.mjs), never on a
// user's machine, and the result ships inside dist/.

export const DICTIONARY_SOURCE = 'WordNet 3.1'
/** Bump when the table layout or the parsing changes, so stale files rebuild. */
const FORMAT = 1

/** WordNet's file suffix for each part of speech, and the one-letter code stored. */
const PARTS = [['noun', 'n'], ['verb', 'v'], ['adj', 'a'], ['adv', 'r']] as const
export type PosCode = typeof PARTS[number][1]

// Synset offsets are only unique within one part of speech, so each part
// gets its own range of ids.
const ID_BASE: Record<PosCode, number> = { n: 100_000_000, v: 200_000_000, a: 300_000_000, r: 400_000_000 }
// The part-of-speech digit in a sense key. 5 is an adjective satellite,
// which WordNet files with the adjectives.
const SENSE_KEY_POS: Record<string, PosCode> = { 1: 'n', 2: 'v', 3: 'a', 4: 'r', 5: 'a' }

/** Split a WordNet gloss into its definition and its quoted example sentences. */
export function parseGloss(gloss: string): { definition: string; examples: string[] } {
  const cut = gloss.search(/;\s*"/)
  const definition = (cut < 0 ? gloss : gloss.slice(0, cut)).trim().replace(/;$/, '').trim()
  const examples = cut < 0 ? [] : [...gloss.slice(cut).matchAll(/"([^"]+)"/g)].map(match => match[1]!.trim()).filter(Boolean)
  return { definition, examples }
}

function dataLines(file: string): string[] {
  // Each file opens with the licence, on lines that start with two spaces.
  return fs.readFileSync(file, 'utf8').split('\n').filter(line => line && !line.startsWith('  '))
}

function inputStamp(files: string[]): string {
  const hash = createHash('sha256').update(`format ${FORMAT}\n`)
  for (const file of files) hash.update(path.basename(file)).update(fs.readFileSync(file))
  return hash.digest('hex')
}

export type BuildResult = { built: boolean; synsets: number; senses: number; exceptions: number }

/**
 * Build `output` from WordNet's `dict` directory and the irregular-form lists
 * (`*.exc`). Does nothing when `output` was already built from the same input.
 */
export function buildDictionary(options: { dictDir: string; exceptionsDir: string; output: string }): BuildResult {
  const { dictDir, exceptionsDir, output } = options
  const inputs = [
    ...PARTS.flatMap(([name]) => [path.join(dictDir, `data.${name}`), path.join(dictDir, `index.${name}`), path.join(exceptionsDir, `${name}.exc`)]),
    path.join(dictDir, 'index.sense'),
  ]
  const stamp = inputStamp(inputs)
  if (fs.existsSync(output)) {
    try {
      const existing = new Database(output, { readonly: true })
      try {
        const row = existing.prepare("SELECT value FROM meta WHERE key='stamp'").get() as { value: string } | undefined
        if (row?.value === stamp) {
          const count = (table: string) => (existing.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
          return { built: false, synsets: count('synset'), senses: count('sense'), exceptions: count('exception') }
        }
      } finally { existing.close() }
    } catch { /* Not a dictionary this version can read: rebuild it. */ }
  }

  // How often each sense was tagged in WordNet's reference corpora. The
  // lookup uses it to show a word's most common part of speech first.
  const tagCounts = new Map<string, number>()
  for (const line of fs.readFileSync(path.join(dictDir, 'index.sense'), 'utf8').split('\n')) {
    const [key, , senseNumber, count] = line.split(' ')
    if (!key || !count || count === '0') continue
    const percent = key.lastIndexOf('%')
    const pos = SENSE_KEY_POS[key.charAt(percent + 1)]
    if (pos) tagCounts.set(`${key.slice(0, percent)} ${pos} ${senseNumber}`, Number(count))
  }

  fs.mkdirSync(path.dirname(output), { recursive: true })
  const temporary = `${output}.${process.pid}.tmp`
  fs.rmSync(temporary, { force: true })
  const db = new Database(temporary)
  const result: BuildResult = { built: true, synsets: 0, senses: 0, exceptions: 0 }
  try {
    db.exec(`
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE synset(id INTEGER PRIMARY KEY, definition TEXT NOT NULL, examples TEXT NOT NULL) STRICT;
      CREATE TABLE sense(lemma TEXT NOT NULL, pos TEXT NOT NULL, rank INTEGER NOT NULL, synset INTEGER NOT NULL, tags INTEGER NOT NULL, PRIMARY KEY(lemma, pos, rank)) WITHOUT ROWID, STRICT;
      CREATE TABLE exception(form TEXT NOT NULL, pos TEXT NOT NULL, lemma TEXT NOT NULL, PRIMARY KEY(form, pos, lemma)) WITHOUT ROWID, STRICT;
    `)
    const insertSynset = db.prepare('INSERT INTO synset(id, definition, examples) VALUES (?,?,?)')
    const insertSense = db.prepare('INSERT INTO sense(lemma, pos, rank, synset, tags) VALUES (?,?,?,?,?)')
    const insertException = db.prepare('INSERT OR IGNORE INTO exception(form, pos, lemma) VALUES (?,?,?)')
    db.transaction(() => {
      for (const [name, pos] of PARTS) {
        for (const line of dataLines(path.join(dictDir, `data.${name}`))) {
          const bar = line.indexOf(' | ')
          if (bar < 0) continue
          const { definition, examples } = parseGloss(line.slice(bar + 3))
          insertSynset.run(ID_BASE[pos] + Number(line.slice(0, 8)), definition, JSON.stringify(examples))
          result.synsets++
        }
        // lemma pos synset_cnt p_cnt [pointer...] sense_cnt tagsense_cnt offset...
        // The offsets are already in WordNet's sense order, most common first.
        for (const line of dataLines(path.join(dictDir, `index.${name}`))) {
          const fields = line.trim().split(' ')
          const lemma = fields[0]!, synsetCount = Number(fields[2]), pointerCount = Number(fields[3])
          fields.slice(6 + pointerCount, 6 + pointerCount + synsetCount).forEach((offset, rank) => {
            insertSense.run(lemma, pos, rank, ID_BASE[pos] + Number(offset), tagCounts.get(`${lemma} ${pos} ${rank + 1}`) ?? 0)
            result.senses++
          })
        }
        // Irregular forms: "mice mouse", "better good well".
        for (const line of fs.readFileSync(path.join(exceptionsDir, `${name}.exc`), 'utf8').split('\n')) {
          const [form, ...lemmas] = line.trim().split(/\s+/)
          if (!form) continue
          for (const lemma of lemmas) result.exceptions += insertException.run(form, pos, lemma).changes
        }
      }
      const insertMeta = db.prepare('INSERT INTO meta(key, value) VALUES (?,?)')
      insertMeta.run('stamp', stamp)
      insertMeta.run('source', DICTIONARY_SOURCE)
      insertMeta.run('format', String(FORMAT))
    })()
    db.exec('VACUUM')
  } catch (error) {
    db.close()
    fs.rmSync(temporary, { force: true })
    throw error
  }
  db.close()
  fs.renameSync(temporary, output)
  return result
}
