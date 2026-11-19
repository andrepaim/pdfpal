import test from 'node:test'
import assert from 'node:assert/strict'
import { codePointSpan, contextualOrder, looksEnglish, senseRequest, type SenseFormat } from '../../src/core/sense-order.js'
import type { DictionaryResult } from '../../src/core/dictionary.js'

// The checkpoint's prompt format, with letters that cannot be mistaken for prompt text.
const format: SenseFormat = {
  letters: Array.from({ length: 128 }, (_, i) => String.fromCharCode(0x400 + i)),
  nota_index: 127, none_text: 'none of the above', separator: '[unused0]', mask_token: '[MASK]', max_length: 2048, temperature: 1,
}
const L = (i: number) => format.letters[i]!

const bank: DictionaryResult = {
  query: 'bank', source: 'WordNet 3.1',
  entries: [
    { lemma: 'bank', part_of_speech: 'noun', senses: [
      { definition: 'sloping land beside a body of water', examples: ['they pulled the canoe up on the bank'] },
      { definition: 'a financial institution that accepts deposits', examples: ['he cashed a check at the bank', 'that bank holds the mortgage'] },
      { definition: 'a long ridge or pile', examples: [] },
    ] },
    { lemma: 'bank', part_of_speech: 'verb', senses: [
      { definition: 'tip laterally', examples: ['the pilot had to bank the aircraft'] },
      { definition: 'do business with a bank', examples: [] },
    ] },
    { lemma: 'banker', part_of_speech: 'noun', senses: [{ definition: 'someone who works at a bank', examples: [] }] },
  ],
}
const deposit = { before: 'After the meeting, he walked over and deposited the money at the ', text: 'bank', after: ' before it closed for the day.' }
const request = (result = bank, selection = deposit) => {
  const built = senseRequest(result, selection, format)
  assert.ok('prompt' in built, `expected a request, got ${JSON.stringify(built)}`)
  return built
}
/** Logits in candidate order, with the "none of the above" logit last. */
function logits(values: number[], none = -10): Float32Array {
  const all = new Float32Array(128).fill(-50)
  values.forEach((value, i) => { all[i] = value })
  all[127] = none
  return all
}

test('JavaScript UTF-16 selection offsets become Unicode code point offsets', () => {
  assert.deepEqual(codePointSpan('😀 bank bank', 8, 12), { start: 7, end: 11, text: 'bank' })
  assert.deepEqual(codePointSpan('plain bank', 6, 10), { start: 6, end: 10, text: 'bank' })
  assert.equal(codePointSpan('😀bank', 1, 3), null, 'a span that splits a surrogate pair is rejected')
  assert.equal(codePointSpan('bank', 2, 2), null)
  assert.equal(codePointSpan('bank', 0, 5), null)
})

test('one prompt scores every original candidate on the exact selected span', () => {
  const built = request()
  assert.equal(built.prompt, [
    'After the meeting, he walked over and deposited the money at the *bank* before it closed for the day.',
    `${L(0)}. sloping land beside a body of water`,
    `${L(1)}. a financial institution that accepts deposits`,
    `${L(2)}. a long ridge or pile`,
    `${L(3)}. tip laterally`,
    `${L(4)}. do business with a bank`,
    `${L(5)}. someone who works at a bank`,
    `${L(127)}. none of the above`,
    '[unused0] [MASK]',
  ].join('\n'))
  assert.deepEqual(built.candidates, [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 0]].map(([entry, sense]) => ({ entry, sense })))
  assert.deepEqual(built.target, { start: 65, end: 69, text: 'bank' })
})

test('the target counts code points after an emoji and keeps the selection exact, not its completion', () => {
  const built = request(bank, { before: '😀 The money is in the ', text: 'bank ', after: 'vault, and it is safe there.' })
  assert.deepEqual(built.target, { start: 22, end: 26, text: 'bank' })
  assert.match(built.prompt, /^😀 The money is in the \*bank\* vault, and it is safe there\.\n/)
  // Half of a hyphenated word is marked as selected; the dictionary completes it separately.
  const half = request(bank, { before: 'The data was stored in a river-', text: 'bank', after: ' for the analysis of the region.' })
  assert.match(half.prompt, /river-\*bank\* for/)
})

test('line breaks and runs of spaces in the page text become single spaces', () => {
  const built = request(bank, { before: 'He paid the money\n into the  ', text: 'bank', after: '\tand the account that was there.' })
  assert.match(built.prompt, /^He paid the money into the \*bank\* and the account that was there\.\n/)
})

test('unsupported inputs are not scored', () => {
  const single: DictionaryResult = { ...bank, entries: [bank.entries[2]!, { ...bank.entries[0]!, senses: bank.entries[0]!.senses.slice(0, 1) }] }
  assert.deepEqual(senseRequest(single, deposit, format), { skip: 'SINGLE_SENSES' })
  assert.deepEqual(senseRequest({ ...bank, entries: [] }, deposit, format), { skip: 'NO_ENTRIES' })
  const many: DictionaryResult = { ...bank, entries: [{ lemma: 'run', part_of_speech: 'verb', senses: Array.from({ length: 128 }, (_, i) => ({ definition: `meaning ${i}`, examples: [] })) }] }
  assert.deepEqual(senseRequest(many, deposit, format), { skip: 'TOO_MANY_SENSES' })
  assert.deepEqual(senseRequest(bank, { ...deposit, after: ' before it closed*.' }, format), { skip: 'UNSAFE_TEXT' })
  assert.deepEqual(senseRequest(bank, { ...deposit, before: 'He saw [MASK] and the money at the ' }, format), { skip: 'UNSAFE_TEXT' })
  assert.deepEqual(senseRequest(bank, { ...deposit, before: 'He saw [SEP] and the money at the ' }, format), { skip: 'UNSAFE_TEXT' })
  const starred: DictionaryResult = { ...bank, entries: [{ ...bank.entries[0]!, senses: [...bank.entries[0]!.senses, { definition: 'a *special* bank', examples: [] }] }] }
  assert.deepEqual(senseRequest(starred, deposit, format), { skip: 'UNSAFE_TEXT' })
  assert.deepEqual(senseRequest(bank, { before: 'Ele depositou o dinheiro no ', text: 'bank', after: ' antes de fechar para o dia.' }, format), { skip: 'NOT_ENGLISH' })
  assert.deepEqual(senseRequest(bank, { ...deposit, text: '   ' }, format), { skip: 'INVALID_SPAN' })
  assert.deepEqual(senseRequest(bank, { ...deposit, before: 'the money at the \uDC00' }, format), { skip: 'INVALID_SPAN' })
})

test('a lone surrogate cut off at the edge of the context is dropped, not sent', () => {
  const built = request(bank, { before: '\uDE00 he deposited the money at the ', text: 'bank', after: ' and then he left \uD83D' })
  assert.match(built.prompt, /^he deposited the money at the \*bank\* and then he left\n/)
})

test('senses are sorted by score only inside each entry, stably, keeping every definition and example', () => {
  const built = request()
  const ordered = contextualOrder(bank, built, logits([1, 5, 1, -2, 3, 0]), format)
  assert.equal(ordered.applied, true)
  assert.deepEqual(ordered.result.entries.map(entry => [entry.lemma, entry.part_of_speech]), [['bank', 'noun'], ['bank', 'verb'], ['banker', 'noun']])
  assert.deepEqual(ordered.result.entries[0]!.senses, [bank.entries[0]!.senses[1], bank.entries[0]!.senses[0], bank.entries[0]!.senses[2]])
  assert.deepEqual(ordered.result.entries[1]!.senses, [bank.entries[1]!.senses[1], bank.entries[1]!.senses[0]])
  assert.deepEqual(ordered.result.entries[2], bank.entries[2])
  assert.deepEqual(Object.keys(ordered.result), Object.keys(bank))
  assert.equal(ordered.result.query, bank.query)
  assert.equal(ordered.result.source, bank.source)
  // The original result is not modified.
  assert.equal(bank.entries[0]!.senses[0]!.definition, 'sloping land beside a body of water')
})

test('equal scores keep WordNet order', () => {
  const ordered = contextualOrder(bank, request(), logits([2, 2, 2, 1, 1, 0]), format)
  assert.deepEqual(ordered.result, bank)
})

test('WordNet order is kept when "none of the above" wins or ties, or the scores are unusable', () => {
  const built = request()
  assert.deepEqual(contextualOrder(bank, built, logits([1, 5, 1, -2, 3, 0], 6), format), { result: bank, applied: false, reason: 'NONE_FITS' })
  assert.deepEqual(contextualOrder(bank, built, logits([1, 5, 1, -2, 3, 0], 5), format), { result: bank, applied: false, reason: 'NONE_FITS' })
  assert.deepEqual(contextualOrder(bank, built, logits([1, Number.NaN, 1, -2, 3, 0]), format), { result: bank, applied: false, reason: 'INVALID_SCORES' })
  assert.deepEqual(contextualOrder(bank, built, new Float32Array(12), format), { result: bank, applied: false, reason: 'INVALID_SCORES' })
})

test('only an English passage is scored', () => {
  assert.equal(looksEnglish('After the meeting, he walked over and deposited the money at the bank before it closed.'), true)
  assert.equal(looksEnglish('We train the model with gradient descent and evaluate it on held-out data.'), true)
  assert.equal(looksEnglish('the bank'), true, 'too short to judge, but in Latin script and without foreign words')
  assert.equal(looksEnglish('Ela depositou dinheiro no banco antes de fechar para o dia.'), false)
  assert.equal(looksEnglish('El modelo se entrena con los datos de la empresa y es muy bueno.'), false)
  assert.equal(looksEnglish('Das Modell wird mit den Daten trainiert und ist nicht schlecht.'), false)
  assert.equal(looksEnglish('Le modèle est entraîné sur les données et il est très bon pour la tâche.'), false)
  assert.equal(looksEnglish('Модель обучается на данных и работает хорошо в этой задаче.'), false)
  assert.equal(looksEnglish('模型在数据上训练并且效果很好。'), false)
  assert.equal(looksEnglish('123 456 789'), false)
})
