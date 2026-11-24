import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { discoverAgent, refreshWindowsPath, runProbe } from './agent-discovery.js'
import { agentModelId, type AgentModelProvider } from './config.js'

const maxCatalogBytes = 4 * 1024 * 1024
const catalogSchema = z.object({ models: z.array(z.unknown()) })
const entrySchema = z.object({ slug: agentModelId, display_name: z.string().optional(), visibility: z.literal('list') })
type ModelOption = { id: string; name: string }

function parseCatalog(text: string): ModelOption[] {
  try {
    const catalog = catalogSchema.parse(JSON.parse(text))
    const choices = new Map<string, ModelOption>()
    for (const entry of catalog.models) {
      const match = entrySchema.safeParse(entry)
      if (!match.success) continue
      const { slug: id, display_name: label } = match.data
      if (!id || choices.has(id)) continue
      const name = label?.trim()
      choices.set(id, { id, name: name && name.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(name) ? name : id })
      if (choices.size === 100) break
    }
    return [...choices.values()]
  } catch { return [] }
}

async function cachedCodexModels(): Promise<ModelOption[]> {
  const filename = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json')
  try {
    const stat = await fs.stat(filename)
    if (!stat.isFile() || stat.size > maxCatalogBytes) return []
    const handle = await fs.open(filename, 'r')
    try {
      const buffer = Buffer.alloc(stat.size + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return bytesRead <= stat.size ? parseCatalog(buffer.toString('utf8', 0, bytesRead)) : []
    } finally { await handle.close() }
  } catch { return [] }
}

export async function discoverAgentModels(agent: AgentModelProvider, binary: string, signal: AbortSignal): Promise<ModelOption[]> {
  if (agent === 'claude') {
    await refreshWindowsPath(signal)
    const status = await discoverAgent('claude', binary, signal, { checkAuth: false, includeHelp: true })
    const choices = [{ id: 'sonnet', name: 'Sonnet' }, { id: 'opus', name: 'Opus' }, { id: 'haiku', name: 'Haiku' }]
    const modelHelp = status.help?.match(/(?:^|\n)[ \t]*--model\b[^\r\n]*(?:\r?\n[ \t]+[^\s-][^\r\n]*)*/i)?.[0]
    if (/['"]fable['"]/i.test(modelHelp ?? '')) choices.push({ id: 'fable', name: 'Fable' })
    return choices
  }

  // Prefer the account-specific catalog Codex has already fetched. The bundled command is an offline fallback.
  const cached = await cachedCodexModels()
  if (cached.length || signal.aborted) return cached
  await refreshWindowsPath(signal)
  const status = await discoverAgent('codex', binary, signal, { checkAuth: false })
  if (status.state !== 'installed') return []
  const result = await runProbe(status.executable, ['debug', 'models', '--bundled'], { signal, maxBytes: maxCatalogBytes })
  return result.code === 0 ? parseCatalog(result.stdout) : []
}
