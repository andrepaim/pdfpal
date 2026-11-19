import type { DictionaryResult } from './dictionary.js'

// Contextual order for the definition card: one prompt that offers every
// WordNet sense to a word-sense model, and the reordering of its answer.
// Pure functions; the model runs in sense-worker.ts.

/** The checkpoint's compact-v1 prompt format, read from its verified model_metadata.json. */
export type SenseFormat = {
  letters: string[]
  nota_index: number
  none_text: string
  separator: string
  mask_token: string
  max_length: number
  temperature: number
}
export type SenseTarget = { start: number; end: number; text: string }
export type SenseRequest = { prompt: string; target: SenseTarget; candidates: Array<{ entry: number; sense: number }> }
export type SkipReason = 'NO_ENTRIES' | 'SINGLE_SENSES' | 'TOO_MANY_SENSES' | 'INVALID_SPAN' | 'UNSAFE_TEXT' | 'NOT_ENGLISH' | 'TOO_LONG'
export type Selection = { text: string; before?: string; after?: string }

const isHigh = (unit: string | undefined) => unit !== undefined && /[\uD800-\uDBFF]/.test(unit)
const isLow = (unit: string | undefined) => unit !== undefined && /[\uDC00-\uDFFF]/.test(unit)
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
// Literal markers the compact prompt uses, and tokens the tokenizer would read as control tokens.
const UNSAFE = /\*|\[(?:MASK|CLS|SEP|PAD|UNK|unused\d+)\]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/**
 * Converts a JavaScript (UTF-16) span of `text` to the model's Unicode code
 * point offsets, end exclusive. Null for an empty span or one that splits a
 * surrogate pair.
 */
export function codePointSpan(text: string, start: number, end: number): SenseTarget | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return null
  for (const offset of [start, end]) if (offset > 0 && offset < text.length && isHigh(text[offset - 1]) && isLow(text[offset])) return null
  return { start: Array.from(text.slice(0, start)).length, end: Array.from(text.slice(0, end)).length, text: text.slice(start, end) }
}

// Very common English function words, and common function words of the
// European languages whose text WordNet could otherwise appear to match.
// Words that are also English ("do", "die", "per", "van") are left out.
const ENGLISH = new Set('the of and to in is are was were be been being that this these those for with as by on at from it its we our they their which or not but can has have had an will would should may also than such into between each used using he she his her who there'.split(' '))
const FOREIGN = new Set(('de da das dos que não nao uma um para com por em os ela ele seu sua são é ao à na no' // Portuguese
  + ' el la los las del con y es una lo muy pero más como' // Spanish
  + ' le les et des du est une pour dans sur ce qui pas très avec' // French
  + ' und der das ist nicht mit ein eine zu von dem sich auch wird' // German
  + ' il di che della sono gli' // Italian
  + ' het een zijn niet').split(' ')) // Dutch
// "no" and "na" are also English, but rare in prose next to the words above.
for (const word of ['no', 'na']) FOREIGN.delete(word)

/**
 * A conservative check that a passage is English: Latin script, few
 * accented letters, and English rather than other languages' function words.
 */
export function looksEnglish(passage: string): boolean {
  const letters = passage.match(/\p{L}/gu) ?? []
  if (!letters.length) return false
  const latin = letters.filter(letter => /\p{Script=Latin}/u.test(letter))
  if (latin.length / letters.length < 0.9) return false
  if (latin.filter(letter => !/[a-z]/i.test(letter)).length / latin.length > 0.05) return false
  const words = passage.toLowerCase().match(/\p{L}+/gu) ?? []
  const english = words.filter(word => ENGLISH.has(word)).length
  const foreign = words.filter(word => FOREIGN.has(word)).length
  if (words.length < 6) return foreign === 0
  return english >= 2 && english >= 2 * foreign
}

/**
 * The single prompt that scores every sense of every entry on the selected
 * span, or why the lookup is not scored. `text` is the selection as made;
 * its surrounding whitespace only separates it from `before` and `after`.
 */
export function senseRequest(result: DictionaryResult, selection: Selection, format: SenseFormat): SenseRequest | { skip: SkipReason } {
  if (!result.entries.length) return { skip: 'NO_ENTRIES' }
  if (result.entries.every(entry => entry.senses.length < 2)) return { skip: 'SINGLE_SENSES' }
  const candidates = result.entries.flatMap((entry, e) => entry.senses.map((_, s) => ({ entry: e, sense: s })))
  if (candidates.length > format.nota_index || format.letters.length <= format.nota_index) return { skip: 'TOO_MANY_SENSES' }

  const selected = selection.text.trim().replace(/\s+/g, ' ')
  if (!selected) return { skip: 'INVALID_SPAN' }
  let before = selection.before ?? '', after = selection.after ?? ''
  // The context is cut at a fixed length, which can leave half of a surrogate pair at its outer edge.
  if (isLow(before[0])) before = before.slice(1)
  if (isHigh(after.at(-1))) after = after.slice(0, -1)
  const leading = /^\s/.test(selection.text) ? ' ' : '', trailing = /\s$/.test(selection.text) ? ' ' : ''
  const pre = (before + leading).replace(/\s+/g, ' ').trimStart()
  const post = (trailing + after).replace(/\s+/g, ' ').trimEnd()
  const passage = pre + selected + post
  if (LONE_SURROGATE.test(passage)) return { skip: 'INVALID_SPAN' }
  const target = codePointSpan(passage, pre.length, pre.length + selected.length)
  if (!target) return { skip: 'INVALID_SPAN' }

  const definitions = candidates.map(({ entry, sense }) => result.entries[entry]!.senses[sense]!.definition)
  for (const content of [passage, ...definitions]) {
    if (UNSAFE.test(content) || content.includes(format.mask_token) || content.includes(format.separator)) return { skip: 'UNSAFE_TEXT' }
  }
  if (!looksEnglish(passage)) return { skip: 'NOT_ENGLISH' }

  const points = Array.from(passage)
  const marked = points.slice(0, target.start).join('') + '*' + target.text + '*' + points.slice(target.end).join('')
  const choices = definitions.map((definition, i) => `${format.letters[i]}. ${definition}`)
  choices.push(`${format.letters[format.nota_index]}. ${format.none_text}`)
  const prompt = `${marked}\n${choices.join('\n')}\n${format.separator} ${format.mask_token}`
  // Every token is at least one character, so a longer prompt cannot fit; the worker checks tokens.
  if (prompt.length > format.max_length * 8) return { skip: 'TOO_LONG' }
  return { prompt, target, candidates }
}

export type OrderOutcome = { result: DictionaryResult; applied: true } | { result: DictionaryResult; applied: false; reason: 'NONE_FITS' | 'INVALID_SCORES' }

/**
 * Sorts the senses of each entry by the model's probability, highest first.
 * Entries keep their order and the sort is stable, so equal scores keep
 * WordNet order. When "none of the above" scores at least as high as every
 * sense, or the scores are unusable, the result is returned unchanged.
 */
export function contextualOrder(result: DictionaryResult, request: SenseRequest, logits: ArrayLike<number>, format: SenseFormat): OrderOutcome {
  const count = request.candidates.length
  if (logits.length <= format.nota_index || count === 0) return { result, applied: false, reason: 'INVALID_SCORES' }
  const temperature = format.temperature > 0 ? format.temperature : 1
  const scores = [...Array.from({ length: count }, (_, i) => logits[i]!), logits[format.nota_index]!].map(value => value / temperature)
  if (!scores.every(Number.isFinite)) return { result, applied: false, reason: 'INVALID_SCORES' }
  const maximum = Math.max(...scores)
  const exp = scores.map(value => Math.exp(value - maximum)), total = exp.reduce((sum, value) => sum + value, 0)
  const probabilities = exp.map(value => value / total)
  const none = probabilities.pop()!
  if (none >= Math.max(...probabilities)) return { result, applied: false, reason: 'NONE_FITS' }

  const probability = new Map(request.candidates.map((candidate, i) => [`${candidate.entry}:${candidate.sense}`, probabilities[i]!]))
  const entries = result.entries.map((entry, e) => ({
    ...entry,
    senses: entry.senses
      .map((sense, s) => ({ sense, s, p: probability.get(`${e}:${s}`) ?? 0 }))
      .sort((a, b) => b.p - a.p || a.s - b.s)
      .map(({ sense }) => sense),
  }))
  return { result: { ...result, entries }, applied: true }
}
