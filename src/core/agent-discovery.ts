import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export type DesktopAgent = 'claude' | 'codex'
export type ProbeResult = { code: number | null; stdout: string; stderr: string; failure?: 'timeout' | 'output_limit' | 'spawn' | 'cancelled' }

/** Bounded diagnostics only. Never return raw authentication output to the UI. */
export function runProbe(binary: string, args: string[], options: { timeoutMs?: number; maxBytes?: number; stdin?: string; cwd?: string; signal?: AbortSignal } = {}): Promise<ProbeResult> {
  if (options.signal?.aborted) return Promise.resolve({ code: null, stdout: '', stderr: '', failure: 'cancelled' })
  return new Promise(resolve => {
    const child = spawn(binary, args, { windowsHide: true, detached: process.platform !== 'win32',
      cwd: options.cwd ?? os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let bytes = 0, done = false, failure: ProbeResult['failure']
    const finish = (result: ProbeResult) => {
      if (!done) { done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); resolve(result) }
    }
    const stop = (reason: 'timeout' | 'output_limit' | 'cancelled') => {
      if (failure || done) return
      failure = reason
      if (!child.pid) return
      if (process.platform === 'win32') {
        // Target this owned PID and descendants, never all processes by name.
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill())
      } else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs ?? 5000)
    const abort = () => stop('cancelled')
    options.signal?.addEventListener('abort', abort, { once: true })
    const collect = (chunk: Buffer, output: boolean) => {
      if (failure) return
      bytes += chunk.length
      if (bytes > (options.maxBytes ?? 64 * 1024)) { stop('output_limit'); return }
      ;(output ? stdout : stderr).push(Buffer.from(chunk))
    }
    child.stdout.on('data', chunk => collect(chunk, true))
    child.stderr.on('data', chunk => collect(chunk, false))
    child.stdin.on('error', () => {})
    child.on('error', () => finish({ code: null, stdout: '', stderr: '', failure: 'spawn' }))
    // Resolve after owned processes have closed their pipes, so callers can
    // safely remove temporary directories on Windows after a timeout.
    child.on('close', code => finish(failure ? { code: null, stdout: '', stderr: '', failure } : {
      code, stdout: Buffer.concat(stdout).toString('utf8').trim(), stderr: Buffer.concat(stderr).toString('utf8').trim(),
    }))
    child.stdin.end(options.stdin)
  })
}

export function agentCandidates(agent: DesktopAgent, options: { binary?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string } = {}): string[] {
  const platform = options.platform ?? process.platform, env = options.env ?? process.env
  const p = platform === 'win32' ? path.win32 : path.posix
  // Explicit overrides are authoritative, including a broken override.
  if (options.binary && options.binary !== agent) return [options.binary]
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(dir => p.isAbsolute(dir))
  const home = options.home ?? os.homedir()
  const candidates = dirs.map(dir => p.join(dir, `${agent}${platform === 'win32' ? '.exe' : ''}`))
  candidates.push(p.join(home, '.local', 'bin', `${agent}${platform === 'win32' ? '.exe' : ''}`))
  if (platform === 'win32' && agent === 'codex') {
    // npm Codex ships a native optional dependency. Use its executable, avoiding cmd.exe quoting and a system-Node dependency.
    const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
    for (const dir of dirs) {
      const root = p.join(dir, 'node_modules', '@openai', 'codex')
      candidates.push(p.join(root, 'vendor', triple, 'codex', 'codex.exe'))
      candidates.push(p.join(root, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'codex', 'codex.exe'))
      candidates.push(p.join(root, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', triple, 'bin', 'codex.exe'))
    }
  }
  return [...new Set(candidates)].filter(file => !/\\Microsoft\\WindowsApps\\claude\.exe$/i.test(file))
}

export function parseAuth(agent: DesktopAgent, result: ProbeResult): 'account' | 'api' | 'external' | 'signed_out' | 'unknown' {
  if (result.failure) return 'unknown'
  if (agent === 'claude') {
    try {
      const value = JSON.parse(result.stdout)
      if (value.loggedIn === false) return 'signed_out'
      if (result.code !== 0) return 'unknown'
      if (value.authMethod === 'claude.ai') return 'account'
      if (['api_key', 'api_key_helper'].includes(value.authMethod)) return 'api'
      if (value.authMethod === 'third_party') return 'external'
      // A token alone does not establish subscription entitlement.
      return 'unknown'
    } catch { return 'unknown' }
  }
  const text = `${result.stdout}\n${result.stderr}`
  if (result.code === 0 && /Logged in using ChatGPT/i.test(text)) return 'account'
  if (result.code === 0 && /Logged in using an API key/i.test(text)) return 'api'
  if (/Not logged in/i.test(text)) return 'signed_out'
  return 'unknown'
}

export async function discoverAgent(agent: DesktopAgent, binary?: string, signal?: AbortSignal) {
  let found = false
  for (const executable of agentCandidates(agent, { binary })) {
    if (signal?.aborted) break
    try { if (!fs.statSync(executable).isFile()) continue } catch { continue }
    found = true
    const version = await runProbe(executable, ['--version'], { signal })
    const text = `${version.stdout}\n${version.stderr}`
    const match = agent === 'claude' ? text.match(/(\d+\.\d+\.\d+)[^\r\n]*\(Claude Code\)/i) : text.match(/codex-cli\s+(\S+)/i)
    if (version.code !== 0 || !match) continue
    const auth = await runProbe(executable, agent === 'claude' ? ['auth', 'status'] : ['login', 'status'], { signal })
    return { agent, state: 'installed' as const, executable, version: match[1]!, auth: parseAuth(agent, auth) }
  }
  return { agent, state: found ? 'unusable' as const : 'missing' as const, auth: 'unknown' as const }
}
