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

  search(projectId: string, query: string, sourceIds: string[] = [], limit = 16): Passage[] {
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 16)
    if (!terms.length) return []
    const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ')
    const filter = sourceIds.length ? `AND s.id IN (${sourceIds.map(() => '?').join(',')})` : ''
    return this.db.prepare(`SELECT c.source_id, COALESCE(s.title,s.url,'Source') source_title,
      c.page_number, c.content, bm25(source_chunks_fts) score
      FROM source_chunks_fts JOIN source_chunks c ON c.id=source_chunks_fts.rowid
      JOIN sources s ON s.id=c.source_id
      WHERE source_chunks_fts MATCH ? AND s.project_id=? ${filter}
      ORDER BY score LIMIT ?`).all(match, projectId, ...sourceIds, limit) as Passage[]
  }
}
