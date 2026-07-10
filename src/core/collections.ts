import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { ProjectService } from './projects.js'
import { PdfpalError } from './types.js'

const now = () => new Date().toISOString()

export interface Collection {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  position: number
  created_at: string
  source_count?: number
}

export class CollectionService {
  private readonly projects: ProjectService

  constructor(private readonly db: Database) {
    this.projects = new ProjectService(db)
  }

  /** All collections in a project, ordered for tree building, with direct source counts. */
  list(projectSelector: string): Collection[] {
    const project = this.projects.resolve(projectSelector)
    return this.db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM sources WHERE collection_id=c.id) source_count
      FROM collections c WHERE c.project_id=? ORDER BY c.parent_id IS NOT NULL, c.parent_id, c.position, c.created_at`).all(project.id) as Collection[]
  }

  resolve(projectSelector: string, selector: string): Collection {
    const project = this.projects.resolve(projectSelector)
    const exact = this.db.prepare('SELECT * FROM collections WHERE project_id=? AND id=?').get(project.id, selector) as Collection | undefined
    if (exact) return exact
    const matches = this.db.prepare('SELECT * FROM collections WHERE project_id=? AND name=? COLLATE NOCASE ORDER BY created_at').all(project.id, selector) as Collection[]
    if (!matches.length) throw new PdfpalError('COLLECTION_NOT_FOUND', `Collection not found: ${selector}`, 3)
    if (matches.length > 1) throw new PdfpalError('AMBIGUOUS_COLLECTION', `Collection name is ambiguous: ${selector}`, 4, matches.map(({ id, name }) => ({ id, name })))
    return matches[0]!
  }

  create(projectSelector: string, name: string, parentSelector?: string): Collection {
    const project = this.projects.resolve(projectSelector)
    if (!name.trim()) throw new PdfpalError('INVALID_NAME', 'Collection name cannot be empty', 2)
    const parent = parentSelector ? this.resolve(project.id, parentSelector) : null
    const position = (this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 next FROM collections WHERE project_id=? AND parent_id IS ?').get(project.id, parent?.id ?? null) as { next: number }).next
    const collection: Collection = { id: randomUUID(), project_id: project.id, parent_id: parent?.id ?? null, name: name.trim(), position, created_at: now() }
    this.db.prepare('INSERT INTO collections(id,project_id,parent_id,name,position,created_at) VALUES (@id,@project_id,@parent_id,@name,@position,@created_at)').run(collection)
    return collection
  }

  rename(projectSelector: string, selector: string, name: string): Collection {
    const collection = this.resolve(projectSelector, selector)
    if (!name.trim()) throw new PdfpalError('INVALID_NAME', 'Collection name cannot be empty', 2)
    this.db.prepare('UPDATE collections SET name=? WHERE id=?').run(name.trim(), collection.id)
    return { ...collection, name: name.trim() }
  }

  /** Reparent a collection. `parentSelector` null moves it to the project root. */
  move(projectSelector: string, selector: string, parentSelector: string | null): Collection {
    const collection = this.resolve(projectSelector, selector)
    const parent = parentSelector ? this.resolve(collection.project_id, parentSelector) : null
    if (parent && this.descendantIds(collection.id).includes(parent.id))
      throw new PdfpalError('COLLECTION_CYCLE', 'A collection cannot be moved inside itself or one of its descendants', 4)
    const position = (this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 next FROM collections WHERE project_id=? AND parent_id IS ?').get(collection.project_id, parent?.id ?? null) as { next: number }).next
    this.db.prepare('UPDATE collections SET parent_id=?, position=? WHERE id=?').run(parent?.id ?? null, position, collection.id)
    return { ...collection, parent_id: parent?.id ?? null, position }
  }

  reorder(projectSelector: string, selector: string, position: number): Collection {
    const collection = this.resolve(projectSelector, selector)
    this.db.prepare('UPDATE collections SET position=? WHERE id=?').run(position, collection.id)
    return { ...collection, position }
  }

  delete(projectSelector: string, selector: string): Collection {
    const collection = this.resolve(projectSelector, selector)
    // Child collections cascade; member sources fall back to unfiled via the
    // sources.collection_id ON DELETE SET NULL foreign key.
    this.db.prepare('DELETE FROM collections WHERE id=?').run(collection.id)
    return collection
  }

  /** The collection's own id plus every descendant collection id. */
  descendantIds(collectionId: string): string[] {
    return (this.db.prepare(`WITH RECURSIVE subtree(id) AS (
      SELECT id FROM collections WHERE id=?
      UNION ALL SELECT c.id FROM collections c JOIN subtree s ON c.parent_id=s.id)
      SELECT id FROM subtree`).all(collectionId) as Array<{ id: string }>).map(row => row.id)
  }

  /** Every source id filed anywhere within a collection subtree — the retrieval scope. */
  descendantSourceIds(collectionId: string): string[] {
    const ids = this.descendantIds(collectionId)
    if (!ids.length) return []
    return (this.db.prepare(`SELECT id FROM sources WHERE collection_id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: string }>).map(row => row.id)
  }
}
