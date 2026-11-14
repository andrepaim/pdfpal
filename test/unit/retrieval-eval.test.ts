import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, loadManifest, loadQuestions, validateStructure, validateText, type FixtureManifest, type QuestionSet } from '../../scripts/retrieval-eval/corpus.js'
import { composeQuery, runEvaluation, searchScope } from '../../scripts/retrieval-eval/harness.js'
import { contextChars, firstHitRank, summarise, type QuestionResult } from '../../scripts/retrieval-eval/metrics.js'
import { baseline } from '../../scripts/retrieval-eval/variants.js'

// These tests never read the papers' text: it is downloaded on demand into a
// git-ignored cache by `npm run eval:retrieval:fetch` and is not in the repository.

const passage = (source_id: string, page_number: number, content = 'x') => ({ source_id, page_number, content })
const result = (overrides: Partial<QuestionResult>): QuestionResult => ({
  id: 'q', category: 'exact', holdout: false, rank: null, hit_at_6: false, hit_at_16: false,
  context_chars_at_6: 0, context_chars_at_16: 0, ...overrides,
})

const work = (id: string, page_count: number) => ({
  id, kind: 'paper' as const, title: `Synthetic ${id}`, authors: ['Doe, Jane'], source_url: `https://example.org/${id}`, pdf_url: `https://example.org/${id}.pdf`,
  licence: 'CC BY 4.0', licence_url: 'https://creativecommons.org/licenses/by/4.0/', pdf_sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64), page_count, attribution: 'Synthetic, CC BY 4.0',
})
const syntheticManifest: FixtureManifest = { description: 'synthetic', changes: 'none', works: [work('alpha', 2), work('beta', 1)] }
const syntheticTexts = new Map([
  ['alpha', '[Page 1]\nGradient clipping keeps training stable when updates explode.\n\n[Page 2]\nThe rolling buffer cache overwrites old keys and values.'],
  ['beta', '[Page 1]\nContrastive learning pulls positive pairs together in embedding space.'],
])
const syntheticQuestions: QuestionSet = { description: 'synthetic', questions: [
  { id: 'q1', category: 'exact', path: 'reader-chat', question: 'How does the rolling buffer cache work?', source: 'alpha', pages: [2], evidence: [{ page: 2, text: 'rolling buffer cache overwrites' }] },
  { id: 'q2', category: 'project', path: 'project-chat', question: 'Which paper uses contrastive learning?', scope: ['alpha', 'beta'], source: 'beta', pages: [1], evidence: [{ page: 1, text: 'Contrastive learning pulls positive pairs' }] },
  { id: 'q3', category: 'selection', path: 'reader-chat', question: 'Why?', selection: { page: 1, text: 'Gradient clipping keeps training stable' }, source: 'alpha', pages: [1], evidence: [{ page: 1, text: 'when updates explode' }] },
  { id: 'q4', category: 'portuguese', path: 'reader-chat', question: 'Como funciona o cache?', source: 'alpha', pages: [2], evidence: [{ page: 2, text: 'old keys and values' }] },
] }

test('firstHitRank needs the gold source and a gold page', () => {
  const gold = { source: 'a', pages: [3, 4] }
  assert.equal(firstHitRank([passage('b', 3), passage('a', 2), passage('a', 4)], gold), 3)
  assert.equal(firstHitRank([passage('a', 3)], gold), 1)
  assert.equal(firstHitRank([passage('b', 3), passage('a', 5)], gold), null)
  assert.equal(firstHitRank([], gold), null)
})

test('summarise computes recall, MRR and mean context size', () => {
  const summary = summarise([
    result({ rank: 1, hit_at_6: true, hit_at_16: true, context_chars_at_6: 100, context_chars_at_16: 300 }),
    result({ rank: 8, hit_at_6: false, hit_at_16: true, context_chars_at_6: 200, context_chars_at_16: 400 }),
    result({ rank: null, context_chars_at_6: 0, context_chars_at_16: 0 }),
    result({ rank: 4, hit_at_6: true, hit_at_16: true, context_chars_at_6: 50, context_chars_at_16: 51 }),
  ])
  assert.deepEqual(summary, { questions: 4, recall_at_6: 0.5, recall_at_16: 0.75, mrr: 0.3438, context_chars_at_6: 88, context_chars_at_16: 188 })
  assert.deepEqual(summarise([]), { questions: 0, recall_at_6: 0, recall_at_16: 0, mrr: 0, context_chars_at_6: 0, context_chars_at_16: 0 })
  assert.equal(contextChars([passage('a', 1, 'abc'), passage('a', 2, 'de')]), 5)
})

test('queries are composed the way each product path builds them', () => {
  const selection = { page: 2, text: 'first line\nsecond line' }
  // ChatPanel `send`: question, blank line, then the selection as Markdown quote lines.
  const reader = composeQuery({ path: 'reader-chat', question: ' Why? ', selection, source: 'a' })
  assert.equal(reader.text, 'Why?\n\n> first line\n> second line')
  assert.equal(reader.openSource, 'a')
  assert.equal(reader.selectionPage, 2)
  assert.equal(composeQuery({ path: 'reader-chat', question: 'Why?' }).text, 'Why?')
  // VisualExplanationService.startWeb: `${question} ${selection || ''}`.
  assert.equal(composeQuery({ path: 'visual', question: 'Explain', selection }).text, 'Explain first line\nsecond line')
  const project = composeQuery({ path: 'project-chat', question: 'Which paper?', source: 'a' })
  assert.equal(project.text, 'Which paper?')
  assert.equal(project.openSource, undefined)
  assert.deepEqual(searchScope({ path: 'reader-chat', source: 'a' }), ['a'])
  assert.deepEqual(searchScope({ path: 'project-chat', source: 'a', scope: ['a', 'b'] }), ['a', 'b'])
  assert.deepEqual(searchScope({ path: 'project-search', source: 'a' }), [])
})

test('the manifest and labelled questions are structurally consistent', () => {
  const manifest = loadManifest(), set = loadQuestions()
  assert.deepEqual(validateStructure(manifest, set), [])
  assert.ok(manifest.works.length >= 9 && manifest.works.length <= 13)
  assert.ok(manifest.works.some(entry => entry.kind === 'book-chapter'))
  for (const entry of manifest.works) {
    assert.match(entry.licence, /^(CC BY \d\.\d|CC0 1\.0|Public domain)$/, `${entry.id} must be CC BY, CC0 or public domain`)
    assert.match(entry.licence_url, /^https:\/\/creativecommons\.org\/(licenses\/by\/\d\.\d|publicdomain\/)/)
    assert.match(entry.attribution ?? '', new RegExp(entry.licence.replace(/\./g, '\\.')))
    assert.match(entry.pdf_sha256 ?? '', /^[0-9a-f]{64}$/)
    assert.match(entry.text_sha256 ?? '', /^[0-9a-f]{64}$/)
  }
  const english = set.questions.filter(question => question.category !== 'portuguese')
  for (const category of CATEGORIES) assert.ok(english.filter(question => question.category === category).length >= 8, `${category} needs about ten questions`)
  const portuguese = set.questions.filter(question => question.category === 'portuguese')
  assert.ok(portuguese.length >= 5 && portuguese.length <= 8)
  assert.ok(portuguese.every(question => !question.holdout))
  const holdout = english.filter(question => question.holdout)
  assert.equal(holdout.length, 10)
  assert.equal(new Set(holdout.map(question => question.category)).size, CATEGORIES.length, 'holdout questions span every category')
})

test('validation fails loudly on bad labels, with or without text', () => {
  const broken: QuestionSet = { ...syntheticQuestions, questions: [
    { ...syntheticQuestions.questions[0]!, id: 'beyond-last-page', pages: [3], evidence: [{ page: 3, text: 'rolling buffer cache overwrites' }] },
    { ...syntheticQuestions.questions[0]!, id: 'unknown-source', source: 'missing' },
    { ...syntheticQuestions.questions[0]!, id: 'no-evidence', evidence: [] },
  ] }
  const structural = validateStructure(syntheticManifest, broken).join('\n')
  assert.match(structural, /beyond-last-page: alpha has no page 3/)
  assert.match(structural, /unknown-source: unknown source missing/)
  assert.match(structural, /no-evidence: gold page 2 has no evidence snippet/)
  const mislabelled: QuestionSet = { ...syntheticQuestions, questions: [{ ...syntheticQuestions.questions[0]!, pages: [1], evidence: [{ page: 1, text: 'rolling buffer cache overwrites' }] }] }
  const textual = validateText(syntheticManifest, mislabelled, syntheticTexts)
  assert.match(textual.errors.join('\n'), /evidence "rolling buffer cache overwrites" not found on alpha page 1/)
  assert.deepEqual(textual.warnings.length, 2, 'synthetic hashes differ, which is reported as a warning')
})

test('the evaluation harness scores the baseline on a synthetic corpus in a temporary library', () => {
  const options = { manifest: syntheticManifest, questions: syntheticQuestions, texts: syntheticTexts }
  const report = runEvaluation(baseline, options)
  assert.equal(report.variant.name, 'baseline')
  assert.equal(report.corpus.chunks, 3)
  assert.equal(report.product.results.length, 4)
  assert.equal(report.product.overall.questions, 3)
  assert.equal(report.product.portuguese.questions, 1)
  assert.equal(report.product.overall.recall_at_6, 1)
  assert.equal(report.library.categories.project!.mrr, 1)
  assert.equal(report.corpus.warnings.length, 2)
  assert.equal(report.holdout_included, false)
  assert.deepEqual(runEvaluation(baseline, options), report)
})
