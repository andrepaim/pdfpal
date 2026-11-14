// Retrieval evaluation harness: indexes the fixture corpus into a temporary
// library and scores labelled questions against a retrieval variant.
// Offline and deterministic; never opens the real home library.
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { Passage } from '../../src/core/types.js'
import { cleanup, testConfig, testDb } from '../../test/helpers/test-utils.js'
import { CATEGORIES, loadCachedTexts, loadManifest, loadQuestions, sha256, validateStructure, validateText, type FixtureManifest, type Question, type QuestionSet } from './corpus.js'
import { contextChars, firstHitRank, summarise, type QuestionResult, type Summary } from './metrics.js'

/** A search request as the product builds it, with its parts kept for variants that weight them. */
export type ComposedQuery = {
  text: string
  question: string
  selection?: string
  path: Question['path']
  /** Reader paths only: the open paper and the page the selection came from, which the reader can send with the request. */
  openSource?: string
  selectionPage?: number
}

/**
 * Builds the query text exactly as each call path does today:
 * - reader-chat: ChatPanel `send` appends the selection as Markdown quote lines,
 *   and that message is passed unchanged to ChatService.ask -> search.
 * - visual: VisualExplanationService.startWeb searches `${question} ${selection || ''}`.
 * - project-chat and project-search: the question alone.
 */
export function composeQuery(question: Pick<Question, 'question' | 'selection' | 'path'> & { source?: string }): ComposedQuery {
  const text = question.question.trim()
  const selection = question.selection?.text
  const reader = question.path === 'reader-chat' || question.path === 'visual'
  const base = {
    question: text, path: question.path, ...(selection ? { selection } : {}),
    ...(reader && question.source ? { openSource: question.source } : {}),
    ...(reader && question.selection ? { selectionPage: question.selection.page } : {}),
  }
  if (question.path === 'reader-chat' && selection) return { ...base, text: `${text}\n\n${selection.split('\n').map(line => `> ${line}`).join('\n')}` }
  if (question.path === 'visual') return { ...base, text: `${text} ${selection || ''}` }
  return { ...base, text }
}

/** Source ids the search is restricted to; empty means the whole project, as in project search. */
export function searchScope(question: Pick<Question, 'scope' | 'source' | 'path'>): string[] {
  if (question.path === 'project-search') return []
  return question.scope ?? [question.source]
}

/**
 * A retrieval implementation under evaluation. A later change (another FTS
 * tokenizer, a different query builder, result shaping) is added as a new
 * variant and compared with the baseline without touching the harness.
 */
export interface RetrievalVariant {
  name: string
  description: string
  /** Runs once on the freshly migrated temporary database, before indexing. */
  prepare?(db: Database.Database): void
  index(db: Database.Database, sourceId: string, text: string): void
  search(db: Database.Database, projectId: string, query: ComposedQuery, sourceIds: string[], limit: number): Passage[]
}

export type ScoredResult = QuestionResult & { ranked: string[] }

/** Scores for one way of scoping the searches. */
export type ScopeReport = {
  overall: Summary
  categories: Record<string, Summary>
  portuguese: Summary
  holdout?: Summary
  results: ScoredResult[]
}

export type EvaluationReport = {
  variant: { name: string; description: string }
  /** text_sha256 is what was indexed; warnings list works whose text differs from the labelled text. */
  corpus: { works: number; chunks: number; chunks_by_source: Record<string, number>; text_sha256: Record<string, string>; warnings: string[] }
  holdout_included: boolean
  limits: [number, number]
  /** Each question searched over the sources the product would use (one paper in the reader, the selected papers in a project). */
  product: ScopeReport
  /** Every question searched across the whole library: a harder ranking test, since short papers fit almost entirely in 16 chunks. */
  library: ScopeReport
}

export const PROJECT_ID = 'retrieval-eval'
const STAMP = '2026-01-01T00:00:00.000Z'
const LIMITS: [number, number] = [6, 16]

function scoreScope(results: ScoredResult[], includeHoldout: boolean): ScopeReport {
  const english = results.filter(result => result.category !== 'portuguese')
  return {
    overall: summarise(english),
    categories: Object.fromEntries(CATEGORIES.map(category => [category, summarise(english.filter(result => result.category === category))])),
    portuguese: summarise(results.filter(result => result.category === 'portuguese')),
    ...(includeHoldout ? { holdout: summarise(english.filter(result => result.holdout)) } : {}),
    results,
  }
}

export type EvaluationOptions = {
  includeHoldout?: boolean
  manifest?: FixtureManifest
  questions?: QuestionSet
  /** Text per work id; defaults to the local cache written by the fetch script. */
  texts?: Map<string, string>
}

export function runEvaluation(variant: RetrievalVariant, options: EvaluationOptions = {}): EvaluationReport {
  const manifest = options.manifest ?? loadManifest()
  const set = options.questions ?? loadQuestions()
  const structural = validateStructure(manifest, set)
  if (structural.length) throw new Error(`The retrieval manifest or questions are inconsistent:\n${structural.join('\n')}`)
  const texts = options.texts ?? loadCachedTexts(manifest)
  // The labels are checked against the text actually being indexed, every run.
  const checked = validateText(manifest, set, texts)
  if (checked.errors.length) throw new Error(`Question labels do not match the corpus text:\n${checked.errors.join('\n')}`)
  const config = testConfig()
  // testConfig honours PDFPAL_DB; refuse anything outside the temporary directory.
  if (path.relative(config.dataDir, config.dbPath).startsWith('..')) {
    fs.rmSync(config.dataDir, { recursive: true, force: true })
    throw new Error('Unset PDFPAL_DB: the evaluation only runs on a temporary library.')
  }
  const db = testDb(config)
  try {
    db.prepare('INSERT INTO projects(id,title,description,created_at,accessed_at) VALUES (?,?,?,?,?)').run(PROJECT_ID, 'Retrieval evaluation', '', STAMP, STAMP)
    const insertSource = db.prepare('INSERT INTO sources(id,project_id,type,url,title,pdf_text,pages,created_at,accessed_at) VALUES (?,?,?,?,?,?,?,?,?)')
    for (const work of manifest.works) insertSource.run(work.id, PROJECT_ID, 'pdf', work.source_url, work.title, texts.get(work.id), work.page_count ?? 0, STAMP, STAMP)
    variant.prepare?.(db)
    for (const work of manifest.works) variant.index(db, work.id, texts.get(work.id)!)
    const counts = db.prepare('SELECT source_id, COUNT(*) n FROM source_chunks GROUP BY source_id').all() as Array<{ source_id: string; n: number }>
    const chunksBySource = Object.fromEntries(manifest.works.map(work => [work.id, counts.find(count => count.source_id === work.id)?.n ?? 0]))
    const chunks = Object.values(chunksBySource).reduce((sum, n) => sum + n, 0)

    const includeHoldout = !!options.includeHoldout
    const scored = set.questions.filter(question => includeHoldout || !question.holdout)
    const score = (question: Question, scope: string[]): ScoredResult => {
      const query = composeQuery(question), gold = { source: question.source, pages: question.pages }
      const [few, many] = LIMITS.map(limit => variant.search(db, PROJECT_ID, query, scope, limit)) as [Passage[], Passage[]]
      const rank = firstHitRank(many, gold)
      return {
        id: question.id, category: question.category, holdout: !!question.holdout, rank,
        hit_at_6: firstHitRank(few, gold) !== null, hit_at_16: rank !== null,
        context_chars_at_6: contextChars(few), context_chars_at_16: contextChars(many),
        ranked: many.map(passage => `${passage.source_id}:${passage.page_number}`),
      }
    }
    return {
      variant: { name: variant.name, description: variant.description },
      corpus: { works: manifest.works.length, chunks, chunks_by_source: chunksBySource, text_sha256: Object.fromEntries(manifest.works.map(work => [work.id, sha256(texts.get(work.id)!)])), warnings: checked.warnings },
      holdout_included: includeHoldout,
      limits: LIMITS,
      product: scoreScope(scored.map(question => score(question, searchScope(question))), includeHoldout),
      library: scoreScope(scored.map(question => score(question, [])), includeHoldout),
    }
  } finally {
    cleanup(config, db)
  }
}

const pad = (value: string | number, width: number) => String(value).padStart(width)
const fixed = (value: number) => value.toFixed(3)

function formatScope(title: string, scope: ScopeReport, before?: ScopeReport): string[] {
  const row = (label: string, summary: Summary, previous?: Summary) => {
    const line = `${label.padEnd(12)}${pad(summary.questions, 4)}${pad(fixed(summary.recall_at_6), 10)}${pad(fixed(summary.recall_at_16), 11)}${pad(fixed(summary.mrr), 8)}${pad(summary.context_chars_at_6, 9)}${pad(summary.context_chars_at_16, 9)}`
    if (!previous) return line
    const delta = (a: number, b: number) => `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(3)}`
    return `${line}   Δ ${delta(summary.recall_at_6, previous.recall_at_6)} ${delta(summary.recall_at_16, previous.recall_at_16)} ${delta(summary.mrr, previous.mrr)}`
  }
  return [
    title,
    `${'set'.padEnd(12)}${pad('n', 4)}${pad('recall@6', 10)}${pad('recall@16', 11)}${pad('MRR', 8)}${pad('ctx@6', 9)}${pad('ctx@16', 9)}`,
    ...CATEGORIES.map(category => row(category, scope.categories[category]!, before?.categories[category])),
    row('overall', scope.overall, before?.overall),
    row('portuguese', scope.portuguese, before?.portuguese),
    ...(scope.holdout ? [row('holdout', scope.holdout, before?.holdout)] : []),
    `Missed at 6: ${scope.results.filter(result => !result.hit_at_6).map(result => result.id).join(', ') || 'none'}`,
    `Missed at 16: ${scope.results.filter(result => !result.hit_at_16).map(result => result.id).join(', ') || 'none'}`,
  ]
}

export function formatReport(report: EvaluationReport, compare?: EvaluationReport): string {
  return `${[
    `Retrieval evaluation: ${report.variant.name} (${report.variant.description})`,
    `Corpus: ${report.corpus.works} works, ${report.corpus.chunks} chunks. Holdout questions ${report.holdout_included ? 'INCLUDED' : 'excluded'}.`,
    ...report.corpus.warnings.map(warning => `WARNING: ${warning}. Labels were re-checked and hold, but numbers may not match the recorded baseline.`),
    ...(compare ? [`Compared with: ${compare.variant.name}${compare.holdout_included === report.holdout_included ? '' : ' (different holdout setting; deltas are not comparable)'}`] : []),
    '',
    ...formatScope('Product scope (the reader searches one paper; project questions search the selected papers)', report.product, compare?.product),
    '',
    ...formatScope('Whole library (every question searched across all works)', report.library, compare?.library),
    '',
    'recall@k: share of questions with a passage from a gold page in the top k. MRR: reciprocal rank of the first',
    'such passage within 16. ctx@k: mean characters of passage text returned at limit k. Portuguese is not in overall.',
  ].join('\n')}\n`
}

