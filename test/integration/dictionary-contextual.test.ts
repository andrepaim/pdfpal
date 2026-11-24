import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import { buildServer } from '../../src/server/app.js'
import { registerDictionaryRoutes } from '../../src/server/dictionary.js'
import { ContextualDefinitions } from '../../src/core/contextual-definitions.js'
import type { DictionaryDefineResponse } from '../../src/shared/dictionary.js'
import { loadConfig } from '../../src/core/config.js'
import { testConfig } from '../helpers/test-utils.js'

const fakeWorker = new URL('../fixtures/fake-sense-worker.mjs', import.meta.url)
const deposit = { text: 'bank', before: 'After lunch he walked over and deposited the money at the ', after: ' before it closed for the day.' }
const url = (query: Record<string, string>) => `/api/dictionary/define?${new URLSearchParams(query)}`
const flatten = (result: DictionaryDefineResponse) => result.entries.flatMap(entry => entry.senses.map(sense => JSON.stringify([entry.lemma, entry.part_of_speech, sense]))).sort()

test('the dictionary route orders senses inside entries when contextual definitions are on', async () => {
  const contextual = new ContextualDefinitions({ directory: '/not/used', worker: { url: fakeWorker, data: { fake: { prefer: 'branch office' } } } })
  const app = Fastify()
  registerDictionaryRoutes(app, contextual)
  try {
    const baseline = (await app.inject({ url: url(deposit) })).json<DictionaryDefineResponse>()
    assert.doesNotMatch(baseline.entries[0]!.senses[0]!.definition, /branch office/)
    contextual.warm(); await contextual.settled()

    const response = await app.inject({ url: url(deposit) })
    assert.equal(response.statusCode, 200)
    const ordered = response.json<DictionaryDefineResponse>()
    const withoutSenses = ({ entries, ...result }: DictionaryDefineResponse) => ({
      ...result,
      entries: entries.map(({ senses, ...entry }) => entry),
    })
    assert.deepEqual(withoutSenses(ordered), withoutSenses(baseline))
    assert.match(ordered.entries[0]!.senses[0]!.definition, /branch office/)
    assert.deepEqual(flatten(ordered), flatten(baseline), 'every definition and example is kept')
    for (const entry of ordered.entries) for (const sense of entry.senses) assert.deepEqual(Object.keys(sense), ['definition', 'examples'])
    assert.equal(contextual.stats.scored, 1)

    // A selection the dictionary cannot define is never scored.
    assert.deepEqual((await app.inject({ url: url({ text: 'zxqv', before: deposit.before }) })).json().entries, [])
    assert.equal(contextual.stats.scored, 1)
  } finally { await app.close(); await contextual.close() }
})

test('the server keeps dictionary order with the flag on but no installed model, and stops the worker on close', async () => {
  const off = testConfig()
  const on = loadConfig({ dataDir: off.dataDir, contextualDefinitions: true, senseModelDir: path.join(off.dataDir, 'models', 'missing') })
  const plain = await buildServer(off)
  const contextual = await buildServer(on)
  try {
    const expected = (await plain.inject({ url: url(deposit) })).json()
    const response = await contextual.inject({ url: url(deposit) })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), expected)
  } finally {
    await plain.close(); await contextual.close()
    fs.rmSync(off.dataDir, { recursive: true, force: true })
  }
})
