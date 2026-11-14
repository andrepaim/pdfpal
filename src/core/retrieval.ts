import type { Database } from 'better-sqlite3'
import type { Passage } from './types.js'

export function splitPages(text: string): Array<{ page: number; text: string }> {
  const matches = [...text.matchAll(/^\[Page (\d+)\]\s*$/gm)]
  if (!matches.length) return [{ page: 1, text }]
  return matches.map((match, index) => ({
    page: Number(match[1]),
    text: text.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length).trim(),
  }))
}

function chunks(text: string, target = 1500, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const out: string[] = []
  for (let start = 0; start < clean.length;) {
    let end = Math.min(clean.length, start + target)
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(' ', end)
      if (boundary > start + target / 2) end = boundary
    }
    out.push(clean.slice(start, end))
    if (end === clean.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return out
}

/** A search result with its position in the source, for assembling chat context. */
export type Chunk = Passage & { chunk_id: number; chunk_index: number }

const MAX_TERMS = 16
// Document frequencies are only compared, so counting stops here: terms in more
// chunks than this are treated as equally common.
const FREQUENCY_CAP = 5000
const quoteTerm = (term: string) => `"${term.replaceAll('"', '""')}"`

export class RetrievalService {
  constructor(private readonly db: Database) {}

  index(sourceId: string, text: string): number {
    const insert = this.db.prepare('INSERT INTO source_chunks(source_id,page_number,chunk_index,content) VALUES (?,?,?,?)')
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM source_chunks WHERE source_id=?').run(sourceId)
      let count = 0
      for (const page of splitPages(text)) for (const [index, content] of chunks(page.text).entries()) {
        insert.run(sourceId, page.page, index, content)
        count++
      }
      return count
    })()
  }

  /**
   * FTS terms for a query: its unique words, including one-character symbols such
   * as τ that the index also keeps. A long query (typically a question with an
   * attached selection or Kindle capture) keeps its 16 rarest terms that occur in
   * the library, in their original order, rather than its first 16.
   */
  queryTerms(query: string): string[] {
    const unique = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    if (unique.length <= MAX_TERMS) return unique
    const frequency = this.db.prepare('SELECT COUNT(*) n FROM (SELECT 1 FROM source_chunks_fts WHERE source_chunks_fts MATCH ? LIMIT ?)')
    return unique.map((term, index) => ({ term, index, documents: (frequency.get(quoteTerm(term), FREQUENCY_CAP) as { n: number }).n }))
      .filter(entry => entry.documents > 0)
      .sort((a, b) => a.documents - b.documents || a.index - b.index)
      .slice(0, MAX_TERMS)
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.term)
  }

  searchChunks(projectId: string, query: string, sourceIds: string[] = [], limit = 16): Chunk[] {
    const terms = this.queryTerms(query)
    if (!terms.length) return []
    const match = terms.map(quoteTerm).join(' OR ')
    const filter = sourceIds.length ? `AND s.id IN (${sourceIds.map(() => '?').join(',')})` : ''
    // The chunk id breaks score ties so equal scores always come back in the same order.
    return this.db.prepare(`SELECT c.id chunk_id, c.chunk_index, c.source_id, COALESCE(s.title,s.url,'Source') source_title,
      c.page_number, c.content, bm25(source_chunks_fts) score
      FROM source_chunks_fts JOIN source_chunks c ON c.id=source_chunks_fts.rowid
      JOIN sources s ON s.id=c.source_id
      WHERE source_chunks_fts MATCH ? AND s.project_id=? ${filter}
      ORDER BY score, c.id LIMIT ?`).all(match, projectId, ...sourceIds, limit) as Chunk[]
  }

  search(projectId: string, query: string, sourceIds: string[] = [], limit = 16): Passage[] {
    return this.searchChunks(projectId, query, sourceIds, limit).map(({ chunk_id: _id, chunk_index: _index, ...passage }) => passage)
  }

  /**
   * Passages handed to an assistant (reader and project chat, visual explanations).
   * When the reader sends the page a selection came from, that page and its
   * neighbours come first, and search results from those pages are skipped; then up
   * to `limit` search results follow, with overlapping neighbouring chunks of the
   * same page merged so no text is sent twice. Search itself is unchanged.
   */
  context(projectId: string, query: string, sourceIds: string[], limit: number, page?: PageContextRequest): Passage[] {
    const pages = page ? selectionPages(page) : []
    const covered = (chunk: Chunk) => pages.some(entry => entry.source_id === chunk.source_id && entry.page_number === chunk.page_number)
    const found = pages.length ? this.searchChunks(projectId, query, sourceIds, limit * 4).filter(chunk => !covered(chunk)).slice(0, limit)
      : this.searchChunks(projectId, query, sourceIds, limit)
    return [...pages, ...mergeAdjacentChunks(found).map(({ chunk_id: _id, chunk_index: _index, ...passage }) => passage)]
  }
}

export type PageContextRequest = {
  source: { id: string; title: string | null; url?: string | null; pdf_text: string | null }
  page: number
  selection?: string
}

/** Characters kept per guaranteed page; a source without page markers is one long "page". */
export const PAGE_CONTEXT_CHARS = 6000

/** Joins two chunks whose ends overlap by up to 200 characters. */
export function joinOverlapping(first: string, second: string): string {
  for (let size = Math.min(200, first.length, second.length); size > 0; size--) {
    if (first.endsWith(second.slice(0, size))) return first + second.slice(size)
  }
  return `${first} ${second}`
}

/**
 * Merges results that are consecutive chunks of the same page into one passage at
 * the best-ranked member's position, so the 150-character overlap is sent once.
 */
export function mergeAdjacentChunks(found: Chunk[]): Chunk[] {
  const groups: Chunk[][] = []
  for (const chunk of found) {
    const touching = groups.filter(group => group[0]!.source_id === chunk.source_id && group[0]!.page_number === chunk.page_number
      && group.some(member => Math.abs(member.chunk_index - chunk.chunk_index) === 1))
    if (!touching.length) { groups.push([chunk]); continue }
    const [target, ...joined] = touching
    target!.push(chunk, ...joined.flat())
    for (const group of joined) groups.splice(groups.indexOf(group), 1)
  }
  return groups.map(group => {
    const ordered = [...group].sort((a, b) => a.chunk_index - b.chunk_index)
    return { ...group[0]!, chunk_index: ordered[0]!.chunk_index, content: ordered.slice(1).reduce((text, member) => joinOverlapping(text, member.content), ordered[0]!.content) }
  })
}

/**
 * The selection's page, then the previous and next pages, from the source text.
 * Long pages are trimmed to PAGE_CONTEXT_CHARS: around the selection on its own
 * page, the end of the previous page and the start of the next.
 */
export function selectionPages({ source, page, selection }: PageContextRequest): Passage[] {
  if (!source.pdf_text || !Number.isInteger(page) || page < 1) return []
  const pages = new Map(splitPages(source.pdf_text).map(entry => [entry.page, entry.text.replace(/\s+/g, ' ').trim()]))
  const trim = (text: string, where: 'selection' | 'end' | 'start') => {
    if (text.length <= PAGE_CONTEXT_CHARS) return text
    if (where === 'end') return text.slice(-PAGE_CONTEXT_CHARS)
    if (where === 'start') return text.slice(0, PAGE_CONTEXT_CHARS)
    const at = selection ? text.indexOf(selection.replace(/\s+/g, ' ').trim().slice(0, 200)) : -1
    const start = Math.max(0, Math.min(text.length - PAGE_CONTEXT_CHARS, (at < 0 ? 0 : at) - PAGE_CONTEXT_CHARS / 2))
    return text.slice(start, start + PAGE_CONTEXT_CHARS)
  }
  return ([[page, 'selection'], [page - 1, 'end'], [page + 1, 'start']] as const)
    .filter(([number]) => pages.get(number))
    .map(([number, where]) => ({ source_id: source.id, source_title: source.title || source.url || 'Source', page_number: number, content: trim(pages.get(number)!, where), score: 0 }))
}
