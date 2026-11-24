import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultAgentModel, type AgentModelProvider, type PdfpalConfig } from './config.js'
import { PdfpalError } from './types.js'
import { agentCandidates, discoverAgent, runProbe, refreshWindowsPath } from './agent-discovery.js'
import { discoverAgentModels, modelsForInstalledAgent } from './agent-models.js'
import { reasoningEffortSchema } from '../shared/reasoning-effort.js'

export type AgentName = 'claude' | 'codex' | 'opencode'

function commandAvailable(binary: string): boolean {
  if (path.isAbsolute(binary)) return fs.existsSync(binary)
  const command = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(command, [binary], { stdio: 'ignore', windowsHide: true, timeout: 1500 }).status === 0
}

export class AgentService {
  private static stopping = false
  static resume(): void { this.stopping = false }
  static stopAccepting(): void { this.stopping = true }
  private static readonly requests = new Map<AbortController, Promise<unknown>>()
  private static readonly inspections = new Map<AbortController, Promise<unknown>>()
  private claudeModelCache?: { binary: string; expires: number; request: ReturnType<typeof discoverAgentModels> }
  static get activeCount(): number { return this.requests.size }
  static async cancelAll(): Promise<void> {
    const pending = [...this.requests.values(), ...this.inspections.values()]
    for (const controller of [...this.requests.keys(), ...this.inspections.keys()]) controller.abort()
    await Promise.allSettled(pending)
  }

  inspect() {
    return this.trackInspection(signal => this.inspectWithSignal(signal))
  }

  models(agent: AgentModelProvider) {
    const binary = this.binary(agent)
    const discover = () => this.trackInspection(signal => discoverAgentModels(agent, binary, signal))
    if (agent === 'codex' || AgentService.stopping) return discover()
    const cached = this.claudeModelCache
    const now = Date.now()
    if (cached?.binary === binary && now < cached.expires) return cached.request
    const request = discover()
    this.claudeModelCache = { binary, expires: now + 30_000, request }
    return request
  }

  private trackInspection<T>(inspect: (signal: AbortSignal) => Promise<T[]>): Promise<T[]> {
    if (AgentService.stopping) return Promise.resolve([])
    const controller = new AbortController()
    const request = inspect(controller.signal)
    AgentService.inspections.set(controller, request)
    return request.finally(() => AgentService.inspections.delete(controller))
  }

  private async inspectWithSignal(signal: AbortSignal) {
    await refreshWindowsPath(signal)
    const agents = this.list()
    return Promise.all(agents.map(async item => {
      if (process.platform === 'win32' && item.id === 'opencode') return item
      const status = await discoverAgent(item.id, this.binary(item.id), signal)
      let modified: number | undefined
      try { if (status.executable) modified = fs.statSync(status.executable).mtimeMs } catch {}
      const fingerprint = createHash('sha256').update(JSON.stringify([status.executable, modified, status.version, status.auth])).digest('hex')
      return { ...item, available: status.state === 'installed', state: status.state, version: status.version, auth: status.auth, fingerprint }
    }))
  }

  constructor(private readonly config: PdfpalConfig) {}

  list(): Array<{ id: AgentName; label: string; available: boolean }> {
    return (['claude', 'codex', 'opencode'] as AgentName[]).map(id => ({
      id,
      label: id[0]!.toUpperCase() + id.slice(1),
      available: process.platform !== 'win32' || id !== 'opencode'
        ? agentCandidates(id, { binary: this.binary(id) }).some(file => {
          try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile() } catch { return false }
        })
        : commandAvailable(this.binary(id)),
    }))
  }

  private binary(agent: AgentName): string {
    return agent === 'claude' ? this.config.claudeBin : agent === 'codex' ? this.config.codexBin : this.config.opencodeBin
  }

  invoke(prompt: string, agent = this.config.agent, model = defaultAgentModel(this.config, agent), options: { signal?: AbortSignal; timeoutMs?: number; effort?: string } = {}): Promise<string> {
    if (AgentService.stopping) return Promise.reject(new PdfpalError('AGENT_CANCELLED', 'pdfpal is shutting down.'))
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (options.signal?.aborted) abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const request = this.run(prompt, agent, model, controller.signal, options)
    AgentService.requests.set(controller, request)
    return request.finally(() => { AgentService.requests.delete(controller); options.signal?.removeEventListener('abort', abort) })
  }

  private async run(prompt: string, agent: AgentName, model: string, signal: AbortSignal, { timeoutMs = 300_000, effort: override }: { timeoutMs?: number; effort?: string }): Promise<string> {
    const unsupportedEffort = () => new PdfpalError('UNSUPPORTED_EFFORT', 'This reasoning effort is unavailable for the selected model. Choose one of its supported levels or use Automatic.', 2)
    if (override && (agent === 'opencode' || !model || !reasoningEffortSchema.safeParse(override).success)) throw unsupportedEffort()
    const defaults = agent === 'opencode' ? undefined : this.config.agentEfforts[agent]
    let effort = override ?? (defaults && Object.hasOwn(defaults, model) ? defaults[model] : undefined)
    let binary = this.binary(agent)
    if (process.platform !== 'win32' || agent !== 'opencode') {
      const status = await discoverAgent(agent, binary, signal, { includeHelp: agent === 'claude' && !!effort })
      if (signal.aborted) throw new PdfpalError('AGENT_CANCELLED', 'The AI request was cancelled.')
      if (status.state !== 'installed') throw new PdfpalError('AGENT_NOT_FOUND', status.state === 'missing'
        ? `The "${agent}" agent CLI is not installed. Open AI settings for setup instructions.`
        : `The ${agent} executable needs installation or repair.`)
      binary = status.executable
      if (effort && agent !== 'opencode') {
        const options = await modelsForInstalledAgent(agent, status, signal)
        if (signal.aborted) throw new PdfpalError('AGENT_CANCELLED', 'The AI request was cancelled.')
        if (!options.find(option => option.id === model)?.efforts?.includes(effort)) {
          if (override) throw unsupportedEffort()
          effort = undefined
        }
      }
    }
    if (!commandAvailable(binary)) throw new PdfpalError('AGENT_NOT_FOUND', `The "${agent}" agent CLI is not installed or not on PATH`)
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `pdfpal-${agent}-`))
    let args: string[]
    let stdin: string | undefined
    if (agent === 'claude') {
      args = ['--print', '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
      if (model) args.push('--model', model)
      if (effort) args.push('--effort', effort)
      stdin = prompt
    } else if (agent === 'codex') {
      args = ['--ask-for-approval', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--disable', 'shell_tool', '--config', 'web_search="disabled"']
      if (model) args.push('-m', model)
      if (effort) args.push('--config', `model_reasoning_effort="${effort}"`)
      // Ultra uses the ordinary model effort with delegation disabled.
      if (effort === 'ultra') args.push('--disable', 'multi_agent_v2', '--config', 'agents.enabled=false')
      args.push('-')
      stdin = prompt
    } else {
      const agentDir = path.join(cwd, '.opencode', 'agent')
      fs.mkdirSync(agentDir, { recursive: true })
      fs.writeFileSync(path.join(agentDir, 'pdfpal.md'), `---\ndescription: pdfpal responder\nmode: primary\npermissions: []\n${model ? `model: ${model}\n` : ''}---\nAnswer only from supplied context.\n`)
      args = ['run', '--format', 'json']
      if (model) args.push('-m', model)
      args.push('--agent', 'pdfpal', prompt)
    }
    try {
      const result = await runProbe(binary, args, { cwd, stdin, signal, timeoutMs, maxBytes: 2 * 1024 * 1024 })
      if (result.failure === 'cancelled') throw new PdfpalError('AGENT_CANCELLED', 'The AI request was cancelled.')
      if (result.failure === 'timeout') throw new PdfpalError('AGENT_TIMEOUT', 'The assistant took too long to respond. Retry, or check its connection in AI settings.')
      if (result.failure === 'output_limit') throw new PdfpalError('AGENT_OUTPUT_LIMIT', 'The agent response exceeded the size limit.')
      const out = result.stdout, err = result.stderr
      if (result.code !== 0) throw providerError(err || out)
      if (agent !== 'opencode') return out
      const text = out.split(/\r?\n/).flatMap(line => {
        try {
          const event = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string } }
          return event.type === 'text' && event.part?.type === 'text' ? [event.part.text ?? ''] : []
        } catch { return [] }
      }).join('').trim()
      if (!text) throw providerError(err)
      return text
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }
}

/** Classify transient failures without exposing provider output, prompts or credentials. */
export function providerError(output: string): PdfpalError {
  if (/unauthori[sz]ed|not (?:logged|signed) in|login required|authentication|oauth.*(?:expired|invalid)|401|403/i.test(output))
    return new PdfpalError('AGENT_SIGN_IN', 'Your assistant needs sign-in. Open AI settings to sign in, then retry your question.')
  if (/rate.?limit|usage.?limit|quota|429|too many requests/i.test(output))
    return new PdfpalError('AGENT_LIMIT', 'Your assistant has reached a usage limit. Wait and retry, or choose another assistant in AI settings.')
  if (/network|connect|ENOTFOUND|ECONN|fetch failed|offline/i.test(output))
    return new PdfpalError('AGENT_OFFLINE', 'Could not reach your assistant. Check your internet connection, then retry.')
  if (/sandbox|unsupported|unknown (?:argument|option)|unrecognized (?:argument|option)/i.test(output))
    return new PdfpalError('AGENT_SETUP', 'Your assistant needs setup or an update. Open AI settings for the official setup instructions, then test the connection again.')
  return new PdfpalError('AGENT_FAILED', 'The assistant could not finish this request. Retry, or check your connection in AI settings.')
}
