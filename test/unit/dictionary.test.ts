import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DictionaryService } from '../../src/core/dictionary.js'

test('serves concurrent lookups from the shipped pack and returns Wiktionary entries and attribution', async () => {
  const dictionary = new DictionaryService()
  try {
    const [mice, wow] = await Promise.all([
      dictionary.define({ text: 'mice' }),
      dictionary.define({ text: 'wow' }),
    ])
    assert.deepEqual(mice.source, {
      name: 'Wiktionary',
      license: 'CC BY-SA 4.0',
      url: 'https://en.wiktionary.org/wiki/mouse',
    })
    assert.equal(mice.entries[0]?.lemma, 'mouse')
    assert.equal(mice.entries[0]?.partOfSpeech, 'noun')
    assert.equal(mice.entries[0]?.note, 'plural of mouse')
    assert.match(mice.entries[0]?.senses[0]?.definition ?? '', /rodent/)
    assert.ok(mice.entries[0]?.senses.some(sense => sense.examples.length))
    assert.equal(wow.entries[0]?.partOfSpeech, 'intj')
  } finally { await dictionary.close() }
})

test('recognizes selected phrases, surrounding compounds and partially selected words', async () => {
  const dictionary = new DictionaryService()
  try {
    const phrase = await dictionary.define({ text: 'neural networks' })
    assert.equal(phrase.entries[0]?.lemma, 'neural network')
    assert.equal(phrase.entries[0]?.note, 'plural of neural network')

    const compound = await dictionary.define({ text: 'network', before: 'a neural ', after: ' was trained' })
    assert.deepEqual(compound.entries.slice(0, 2).map(entry => entry.lemma), ['neural network', 'network'])

    const partial = await dictionary.define({ text: 'known', before: 'a well‑', after: ' result' })
    assert.deepEqual(partial.entries.slice(0, 2).map(entry => entry.lemma), ['well-known', 'known'])

    const incorrectBoundary = await dictionary.define({ text: 'network', before: 'the neural', after: 'is trained' })
    assert.equal(incorrectBoundary.entries[0]?.lemma, 'network')
    const clause = await dictionary.define({ text: 'network', before: 'neural. ', after: ' was trained' })
    assert.equal(clause.entries[0]?.lemma, 'network')
  } finally { await dictionary.close() }
})

test('normalizes PDF typography for lookup and leaves non-definable selections empty', async () => {
  const dictionary = new DictionaryService()
  try {
    const ligature = await dictionary.define({ text: 'ﬁnally' })
    assert.equal(ligature.entries[0]?.lemma, 'finally')
    assert.equal(ligature.entries[0]?.partOfSpeech, 'adv')
    const hyphen = await dictionary.define({ text: 'known', before: 'a well–' })
    assert.equal(hyphen.entries[0]?.lemma, 'well-known')
    const apostrophe = await dictionary.define({ text: 'o’clock' })
    assert.equal(apostrophe.entries[0]?.lemma, "o'clock")
    for (const text of ['zxqv', '  ', '42', 'one two three four five', '\uD800'])
      assert.deepEqual((await dictionary.define({ text })).entries, [], JSON.stringify(text))
  } finally { await dictionary.close() }
})

test('returns an offline miss for missing or invalid packs and can reopen after close', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-dictionary-'))
  const file = path.join(directory, 'wiktionary.pack')
  const dictionary = new DictionaryService(file)
  t.after(async () => {
    await dictionary.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  const miss = {
    query: 'bank', entries: [],
    source: { name: 'Wiktionary', license: 'CC BY-SA 4.0', url: 'https://en.wiktionary.org/wiki/bank' },
  }
  assert.deepEqual(await dictionary.define({ text: 'bank' }), miss)
  await dictionary.close()
  await fs.writeFile(file, Buffer.alloc(128))
  assert.deepEqual(await dictionary.define({ text: 'bank' }), miss)
  await dictionary.close()

  const shippedPack = new URL('../../data/dictionary/wiktionary-en-v1.pack', import.meta.url)
  await fs.copyFile(shippedPack, file, fs.constants.COPYFILE_FICLONE)
  assert.ok((await dictionary.define({ text: 'bank' })).entries.length)
  await dictionary.close()
  await fs.writeFile(file, Buffer.alloc(128))
  assert.deepEqual(await dictionary.define({ text: 'bank' }), miss)
})
