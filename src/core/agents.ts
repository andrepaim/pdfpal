import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PdfpalConfig } from './config.js'
import { PdfpalError } from './types.js'
import { agentCandidates, discoverAgent, runProbe } from './agent-discovery.js'

export type AgentName = 'claude' | 'codex' | 'opencode'

function commandAvailable(binary: string): boolean {
  if (path.isAbsolute(binary)) return fs.existsSync(binary)
  const command = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(command, [binary], { stdio: 'ignore', windowsHide: true, timeout: 1500 }).status === 0
}

export class AgentService {
  private static readonly requests = new Map<AbortController, Promise<unknown>>()
  private static readonly inspections = new Map<AbortController, Promise<unknown>>()
  static get activeCount(): number { return this.requests.size }
  static async cancelAll(): Promise<void> {
    const pending = [...this.requests.values(), ...this.inspections.values()]
    for (const controller of [...this.requests.keys(), ...this.inspections.keys()]) controller.abort()
    await Promise.allSettled(pending)
  }

  inspect() {
    const controller = new AbortController()
    const request = this.inspectWithSignal(controller.signal)
    AgentService.inspections.set(controller, request)
    return request.finally(() => AgentService.inspections.delete(controller))
  }

  private async inspectWithSignal(signal: AbortSignal) {
    const agents = this.list()
    if (process.platform !== 'win32') return agents
    return Promise.all(agents.map(async item => {
      if (item.id === 'opencode') return item
      const status = await discoverAgent(item.id, this.binary(item.id), signal)
      return { ...item, available: status.state === 'installed', auth: status.auth }
    }))
  }

  constructor(private readonly config: PdfpalConfig) {}

  list(): Array<{ id: AgentName; label: string; available: boolean }> {
    return (['claude', 'codex', 'opencode'] as AgentName[]).map(id => ({
      id,
      label: id[0]!.toUpperCase() + id.slice(1),
      available: process.platform === 'win32' && id !== 'opencode'
        ? agentCandidates(id, { binary: this.binary(id) }).some(file => fs.existsSync(file))
        : commandAvailable(this.binary(id)),
    }))
  }

  private binary(agent: AgentName): string {
    return agent === 'claude' ? this.config.claudeBin : agent === 'codex' ? this.config.codexBin : this.config.opencodeBin
  }

  invoke(prompt: string, agent = this.config.agent, model = this.config.model): Promise<string> {
    const controller = new AbortController()
    const request = this.run(prompt, agent, model, controller.signal)
    AgentService.requests.set(controller, request)
    return request.finally(() => AgentService.requests.delete(controller))
  }

  private async run(prompt: string, agent: AgentName, model: string, signal: AbortSignal): Promise<string> {
    let binary = this.binary(agent)
    if (process.platform === 'win32' && agent !== 'opencode') {
      const status = await discoverAgent(agent, binary, signal)
      if (signal.aborted) throw new PdfpalError('AGENT_CANCELLED', 'The AI request was cancelled.')
      if (status.state !== 'installed') throw new PdfpalError('AGENT_NOT_FOUND', `The ${agent} executable needs installation or repair.`)
      binary = status.executable
    }
    if (!commandAvailable(binary)) throw new PdfpalError('AGENT_NOT_FOUND', `The "${agent}" agent CLI is not installed or not on PATH`)
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `pdfpal-${agent}-`))
    let args: string[]
    let stdin: string | undefined
    if (agent === 'claude') {
      args = ['--print']
      if (model) args.push('--model', model)
      stdin = prompt
    } else if (agent === 'codex') {
      args = ['--ask-for-approval', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'read-only']
      if (model) args.push('-m', model)
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
      const result = await runProbe(binary, args, { cwd, stdin, signal, timeoutMs: 300_000, maxBytes: 2 * 1024 * 1024 })
      if (result.failure === 'cancelled') throw new PdfpalError('AGENT_CANCELLED', 'The AI request was cancelled.')
      if (result.failure === 'timeout') throw new PdfpalError('AGENT_TIMEOUT', 'Agent request timed out after five minutes')
      if (result.failure === 'output_limit') throw new PdfpalError('AGENT_OUTPUT_LIMIT', 'The agent response exceeded the size limit.')
      const out = result.stdout, err = result.stderr
      if (result.code !== 0) throw new PdfpalError('AGENT_FAILED', err || out || `${agent} exited with status ${result.code}`)
      if (agent !== 'opencode') return out
      const text = out.split(/\r?\n/).flatMap(line => {
        try {
          const event = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string } }
          return event.type === 'text' && event.part?.type === 'text' ? [event.part.text ?? ''] : []
        } catch { return [] }
      }).join('').trim()
      if (!text) throw new PdfpalError('AGENT_FAILED', err || 'OpenCode produced no answer')
      return text
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }
}
