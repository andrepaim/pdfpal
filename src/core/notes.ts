import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { PdfpalConfig } from './config.js'
import { ProjectService } from './projects.js'
import { SourceService } from './sources.js'
import type { Note } from './types.js'
import { PdfpalError } from './types.js'

const now = () => new Date().toISOString()

export class NoteService {
  private readonly projects: ProjectService
  private readonly sources: SourceService

  constructor(private readonly db: Database, config: PdfpalConfig) {
    this.projects = new ProjectService(db)
    this.sources = new SourceService(db, config)
  }

  list(projectSelector: string): Note[] {
    const project = this.projects.resolve(projectSelector)
    return this.db.prepare('SELECT * FROM notes WHERE project_id=? ORDER BY updated_at DESC').all(project.id) as Note[]
  }

  listBySource(projectSelector: string, sourceSelector: string): Note[] {
    const project = this.projects.resolve(projectSelector)
    const source = this.sources.resolve(project.id, sourceSelector)
    return this.db.prepare('SELECT * FROM notes WHERE project_id=? AND source_id=? ORDER BY updated_at DESC').all(project.id, source.id) as Note[]
  }

  resolve(projectSelector: string, selector: string): Note {
    const project = this.projects.resolve(projectSelector)
    const exact = this.db.prepare('SELECT * FROM notes WHERE project_id=? AND id=?').get(project.id, selector) as Note | undefined
    if (exact) return exact
    const matches = this.db.prepare('SELECT * FROM notes WHERE project_id=? AND title=? COLLATE NOCASE ORDER BY created_at').all(project.id, selector) as Note[]
    if (!matches.length) throw new PdfpalError('NOTE_NOT_FOUND', `Note not found: ${selector}`, 3)
    if (matches.length > 1) throw new PdfpalError('AMBIGUOUS_NOTE', `Note title is ambiguous: ${selector}`, 4, matches.map(({ id, title }) => ({ id, title })))
    return matches[0]!
  }

  create(projectSelector: string, options: { title?: string; content?: string; sourceSelector?: string } = {}): Note {
    const project = this.projects.resolve(projectSelector)
    const source = options.sourceSelector ? this.sources.resolve(project.id, options.sourceSelector) : null
    const timestamp = now()
    const note: Note = {
      id: randomUUID(), project_id: project.id, source_id: source?.id ?? null,
      title: options.title?.trim() || 'Untitled Note', content: options.content ?? '',
      created_at: timestamp, updated_at: timestamp,
    }
    this.db.prepare(`INSERT INTO notes(id,project_id,source_id,title,content,created_at,updated_at)
      VALUES (@id,@project_id,@source_id,@title,@content,@created_at,@updated_at)`).run(note)
    return note
  }

  /** Updates whichever of title/content is provided; the other is left unchanged. */
  update(projectSelector: string, selector: string, changes: { title?: string; content?: string }): Note {
    const note = this.resolve(projectSelector, selector)
    if (changes.title !== undefined && !changes.title.trim()) throw new PdfpalError('INVALID_TITLE', 'Note title cannot be empty', 2)
    const title = changes.title !== undefined ? changes.title.trim() : note.title
    const content = changes.content !== undefined ? changes.content : note.content
    const updated_at = now()
    this.db.prepare('UPDATE notes SET title=?, content=?, updated_at=? WHERE id=?').run(title, content, updated_at, note.id)
    return { ...note, title, content, updated_at }
  }

  delete(projectSelector: string, selector: string): Note {
    const note = this.resolve(projectSelector, selector)
    this.db.prepare('DELETE FROM notes WHERE id=?').run(note.id)
    return note
  }
}
