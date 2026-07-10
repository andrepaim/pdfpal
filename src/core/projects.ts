import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { Project } from './types.js'
import { PdfpalError } from './types.js'

const now = () => new Date().toISOString()

export class ProjectService {
  constructor(private readonly db: Database) {}

  list(): Project[] {
    return this.db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM sources WHERE project_id=p.id) source_count,
      (SELECT COUNT(*) FROM notes WHERE project_id=p.id) note_count,
      (SELECT COUNT(*) FROM artifacts WHERE project_id=p.id) artifact_count,
      (SELECT COUNT(*) FROM chat_sessions WHERE project_id=p.id) chat_count
      FROM projects p ORDER BY accessed_at DESC`).all() as Project[]
  }

  resolve(selector: string): Project {
    const exact = this.db.prepare('SELECT * FROM projects WHERE id=?').get(selector) as Project | undefined
    if (exact) return exact
    const matches = this.db.prepare('SELECT * FROM projects WHERE title=? COLLATE NOCASE ORDER BY created_at').all(selector) as Project[]
    if (!matches.length) throw new PdfpalError('PROJECT_NOT_FOUND', `Project not found: ${selector}`, 3)
    if (matches.length > 1) throw new PdfpalError('AMBIGUOUS_PROJECT', `Project title is ambiguous: ${selector}`, 4, matches.map(({ id, title }) => ({ id, title })))
    return matches[0]!
  }

  create(title: string, description = ''): Project {
    if (!title.trim()) throw new PdfpalError('INVALID_TITLE', 'Project title cannot be empty', 2)
    const project: Project = { id: randomUUID(), title: title.trim(), description, created_at: now(), accessed_at: now() }
    this.db.prepare('INSERT INTO projects(id,title,description,created_at,accessed_at) VALUES (@id,@title,@description,@created_at,@accessed_at)').run(project)
    return project
  }

  rename(selector: string, title: string): Project {
    const project = this.resolve(selector)
    if (!title.trim()) throw new PdfpalError('INVALID_TITLE', 'Project title cannot be empty', 2)
    this.db.prepare('UPDATE projects SET title=?, accessed_at=? WHERE id=?').run(title.trim(), now(), project.id)
    return this.resolve(project.id)
  }

  delete(selector: string): Project {
    const project = this.resolve(selector)
    this.db.prepare('DELETE FROM projects WHERE id=?').run(project.id)
    return project
  }
}
