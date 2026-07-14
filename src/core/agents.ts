import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PdfpalConfig } from './config.js'
import { PdfpalError } from './types.js'

export type AgentName = 'claude' | 'codex' | 'opencode'

function commandAvailable(binary: string): boolean {
  if (path.isAbsolute(binary)) return fs.existsSync(binary)
  const command = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(command, [binary], { stdio: 'ignore' }).status === 0
}

export class AgentService {
  constructor(private readonly config: PdfpalConfig) {}

  list(): Array<{ id: AgentName; label: string; available: boolean }> {
    return (['claude', 'codex', 'opencode'] as AgentName[]).map(id => ({
      id,
      label: id[0]!.toUpperCase() + id.slice(1),
      available: commandAvailable(this.binary(id)),
    }))
  }

  private binary(agent: AgentName): string {
    return agent === 'claude' ? this.config.claudeBin : agent === 'codex' ? this.config.codexBin : this.config.opencodeBin
  }

  async invoke(prompt: string, agent = this.config.agent, model = this.config.model): Promise<string> {
    const binary = this.binary(agent)
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
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        child.stdout.on('data', data => stdout.push(Buffer.from(data)))
        child.stderr.on('data', data => stderr.push(Buffer.from(data)))
        child.on('error', reject)
        // Some valid command-line programs exit without reading stdin (for
        // example a probe executable or a failed agent). Treat the resulting
        // broken pipe as a process outcome instead of an uncaught exception.
        child.stdin.on('error', error => {
          if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error)
        })
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new PdfpalError('AGENT_TIMEOUT', 'Agent request timed out after five minutes'))
        }, 300_000)
        child.on('close', code => {
          clearTimeout(timer)
          const out = Buffer.concat(stdout).toString('utf8').trim()
          const err = Buffer.concat(stderr).toString('utf8').trim()
          if (code !== 0 && !out) return reject(new PdfpalError('AGENT_FAILED', err || `${agent} exited with status ${code}`))
          if (agent !== 'opencode') return resolve(out)
          const text = out.split(/\r?\n/).flatMap(line => {
            try {
              const event = JSON.parse(line) as { type?: string; part?: { type?: string; text?: string } }
              return event.type === 'text' && event.part?.type === 'text' ? [event.part.text ?? ''] : []
            } catch { return [] }
          }).join('').trim()
          if (!text) return reject(new PdfpalError('AGENT_FAILED', err || 'OpenCode produced no answer'))
          resolve(text)
        })
        if (stdin) child.stdin.end(stdin)
        else child.stdin.end()
      })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }
}
