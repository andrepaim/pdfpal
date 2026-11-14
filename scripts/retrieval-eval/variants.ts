// Retrieval implementations the evaluation can score. Add candidates here
// (one entry per change) and compare them with `--variant NAME --compare FILE`.
import { RetrievalService, type PageContextRequest } from '../../src/core/retrieval.js'
import type { RetrievalVariant } from './harness.js'
import { labVariant } from './lab.js'

/** The implementation before Track B (first 16 words of two or more characters, default tokenizer, no tie-breaker). */
export const baseline: RetrievalVariant = labVariant('baseline', 'pre-Track B retrieval: default FTS5 tokenizer, first 16 unique terms ORed, BM25', {})

/** What src/ ships now: RetrievalService.search for search paths, RetrievalService.context for chat paths. */
export const current: RetrievalVariant = {
  name: 'current',
  description: 'shipped: rarest terms incl. one-character symbols, chunk-id tie-breaker; chat adds selection pages and merges neighbouring chunks',
  index: (db, sourceId, text) => { new RetrievalService(db).index(sourceId, text) },
  search: (db, projectId, query, sourceIds, limit) => {
    const retrieval = new RetrievalService(db)
    if (query.path === 'project-search') return retrieval.search(projectId, query.text, sourceIds, limit)
    const source = query.openSource && query.selectionPage
      ? db.prepare('SELECT id,title,url,pdf_text FROM sources WHERE id=?').get(query.openSource) as PageContextRequest['source'] | undefined : undefined
    return retrieval.context(projectId, query.text, sourceIds, limit, source && query.selectionPage ? { source, page: query.selectionPage, selection: query.selection } : undefined)
  },
}

const PORTER = 'porter unicode61 remove_diacritics 2'
const KEPT1 = { rarest: true, pageContext: true, tiebreak: true, merge: true }
const KEPT2 = { ...KEPT1, singles: true }

const candidates: RetrievalVariant[] = [
  // Each candidate alone against the baseline.
  labVariant('ret04-porter', 'RET-04: porter unicode61 remove_diacritics 2 tokenizer', { tokenizer: PORTER }),
  labVariant('ret04-diacritics', 'RET-04 control: unicode61 remove_diacritics 2 without stemming', { tokenizer: 'unicode61 remove_diacritics 2' }),
  labVariant('ret05-stopwords', 'RET-05: drop English stopwords', { stopwords: 'en' }),
  labVariant('ret05-stopwords-pt', 'RET-05: drop English and Portuguese stopwords', { stopwords: 'en+pt' }),
  labVariant('ret05-rarest', 'RET-05: keep the 16 rarest matching terms', { rarest: true }),
  labVariant('ret05-singles', 'RET-05: keep one-character terms', { singles: true }),
  labVariant('ret05-question-first', 'RET-05: question terms take the budget before selection terms', { questionFirst: true }),
  labVariant('ret05-selection-half', 'RET-05: selection terms weighted 0.5 against question terms', { selectionWeight: 0.5 }),
  labVariant('ret06-page-context', 'RET-06: selection page and neighbours ahead of results', { pageContext: true }),
  labVariant('ret07-tiebreak', 'RET-07: chunk id breaks score ties', { tiebreak: true }),
  labVariant('ret07-merge', 'RET-07: merge overlapping adjacent chunks in chat context', { merge: true }),
  labVariant('ret07-cap', 'RET-07: at most half the chunks from one source in multi-source chat', { capPerSource: true }),
  // Combinations on top of the changes kept alone (rarest terms, page context, tie-breaker, merging).
  labVariant('kept1', 'kept alone: rarest terms + page context + tie-breaker + merge', KEPT1),
  labVariant('kept1+porter', 'kept1 + porter tokenizer', { ...KEPT1, tokenizer: PORTER }),
  labVariant('kept1+stopwords', 'kept1 + English stopwords', { ...KEPT1, stopwords: 'en' }),
  labVariant('kept1+stopwords-pt', 'kept1 + English and Portuguese stopwords', { ...KEPT1, stopwords: 'en+pt' }),
  labVariant('kept1+singles', 'kept1 + one-character terms', { ...KEPT1, singles: true }),
  labVariant('kept1+stopwords-pt+singles', 'kept1 + stopwords (en+pt) + one-character terms', { ...KEPT1, stopwords: 'en+pt', singles: true }),
  labVariant('kept1+porter+stopwords-pt', 'kept1 + porter + stopwords (en+pt)', { ...KEPT1, tokenizer: PORTER, stopwords: 'en+pt' }),
  labVariant('kept1+porter+stopwords-pt+singles', 'kept1 + porter + stopwords (en+pt) + one-character terms', { ...KEPT1, tokenizer: PORTER, stopwords: 'en+pt', singles: true }),
  labVariant('kept1+cap', 'kept1 + per-source cap', { ...KEPT1, capPerSource: true }),
  labVariant('kept1+selection-half', 'kept1 + selection weight 0.5', { ...KEPT1, selectionWeight: 0.5 }),
  // Second round on top of kept1 + one-character terms.
  labVariant('kept2', 'kept1 + one-character terms', KEPT2),
  labVariant('kept2+stopwords', 'kept2 + English stopwords', { ...KEPT2, stopwords: 'en' }),
  labVariant('kept2+stopwords-pt', 'kept2 + English and Portuguese stopwords', { ...KEPT2, stopwords: 'en+pt' }),
  labVariant('kept2+porter', 'kept2 + porter tokenizer', { ...KEPT2, tokenizer: PORTER }),
  labVariant('kept2+porter+stopwords-pt', 'kept2 + porter + stopwords (en+pt)', { ...KEPT2, tokenizer: PORTER, stopwords: 'en+pt' }),
  labVariant('kept2+cap', 'kept2 + per-source cap', { ...KEPT2, capPerSource: true }),
  labVariant('kept2+selection-half', 'kept2 + selection weight 0.5', { ...KEPT2, selectionWeight: 0.5 }),
]

export const variants: Record<string, RetrievalVariant> = Object.fromEntries([baseline, current, ...candidates].map(variant => [variant.name, variant]))
