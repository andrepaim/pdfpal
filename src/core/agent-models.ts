import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { discoverAgent, refreshWindowsPath, runProbe } from './agent-discovery.js'
import { agentModelId, type AgentModelProvider } from './config.js'
import { parseEffortCapabilities } from '../shared/reasoning-effort.js'

const maxCatalogBytes = 4 * 1024 * 1024
const catalogSchema = z.object({ models: z.array(z.unknown()) })
const minimumClientSchema = z.object({ minimal_client_version: z.tuple([z.int().nonnegative(), z.int().nonnegative(), z.int().nonnegative()]).nullish() })
const entrySchema = z.object({ slug: agentModelId, display_name: z.string().optional(), visibility: z.literal('list') })
type ModelOption = { id: string; name: string; efforts?: string[]; defaultEffort?: string }
type InstalledAgent = Extract<Awaited<ReturnType<typeof discoverAgent>>, { state: 'installed' }>

function atLeast(version: string, minimum: readonly number[]): boolean {
  const actual = version.split(/[-+]/, 1)[0]!.split('.').map(Number)
  const different = minimum.findIndex((value, index) => value !== actual[index])
  return different === -1 || actual[different]! > minimum[different]!
}

function parseCatalog(text: string, version?: string): ModelOption[] {
  try {
    const catalog = catalogSchema.parse(JSON.parse(text))
    const choices = new Map<string, ModelOption>()
    for (const entry of catalog.models) {
      const match = entrySchema.safeParse(entry)
      if (!match.success) continue
      const { slug: id, display_name: label } = match.data
      if (!id || choices.has(id)) continue
      const name = label?.trim()
      const option: ModelOption = { id, name: name && name.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(name) ? name : id }
      const minimum = minimumClientSchema.safeParse(entry)
      if (version && minimum.success && (!minimum.data.minimal_client_version || atLeast(version, minimum.data.minimal_client_version))) {
        const { efforts, defaultEffort } = parseEffortCapabilities(entry)
        // Codex Ultra activates delegation unless the CLI can disable both agent implementations.
        const allowed = efforts?.filter(effort => effort !== 'ultra' || atLeast(version, [0, 164, 0]))
        if (allowed?.length) option.efforts = allowed
        if (defaultEffort && allowed?.includes(defaultEffort)) option.defaultEffort = defaultEffort
      }
      choices.set(id, option)
      if (choices.size === 100) break
    }
    return [...choices.values()]
  } catch { return [] }
}

async function cachedCodexModels(version?: string): Promise<ModelOption[]> {
  const filename = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json')
  try {
    const stat = await fs.stat(filename)
    if (!stat.isFile() || stat.size > maxCatalogBytes) return []
    const handle = await fs.open(filename, 'r')
    try {
      const buffer = Buffer.alloc(stat.size + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return bytesRead <= stat.size ? parseCatalog(buffer.toString('utf8', 0, bytesRead), version) : []
    } finally { await handle.close() }
  } catch { return [] }
}

// Use documented Claude Code alias/version boundaries and intersect each model's
// capabilities with the installed CLI flag. Third-party deployments can resolve
// these aliases to different models. See https://code.claude.com/docs/en/model-config.
const claudeAliases = {
  sonnet: { name: 'Sonnet', minimum: [2, 1, 197], mediumSince: [2, 1, 284] },
  opus: { name: 'Opus', minimum: [2, 1, 154], mediumSince: [2, 1, 280] },
  haiku: { name: 'Haiku', minimum: [2, 1, 293], mediumSince: [2, 1, 293] },
  fable: { name: 'Fable', minimum: [2, 1, 257], mediumSince: [2, 1, 321] },
}
const claudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max']

function optionHelp(help: string, flag: string): string {
  const option = new RegExp(`(?:^|\\n)[ \\t]*--${flag}\\b[^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\s-][^\\r\\n]*)*`, 'i')
  return help.match(option)?.[0] ?? ''
}

function claudeModels(status?: InstalledAgent): ModelOption[] {
  const help = status?.help ?? ''
  const modelHelp = optionHelp(help, 'model')
  const effortHelp = optionHelp(help, 'effort')
  const advertised: string[] = effortHelp.match(/\b[a-z]+\b/g) ?? []
  const levels = claudeEfforts.filter(effort => advertised.includes(effort))
  const customProvider = ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE'].some(key => process.env[key] && process.env[key] !== '0')
  const fixedEffort = !!process.env.CLAUDE_CODE_EFFORT_LEVEL
  return Object.entries(claudeAliases).flatMap(([id, { name, minimum, mediumSince }]) => {
    if (id === 'fable' && !/['"]fable['"]/i.test(modelHelp)) return []
    const option: ModelOption = { id, name }
    const aliasOverride = process.env[`ANTHROPIC_DEFAULT_${id.toUpperCase()}_MODEL`]
    if (status && levels.length && !fixedEffort && !customProvider && !aliasOverride && atLeast(status.version, minimum)) {
      option.efforts = levels
      const defaultEffort = atLeast(status.version, mediumSince) ? 'medium' : 'high'
      if (levels.includes(defaultEffort)) option.defaultEffort = defaultEffort
    }
    return [option]
  })
}

export async function modelsForInstalledAgent(agent: AgentModelProvider, status: InstalledAgent | undefined, signal: AbortSignal): Promise<ModelOption[]> {
  if (signal.aborted) return []
  if (agent === 'claude') return claudeModels(status)
  // Prefer the account-specific catalog Codex has already fetched. The bundled command is an offline fallback.
  const cached = await cachedCodexModels(status?.version)
  if (cached.length || signal.aborted || !status) return cached
  const result = await runProbe(status.executable, ['debug', 'models', '--bundled'], { signal, maxBytes: maxCatalogBytes })
  return result.code === 0 ? parseCatalog(result.stdout, status.version) : []
}

export async function discoverAgentModels(agent: AgentModelProvider, binary: string, signal: AbortSignal): Promise<ModelOption[]> {
  await refreshWindowsPath(signal)
  const status = await discoverAgent(agent, binary, signal, { checkAuth: false, includeHelp: agent === 'claude' })
  return modelsForInstalledAgent(agent, status.state === 'installed' ? status : undefined, signal)
}
