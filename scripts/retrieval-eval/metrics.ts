// Pure scoring functions for the retrieval evaluation.
import type { Passage } from '../../src/core/types.js'

export type Gold = { source: string; pages: number[] }
type Ranked = Pick<Passage, 'source_id' | 'page_number'>

export const isHit = (passage: Ranked, gold: Gold) => passage.source_id === gold.source && gold.pages.includes(passage.page_number)

/** 1-based rank of the first passage from a gold page, or null when none was returned. */
export function firstHitRank(passages: Ranked[], gold: Gold): number | null {
  const index = passages.findIndex(passage => isHit(passage, gold))
  return index < 0 ? null : index + 1
}

export const contextChars = (passages: Array<Pick<Passage, 'content'>>) => passages.reduce((sum, passage) => sum + passage.content.length, 0)

export type QuestionResult = {
  id: string
  category: string
  holdout: boolean
  /** Rank of the first gold passage in the 16-passage result, or null. */
  rank: number | null
  hit_at_6: boolean
  hit_at_16: boolean
  context_chars_at_6: number
  context_chars_at_16: number
}

export type Summary = {
  questions: number
  recall_at_6: number
  recall_at_16: number
  mrr: number
  context_chars_at_6: number
  context_chars_at_16: number
}

const round = (value: number, places = 4) => Number(value.toFixed(places))

/**
 * recall@k is the share of questions with at least one gold passage in the top k
 * (sometimes called success@k); MRR uses the first gold passage within 16.
 */
export function summarise(results: QuestionResult[]): Summary {
  const n = results.length
  const mean = (values: number[]) => n ? values.reduce((sum, value) => sum + value, 0) / n : 0
  return {
    questions: n,
    recall_at_6: round(mean(results.map(result => Number(result.hit_at_6)))),
    recall_at_16: round(mean(results.map(result => Number(result.hit_at_16)))),
    mrr: round(mean(results.map(result => result.rank ? 1 / result.rank : 0))),
    context_chars_at_6: Math.round(mean(results.map(result => result.context_chars_at_6))),
    context_chars_at_16: Math.round(mean(results.map(result => result.context_chars_at_16))),
  }
}
