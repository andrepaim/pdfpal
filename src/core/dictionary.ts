import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { DICTIONARY_SOURCE, type PosCode } from './dictionary-build.js'

// Offline definitions for the reader's definition card. The data is the
// WordNet file built by dictionary-build.ts; nothing here uses the network or
// the user's library.

export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb'
export type DictionarySense = { definition: string; examples: string[] }
export type DictionaryEntry = { lemma: string; part_of_speech: PartOfSpeech; senses: DictionarySense[] }
export type DictionaryResult = { query: string; entries: DictionaryEntry[]; source: string }

const DEFAULT_PATH = fileURLToPath(new URL('../../dist/dictionary/wordnet.sqlite', import.meta.url))
const POS_ORDER: PosCode[] = ['n', 'v', 'a', 'r']
const POS_NAME: Record<PosCode, PartOfSpeech> = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' }
/** A longer selection is a passage, not something to define. */
export const MAX_SELECTED_WORDS = 4
/** WordNet has longer entries, but a compound found around a word stays short. */
const MAX_COMPOUND_WORDS = 4
const MAX_CONTEXT_WORDS = 3
const MAX_COMPOUNDS = 2

// WordNet's own rules for reducing a regular inflected form to its base
// form: [ending, replacement]. Irregular forms come from the exception table.
const SUFFIX_RULES: Record<PosCode, Array<[string, string]>> = {
  n: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  v: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  a: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e']],
  r: [],
}

const ENDS_CLAUSE = /[.,;:!?)\]]$/
const STARTS_CLAUSE = /^[(\[]/

/** Lower-case a word as selected and drop the punctuation around it. */
function cleanWord(chunk: string): string {
  return chunk
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, '-')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function chunks(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

type Found = { lemma: string; pos: PosCode; tags: number; senses: DictionarySense[] }

export class DictionaryService {
  private db: Database.Database | null | undefined

  constructor(private readonly file = DEFAULT_PATH) {}

  /** False when the dictionary file is missing, as in a checkout that has not been built. */
  get available(): boolean {
    return this.open() !== null
  }

  private open(): Database.Database | null {
    if (this.db !== undefined) return this.db
    try {
      // Opened from memory, not by path: in the desktop app the file sits
      // inside the app archive, which Node can read but SQLite cannot open.
      this.db = new Database(fs.readFileSync(this.file))
    } catch {
      this.db = null
    }
    return this.db
  }

  close(): void {
    this.db?.close()
    this.db = undefined
  }

  /** Candidate base forms of one word for a part of speech, the word itself first. */
  private baseForms(db: Database.Database, word: string, pos: PosCode): string[] {
    const forms = [word]
    for (const row of db.prepare('SELECT lemma FROM exception WHERE form=? AND pos=?').all(word, pos) as Array<{ lemma: string }>) forms.push(row.lemma)
    for (const [ending, replacement] of SUFFIX_RULES[pos]) {
      if (word.length > ending.length && word.endsWith(ending)) forms.push(word.slice(0, -ending.length) + replacement)
    }
    return forms
  }

  /** Lemmas, in WordNet's spelling, that a word or phrase could be an entry for. */
  private candidates(db: Database.Database, words: string[], pos: PosCode): string[] {
    if (words.length === 1) {
      const word = words[0]!
      // "trade-off" is listed with its hyphen, "e-mail" also as "email".
      const spellings = word.includes('-') ? [word, word.replaceAll('-', '_'), word.replaceAll('-', '')] : [word]
      return spellings.flatMap(spelling => this.baseForms(db, spelling, pos))
    }
    // Multi-word entries join their words with underscores. A phrase
    // inflects on its last word as a noun ("neural networks") and on its
    // first as a verb ("carried out").
    const lemmas = [words.join('_')]
    if (pos === 'n') for (const base of this.baseForms(db, words.at(-1)!, 'n')) lemmas.push([...words.slice(0, -1), base].join('_'))
    if (pos === 'v') for (const base of this.baseForms(db, words[0]!, 'v')) lemmas.push([base, ...words.slice(1)].join('_'))
    return lemmas
  }

  private lookup(db: Database.Database, words: string[]): Found[] {
    const senses = db.prepare('SELECT s.tags, y.definition, y.examples FROM sense s JOIN synset y ON y.id=s.synset WHERE s.lemma=? AND s.pos=? ORDER BY s.rank')
    const found: Found[] = []
    for (const pos of POS_ORDER) {
      for (const lemma of new Set(this.candidates(db, words, pos))) {
        const rows = senses.all(lemma, pos) as Array<{ tags: number; definition: string; examples: string }>
        if (!rows.length) continue
        found.push({
          lemma, pos,
          tags: rows.reduce((sum, row) => sum + row.tags, 0),
          senses: rows.map(row => ({ definition: row.definition, examples: JSON.parse(row.examples) as string[] })),
        })
      }
    }
    // The most used reading first: "ran" opens with the verb "run". The sort
    // is stable, so ties keep the word as written ahead of its base forms.
    return found.sort((a, b) => b.tags - a.tags)
  }

  /**
   * Define the selected `text`. `before` and `after` are the text on either
   * side of the selection. They complete a word selected in part ("known" in
   * "well-known") and find a compound around it ("network" in "neural
   * network"); the compound is listed first, then the word on its own.
   */
  define(text: string, context: { before?: string; after?: string } = {}): DictionaryResult {
    const empty = (query: string): DictionaryResult => ({ query, entries: [], source: DICTIONARY_SOURCE })
    const selected = chunks(text)
    const selectedWords = selected.map(cleanWord).filter(Boolean)
    if (!selectedWords.length || selectedWords.length > MAX_SELECTED_WORDS) return empty(selectedWords.join(' '))
    // WordNet lists numbers ("42: being two more than forty"), which is noise in a paper.
    if (!selectedWords.some(word => /\p{L}/u.test(word))) return empty(selectedWords.join(' '))
    const db = this.open()
    if (!db) return empty(selectedWords.join(' '))

    const before = chunks(context.before ?? ''), after = chunks(context.after ?? '')
    // No space between the selection and its neighbour means the selection
    // stops inside a word: double-clicking "well-known" selects only one half.
    const whole = [...selected]
    if (before.length && !/\s$/.test(context.before!) && !/^\s/.test(text)) whole[0] = before.pop() + whole[0]!
    if (after.length && !/\s$/.test(text) && !/^\s/.test(context.after!)) whole[whole.length - 1] += after.shift()!
    const words = whole.map(cleanWord).filter(Boolean)
    if (!words.length) return empty(selectedWords.join(' '))

    const entries: Found[] = []
    const add = (found: Found[]) => {
      for (const entry of found) if (!entries.some(known => known.lemma === entry.lemma && known.pos === entry.pos)) entries.push(entry)
    }

    // Neighbouring words that could belong to the same phrase: a word that
    // ends a clause, or starts a bracket, separates what follows from it.
    const left: string[] = [], right: string[] = []
    if (!STARTS_CLAUSE.test(whole[0]!)) {
      for (const chunk of before.reverse().slice(0, MAX_CONTEXT_WORDS)) {
        const word = cleanWord(chunk)
        if (!word || ENDS_CLAUSE.test(chunk)) break
        left.unshift(word)
        if (STARTS_CLAUSE.test(chunk)) break
      }
    }
    if (!ENDS_CLAUSE.test(whole.at(-1)!)) {
      for (const chunk of after.slice(0, MAX_CONTEXT_WORDS)) {
        const word = cleanWord(chunk)
        if (!word || STARTS_CLAUSE.test(chunk)) break
        right.push(word)
        if (ENDS_CLAUSE.test(chunk)) break
      }
    }
    // Every run of words that contains the selection, longest first.
    const windows: string[][] = []
    for (let size = Math.min(MAX_COMPOUND_WORDS, left.length + words.length + right.length); size > words.length; size--) {
      for (let fromLeft = Math.min(left.length, size - words.length); fromLeft >= 0; fromLeft--) {
        const fromRight = size - words.length - fromLeft
        if (fromRight <= right.length) windows.push([...left.slice(left.length - fromLeft), ...words, ...right.slice(0, fromRight)])
      }
    }
    let compounds = 0
    for (const window of windows) {
      if (compounds >= MAX_COMPOUNDS) break
      const found = this.lookup(db, window)
      if (found.length) { add(found); compounds++ }
    }

    const direct = this.lookup(db, words)
    add(direct)
    const completed = words.join(' ') !== selectedWords.join(' ')
    if (words.length === 1) {
      const parts = words[0]!.split('-').filter(part => part.length > 1)
      // Clicking one half of "well-known" lists the whole word, then that half.
      if (completed && parts.includes(selectedWords[0]!)) add(this.lookup(db, selectedWords))
      // A hyphenated word with no entry of its own ("self-attention") falls
      // back to its parts, the last first since it carries the meaning.
      else if (!completed && !direct.length && parts.length > 1) for (const part of parts.reverse()) add(this.lookup(db, [part]))
    }
    // The text around the selection can be wrong about where a word ends,
    // as when a PDF leaves no space between two words. If completing the
    // selection found nothing, define exactly what was selected.
    if (completed && !direct.length) add(this.lookup(db, selectedWords))

    return {
      query: words.join(' '),
      entries: entries.map(entry => ({ lemma: entry.lemma.replaceAll('_', ' '), part_of_speech: POS_NAME[entry.pos], senses: entry.senses })),
      source: DICTIONARY_SOURCE,
    }
  }
}
