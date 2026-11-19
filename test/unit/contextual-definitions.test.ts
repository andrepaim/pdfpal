import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { ContextualDefinitions, type ContextualOptions } from '../../src/core/contextual-definitions.js'
import type { DictionaryResult } from '../../src/core/dictionary.js'

const fakeWorker = new URL('../fixtures/fake-sense-worker.mjs', import.meta.url)
type Fake = { loadMs?: number; scoreMs?: number; fail?: string; crashOnScore?: boolean; rejectCode?: string; prefer?: string; none?: number }
function ranker(fake: Fake = {}, options: Partial<ContextualOptions> = {}) {
  return new ContextualDefinitions({ directory: '/not/used', worker: { url: fakeWorker, data: { fake } }, ...options })
}

const bank: DictionaryResult = {
  query: 'bank', source: 'WordNet 3.1',
  entries: [
    { lemma: 'bank', part_of_speech: 'noun', senses: [
      { definition: 'sloping land beside a body of water', examples: [] },
      { definition: 'a financial institution that accepts deposits', examples: ['he cashed a check at the bank'] },
    ] },
    { lemma: 'bank', part_of_speech: 'verb', senses: [{ definition: 'tip laterally', examples: [] }] },
  ],
}
const financialFirst = [bank.entries[0]!.senses[1], bank.entries[0]!.senses[0]]
/** A distinct English passage for each lookup, so that none is answered from the cache. */
const passage = (n = 0) => ({ before: `On day ${n} he walked over and deposited all of the money at the `, text: 'bank', after: ' before it closed for the day.' })
const elapsed = async <T>(work: Promise<T>) => { const start = performance.now(); const value = await work; return { value, ms: performance.now() - start } }

test('a lookup before the model is ready gets WordNet order at once, and the loaded model then orders senses', async () => {
  const contextual = ranker({ loadMs: 300, prefer: 'financial' })
  try {
    contextual.warm()
    assert.equal(contextual.status().state, 'loading')
    const cold = await elapsed(contextual.order(bank, passage()))
    assert.deepEqual(cold.value, bank)
    assert.ok(cold.ms < 100, `cold lookup took ${cold.ms} ms`)
    assert.deepEqual(await contextual.settled(), { state: 'ready' })
    const warm = await contextual.order(bank, passage())
    assert.deepEqual(warm.entries[0]!.senses, financialFirst)
    assert.deepEqual(warm.entries[1], bank.entries[1])
    assert.equal(contextual.stats.scored, 1)
  } finally { await contextual.close() }
})

test('the first lookup starts loading when nothing warmed the model', async () => {
  const contextual = ranker({ prefer: 'financial' })
  try {
    assert.equal(contextual.status().state, 'idle')
    assert.deepEqual(await contextual.order(bank, passage()), bank)
    assert.equal((await contextual.settled()).state, 'ready')
    assert.deepEqual((await contextual.order(bank, passage())).entries[0]!.senses, financialFirst)
  } finally { await contextual.close() }
})

test('nothing is sent to the model when every entry has one sense or the input is unsupported', async () => {
  const contextual = ranker({ prefer: 'financial' })
  try {
    contextual.warm(); await contextual.settled()
    const single: DictionaryResult = { ...bank, entries: [bank.entries[1]!] }
    assert.deepEqual(await contextual.order(single, passage()), single)
    assert.deepEqual(await contextual.order(bank, { before: 'Ele depositou o dinheiro no ', text: 'bank', after: ' antes de fechar para o dia.' }), bank)
    assert.deepEqual(await contextual.order(bank, { ...passage(), after: ' see footnote*' }), bank)
    assert.equal(contextual.stats.scored, 0)
    assert.equal(contextual.stats.skipped, 3)
  } finally { await contextual.close() }
})

test('a lookup over its time budget gets WordNet order, and the late answer serves the same lookup later', async () => {
  const contextual = ranker({ scoreMs: 300, prefer: 'financial' }, { budgetMs: 80 })
  try {
    contextual.warm(); await contextual.settled()
    const late = await elapsed(contextual.order(bank, passage()))
    assert.deepEqual(late.value, bank)
    assert.ok(late.ms < 250, `timed out after ${late.ms} ms`)
    assert.equal(contextual.stats.timedOut, 1)
    await sleep(350)
    assert.deepEqual((await contextual.order(bank, passage())).entries[0]!.senses, financialFirst)
    assert.equal(contextual.stats.cached, 1)
    assert.equal(contextual.stats.scored, 1)
  } finally { await contextual.close() }
})

test('a newer lookup replaces one still waiting for the model; the running one completes', async () => {
  const contextual = ranker({ scoreMs: 150, prefer: 'financial' }, { budgetMs: 2000 })
  try {
    contextual.warm(); await contextual.settled()
    const finished: string[] = []
    const track = (name: string, work: Promise<DictionaryResult>) => work.then(result => { finished.push(name); return result })
    const first = track('first', contextual.order(bank, passage(1)))
    const replaced = track('replaced', contextual.order(bank, passage(2)))
    const latest = track('latest', contextual.order(bank, passage(3)))
    assert.deepEqual(await replaced, bank)
    assert.deepEqual((await first).entries[0]!.senses, financialFirst)
    assert.deepEqual((await latest).entries[0]!.senses, financialFirst)
    assert.deepEqual(finished, ['replaced', 'first', 'latest'])
    assert.equal(contextual.stats.superseded, 1)
    assert.equal(contextual.stats.scored, 2)
  } finally { await contextual.close() }
})

test('a cancelled lookup returns at once, and a cancelled queued lookup is never scored', async () => {
  const contextual = ranker({ scoreMs: 200, prefer: 'financial' }, { budgetMs: 2000 })
  try {
    contextual.warm(); await contextual.settled()
    const running = new AbortController(), queued = new AbortController()
    const first = elapsed(contextual.order(bank, passage(1), running.signal))
    const second = elapsed(contextual.order(bank, passage(2), queued.signal))
    await sleep(20)
    running.abort(); queued.abort()
    const [a, b] = await Promise.all([first, second])
    assert.deepEqual(a.value, bank)
    assert.deepEqual(b.value, bank)
    assert.ok(a.ms < 120 && b.ms < 120, `cancelled after ${a.ms} and ${b.ms} ms`)
    await sleep(250)
    assert.equal(contextual.stats.scored, 1)
    const aborted = new AbortController(); aborted.abort()
    assert.deepEqual(await contextual.order(bank, passage(3), aborted.signal), bank)
    assert.equal(contextual.stats.scored, 1)
  } finally { await contextual.close() }
})

test('a model that "fits none" or rejects the prompt leaves WordNet order', async () => {
  const none = ranker({ prefer: 'financial', none: 9 })
  const rejected = ranker({ prefer: 'financial', rejectCode: 'TOO_LONG' })
  try {
    none.warm(); rejected.warm(); await Promise.all([none.settled(), rejected.settled()])
    assert.deepEqual(await none.order(bank, passage()), bank)
    assert.deepEqual(await rejected.order(bank, passage()), bank)
    assert.equal(rejected.status().state, 'ready', 'one rejected prompt does not stop the model')
  } finally { await Promise.all([none.close(), rejected.close()]) }
})

test('load failures are reported by code and retried only after a pause', async () => {
  const contextual = ranker({ fail: 'MODEL_MISMATCH' }, { retryMs: 200 })
  try {
    contextual.warm()
    assert.deepEqual(await contextual.settled(), { state: 'failed', code: 'MODEL_MISMATCH' })
    assert.deepEqual(await contextual.order(bank, passage()), bank)
    assert.equal(contextual.status().state, 'failed', 'no reload before the pause')
    await sleep(250)
    await contextual.order(bank, passage())
    assert.equal(contextual.status().state, 'loading')
  } finally { await contextual.close() }
})

test('a load that takes too long is abandoned', async () => {
  const contextual = ranker({ loadMs: 5000 }, { loadTimeoutMs: 100 })
  try {
    contextual.warm()
    assert.deepEqual(await contextual.settled(), { state: 'failed', code: 'LOAD_TIMEOUT' })
  } finally { await contextual.close() }
})

test('a crashed worker returns WordNet order and is restarted after a pause', async () => {
  const contextual = ranker({ crashOnScore: true }, { retryMs: 100, budgetMs: 2000 })
  try {
    contextual.warm(); await contextual.settled()
    const crashed = await elapsed(contextual.order(bank, passage()))
    assert.deepEqual(crashed.value, bank)
    assert.ok(crashed.ms < 1000)
    assert.deepEqual(contextual.status(), { state: 'failed', code: 'WORKER_EXITED' })
    await sleep(150)
    contextual.warm()
    assert.equal((await contextual.settled()).state, 'ready')
  } finally { await contextual.close() }
})

test('a worker stuck on one prompt is stopped', async () => {
  const contextual = ranker({ scoreMs: 10_000 }, { budgetMs: 50, runTimeoutMs: 200 })
  try {
    contextual.warm(); await contextual.settled()
    assert.deepEqual(await contextual.order(bank, passage()), bank)
    await sleep(300)
    assert.deepEqual(contextual.status(), { state: 'failed', code: 'WORKER_TIMEOUT' })
  } finally { await contextual.close() }
})

test('closing stops the worker and later lookups keep WordNet order', async () => {
  const contextual = ranker({ loadMs: 50, scoreMs: 500, prefer: 'financial' }, { budgetMs: 2000 })
  contextual.warm(); await contextual.settled()
  const pending = elapsed(contextual.order(bank, passage(1)))
  await sleep(20)
  await contextual.close()
  const answered = await pending
  assert.deepEqual(answered.value, bank)
  assert.ok(answered.ms < 300)
  assert.deepEqual(contextual.status(), { state: 'closed' })
  assert.deepEqual(await contextual.order(bank, passage(2)), bank)
  contextual.warm()
  assert.deepEqual(contextual.status(), { state: 'closed' })
})

test('the real worker reports a missing model without loading a runtime', async () => {
  const contextual = new ContextualDefinitions({ directory: '/nonexistent/pdfpal/model' })
  try {
    contextual.warm()
    assert.deepEqual(await contextual.settled(), { state: 'failed', code: 'MODEL_MISSING' })
    assert.deepEqual(await contextual.order(bank, passage()), bank)
  } finally { await contextual.close() }
})
