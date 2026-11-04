import { randomUUID, createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { PdfpalConfig } from './config.js'
import { AIService, type ProviderName as AgentName } from './ai.js'
import { CollectionService } from './collections.js'
import { ProjectService } from './projects.js'
import { RetrievalService } from './retrieval.js'
import { SourceService } from './sources.js'
import type { AskResult, Passage } from './types.js'
import { PdfpalError } from './types.js'

const now = () => new Date().toISOString()
export const messageOrder = "sync_order,sync_turn,CASE role WHEN 'user' THEN 0 ELSE 1 END,sync_id"
const RESPONSE_FORMAT_INSTRUCTIONS = 'Format the answer as GitHub-flavored Markdown. Use headings, lists, tables, and code fences when they improve readability. For math, use $...$ for inline expressions and $$...$$ for display equations; do not use \\(...\\) or \\[...\\] delimiters.'

export interface AskOptions {
  onDelta?: (text: string) => void
  sourceSelectors?: string[]
  collectionSelector?: string
  agent?: AgentName
  model?: string
}

export class ChatService {
  private readonly projects: ProjectService
  private readonly sources: SourceService
  private readonly collections: CollectionService
  private readonly retrieval: RetrievalService
  private readonly agents: AIService

  constructor(private readonly db: Database, private readonly config: PdfpalConfig) {
    this.projects = new ProjectService(db)
    this.sources = new SourceService(db, config)
    this.collections = new CollectionService(db)
    this.retrieval = new RetrievalService(db)
    this.agents = new AIService(config, db)
  }

  async ask(projectSelector: string, question: string, options: AskOptions = {}): Promise<AskResult> {
    if (!question.trim()) throw new PdfpalError('EMPTY_QUESTION', 'Question cannot be empty', 2)
    const project = this.projects.resolve(projectSelector)
    const selected = (options.sourceSelectors ?? []).map(selector => this.sources.resolve(project.id, selector))
    // A collection scopes retrieval to every source filed anywhere beneath it,
    // unioned with any explicitly selected sources.
    let scope = selected
    if (options.collectionSelector) {
      const collectionId = this.collections.resolve(project.id, options.collectionSelector).id
      const ids = new Set(this.collections.descendantSourceIds(collectionId))
      const collectionSources = this.sources.list(project.id).filter(source => ids.has(source.id))
      scope = [...new Map([...selected, ...collectionSources].map(source => [source.id, source])).values()]
    }
    let passages = this.retrieval.search(project.id, question, scope.map(source => source.id))
    if (!passages.length) {
      const fallback = scope.length ? scope : this.sources.list(project.id)
      passages = fallback.filter(source => source.pdf_text).slice(0, 4).map(source => ({
        source_id: source.id, source_title: source.title ?? 'Source', page_number: 1,
        content: (source.pdf_text ?? '').slice(0, 15_000), score: 0,
      }))
    }
    if (!passages.length) throw new PdfpalError('NO_CONTEXT', 'No indexed source text is available for this project', 4)
    const history = this.history(project.id, selected.length === 1 ? selected[0]!.id : undefined).slice(-10)
    const context = passages.reduce((out, passage) => {
      const block = `\n[Source: ${passage.source_title}; page ${passage.page_number}]\n${passage.content}\n`
      return out.length + block.length <= 80_000 ? out + block : out
    }, '')
    const prompt = `You are a research assistant. Answer from the supplied passages. Cite source titles and page numbers when possible. If the context is insufficient, say so. ${RESPONSE_FORMAT_INSTRUCTIONS}\n\nPassages:${context}${history.length ? `\n\nRecent conversation:\n${history.map(message => `${message.role}: ${message.content}`).join('\n')}` : ''}\n\nUser: ${question}\nAssistant:`
    const answer = await this.agents.invoke(prompt, options.agent, options.model, { onDelta: options.onDelta, projectId: project.id, sourceId: selected.length === 1 ? selected[0]!.id : undefined, question })
    const sourceIds = [...new Set(passages.map(passage => passage.source_id))]
    const sessionId = this.persist(project.id, selected.length === 1 ? selected[0]!.id : null, question, answer, sourceIds)
    return {
      answer,
      project: { id: project.id, title: project.title },
      sources: sourceIds.map(id => {
        const relevant = passages.filter(passage => passage.source_id === id)
        return { id, title: relevant[0]!.source_title, pages: [...new Set(relevant.map(passage => passage.page_number))].sort((a, b) => a - b) }
      }),
      chat_session_id: sessionId,
    }
  }

  history(projectId: string, sourceId?: string): Array<{ id: number; visual_id: string | null; role: string; content: string; sources_used: string; created_at: string }> {
    // Older devices may have independent session UUIDs for the same paper.
    // Keep every saved turn visible after those histories meet in the cloud.
    return this.db.prepare(`SELECT m.id,m.visual_id,m.role,m.content,m.sources_used,m.created_at
      FROM chat_messages m JOIN chat_sessions s ON s.id=m.session_id
      WHERE s.project_id=? AND s.source_id IS ? ORDER BY s.created_at,s.id,${messageOrder}`)
      .all(projectId, sourceId ?? null) as ReturnType<ChatService['history']>
  }

  persist(projectId: string, sourceId: string | null, question: string, answer: string, sourceIds: string[], visualId?: string): string {
    return this.db.transaction(() => {
      const existing = sourceId
        ? this.db.prepare('SELECT id FROM chat_sessions WHERE project_id=? AND source_id=? ORDER BY accessed_at DESC LIMIT 1').get(projectId, sourceId)
        : this.db.prepare('SELECT id FROM chat_sessions WHERE project_id=? AND source_id IS NULL ORDER BY accessed_at DESC LIMIT 1').get(projectId)
      const id = (existing as { id: string } | undefined)?.id ?? createHash('sha256').update(`${projectId}\0${sourceId ?? ''}`).digest('hex').slice(0, 32)
      const timestamp = now()
      if (!existing) this.db.prepare('INSERT INTO chat_sessions(id,project_id,source_id,title,created_at,accessed_at) VALUES (?,?,?,?,?,?)')
        .run(id, projectId, sourceId, sourceId ? 'Chat' : 'Project Chat', timestamp, timestamp)
      else this.db.prepare('UPDATE chat_sessions SET accessed_at=? WHERE id=?').run(timestamp, id)
      const position = (this.db.prepare('SELECT COALESCE(MAX(sync_order),0)+1 n FROM chat_messages WHERE session_id=?').get(id) as { n: number }).n
      const turn = randomUUID()
      const insert = this.db.prepare('INSERT INTO chat_messages(session_id,role,content,sources_used,created_at,visual_id,sync_id,sync_order,sync_turn) VALUES (?,?,?,?,?,?,?,?,?)')
      insert.run(id, 'user', question, JSON.stringify(sourceIds), timestamp, null, randomUUID(), position, turn)
      insert.run(id, 'assistant', answer, JSON.stringify(sourceIds), now(), visualId || null, randomUUID(), position, turn)
      return id
    })()
  }
}
