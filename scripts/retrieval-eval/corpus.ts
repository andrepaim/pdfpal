// Corpus manifest, labelled question set and local text cache for the retrieval
// evaluation. File reading and validation only: no network, no database.
//
// The papers' text is not redistributed. `npm run eval:retrieval:fetch` downloads
// the pinned PDFs and writes their extracted text into a git-ignored cache.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { splitPages } from '../../src/core/retrieval.js'

export const fixtureDir = path.resolve(import.meta.dirname, '../../test/fixtures/retrieval')
/** Git-ignored; holds `<id>.txt` written by the fetch script. */
export const textCacheDir = path.resolve(import.meta.dirname, '../../.cache/retrieval')
export const SETUP_COMMAND = 'npm run eval:retrieval:fetch'

export type FixtureWork = {
  id: string
  kind: 'paper' | 'book-chapter'
  title: string
  authors: string[]
  source_url: string
  pdf_url: string
  licence: string
  licence_url: string
  pdf_sha256?: string
  /** SHA-256 of the text extractPdf produced when the labels were made. */
  text_sha256?: string
  page_count?: number
  attribution?: string
}

export type FixtureManifest = { description: string; changes: string; works: FixtureWork[] }

export const CATEGORIES = ['exact', 'word-forms', 'paraphrase', 'selection', 'symbols', 'project'] as const
export type Category = typeof CATEGORIES[number] | 'portuguese'

/**
 * The product path a question simulates. Each path builds its search query the
 * way the product does (see composeQuery in harness.ts).
 * - reader-chat: ChatPanel `send` -> /api/chat -> ChatService.ask, one source.
 * - project-chat: ProjectChat `send` -> /api/chat with active_source_ids.
 * - visual: /visual from the reader -> VisualExplanationService.startWeb.
 * - project-search: /api/projects/:id/search and `pdfpal search`, whole project.
 */
export type CallPath = 'reader-chat' | 'project-chat' | 'visual' | 'project-search'
const CALL_PATHS: CallPath[] = ['reader-chat', 'project-chat', 'visual', 'project-search']

export type Evidence = { page: number; text: string }

export type Question = {
  id: string
  category: Category
  path: CallPath
  question: string
  /** Text the reader attached from the PDF, with the page it was selected on. */
  selection?: Evidence
  /** Sources the search is scoped to. Omitted means the gold source alone, as in the reader. */
  scope?: string[]
  source: string
  pages: number[]
  /** At least one short verbatim snippet per gold page, proving that page answers the question. */
  evidence: Evidence[]
  holdout?: boolean
  note?: string
}

export type QuestionSet = { description: string; questions: Question[] }

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

export function loadManifest(dir = fixtureDir): FixtureManifest {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as FixtureManifest
}

export function loadQuestions(dir = fixtureDir): QuestionSet {
  return JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8')) as QuestionSet
}

export const cachedTextPath = (work: Pick<FixtureWork, 'id'>, dir = textCacheDir) => path.join(dir, `${work.id}.txt`)

/** Reads every work's cached text, or throws naming the setup command when any is missing. */
export function loadCachedTexts(manifest: FixtureManifest, dir = textCacheDir): Map<string, string> {
  const missing = manifest.works.filter(work => !fs.existsSync(cachedTextPath(work, dir)))
  if (missing.length) {
    throw new Error(`The retrieval corpus text is not set up (${missing.length} of ${manifest.works.length} missing: ${missing.map(work => work.id).join(', ')}).\n`
      + `Run \`${SETUP_COMMAND}\` once. It downloads the pinned open-access PDFs and writes their extracted text to ${path.relative(process.cwd(), dir) || dir}; the evaluation itself never uses the network.`)
  }
  return new Map(manifest.works.map(work => [work.id, fs.readFileSync(cachedTextPath(work, dir), 'utf8')]))
}

export function fixturePages(text: string): Map<number, string> {
  return new Map(splitPages(text).map(page => [page.page, normalise(page.text)]))
}

/** Problems with the manifest and question set that can be found without the papers' text. */
export function validateStructure(manifest: FixtureManifest, set: QuestionSet): string[] {
  const errors: string[] = []
  const works = new Map<string, FixtureWork>()
  for (const work of manifest.works) {
    for (const key of ['pdf_sha256', 'text_sha256', 'page_count', 'attribution', 'licence', 'licence_url', 'source_url', 'pdf_url'] as const) {
      if (!work[key]) errors.push(`${work.id}: manifest is missing ${key}`)
    }
    if (works.has(work.id)) errors.push(`${work.id}: duplicate work id`)
    works.set(work.id, work)
  }
  const ids = new Set<string>()
  const pageInRange = (source: string, page: number) => Number.isInteger(page) && page >= 1 && page <= (works.get(source)?.page_count ?? 0)
  for (const question of set.questions) {
    const label = question.id
    if (ids.has(label)) errors.push(`${label}: duplicate question id`)
    ids.add(label)
    if (![...CATEGORIES, 'portuguese'].includes(question.category)) errors.push(`${label}: unknown category ${question.category}`)
    if (!CALL_PATHS.includes(question.path)) errors.push(`${label}: unknown path ${question.path}`)
    if (!question.question.trim()) errors.push(`${label}: empty question`)
    if (!works.has(question.source)) { errors.push(`${label}: unknown source ${question.source}`); continue }
    if (!question.pages.length) errors.push(`${label}: no gold pages`)
    for (const page of question.pages) {
      if (!pageInRange(question.source, page)) errors.push(`${label}: ${question.source} has no page ${page}`)
      if (!question.evidence.some(evidence => evidence.page === page)) errors.push(`${label}: gold page ${page} has no evidence snippet`)
    }
    for (const evidence of question.evidence) {
      if (!question.pages.includes(evidence.page)) errors.push(`${label}: evidence on page ${evidence.page} is not a gold page`)
      if (normalise(evidence.text).length < 12) errors.push(`${label}: evidence snippet is too short to be meaningful`)
    }
    if (question.selection && !pageInRange(question.source, question.selection.page)) errors.push(`${label}: selection page ${question.selection.page} is outside ${question.source}`)
    if (question.category === 'selection' && !question.selection) errors.push(`${label}: selection question has no selection`)
    if (question.path === 'visual' && !question.selection) errors.push(`${label}: visual path needs a selection`)
    if (question.path === 'project-search' && question.scope) errors.push(`${label}: project-search always covers the whole project; remove scope`)
    for (const source of question.scope ?? []) if (!works.has(source)) errors.push(`${label}: scope lists unknown source ${source}`)
    if (question.scope && !question.scope.includes(question.source)) errors.push(`${label}: scope excludes the gold source`)
    if (question.category === 'project' && question.path !== 'project-search' && (question.scope?.length ?? 0) < 2) errors.push(`${label}: project question needs a scope of several sources`)
  }
  return errors
}

/**
 * Checks that need the text: every evidence snippet and selection occurs on its
 * labelled page. Hash differences are returned separately as warnings, because a
 * pdfjs-dist upgrade can change extraction without invalidating the labels; the
 * snippet checks decide whether the labels still hold.
 */
export function validateText(manifest: FixtureManifest, set: QuestionSet, texts: Map<string, string>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = []
  const pagesBySource = new Map<string, Map<number, string>>()
  for (const work of manifest.works) {
    const text = texts.get(work.id)
    if (text === undefined) { errors.push(`${work.id}: no text`); continue }
    if (work.text_sha256 && sha256(text) !== work.text_sha256) warnings.push(`${work.id}: cached text differs from the text the labels were made on (SHA-256 mismatch)`)
    const pages = fixturePages(text)
    if (work.page_count && [...pages.keys()].some(page => page < 1 || page > work.page_count!)) errors.push(`${work.id}: text has pages outside 1..${work.page_count}`)
    pagesBySource.set(work.id, pages)
  }
  const contains = (source: string, evidence: Evidence) => pagesBySource.get(source)?.get(evidence.page)?.includes(normalise(evidence.text)) ?? false
  for (const question of set.questions) {
    if (!pagesBySource.has(question.source)) continue
    for (const evidence of question.evidence) {
      if (!contains(question.source, evidence)) errors.push(`${question.id}: evidence "${evidence.text}" not found on ${question.source} page ${evidence.page}`)
    }
    if (question.selection && !contains(question.source, question.selection)) errors.push(`${question.id}: selection not found on ${question.source} page ${question.selection.page}`)
  }
  return { errors, warnings }
}
