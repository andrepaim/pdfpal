import crypto from 'node:crypto'
import os from 'node:os'
import { Worker } from 'node:worker_threads'
import {
  contextualOrder, senseRequest, SENSE_PROMPT_DEFAULTS, type DictionaryResult, type Selection, type SenseFormat,
} from '@andrepaim/contextual-dictionary-core'

// Contextual definition order for the reader's card (opt-in, English only).
// One reusable worker thread holds the model. A lookup made before it is
// ready, or that the model cannot answer within the budget, gets dictionary
// order; nothing here ever fails a lookup. Text stays in this process and
// the worker; the cache keeps only prompt hashes and numbers.

export type ContextualOptions = {
  /** The verified model directory. */
  directory: string
  /** A provisioned runtime directory (holding node_modules), used instead of the app's dependencies when present. */
  runtimeDirectory?: string
  /** How long a lookup waits for a ready model before dictionary order is used. */
  budgetMs?: number
  /** The pause before a failed model is loaded again. */
  retryMs?: number
  loadTimeoutMs?: number
  /** A single prompt taking longer than this stops the worker. */
  runTimeoutMs?: number
  threads?: number
  cacheSize?: number
  /** Tests substitute a worker that speaks the same messages. */
  worker?: { url: URL; data?: Record<string, unknown> }
}
export type ContextualState = 'idle' | 'loading' | 'ready' | 'failed' | 'closed'
export type ContextualStatus = { state: Exclude<ContextualState, 'failed'> } | { state: 'failed'; code: string }

/**
 * The card should appear within 300 ms of a selection. When the model misses
 * its deadline, a repeat lookup can use the late answer from the cache.
 */
export const DEFAULT_BUDGET_MS = 120

type Job = { id: number; key: string; prompt: string; done: boolean; settle(logits: Float32Array | null): void }
type Message = { type: 'ready'; format: SenseFormat } | { type: 'failed'; code: string }
  | { type: 'scored'; id: number; logits: Float32Array } | { type: 'rejected'; id: number; code: string }

// Worker threads do not inherit tsx, so source runs (tests, `npm run dev`) use the
// compiled worker that `npm run build:server` writes.
const defaultWorker = () => new URL(import.meta.url.endsWith('.ts') ? '../../dist/core/sense-worker.js' : './sense-worker.js', import.meta.url)
// Half the logical cores, at most eight: measured faster than four on a large machine, and it leaves room for the reader.
const defaultThreads = () => Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2)))

export class ContextualDefinitions {
  readonly stats = { scored: 0, cached: 0, superseded: 0, timedOut: 0, skipped: 0, applied: 0 }
  private state: ContextualState = 'idle'
  private code = ''
  private failedAt = 0
  private worker: Worker | undefined
  private format: SenseFormat | undefined
  private loadTimer: NodeJS.Timeout | undefined
  private runTimer: NodeJS.Timeout | undefined
  private inflight: Job | undefined
  private queued: Job | undefined
  private waiters: Array<() => void> = []
  private cache = new Map<string, Float32Array>()
  private nextId = 1
  private readonly budgetMs: number
  private readonly retryMs: number
  private readonly loadTimeoutMs: number
  private readonly runTimeoutMs: number
  private readonly cacheSize: number

  constructor(private readonly options: ContextualOptions) {
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
    this.retryMs = options.retryMs ?? 60_000
    this.loadTimeoutMs = options.loadTimeoutMs ?? 120_000
    this.runTimeoutMs = options.runTimeoutMs ?? 10_000
    this.cacheSize = options.cacheSize ?? 64
  }

  status(): ContextualStatus {
    return this.state === 'failed' ? { state: 'failed', code: this.code } : { state: this.state }
  }

  /** Resolves once the model is no longer loading. */
  settled(): Promise<ContextualStatus> {
    if (this.state !== 'loading') return Promise.resolve(this.status())
    return new Promise(resolve => this.waiters.push(() => resolve(this.status())))
  }

  /** Starts loading the model in the background, unless it is loaded, loading, closed or recently failed. */
  warm(): void {
    if (this.state === 'closed' || this.state === 'loading' || this.state === 'ready') return
    if (this.state === 'failed' && Date.now() - this.failedAt < this.retryMs) return
    this.state = 'loading'
    const worker = new Worker(this.options.worker?.url ?? defaultWorker(), {
      workerData: { directory: this.options.directory, runtimeDirectory: this.options.runtimeDirectory, threads: this.options.threads ?? defaultThreads(), ...this.options.worker?.data },
    })
    worker.unref()
    this.worker = worker
    this.loadTimer = setTimeout(() => this.fail(worker, 'LOAD_TIMEOUT'), this.loadTimeoutMs).unref()
    worker.on('message', (message: Message) => this.receive(worker, message))
    worker.on('error', () => this.fail(worker, 'WORKER_ERROR'))
    worker.on('exit', () => this.fail(worker, 'WORKER_EXITED'))
  }

  /**
   * `result` with the senses of each entry in contextual order, or `result`
   * itself whenever the model is not ready, the input is unsupported, the
   * model rejects every sense, the budget runs out or `signal` aborts.
   */
  async order(result: DictionaryResult, selection: Selection, signal?: AbortSignal): Promise<DictionaryResult> {
    if (signal?.aborted || this.state === 'closed') return result
    const format = this.format
    if (this.state !== 'ready' || !format) { this.warm(); return result }
    const request = senseRequest(result, selection, format, SENSE_PROMPT_DEFAULTS.maxCandidates, SENSE_PROMPT_DEFAULTS.maxPromptChars)
    if ('skip' in request) { this.stats.skipped++; return result }
    const key = crypto.createHash('sha256').update(request.prompt).digest('hex')
    let logits = this.cache.get(key)
    if (logits) {
      this.stats.cached++
      this.cache.delete(key); this.cache.set(key, logits)
    } else {
      logits = await this.score(key, request.prompt, signal) ?? undefined
      if (!logits) return result
    }
    const outcome = contextualOrder(result, request, logits, format)
    if (outcome.applied) this.stats.applied++
    return outcome.result
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return
    const worker = this.worker
    this.state = 'closed'
    this.reset()
    if (worker) {
      worker.postMessage({ type: 'close' })
      const exited = new Promise(resolve => worker.once('exit', resolve))
      const timer = setTimeout(() => void worker.terminate(), 500)
      await exited
      clearTimeout(timer)
    }
  }

  private score(key: string, prompt: string, signal?: AbortSignal): Promise<Float32Array | null> {
    return new Promise(resolve => {
      const abort = () => { job.settle(null); if (this.queued === job) this.queued = undefined }
      const timer = setTimeout(() => { if (!job.done) this.stats.timedOut++; abort() }, this.budgetMs)
      const job: Job = {
        id: this.nextId++, key, prompt, done: false,
        settle: logits => {
          if (job.done) return
          job.done = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          resolve(logits)
        },
      }
      signal?.addEventListener('abort', abort, { once: true })
      // Only the newest lookup waits for the model; an older one still queued gets dictionary order now.
      if (this.queued) { this.stats.superseded++; this.queued.settle(null) }
      this.queued = job
      this.pump()
    })
  }

  private pump(): void {
    if (!this.worker || this.state !== 'ready' || this.inflight) return
    const job = this.queued
    this.queued = undefined
    if (!job || job.done) return
    this.inflight = job
    this.stats.scored++
    const worker = this.worker
    this.runTimer = setTimeout(() => this.fail(worker, 'WORKER_TIMEOUT'), this.runTimeoutMs).unref()
    worker.postMessage({ type: 'score', id: job.id, prompt: job.prompt })
  }

  private receive(worker: Worker, message: Message): void {
    if (worker !== this.worker) return
    if (message.type === 'ready') {
      clearTimeout(this.loadTimer)
      this.format = message.format
      this.state = 'ready'
      this.notify()
    } else if (message.type === 'failed') this.fail(worker, message.code)
    else if (this.inflight?.id === message.id) {
      clearTimeout(this.runTimer)
      const job = this.inflight
      this.inflight = undefined
      if (message.type === 'scored') {
        // A late answer still serves the same lookup next time.
        this.cache.set(job.key, message.logits)
        if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!)
        job.settle(message.logits)
      } else job.settle(null)
      this.pump()
    }
  }

  private fail(worker: Worker, code: string): void {
    if (worker !== this.worker || this.state === 'closed') return
    this.state = 'failed'
    this.code = code
    this.failedAt = Date.now()
    this.reset()
    void worker.terminate()
    this.notify()
  }

  private reset(): void {
    clearTimeout(this.loadTimer); clearTimeout(this.runTimer)
    this.worker = undefined
    this.format = undefined
    this.inflight?.settle(null); this.queued?.settle(null)
    this.inflight = this.queued = undefined
    if (this.state === 'closed') this.notify()
  }

  private notify(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}
