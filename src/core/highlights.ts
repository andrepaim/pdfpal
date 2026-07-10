import type { Database } from 'better-sqlite3'

export interface Highlight {
  id: string
  source_id: string
  source_title: string
  collection_id: string | null
  collection_name: string | null
  page_number: number
  text: string
  color: string
  created_at: string
}

/** Every annotation in a project, joined with its source and collection for grouping. */
export function listHighlights(db: Database, projectId: string): Highlight[] {
  return db.prepare(`SELECT a.id, a.source_id, COALESCE(s.title, s.url, 'Source') source_title,
    s.collection_id, col.name collection_name, a.page_number, a.text, a.color, a.created_at
    FROM annotations a JOIN sources s ON s.id = a.source_id
    LEFT JOIN collections col ON col.id = s.collection_id
    WHERE a.project_id = ? ORDER BY source_title, a.page_number, a.y1`).all(projectId) as Highlight[]
}
