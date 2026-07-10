import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

const ConfigSchema = z.object({
  dataDir: z.string(),
  dbPath: z.string(),
  filesDir: z.string(),
  backupsDir: z.string(),
  port: z.number().int().positive().max(65535),
  host: z.string(),
  agent: z.enum(['claude', 'codex', 'opencode']),
  model: z.string(),
  claudeBin: z.string(),
  codexBin: z.string(),
  opencodeBin: z.string(),
  tavilyApiKey: z.string(),
})

export type PdfpalConfig = z.infer<typeof ConfigSchema>

type ConfigFile = Partial<{
  port: number
  agent: PdfpalConfig['agent']
  model: string
  claude_bin: string
  codex_bin: string
  opencode_bin: string
  tavily_api_key: string
}>

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
      tavily_api_key: legacy.TAVILY_API_KEY,
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
    agent: overrides.agent ?? process.env.PDFPAL_AGENT ?? file.agent ?? 'claude',
    model: overrides.model ?? process.env.PDFPAL_MODEL ?? file.model ?? '',
    claudeBin: overrides.claudeBin ?? process.env.CLAUDE_BIN ?? file.claude_bin ?? 'claude',
    codexBin: overrides.codexBin ?? process.env.CODEX_BIN ?? file.codex_bin ?? 'codex',
    opencodeBin: overrides.opencodeBin ?? process.env.OPENCODE_BIN ?? file.opencode_bin ?? 'opencode',
    tavilyApiKey: overrides.tavilyApiKey ?? process.env.TAVILY_API_KEY ?? file.tavily_api_key ?? '',
  })
}

export function ensureDataDirectories(config: PdfpalConfig): void {
  for (const dir of [config.dataDir, config.filesDir, config.backupsDir]) fs.mkdirSync(dir, { recursive: true })
}
