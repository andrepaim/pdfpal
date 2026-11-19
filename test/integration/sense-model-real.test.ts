import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ContextualDefinitions, DEFAULT_BUDGET_MS } from '../../src/core/contextual-definitions.js'
import { DictionaryService } from '../../src/core/dictionary.js'
import { installRuntime, verifyModel } from '../../src/core/sense-model.js'
import { SENSE_RUNTIME } from '../../src/core/sense-runtime-manifest.js'

// Runs the real Ettin INT8 checkpoint on the CPU. Opt in with the directory of
// a local sense-model export, for example:
//   PDFPAL_TEST_SENSE_MODEL_DIR=~/src/sense-model/artifacts/upstream-english npm test
const directory = process.env.PDFPAL_TEST_SENSE_MODEL_DIR
const skip = directory ? false : 'set PDFPAL_TEST_SENSE_MODEL_DIR to a local Ettin-150m-WSD export'

const dictionary = new DictionaryService()
const lookup = (before: string, text: string, after: string) => ({ selection: { before, text, after }, result: dictionary.define(text, { before, after }) })
const firstNoun = (result: ReturnType<DictionaryService['define']>) => result.entries.find(entry => entry.part_of_speech === 'noun')!.senses[0]!.definition

test('the real checkpoint orders "bank" by its passage, through the package and a provisioned runtime', { skip, timeout: 180_000 }, async () => {
  assert.deepEqual(await verifyModel(directory!), { ok: true })
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-real-runtime-'))
  const contexts = [
    new ContextualDefinitions({ directory: directory!, budgetMs: 5000 }),
    new ContextualDefinitions({ directory: directory!, runtimeDirectory: path.join(runtime, 'sense-runtime'), budgetMs: 5000 }),
  ]
  try {
    await installRuntime(path.resolve('.'), path.join(runtime, 'sense-runtime'), SENSE_RUNTIME)
    for (const contextual of contexts) {
      contextual.warm()
      assert.deepEqual(await contextual.settled(), { state: 'ready' })
      const money = lookup('After the meeting he walked over and deposited his salary at the ', 'bank', ' before it closed for the day.')
      const river = lookup('The children sat on the grassy ', 'bank', ' of the river and watched the boats go by.')
      assert.match(firstNoun(money.result), /sloping land/, 'WordNet lists the river sense first')
      assert.match(firstNoun(await contextual.order(money.result, money.selection)), /financial institution/)
      assert.match(firstNoun(await contextual.order(river.result, river.selection)), /sloping land/)
      assert.equal(contextual.stats.applied, 2)
    }
  } finally {
    await Promise.all(contexts.map(contextual => contextual.close()))
    fs.rmSync(runtime, { recursive: true, force: true })
  }
})

test('warm lookups with the default budget stay bounded', { skip, timeout: 180_000 }, async () => {
  const contextual = new ContextualDefinitions({ directory: directory! })
  const passages = [
    ['We evaluate the ', 'model', ' on three benchmarks and report the mean accuracy over five seeds.'],
    ['The packets travel across the ', 'network', ' and are reassembled by the receiving host.'],
    ['Each ', 'layer', ' of the network applies a linear map followed by a nonlinearity.'],
    ['The judge will ', 'charge', ' the defendant with fraud once the evidence is in.'],
    ['We ', 'train', ' the classifier for ten epochs with a small learning rate.'],
    ['The magnetic ', 'field', ' around the coil grows as the current increases.'],
    ['She used a ', 'key', ' to open the old wooden door of the cottage.'],
    ['The ', 'state', ' of the system is stored in a small table on disk.'],
  ]
  try {
    contextual.warm()
    assert.deepEqual(await contextual.settled(), { state: 'ready' })
    const times: number[] = []
    for (let round = 0; round < 3; round++) {
      for (const [before, text, after] of passages) {
        const { selection, result } = lookup(before!, text!, `${after} (${round})`)
        const start = performance.now()
        await contextual.order(result, selection)
        times.push(performance.now() - start)
      }
    }
    times.sort((a, b) => a - b)
    const p50 = times[Math.floor(times.length / 2)]!, p95 = times[Math.ceil(times.length * 0.95) - 1]!
    console.log(`warm order(): p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${times.at(-1)!.toFixed(1)} ms; ${JSON.stringify(contextual.stats)}`)
    assert.ok(times.at(-1)! < DEFAULT_BUDGET_MS + 50, 'a lookup never waits much longer than the budget')
  } finally { await contextual.close() }
})
