// Prototype retrieval pipeline for evaluating candidate changes (RET-04 to RET-07)
// one at a time. Each option mirrors one candidate; variants.ts turns option sets
// into named variants. Kept changes are then implemented in src/ and evaluated
// through the product code; this file keeps rejected candidates reproducible.
import type Database from 'better-sqlite3'
import { splitPages } from '../../src/core/retrieval.js'
import type { Passage } from '../../src/core/types.js'
import type { ComposedQuery, RetrievalVariant } from './harness.js'
import { RetrievalService } from '../../src/core/retrieval.js'

export type LabOptions = {
  /** RET-04: rebuild the FTS table with this tokenizer before indexing. */
  tokenizer?: string
  /** RET-05 */
  stopwords?: 'en' | 'en+pt'
  singles?: boolean
  rarest?: boolean
  /** Reserve the term budget for question words before selection words. */
  questionFirst?: boolean
  /** Score = bm25(question terms) + weight × bm25(selection terms). */
  selectionWeight?: number
  /** RET-06: selection page and neighbours ahead of search results. */
  pageContext?: boolean
  /** RET-07 */
  merge?: boolean
  capPerSource?: boolean
  tiebreak?: boolean
}

const EN = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by can could
did do does doing done down during each either few for from further had has have having he her here hers him his how however i if in into is it its
itself just me more most much my no nor not now of off on once only or other our ours out over own same she should so some such than that the their
theirs them then there these they this those through to too under until up very was we were what when where which while who whom whose why will with
would you your yours yet via per eg ie etc actually really still get gets got make makes made use used uses using way ways thing things say says said`.split(/\s+/))
const PT = new Set(`o a os as um uma uns umas de do da dos das em no na nos nas por pela pelo pelas pelos para com sem que qual quais como porque
e é ou se ao aos à às ela ele eles elas isso isto esse essa este esta só mais não sua seu suas seus quanto quanta quantos quantas onde quando
também já ser foi são está estão tem têm há me te lhe nós vós entre sobre até após cada muito muita`.split(/\s+/))

function tokens(text: string, singles: boolean): string[] {
  return text.toLowerCase().match(singles ? /[\p{L}\p{N}]+/gu : /[\p{L}\p{N}]{2,}/gu) ?? []
}

const quoteTerm = (term: string) => `"${term.replaceAll('"', '""')}"`

function scopeFilter(sourceIds: string[]) {
  return sourceIds.length ? `AND s.id IN (${sourceIds.map(() => '?').join(',')})` : ''
}

type Row = Passage & { id: number; chunk_index: number }

function rawSearch(db: Database.Database, match: string, projectId: string, sourceIds: string[], limit: number, tiebreak: boolean): Row[] {
  return db.prepare(`SELECT c.id, c.chunk_index, c.source_id, COALESCE(s.title,s.url,'Source') source_title,
    c.page_number, c.content, bm25(source_chunks_fts) score
    FROM source_chunks_fts JOIN source_chunks c ON c.id=source_chunks_fts.rowid
    JOIN sources s ON s.id=c.source_id
    WHERE source_chunks_fts MATCH ? AND s.project_id=? ${scopeFilter(sourceIds)}
    ORDER BY score${tiebreak ? ', c.id' : ''} LIMIT ?`).all(match, projectId, ...sourceIds, limit) as Row[]
}

function docFrequency(db: Database.Database, term: string): number {
  return (db.prepare('SELECT COUNT(*) n FROM (SELECT 1 FROM source_chunks_fts WHERE source_chunks_fts MATCH ? LIMIT 5000)').get(quoteTerm(term)) as { n: number }).n
}

function pickTerms(db: Database.Database, words: string[], options: LabOptions, budget = 16): string[] {
  const stop = options.stopwords === 'en+pt' ? (word: string) => EN.has(word) || PT.has(word) : options.stopwords === 'en' ? (word: string) => EN.has(word) : () => false
  const unique = [...new Set(words)].filter(word => !stop(word))
  if (!options.rarest) return unique.slice(0, budget)
  const ranked = unique.map((term, index) => ({ term, index, df: docFrequency(db, term) })).filter(entry => entry.df > 0)
  return ranked.sort((a, b) => a.df - b.df || a.index - b.index).slice(0, budget).sort((a, b) => a.index - b.index).map(entry => entry.term)
}

function searchRows(db: Database.Database, projectId: string, query: ComposedQuery, sourceIds: string[], limit: number, options: LabOptions): Row[] {
  const singles = !!options.singles, tiebreak = !!options.tiebreak
  // Without question/selection handling, the composed text is tokenized as one string, as today.
  if (!options.questionFirst && options.selectionWeight === undefined || !query.selection) {
    const terms = pickTerms(db, tokens(query.text, singles), options)
    return terms.length ? rawSearch(db, terms.map(quoteTerm).join(' OR '), projectId, sourceIds, limit, tiebreak) : []
  }
  const questionTerms = pickTerms(db, tokens(query.question, singles), options)
  const selectionTerms = pickTerms(db, tokens(query.selection, singles), options).filter(term => !questionTerms.includes(term))
  if (options.selectionWeight === undefined) {
    const terms = [...questionTerms, ...selectionTerms].slice(0, 16)
    return terms.length ? rawSearch(db, terms.map(quoteTerm).join(' OR '), projectId, sourceIds, limit, tiebreak) : []
  }
  const q = questionTerms.slice(0, 16), s = selectionTerms.slice(0, Math.max(0, 16 - q.length))
  if (!q.length || !s.length) {
    const terms = [...q, ...s]
    return terms.length ? rawSearch(db, terms.map(quoteTerm).join(' OR '), projectId, sourceIds, limit, tiebreak) : []
  }
  const all = [...q, ...s].map(quoteTerm).join(' OR ')
  const candidates = rawSearch(db, all, projectId, sourceIds, 400, true)
  const scoreFor = (terms: string[]) => {
    const map = new Map<number, number>()
    const ids = candidates.map(row => row.id)
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500)
      const rows = db.prepare(`SELECT rowid id, bm25(source_chunks_fts) score FROM source_chunks_fts WHERE source_chunks_fts MATCH ? AND rowid IN (${part.map(() => '?').join(',')})`)
        .all(terms.map(quoteTerm).join(' OR '), ...part) as Array<{ id: number; score: number }>
      for (const row of rows) map.set(row.id, row.score)
    }
    return map
  }
  const qs = scoreFor(q), ss = scoreFor(s), weight = options.selectionWeight
  return candidates.map(row => ({ ...row, score: (qs.get(row.id) ?? 0) + weight * (ss.get(row.id) ?? 0) }))
    .sort((a, b) => a.score - b.score || a.id - b.id).slice(0, limit)
}

/** Joins two chunks that overlap by up to 200 characters. */
export function joinOverlapping(first: string, second: string): string {
  for (let size = Math.min(200, first.length, second.length); size > 0; size--) {
    if (first.endsWith(second.slice(0, size))) return first + second.slice(size)
  }
  return `${first} ${second}`
}

function mergeAdjacent(rows: Row[]): Row[] {
  const out: Row[] = []
  for (const row of rows) {
    const neighbour = out.find(kept => kept.source_id === row.source_id && kept.page_number === row.page_number && Math.abs(kept.chunk_index - row.chunk_index) === 1)
    if (!neighbour) { out.push({ ...row }); continue }
    const [a, b] = neighbour.chunk_index < row.chunk_index ? [neighbour, row] : [row, neighbour]
    neighbour.content = joinOverlapping(a.content, b.content)
    neighbour.chunk_index = Math.max(a.chunk_index, b.chunk_index)
  }
  return out
}

function pagePassages(db: Database.Database, sourceId: string, page: number): Passage[] {
  const source = db.prepare('SELECT title,url,pdf_text FROM sources WHERE id=?').get(sourceId) as { title: string | null; url: string | null; pdf_text: string | null } | undefined
  if (!source?.pdf_text) return []
  const pages = new Map(splitPages(source.pdf_text).map(entry => [entry.page, entry.text.replace(/\s+/g, ' ').trim()]))
  return [page, page - 1, page + 1].filter(number => pages.get(number)).map(number => ({
    source_id: sourceId, source_title: source.title || source.url || 'Source', page_number: number, content: pages.get(number)!, score: 0,
  }))
}

export function labVariant(name: string, description: string, options: LabOptions): RetrievalVariant {
  return {
    name, description,
    prepare: options.tokenizer ? db => db.exec(`
      DROP TRIGGER IF EXISTS source_chunks_ai; DROP TRIGGER IF EXISTS source_chunks_ad; DROP TRIGGER IF EXISTS source_chunks_au;
      DROP TABLE IF EXISTS source_chunks_fts;
      CREATE VIRTUAL TABLE source_chunks_fts USING fts5(content, content='source_chunks', content_rowid='id', tokenize='${options.tokenizer}');
      CREATE TRIGGER source_chunks_ai AFTER INSERT ON source_chunks BEGIN
        INSERT INTO source_chunks_fts(rowid, content) VALUES (new.id, new.content); END;
      CREATE TRIGGER source_chunks_ad AFTER DELETE ON source_chunks BEGIN
        INSERT INTO source_chunks_fts(source_chunks_fts, rowid, content) VALUES('delete', old.id, old.content); END;
      CREATE TRIGGER source_chunks_au AFTER UPDATE ON source_chunks BEGIN
        INSERT INTO source_chunks_fts(source_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO source_chunks_fts(rowid, content) VALUES (new.id, new.content); END;`) : undefined,
    index: (db, sourceId, text) => { new RetrievalService(db).index(sourceId, text) },
    search: (db, projectId, query, sourceIds, limit) => {
      const chat = query.path !== 'project-search'
      const multi = sourceIds.length !== 1
      const cap = chat && multi && options.capPerSource ? Math.ceil(limit / 2) : Infinity
      const guaranteed = chat && options.pageContext && query.openSource && query.selectionPage ? pagePassages(db, query.openSource, query.selectionPage) : []
      const covered = (row: Passage) => guaranteed.some(page => page.source_id === row.source_id && page.page_number === row.page_number)
      const extra = cap < Infinity || guaranteed.length || (chat && options.merge)
      let rows = searchRows(db, projectId, query, sourceIds, extra ? limit * 4 : limit, options)
      if (guaranteed.length) rows = rows.filter(row => !covered(row))
      if (cap < Infinity) {
        const counts = new Map<string, number>()
        rows = rows.filter(row => { const n = (counts.get(row.source_id) ?? 0) + 1; counts.set(row.source_id, n); return n <= cap })
      }
      rows = rows.slice(0, limit)
      if (chat && options.merge) rows = mergeAdjacent(rows)
      return [...guaranteed, ...rows.map(({ id: _id, chunk_index: _index, ...passage }) => passage)]
    },
  }
}
