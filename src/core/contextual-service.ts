import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { envFlag, saveContextualDefinitionsPreference, type PdfpalConfig } from './config.js'
import { ContextualDefinitions, type ContextualOptions } from './contextual-definitions.js'
import { ETTIN_ENGLISH_INT8, MODEL_FOLDER, platformTag, type ModelIdentity, type RuntimeIdentity } from './sense-model.js'
import { SENSE_RUNTIME } from './sense-runtime-manifest.js'
import { bundleUrl, DownloadError, installBundle, loadDownloadAssets, modelTarget, runtimeTarget, type Bundle, type DownloadAssets, type Fetch, type InstallTarget } from './sense-download.js'

// The reader's "Order meanings by context" setting for one library: its
// saved preference, where the model and runtime come from, the one-time
// download into the per-user cache, and the model worker. Lookups never
// wait on any of this; they use whatever worker is ready.

export type ContextualServiceOptions = {
  fetch?: Fetch
  /** The release manifest; undefined loads it from the build, null means none. */
  assets?: DownloadAssets | null
  modelIdentity?: ModelIdentity
  runtimeIdentity?: RuntimeIdentity
  platform?: string
  /** Whether onnxruntime-node and the tokenizer can be loaded from pdfpal's own dependencies. */
  packageRuntime?: boolean
  worker?: ContextualOptions['worker']
}
export type ContextualPhase = 'off' | 'unavailable' | 'needs_download' | 'downloading' | 'installing' | 'loading' | 'ready' | 'failed'
export type Source = 'override' | 'library' | 'cache'
export type ContextualStatus = {
  enabled: boolean
  /** The PDFPAL_CONTEXTUAL_DEFINITIONS environment variable fixes the setting. */
  locked: boolean
  language: 'en'
  state: ContextualPhase
  error: string | null
  model_source: Source | null
  runtime_source: Source | 'bundled' | null
  download: { required_bytes: number | null; received_bytes: number; total_bytes: number }
}

export class ContextualError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409, readonly details?: Record<string, unknown>) { super(message) }
}

type Job = { controller: AbortController; received: number; total: number; phase: 'downloading' | 'installing' }
type Piece = { target: InstallTarget; bundle: Bundle | undefined }
/** Worker failures that a fresh download of a cached copy repairs. */
const REPAIRABLE = new Set(['MODEL_MISMATCH', 'MODEL_MISSING', 'RUNTIME_MISMATCH', 'RUNTIME_MISSING'])

function packageRuntimeAvailable(): boolean {
  try {
    const local = createRequire(import.meta.url)
    local.resolve('onnxruntime-node'); local.resolve('@huggingface/tokenizers')
    return true
  } catch { return false }
}

export class ContextualService {
  private enabled: boolean
  private readonly locked: boolean
  private assets: DownloadAssets | undefined
  private ranker: ContextualDefinitions | undefined
  private rankerKey = ''
  private job: Job | undefined
  private lastError: string | null = null
  private closed = false
  private readonly platform: string
  private readonly modelIdentity: ModelIdentity
  private readonly runtimeIdentity: RuntimeIdentity
  private readonly packageRuntime: boolean

  constructor(private readonly config: PdfpalConfig, private readonly options: ContextualServiceOptions = {}) {
    this.locked = envFlag(process.env.PDFPAL_CONTEXTUAL_DEFINITIONS) !== undefined
    this.enabled = config.contextualDefinitions
    this.platform = options.platform ?? platformTag()
    this.modelIdentity = options.modelIdentity ?? ETTIN_ENGLISH_INT8
    this.runtimeIdentity = options.runtimeIdentity ?? SENSE_RUNTIME
    this.packageRuntime = options.packageRuntime ?? packageRuntimeAvailable()
  }

  async init(): Promise<void> {
    this.assets = this.options.assets === undefined ? await loadDownloadAssets() : this.options.assets ?? undefined
    if (this.enabled) this.start()
  }

  /** The worker that orders lookups, when the setting is on and the files are present. */
  current(): ContextualDefinitions | undefined { return this.enabled ? this.ranker : undefined }

  /** Where the model and runtime come from: an explicit or library install first, then the per-user cache. */
  private sources() {
    const libraryModel = path.join(this.config.dataDir, 'models', MODEL_FOLDER)
    const libraryRuntime = path.join(this.config.dataDir, 'models', 'sense-runtime')
    const model: Piece = { target: modelTarget(this.config.senseCacheDir, this.modelIdentity), bundle: this.assets?.model }
    const runtimeCache = runtimeTarget(this.config.senseCacheDir, this.runtimeIdentity, this.platform)
    const runtime: Piece | undefined = runtimeCache && { target: runtimeCache, bundle: this.assets?.runtimes[this.platform] }
    const modelDirectory = fs.existsSync(path.join(this.config.senseModelDir, 'model_metadata.json'))
      ? { directory: this.config.senseModelDir, source: (path.resolve(this.config.senseModelDir) === path.resolve(libraryModel) ? 'library' : 'override') as Source }
      : fs.existsSync(model.target.directory) ? { directory: model.target.directory, source: 'cache' as Source } : undefined
    const runtimeDirectory = fs.existsSync(path.join(this.config.senseRuntimeDir, 'node_modules'))
      ? { directory: this.config.senseRuntimeDir, source: (path.resolve(this.config.senseRuntimeDir) === path.resolve(libraryRuntime) ? 'library' : 'override') as Source | 'bundled' }
      : runtime && fs.existsSync(runtime.target.directory) ? { directory: runtime.target.directory, source: 'cache' as Source | 'bundled' }
        : this.packageRuntime ? { directory: undefined, source: 'bundled' as Source | 'bundled' } : undefined
    // A cached copy the worker found altered can be downloaded again.
    const failed = this.ranker?.status()
    const code = failed?.state === 'failed' ? failed.code : ''
    const repairModel = REPAIRABLE.has(code) && code.startsWith('MODEL') && modelDirectory?.source === 'cache'
    const repairRuntime = REPAIRABLE.has(code) && code.startsWith('RUNTIME') && runtimeDirectory?.source === 'cache'
    const needed: Piece[] = []
    if (!modelDirectory || repairModel) needed.push(model)
    if (!runtimeDirectory || repairRuntime) needed.push(runtime ?? { target: model.target, bundle: undefined })
    const required = needed.some(piece => !piece.bundle) ? null : needed.reduce((sum, piece) => sum + piece.bundle!.size, 0)
    return { modelDirectory, runtimeDirectory, needed, required }
  }

  status(): ContextualStatus {
    const { modelDirectory, runtimeDirectory, needed, required } = this.sources()
    const job = this.job
    let state: ContextualPhase
    let error = this.lastError
    if (job) state = job.phase
    else if (!this.enabled) state = needed.length && required === null ? 'unavailable' : error && error !== 'DOWNLOAD_CANCELLED' ? 'failed' : 'off'
    else if (needed.length && !this.ranker) state = required === null ? 'unavailable' : error && error !== 'DOWNLOAD_CANCELLED' ? 'failed' : 'needs_download'
    else {
      const ranker = this.ranker?.status()
      state = !ranker || ranker.state === 'idle' || ranker.state === 'loading' ? 'loading' : ranker.state === 'ready' ? 'ready' : 'failed'
      if (ranker?.state === 'failed') error = ranker.code
    }
    return {
      enabled: this.enabled, locked: this.locked, language: 'en', state, error,
      model_source: modelDirectory?.source ?? null, runtime_source: runtimeDirectory?.source ?? null,
      download: { required_bytes: required, received_bytes: job?.received ?? 0, total_bytes: job?.total ?? 0 },
    }
  }

  async setEnabled(enabled: boolean): Promise<ContextualStatus> {
    if (this.locked) throw new ContextualError('SETTING_LOCKED', 'Your startup configuration (PDFPAL_CONTEXTUAL_DEFINITIONS) fixes this setting.')
    if (!enabled) {
      this.cancel(null)
      this.save(false)
      await this.stop()
      this.lastError = null
      return this.status()
    }
    const { needed, required } = this.sources()
    if (needed.length) {
      if (required === null) throw new ContextualError('DOWNLOAD_UNAVAILABLE', 'Contextual order is not available for this platform or build.')
      throw new ContextualError('DOWNLOAD_REQUIRED', 'The model has to be downloaded first.', 409, { required_bytes: required })
    }
    this.lastError = null
    this.activate()
    return this.status()
  }

  /** Saves the preference and starts the worker; a failure is reported and can be retried. */
  private activate(): void {
    try {
      if (!this.locked) this.save(true)
      this.start()
    } catch {
      this.lastError = 'ACTIVATION_FAILED'
      throw new ContextualError('ACTIVATION_FAILED', 'The setting could not be saved or the model could not be started. Try again.', 500)
    }
  }

  /** Starts the one-time download the reader confirmed. `acceptBytes` must match the size it showed. */
  startDownload(acceptBytes: number): ContextualStatus {
    if (this.locked && !this.enabled) throw new ContextualError('SETTING_LOCKED', 'Your startup configuration (PDFPAL_CONTEXTUAL_DEFINITIONS) turns this setting off.')
    if (this.job) return this.status()
    const { needed, required } = this.sources()
    if (required === null) throw new ContextualError('DOWNLOAD_UNAVAILABLE', 'Contextual order is not available for this platform or build.')
    if (acceptBytes !== required) throw new ContextualError('DOWNLOAD_SIZE_CHANGED', 'The download size changed. Review it and confirm again.', 409, { required_bytes: required })
    if (!needed.length) { this.lastError = null; this.activate(); return this.status() }
    const job: Job = { controller: new AbortController(), received: 0, total: required, phase: 'downloading' }
    this.job = job
    this.lastError = null
    void this.run(job, needed)
    return this.status()
  }

  cancelDownload(): ContextualStatus {
    this.cancel('DOWNLOAD_CANCELLED')
    return this.status()
  }

  private cancel(error: string | null): void {
    if (!this.job) return
    this.job.controller.abort()
    this.job = undefined
    this.lastError = error
  }

  private async run(job: Job, needed: Piece[]): Promise<void> {
    try {
      // A worker holding an altered or incomplete cached copy is stopped before it is replaced.
      if (this.ranker?.status().state === 'failed') await this.stop()
      let done = 0
      for (const piece of needed) {
        const bundle = piece.bundle!
        await installBundle(piece.target, {
          url: bundleUrl(this.assets!.tag, bundle), bundle, fetch: this.options.fetch ?? fetch, signal: job.controller.signal,
          onProgress: received => { job.received = done + received; if (job.received >= job.total) job.phase = 'installing' },
        })
        done += bundle.size
        job.received = done
      }
    } catch (error) {
      if (this.job !== job) return
      this.job = undefined
      this.lastError = error instanceof DownloadError ? error.code : 'INSTALL_FAILED'
      return
    }
    if (this.job !== job || this.closed) return
    // The files are in the cache; turning the setting on can still fail and be retried without downloading.
    try { this.activate() } catch { /* lastError is ACTIVATION_FAILED */ } finally { if (this.job === job) this.job = undefined }
  }

  private save(enabled: boolean): void {
    saveContextualDefinitionsPreference(this.config, enabled)
    this.enabled = enabled
  }

  /** Starts (or keeps) the worker for the current sources. */
  private start(): void {
    if (this.closed) return
    const { modelDirectory, runtimeDirectory } = this.sources()
    if (!modelDirectory || !runtimeDirectory) return
    const key = `${modelDirectory.directory}\0${runtimeDirectory.directory ?? ''}`
    if (this.ranker && this.rankerKey === key && this.ranker.status().state !== 'failed') { this.ranker.warm(); return }
    void this.ranker?.close()
    this.rankerKey = key
    this.ranker = new ContextualDefinitions({
      directory: modelDirectory.directory, runtimeDirectory: runtimeDirectory.directory,
      budgetMs: this.config.contextualDefinitionsBudgetMs, worker: this.options.worker,
    })
    this.ranker.warm()
  }

  private async stop(): Promise<void> {
    const ranker = this.ranker
    this.ranker = undefined
    this.rankerKey = ''
    await ranker?.close()
  }

  async close(): Promise<void> {
    this.closed = true
    this.cancel(null)
    await this.stop()
  }
}
