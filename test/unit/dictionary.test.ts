import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDictionary, parseGloss } from '../../src/core/dictionary-build.js'
import { DictionaryService, type DictionaryResult } from '../../src/core/dictionary.js'

const lemmas = (result: DictionaryResult) => result.entries.map(entry => `${entry.lemma} (${entry.part_of_speech})`)

// A WordNet database small enough to read: two nouns, a verb, an adjective
// and an adverb, in WordNet's own file formats.
function miniWordNet(directory: string) {
  const header = '  1 This software and database is being provided to you, the LICENSEE\n'
  const files: Record<string, string> = {
    'data.noun': header
      + '00001740 03 n 01 mouse 0 000 | a small rodent; "a mouse ran by"; "mice squeak"\n'
      + '00002000 03 n 01 mouse 1 000 | a hand-operated pointing device\n'
      + '00003000 03 n 02 neural_network 0 neural_net 0 000 | a network of simple processors\n',
    'index.noun': header
      + 'mouse n 2 0 2 1 00001740 00002000  \n'
      + 'neural_network n 1 0 1 0 00003000  \n',
    'data.verb': header + '00001740 30 v 01 run 0 000 00 | move fast on foot; "he ran home"\n',
    'index.verb': header + 'run v 1 0 1 1 00001740  \n',
    'data.adj': header + '00001740 00 a 01 good 0 000 | having desirable qualities\n',
    'index.adj': header + 'good a 1 0 1 1 00001740  \n',
    'data.adv': header + '00001740 02 r 01 quickly 0 000 | with speed\n',
    'index.adv': header + 'quickly r 1 0 1 0 00001740  \n',
    'index.sense': 'mouse%1:05:00:: 00001740 1 7\nmouse%1:06:00:: 00002000 2 0\nrun%2:38:00:: 00001740 1 40\ngood%3:00:01:: 00001740 1 190\n',
    'noun.exc': 'mice mouse\n', 'verb.exc': 'ran run\n', 'adj.exc': 'better good well\n', 'adv.exc': '',
  }
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content)
}

test('parseGloss separates the definition from its example sentences', () => {
  assert.deepEqual(parseGloss('a small rodent; "a mouse ran by"; "mice squeak"'), { definition: 'a small rodent', examples: ['a mouse ran by', 'mice squeak'] })
  assert.deepEqual(parseGloss('the first; the second meaning'), { definition: 'the first; the second meaning', examples: [] })
  assert.deepEqual(parseGloss('and others (`et al.\' is an abbreviation); "Smith et al."  '), { definition: 'and others (`et al.\' is an abbreviation)', examples: ['Smith et al.'] })
})

test('builds a dictionary from WordNet files, skips an up-to-date one and rebuilds a stale one', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-dictionary-'))
  try {
    miniWordNet(directory)
    const output = path.join(directory, 'out', 'wordnet.sqlite')
    const options = { dictDir: directory, exceptionsDir: directory, output }
    assert.deepEqual(buildDictionary(options), { built: true, synsets: 6, senses: 6, exceptions: 4 })
    assert.deepEqual(buildDictionary(options), { built: false, synsets: 6, senses: 6, exceptions: 4 })

    const dictionary = new DictionaryService(output)
    assert.equal(dictionary.available, true)
    const mice = dictionary.define('mice')
    assert.deepEqual(lemmas(mice), ['mouse (noun)'])
    assert.deepEqual(mice.entries[0]!.senses, [
      { definition: 'a small rodent', examples: ['a mouse ran by', 'mice squeak'] },
      { definition: 'a hand-operated pointing device', examples: [] },
    ])
    assert.deepEqual(lemmas(dictionary.define('ran')), ['run (verb)'])
    assert.deepEqual(lemmas(dictionary.define('neural networks')), ['neural network (noun)'])
    dictionary.close()

    fs.appendFileSync(path.join(directory, 'adv.exc'), 'best well\n')
    assert.equal(buildDictionary(options).built, true)
    fs.writeFileSync(output, 'not a database')
    assert.equal(buildDictionary(options).built, true)
    assert.ok(!fs.readdirSync(path.dirname(output)).some(name => name.endsWith('.tmp')), 'no temporary file is left behind')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('a missing dictionary file gives no definitions instead of failing', () => {
  const dictionary = new DictionaryService(path.join(os.tmpdir(), 'pdfpal-no-such-dictionary.sqlite'))
  assert.equal(dictionary.available, false)
  assert.deepEqual(dictionary.define('bank'), { query: 'bank', entries: [], source: 'WordNet 3.1' })
})

// The rest use the real dictionary, which `npm test` builds first (pretest).
const dictionary = new DictionaryService()
test.after(() => dictionary.close())

test('defines a word with its meanings grouped by part of speech', () => {
  const result = dictionary.define('bank')
  assert.equal(result.source, 'WordNet 3.1')
  assert.deepEqual(lemmas(result), ['bank (noun)', 'bank (verb)'])
  assert.equal(result.entries[0]!.senses.length, 10)
  assert.match(result.entries[0]!.senses[0]!.definition, /sloping land/)
  assert.ok(result.entries[0]!.senses[0]!.examples.length > 0)
})

test('reduces inflected and irregular forms to their base form, most used reading first', () => {
  assert.deepEqual(lemmas(dictionary.define('mice')), ['mouse (noun)'])
  assert.deepEqual(lemmas(dictionary.define('ran')), ['run (verb)'])
  assert.deepEqual(lemmas(dictionary.define('studies')), ['study (noun)', 'study (verb)'])
  assert.deepEqual(lemmas(dictionary.define('boxes')), ['box (noun)', 'box (verb)'])
  // "running" is a word of its own and a form of "run"; the verb is far more common.
  assert.deepEqual(lemmas(dictionary.define('running')), ['run (verb)', 'running (noun)', 'running (adjective)'])
  assert.equal(lemmas(dictionary.define('saw'))[0], 'see (verb)')
})

test('cleans up the selection: capitals, punctuation, ligatures and curly quotes', () => {
  assert.deepEqual(lemmas(dictionary.define('  Studies, ')), ['study (noun)', 'study (verb)'])
  assert.equal(dictionary.define('(Bank).').query, 'bank')
  assert.deepEqual(lemmas(dictionary.define('ﬁnally')), ['finally (adverb)'])
  assert.deepEqual(lemmas(dictionary.define('o’clock')), ['o\'clock (adverb)'])
})

test('gives nothing for words WordNet does not list, empty selections and long passages', () => {
  for (const text of ['the', 'zxqv', '...', '   ', '42', 'one two three four five'])
    assert.deepEqual(dictionary.define(text).entries, [], text)
})

test('defines a selected compound, inflected or not', () => {
  assert.deepEqual(lemmas(dictionary.define('standard deviation')), ['standard deviation (noun)'])
  assert.deepEqual(lemmas(dictionary.define('Neural  networks')), ['neural network (noun)'])
  assert.deepEqual(lemmas(dictionary.define('carried out')), ['carry out (verb)'])
  assert.deepEqual(lemmas(dictionary.define('a priori')), ['a priori (adjective)', 'a priori (adverb)'])
  // Not in WordNet as a phrase: no card, rather than the words one by one.
  assert.deepEqual(dictionary.define('machine learning').entries, [])
})

test('defines hyphenated words, falling back to their parts when the whole is not listed', () => {
  assert.deepEqual(lemmas(dictionary.define('well-known')), ['well-known (adjective)'])
  assert.deepEqual(lemmas(dictionary.define('trade-offs')), ['trade-off (noun)', 'tradeoff (noun)'])
  assert.ok(lemmas(dictionary.define('state-of-the-art')).includes('state-of-the-art (adjective)'))
  assert.deepEqual(lemmas(dictionary.define('self-attention')), ['attention (noun)', 'self (noun)', 'self (adjective)'])
})

test('finds the compound around a single selected word and lists it first', () => {
  assert.deepEqual(lemmas(dictionary.define('network', { before: 'trained a deep neural ', after: ' on images' })),
    ['neural network (noun)', 'network (noun)', 'network (verb)'])
  // A double-click can take the space after the word with it.
  assert.deepEqual(lemmas(dictionary.define('networks ', { before: 'a deep neural ', after: 'are trained' })),
    ['neural network (noun)', 'network (noun)', 'network (verb)'])
  assert.equal(lemmas(dictionary.define('out', { before: 'we carried ', after: ' the test' }))[0], 'carry out (verb)')
  assert.deepEqual(lemmas(dictionary.define('priori', { before: 'an a ', after: ' assumption' })), ['a priori (adjective)', 'a priori (adverb)'])
  assert.equal(lemmas(dictionary.define('deviation', { before: 'the standard ', after: ', which is' }))[0], 'standard deviation (noun)')
})

test('a compound around the word is a guess: it is listed first, with the word itself after it', () => {
  // "run along" (to form a line along) is a WordNet entry, though not what
  // "the mice ran along the river" means. Without reading the sentence the
  // lookup cannot tell, so the plain verb stays right below it.
  assert.deepEqual(lemmas(dictionary.define('ran', { before: 'The mice ', after: ' along the river bank.' })), ['run along (verb)', 'run (verb)'])
})

test('does not join words across a sentence or a bracket', () => {
  // "standard" ends one sentence and "deviation" starts the next.
  assert.deepEqual(lemmas(dictionary.define('deviation', { before: 'set the standard. ', after: ' from it' })).slice(0, 1), ['deviation (noun)'])
  assert.deepEqual(lemmas(dictionary.define('standard', { before: 'the ', after: ' (deviation of' })).includes('standard deviation (noun)'), false)
  assert.equal(lemmas(dictionary.define('network.', { before: 'a neural ', after: ' Deep nets' }))[0], 'neural network (noun)')
})

test('completes a word selected in part from the text around it', () => {
  // Double-clicking a hyphenated word selects one half.
  assert.deepEqual(lemmas(dictionary.define('known', { before: 'a well-', after: ' result' })), ['well-known (adjective)', 'know (verb)', 'known (adjective)'])
  assert.deepEqual(lemmas(dictionary.define('well', { before: 'a ', after: '-known result' }))[0], 'well-known (adjective)')
  assert.deepEqual(lemmas(dictionary.define('attention', { before: 'uses self-', after: ' layers' })), ['attention (noun)'])
  assert.equal(dictionary.define('attent', { before: 'pay ', after: 'ion to' }).query, 'attention')
  // A PDF can leave no space between two words; the selection still gets its own meaning.
  assert.deepEqual(lemmas(dictionary.define('network', { before: 'the neural', after: 'is trained' })), ['network (noun)', 'network (verb)'])
})
