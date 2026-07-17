import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'better-sqlite3'
import type { PdfpalConfig } from './config.js'
import { extractPdf, resolvePdf, storePdf } from './pdf.js'
import { titleFromUrl } from './research.js'
import { CollectionService } from './collections.js'
import { ProjectService } from './projects.js'
import { RetrievalService } from './retrieval.js'
import type { Source } from './types.js'
import { PdfpalError } from './types.js'

const now = () => new Date().toISOString()

export class SourceService {
  private readonly projects: ProjectService
  private readonly retrieval: RetrievalService
  private readonly collections: CollectionService

  constructor(private readonly db: Database, private readonly config: PdfpalConfig) {
    this.projects = new ProjectService(db)
    this.retrieval = new RetrievalService(db)
    this.collections = new CollectionService(db)
  }

  list(projectSelector: string): Source[] {
    const project = this.projects.resolve(projectSelector)
    return this.db.prepare('SELECT * FROM sources WHERE project_id=? ORDER BY created_at DESC').all(project.id) as Source[]
  }

  resolve(projectSelector: string, selector: string): Source {
    const project = this.projects.resolve(projectSelector)
    const exact = this.db.prepare('SELECT * FROM sources WHERE project_id=? AND id=?').get(project.id, selector) as Source | undefined
    if (exact) return exact
    const matches = this.db.prepare('SELECT * FROM sources WHERE project_id=? AND title=? COLLATE NOCASE ORDER BY created_at').all(project.id, selector) as Source[]
    if (!matches.length) throw new PdfpalError('SOURCE_NOT_FOUND', `Source not found: ${selector}`, 3)
    if (matches.length > 1) throw new PdfpalError('AMBIGUOUS_SOURCE', `Source title is ambiguous: ${selector}`, 4, matches.map(({ id, title }) => ({ id, title })))
    return matches[0]!
  }

  async add(projectSelector: string, location: string, title?: string, collectionSelector?: string): Promise<Source> {
    const project = this.projects.resolve(projectSelector)
    const collectionId = collectionSelector ? this.collections.resolve(project.id, collectionSelector).id : null
    const id = randomUUID()
    const isUrl = /^https?:\/\//i.test(location)
    let bytes: Buffer
    let url: string | null = null
    let originalLocation = location
    if (isUrl) {
      const resolved = await resolvePdf(location)
      bytes = resolved.bytes
      url = resolved.url
    } else {
      const absolute = path.resolve(location)
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new PdfpalError('FILE_NOT_FOUND', `PDF file not found: ${location}`, 3)
      bytes = fs.readFileSync(absolute)
      originalLocation = absolute
      if (bytes.subarray(0, 4).toString() !== '%PDF') throw new PdfpalError('NOT_A_PDF', `File is not a PDF: ${location}`, 2)
    }
    const extracted = await extractPdf(bytes)
    const stored = storePdf(bytes, this.config.filesDir, id)
    const timestamp = now()
    // Prefer a clean catalogue title for arXiv/DOI links; the PDF's own
    // first-line heuristic often bleeds authors and affiliations into the title.
    const catalogueTitle = isUrl && !title?.trim() ? await titleFromUrl(location, this.config.semanticScholarApiKey) : null
    const sourceTitle = title?.trim() || catalogueTitle || extracted.title || (isUrl ? new URL(location).pathname.split('/').filter(Boolean).at(-1) : path.basename(location)) || 'Untitled Source'
    const source: Source = {
      id, project_id: project.id, type: 'pdf', url, title: sourceTitle, pdf_text: extracted.text,
      pages: extracted.pages, last_page_read: 1, created_at: timestamp, accessed_at: timestamp, original_location: originalLocation,
      local_path: path.basename(stored.localPath), media_type: 'application/pdf', byte_size: bytes.length, content_hash: stored.hash,
      collection_id: collectionId,
    }
    try {
      this.db.transaction(() => {
        this.db.prepare(`INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,last_page_read,created_at,accessed_at,
          original_location,local_path,media_type,byte_size,content_hash,collection_id)
          VALUES (@id,@project_id,@type,@url,@title,@pdf_text,@pages,@last_page_read,@created_at,@accessed_at,
          @original_location,@local_path,@media_type,@byte_size,@content_hash,@collection_id)`).run(source)
        this.retrieval.index(id, extracted.text)
        this.db.prepare('UPDATE projects SET accessed_at=? WHERE id=?').run(timestamp, project.id)
      })()
    } catch (error) {
      fs.rmSync(stored.localPath, { force: true })
      throw error
    }
    return source
  }

  rename(projectSelector: string, sourceSelector: string, title: string): Source {
    const source = this.resolve(projectSelector, sourceSelector)
    if (!title.trim()) throw new PdfpalError('INVALID_TITLE', 'Source title cannot be empty', 2)
    this.db.prepare('UPDATE sources SET title=?, accessed_at=? WHERE id=?').run(title.trim(), now(), source.id)
    return this.resolve(source.project_id, source.id)
  }

  move(projectSelector: string, sourceSelector: string, targetProjectSelector: string): Source {
    const source = this.resolve(projectSelector, sourceSelector)
    const target = this.projects.resolve(targetProjectSelector)
    if (source.project_id === target.id) throw new PdfpalError('SAME_PROJECT', 'Source is already in the target project', 4)
    this.db.transaction(() => {
      // Collections are project-scoped, so a cross-project move unfiles the source.
      this.db.prepare('UPDATE sources SET project_id=?, collection_id=NULL, accessed_at=? WHERE id=?').run(target.id, now(), source.id)
      this.db.prepare('UPDATE notes SET project_id=? WHERE source_id=?').run(target.id, source.id)
      this.db.prepare('UPDATE annotations SET project_id=? WHERE source_id=?').run(target.id, source.id)
      this.db.prepare('UPDATE chat_sessions SET project_id=? WHERE source_id=?').run(target.id, source.id)
    })()
    return this.resolve(target.id, source.id)
  }

  /** File a source into a collection, or unfile it when `collectionSelector` is null. */
  setCollection(projectSelector: string, sourceSelector: string, collectionSelector: string | null): Source {
    const source = this.resolve(projectSelector, sourceSelector)
    const collectionId = collectionSelector ? this.collections.resolve(source.project_id, collectionSelector).id : null
    this.db.prepare('UPDATE sources SET collection_id=?, accessed_at=? WHERE id=?').run(collectionId, now(), source.id)
    return { ...source, collection_id: collectionId }
  }

  setLastPageRead(projectSelector: string, sourceSelector: string, page: number): Source {
    const source = this.resolve(projectSelector, sourceSelector)
    const lastPage = Math.max(1, source.pages)
    if (!Number.isInteger(page) || page < 1 || page > lastPage) {
      throw new PdfpalError('INVALID_PAGE', `Page must be an integer between 1 and ${lastPage}`, 2)
    }
    this.db.prepare('UPDATE sources SET last_page_read=?, accessed_at=? WHERE id=?').run(page, now(), source.id)
    return this.resolve(source.project_id, source.id)
  }

  remove(projectSelector: string, sourceSelector: string): Source {
    const source = this.resolve(projectSelector, sourceSelector)
    this.db.prepare('DELETE FROM sources WHERE id=?').run(source.id)
    if (source.local_path) fs.rmSync(path.join(this.config.filesDir, path.basename(source.local_path)), { force: true })
    return source
  }

  async reindex(projectSelector: string, sourceSelector?: string, refetch = false): Promise<number> {
    const targets = sourceSelector ? [this.resolve(projectSelector, sourceSelector)] : this.list(projectSelector)
    let total = 0
    for (const source of targets) {
      let text = source.pdf_text ?? ''
      if (refetch) {
        const location = source.url ?? source.original_location
        if (!location) throw new PdfpalError('SOURCE_UNAVAILABLE', `No retrievable location for ${source.title ?? source.id}`)
        const bytes = /^https?:\/\//.test(location) ? (await resolvePdf(location)).bytes : fs.readFileSync(location)
        const extracted = await extractPdf(bytes)
        const stored = storePdf(bytes, this.config.filesDir, source.id)
        text = extracted.text
        this.db.prepare(`UPDATE sources SET pdf_text=?, pages=?, local_path=?, byte_size=?, content_hash=?,
          last_page_read=MIN(last_page_read, ?), accessed_at=? WHERE id=?`)
          .run(text, extracted.pages, path.basename(stored.localPath), bytes.length, stored.hash,
            Math.max(1, extracted.pages), now(), source.id)
      }
      total += this.retrieval.index(source.id, text)
    }
    return total
  }

  pdfPath(source: Source): string | null {
    if (!source.local_path) return null
    const candidate = path.join(this.config.filesDir, path.basename(source.local_path))
    return fs.existsSync(candidate) ? candidate : null
  }
}
