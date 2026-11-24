import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'
import { ETTIN_ENGLISH_INT8, runtimeRequire, verifyModel, verifyRuntime } from './sense-model.js'
import { SENSE_RUNTIME } from './sense-runtime-manifest.js'
import { isSenseFormat, senseRequest, type DictionaryResult, type Selection, type SenseFormat } from '@andrepaim/contextual-dictionary-core'

// The worker thread that runs the English word-sense model on the CPU. It
// verifies the pinned files, loads the ONNX Runtime session once, and then
// turns prompts into the model's 128 answer logits. It reads only local
// files and has no network code; messages carry prompts in and numbers or
// content-free codes out.
//
// in:  { type: 'score', id, prompt } | { type: 'close' }
// out: { type: 'ready', format, revision } | { type: 'failed', code }
//      { type: 'scored', id, logits } | { type: 'rejected', id, code }

type Data = { directory: string; runtimeDirectory?: string; threads: number }
type Tensor = { data: ArrayLike<number> & { slice(start: number, end: number): Float32Array }; dims: readonly number[] }
type Session = { run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>>; release(): Promise<void> }
type Ort = {
  InferenceSession: { create(file: string, options: Record<string, unknown>): Promise<Session> }
  Tensor: new (type: 'int64', data: BigInt64Array, dims: number[]) => unknown
}
type Tokenizer = { encode(text: string): { ids: number[] }; token_to_id(token: string): number | undefined }
type Metadata = { letters: string[]; nota_index: number; none_text: string; separator: string; template_version: string; max_length: number; model_revision: string }

class LoadError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}
const port = parentPort!
const data = workerData as Data

/** Packages from a verified provisioned runtime when there is one, otherwise from the app's own dependencies. */
async function runtime(): Promise<{ ort: Ort; Tokenizer: new (json: object, config: object) => Tokenizer }> {
  const provisioned = data.runtimeDirectory && fs.existsSync(path.join(data.runtimeDirectory, 'node_modules'))
  if (provisioned) {
    const verified = await verifyRuntime(data.runtimeDirectory!, SENSE_RUNTIME)
    if (!verified.ok) throw new LoadError(verified.code)
  }
  const load = provisioned ? runtimeRequire(data.runtimeDirectory!) : createRequire(import.meta.url)
  try {
    load.resolve('onnxruntime-node'); load.resolve('@huggingface/tokenizers')
  } catch { throw new LoadError('RUNTIME_MISSING') }
  try {
    return { ort: load('onnxruntime-node') as Ort, Tokenizer: (load('@huggingface/tokenizers') as { Tokenizer: new (json: object, config: object) => Tokenizer }).Tokenizer }
  } catch { throw new LoadError('RUNTIME_FAILED') }
}

const readJson = (name: string) => JSON.parse(fs.readFileSync(path.join(data.directory, name), 'utf8'))

async function load() {
  const model = await verifyModel(data.directory)
  if (!model.ok) throw new LoadError(model.code)
  const { ort, Tokenizer } = await runtime()
  const metadata = readJson('model_metadata.json') as Metadata
  const calibration = readJson('calibration.json') as { temperature?: number }
  if (metadata.template_version !== 'compact-v1' || metadata.model_revision !== ETTIN_ENGLISH_INT8.revision || metadata.letters.length <= metadata.nota_index) throw new LoadError('MODEL_MISMATCH')
  const config = readJson('tokenizer_config.json') as { mask_token: string }
  const format: SenseFormat = {
    letters: metadata.letters, nota_index: metadata.nota_index, none_text: metadata.none_text, separator: metadata.separator,
    mask_token: config.mask_token, max_length: metadata.max_length, temperature: calibration.temperature ?? 1,
  }
  if (!isSenseFormat(format)) throw new LoadError('MODEL_MISMATCH')
  const tokenizer = new Tokenizer(readJson('tokenizer.json'), config)
  const mask = tokenizer.token_to_id(config.mask_token)
  if (mask === undefined) throw new LoadError('MODEL_MISMATCH')
  let session: Session
  try {
    session = await ort.InferenceSession.create(path.join(data.directory, 'onnx', 'model.int8.onnx'), {
      executionProviders: ['cpu'], intraOpNumThreads: data.threads, interOpNumThreads: 1, graphOptimizationLevel: 'all',
    })
  } catch { throw new LoadError('SESSION_FAILED') }
  return { ort, tokenizer, mask, session, format }
}

type Loaded = Awaited<ReturnType<typeof load>>

async function logits({ ort, tokenizer, mask, session, format }: Loaded, prompt: string): Promise<Float32Array | string> {
  const ids = tokenizer.encode(prompt).ids
  if (ids.length > format.max_length) return 'TOO_LONG'
  const positions = ids.flatMap((id, i) => id === mask ? [i] : [])
  if (positions.length !== 1) return 'MASK'
  const output = await session.run({
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]),
    prediction_positions: new ort.Tensor('int64', BigInt64Array.from([BigInt(positions[0]!)]), [1]),
  })
  const result = output.logits
  if (!result || result.data.length < 128) return 'RUN_FAILED'
  return Float32Array.from(result.data.slice(0, 128))
}

// A prompt of typical length, so that the first lookup does not pay for
// ONNX Runtime's first-run allocations.
const warmupSelection: Selection = {
  text: 'bank',
  before: 'We trained the model on a large ',
  after: ' of labelled examples before testing it on new data from the same field.',
}
const warmupResult: DictionaryResult = {
  query: 'bank',
  source: { name: 'Wiktionary', license: 'CC BY-SA 4.0', url: 'https://en.wiktionary.org/wiki/bank' },
  entries: [{
    lemma: 'bank',
    partOfSpeech: 'noun',
    senses: ['a collection', 'sloping land', 'a financial institution', 'a long ridge', 'a supply held in reserve']
      .map(definition => ({ definition, examples: [] })),
  }],
}

let loaded: Loaded | undefined
let work = Promise.resolve()
port.on('message', (message: { type: string; id?: number; prompt?: string }) => {
  if (message.type === 'close') {
    work = work.then(async () => { await loaded?.session.release().catch(() => undefined); process.exit(0) })
    return
  }
  if (message.type !== 'score' || !loaded) return
  const ready = loaded
  work = work.then(async () => {
    try {
      const answer = await logits(ready, message.prompt!)
      if (typeof answer === 'string') port.postMessage({ type: 'rejected', id: message.id, code: answer })
      else port.postMessage({ type: 'scored', id: message.id, logits: answer }, [answer.buffer as ArrayBuffer])
    } catch { port.postMessage({ type: 'rejected', id: message.id, code: 'RUN_FAILED' }) }
  })
})

try {
  loaded = await load()
  const warmup = senseRequest(warmupResult, warmupSelection, loaded.format)
  if ('skip' in warmup) throw new LoadError('MODEL_MISMATCH')
  for (let i = 0; i < 2; i++) await logits(loaded, warmup.prompt)
  port.postMessage({ type: 'ready', format: loaded.format, revision: ETTIN_ENGLISH_INT8.revision })
} catch (error) {
  port.postMessage({ type: 'failed', code: error instanceof LoadError ? error.code : 'LOAD_FAILED' })
}
