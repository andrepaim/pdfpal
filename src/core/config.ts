import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { isCustomAgentModel, MAX_AGENT_MODEL_LENGTH } from '../shared/agent-model-id.js'
import { reasoningEffortSchema } from '../shared/reasoning-effort.js'
import { acquireLease } from './locking.js'
import { defaultSenseCacheDir } from './sense-download.js'

export const agentModelProvider = z.enum(['claude', 'codex'])
export type AgentModelProvider = z.infer<typeof agentModelProvider>
export const agentModelId = z.string().trim().max(MAX_AGENT_MODEL_LENGTH).refine(id => id === '' || isCustomAgentModel(id), 'Enter a valid model ID.')
const agentModelsSchema = z.object({ claude: agentModelId.optional(), codex: agentModelId.optional() })
const modelEffortPatch = z.record(z.string().refine(isCustomAgentModel, 'Enter a valid model ID.'), reasoningEffortSchema)
const agentEffortsSchema = z.object({ claude: modelEffortPatch.optional(), codex: modelEffortPatch.optional() })

const ConfigSchema = z.object({
  dataDir: z.string(),
  dbPath: z.string(),
  filesDir: z.string(),
  backupsDir: z.string(),
  port: z.number().int().positive().max(65535),
  host: z.string(),
  aiMode: z.enum(['agent', 'chatgpt']).default('agent'),
  agent: z.enum(['claude', 'codex', 'opencode']),
  model: z.string(),
  agentModels: agentModelsSchema,
  agentEfforts: agentEffortsSchema,
  claudeBin: z.string(),
  codexBin: z.string(),
  opencodeBin: z.string(),
  semanticScholarApiKey: z.string(),
  // Contextual definition order (English, opt-in): see docs/contextual-definitions.md.
  contextualDefinitions: z.boolean(),
  contextualDefinitionsBudgetMs: z.number().int().min(20).max(1000),
  senseModelDir: z.string(),
  senseRuntimeDir: z.string(),
  /** The per-user cache of downloaded models and runtimes, shared by every library. */
  senseCacheDir: z.string(),
})

export type PdfpalConfig = z.infer<typeof ConfigSchema>

type ConfigFile = Partial<{
  ai_mode: 'agent' | 'chatgpt'
  port: number
  agent: PdfpalConfig['agent']
  model: string
  agent_models: PdfpalConfig['agentModels']
  agent_efforts: PdfpalConfig['agentEfforts']
  claude_bin: string
  codex_bin: string
  opencode_bin: string
  semantic_scholar_api_key: string
  contextual_definitions: boolean
  contextual_definitions_budget_ms: number
  sense_model_dir: string
  sense_runtime_dir: string
  sense_cache_dir: string
}>

/** A lookup budget in milliseconds, kept within 20-1000; anything else is undefined. */
function budget(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? Math.min(1000, Math.max(20, Math.round(number))) : undefined
}

/** "1"/"true"/"on" and "0"/"false"/"off"; anything else, including an unset variable, is undefined. */
export function envFlag(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  return ['1', 'true', 'on', 'yes'].includes(normalized)
}

function parseLegacy(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    const key = match[1]!
    let value = match[2]!
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    result[key] = value
  }
  return result
}

export function loadConfig(overrides: Partial<PdfpalConfig> = {}): PdfpalConfig {
  const dataDir = overrides.dataDir ?? process.env.PDFPAL_DATA_DIR ?? path.join(os.homedir(), '.pdfpal')
  fs.mkdirSync(dataDir, { recursive: true })
  const configPath = path.join(dataDir, 'config.json')
  const legacyPath = path.join(dataDir, 'config.env')
  let file: ConfigFile = {}
  if (fs.existsSync(configPath)) {
    file = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ConfigFile
  } else if (fs.existsSync(legacyPath)) {
    const legacy = parseLegacy(fs.readFileSync(legacyPath, 'utf8'))
    file = {
      port: legacy.PDFPAL_PORT ? Number(legacy.PDFPAL_PORT) : undefined,
      agent: legacy.PDFPAL_AGENT as ConfigFile['agent'],
      model: legacy.PDFPAL_MODEL,
      claude_bin: legacy.CLAUDE_BIN,
      codex_bin: legacy.CODEX_BIN,
      opencode_bin: legacy.OPENCODE_BIN,
    }
    fs.writeFileSync(configPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  }

  const envPort = process.env.PDFPAL_PORT ? Number(process.env.PDFPAL_PORT) : undefined
  return ConfigSchema.parse({
    dataDir,
    dbPath: overrides.dbPath ?? process.env.PDFPAL_DB ?? path.join(dataDir, 'pdfpal.db'),
    filesDir: overrides.filesDir ?? path.join(dataDir, 'files'),
    backupsDir: overrides.backupsDir ?? path.join(dataDir, 'backups'),
    port: overrides.port ?? envPort ?? file.port ?? 8200,
    host: overrides.host ?? '127.0.0.1',
    aiMode: overrides.aiMode ?? (process.env.PDFPAL_AGENT ? 'agent' : file.ai_mode) ?? 'agent',
    agent: overrides.agent ?? process.env.PDFPAL_AGENT ?? file.agent ?? 'claude',
    model: overrides.model ?? process.env.PDFPAL_MODEL ?? file.model ?? '',
    agentModels: overrides.agentModels ?? file.agent_models ?? {},
    agentEfforts: overrides.agentEfforts ?? file.agent_efforts ?? {},
    claudeBin: overrides.claudeBin ?? process.env.CLAUDE_BIN ?? file.claude_bin ?? 'claude',
    codexBin: overrides.codexBin ?? process.env.CODEX_BIN ?? file.codex_bin ?? 'codex',
    opencodeBin: overrides.opencodeBin ?? process.env.OPENCODE_BIN ?? file.opencode_bin ?? 'opencode',
    semanticScholarApiKey: overrides.semanticScholarApiKey ?? process.env.SEMANTIC_SCHOLAR_API_KEY ?? file.semantic_scholar_api_key ?? '',
    contextualDefinitions: overrides.contextualDefinitions ?? envFlag(process.env.PDFPAL_CONTEXTUAL_DEFINITIONS) ?? file.contextual_definitions === true,
    contextualDefinitionsBudgetMs: overrides.contextualDefinitionsBudgetMs ?? budget(process.env.PDFPAL_CONTEXTUAL_DEFINITIONS_BUDGET_MS) ?? budget(file.contextual_definitions_budget_ms) ?? 120,
    senseModelDir: overrides.senseModelDir ?? (process.env.PDFPAL_SENSE_MODEL_DIR || undefined) ?? file.sense_model_dir ?? path.join(dataDir, 'models', 'ettin-150m-wsd-int8'),
    senseRuntimeDir: overrides.senseRuntimeDir ?? (process.env.PDFPAL_SENSE_RUNTIME_DIR || undefined) ?? file.sense_runtime_dir ?? path.join(dataDir, 'models', 'sense-runtime'),
    senseCacheDir: overrides.senseCacheDir ?? (process.env.PDFPAL_SENSE_CACHE_DIR || undefined) ?? file.sense_cache_dir ?? defaultSenseCacheDir(),
  })
}

export function ensureDataDirectories(config: PdfpalConfig): void {
  for (const dir of [config.dataDir, config.filesDir, config.backupsDir]) fs.mkdirSync(dir, { recursive: true })
}

export function defaultAgentModel(config: PdfpalConfig, agent: PdfpalConfig['agent']): string {
  // Missing preferences inherit the legacy global model. An empty preference delegates model selection to the CLI.
  return (agent === 'opencode' ? undefined : config.agentModels?.[agent]) ?? config.model
}

export function saveAgentPreference(config: PdfpalConfig, agent: PdfpalConfig['agent']): void {
  const value = ConfigSchema.shape.agent.parse(agent)
  const filename = path.join(config.dataDir, 'config.json')
  const release = acquireLease(`${filename}.write-lock`, 5000)
  try {
    const existing = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {}
    const temporary = `${filename}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify({ ...existing, agent: value }, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, filename)
    // Environment overrides keep the same precedence as the CLI.
    config.agent = process.env.PDFPAL_AGENT ? ConfigSchema.shape.agent.parse(process.env.PDFPAL_AGENT) : value
  } finally { release() }
}

/** Preserve unrelated settings when a user explicitly chooses an executable. */
export function saveAgentBinary(config: PdfpalConfig, agent: 'claude' | 'codex', executable: string): void {
  const key = agent === 'claude' ? 'claude_bin' : 'codex_bin'
  if (process.env[agent === 'claude' ? 'CLAUDE_BIN' : 'CODEX_BIN']) throw new Error('The executable is fixed by your startup configuration.')
  const filename = path.join(config.dataDir, 'config.json')
  const release = acquireLease(`${filename}.write-lock`, 5000)
  try {
    const existing = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {}
    const temporary = `${filename}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify({ ...existing, [key]: executable }, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, filename)
    if (agent === 'claude') config.claudeBin = executable
    else config.codexBin = executable
  } finally { release() }
}

/** Save the assistant, model, and effort preferences together under the config write lock. */
export function saveAIModePreference(config: PdfpalConfig, selected: 'chatgpt' | PdfpalConfig['agent'], model?: string, efforts?: Record<string, string>): string {
  if (!['chatgpt', 'claude', 'codex', 'opencode'].includes(selected)) throw new Error('Unknown AI provider')
  if (process.env.PDFPAL_AGENT && selected !== process.env.PDFPAL_AGENT) throw new Error('Your startup configuration fixes the AI provider. Update PDFPAL_AGENT to change it.')
  const modelAgent = agentModelProvider.safeParse(selected)
  if (model !== undefined && !modelAgent.success) throw new Error('Model selection is unavailable for this assistant.')
  if (efforts !== undefined && !modelAgent.success) throw new Error('Reasoning effort is unavailable for this assistant.')
  const modelChange = model === undefined ? undefined : { [selected]: agentModelId.parse(model) }
  const effortPatch = efforts === undefined ? undefined : modelEffortPatch.parse(efforts)
  const filename = path.join(config.dataDir, 'config.json')
  const release = acquireLease(`${filename}.write-lock`, 5000)
  try {
    const existing: ConfigFile = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {}
    const aiMode = selected === 'chatgpt' ? 'chatgpt' : 'agent'
    const temporary = `${filename}.${process.pid}.tmp`
    let updatedEfforts: PdfpalConfig['agentEfforts'] | undefined
    if (modelAgent.success && effortPatch && Object.keys(effortPatch).length) {
      const provider = modelAgent.data
      const storedEfforts = { ...existing.agent_efforts?.[provider] }
      for (const [id, effort] of Object.entries(effortPatch)) {
        if (effort) storedEfforts[id] = effort
        else delete storedEfforts[id]
      }
      updatedEfforts = { ...existing.agent_efforts, [provider]: storedEfforts }
    }
    const updated = {
      ...existing,
      ai_mode: aiMode,
      ...(selected !== 'chatgpt' ? { agent: selected } : {}),
      ...(modelChange ? { agent_models: { ...existing.agent_models, ...modelChange } } : {}),
      ...(updatedEfforts ? { agent_efforts: updatedEfforts } : {}),
    }
    try {
      fs.writeFileSync(temporary, JSON.stringify(updated), { mode: 0o600 })
      fs.renameSync(temporary, filename)
    } finally { fs.rmSync(temporary, { force: true }) }
    config.aiMode = aiMode
    if (selected !== 'chatgpt') config.agent = selected
    if (modelChange) config.agentModels = { ...config.agentModels, ...modelChange }
    if (updatedEfforts) config.agentEfforts = { ...config.agentEfforts, ...updatedEfforts }
    return selected
  } finally { release() }
}

/** Turns contextual definition order on or off in config.json; the environment still takes precedence at startup. */
export function saveContextualDefinitionsPreference(config: PdfpalConfig, enabled: boolean): void {
  const filename = path.join(config.dataDir, 'config.json'), release = acquireLease(`${filename}.write-lock`, 5000)
  try {
    const existing = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {}
    const temporary = `${filename}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify({ ...existing, contextual_definitions: enabled }, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, filename)
    config.contextualDefinitions = envFlag(process.env.PDFPAL_CONTEXTUAL_DEFINITIONS) ?? enabled
  } finally { release() }
}
