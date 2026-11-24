import type { DictionaryEntry, DictionaryResult } from '@andrepaim/contextual-dictionary-core'

/** The definition endpoint keeps the fields read by previously opened PDFPal readers. */
export interface DictionaryDefineResponse extends Omit<DictionaryResult, 'source' | 'entries'> {
  entries: Array<DictionaryEntry & { part_of_speech: string }>
  source: string
  sourceDetails: DictionaryResult['source']
}
