import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

export type DesktopAgent = 'claude' | 'codex' | 'opencode'
type DiscoveryOptions = { binary?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; home?: string }
export type ProbeResult = { code: number | null; stdout: string; stderr: string; failure?: 'timeout' | 'output_limit' | 'spawn' | 'cancelled' }

/** Bounded diagnostics only. Never return raw authentication output to the UI. */
export function runProbe(binary: string, args: string[], options: { timeoutMs?: number; maxBytes?: number; stdin?: string; cwd?: string; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}): Promise<ProbeResult> {
  if (options.signal?.aborted) return Promise.resolve({ code: null, stdout: '', stderr: '', failure: 'cancelled' })
  return new Promise(resolve => {
    const child = spawn(binary, args, { windowsHide: true, detached: process.platform !== 'win32',
      cwd: options.cwd ?? os.tmpdir(), env: options.env ?? agentEnvironment(binary), stdio: ['pipe', 'pipe', 'pipe'] })
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

/** GUI launchers often omit the user's terminal PATH. Never source shell startup files. */
function posixDirectories(env: NodeJS.ProcessEnv, home: string): string[] {
  const dirs = (env.PATH ?? '').split(':').filter(dir => path.posix.isAbsolute(dir))
  dirs.push(...['.local/bin', '.npm-global/bin', '.npm/bin', '.bun/bin', '.opencode/bin', '.volta/bin'].map(dir => path.join(home, dir)))
  for (const prefix of [env.npm_config_prefix, env.NPM_CONFIG_PREFIX, env.VOLTA_HOME]) {
    if (prefix && path.isAbsolute(prefix)) dirs.push(path.join(prefix, 'bin'))
  }
  if (env.NVM_BIN && path.isAbsolute(env.NVM_BIN)) dirs.push(env.NVM_BIN)
  const nvm = path.join(env.NVM_DIR && path.isAbsolute(env.NVM_DIR) ? env.NVM_DIR : path.join(home, '.nvm'), 'versions', 'node')
  try {
    dirs.push(...fs.readdirSync(nvm).filter(name => /^v\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, 50).map(name => path.join(nvm, name, 'bin')))
  } catch {}
  dirs.push('/usr/local/bin', '/usr/bin', '/bin', '/snap/bin')
  return [...new Set(dirs)]
}

/** Preserve the inherited environment, adding known executable directories for env/node and npm wrappers. */
export function agentEnvironment(binary: string, options: Omit<DiscoveryOptions, 'binary'> = {}): NodeJS.ProcessEnv {
  const env = options.env ?? process.env
  if ((options.platform ?? process.platform) === 'win32') return env
  const dirs: string[] = []
  if (path.isAbsolute(binary)) {
    dirs.push(path.dirname(binary))
    try { dirs.push(path.dirname(fs.realpathSync(binary))) } catch {}
  }
  return { ...env, PATH: [...new Set([...dirs, ...posixDirectories(env, options.home ?? os.homedir())])].join(':') }
}

export function agentCandidates(agent: DesktopAgent, options: DiscoveryOptions = {}): string[] {
  const platform = options.platform ?? process.platform, env = options.env ?? process.env
  const p = platform === 'win32' ? path.win32 : path.posix
  // Explicit overrides are authoritative, including a broken override.
  const home = options.home ?? os.homedir()
  const dirs = platform === 'win32'
    ? (env.PATH ?? env.Path ?? '').split(';').filter(dir => p.isAbsolute(dir))
    : posixDirectories(env, home)
  if (options.binary && options.binary !== agent) {
    if (platform === 'win32' || options.binary.includes('/')) return [options.binary]
    return dirs.map(dir => p.join(dir, options.binary!))
  }
  if (platform === 'win32' && env.APPDATA) dirs.push(p.join(env.APPDATA, 'npm'))
  const candidates = dirs.map(dir => p.join(dir, `${agent}${platform === 'win32' ? '.exe' : ''}`))
  if (platform === 'win32' && env.LOCALAPPDATA) candidates.push(p.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${agent}.exe`))
  candidates.push(p.join(home, '.local', 'bin', `${agent}${platform === 'win32' ? '.exe' : ''}`))
  if (platform === 'win32' && agent === 'codex') {
    if (env.LOCALAPPDATA) candidates.push(p.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'))
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
  if (agent === 'opencode') return 'unknown'
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

export async function discoverAgent(agent: DesktopAgent, binary?: string, signal?: AbortSignal, options: Omit<DiscoveryOptions, 'binary'> = {}) {
  let found = false
  let unsupportedVersion: string | undefined
  const deadline = Date.now() + 15_000
  for (const executable of agentCandidates(agent, { ...options, binary })) {
    if (signal?.aborted || Date.now() >= deadline) break
    try { if (!fs.statSync(executable).isFile()) continue } catch { continue }
    found = true
    try { fs.accessSync(executable, fs.constants.X_OK) } catch { continue }
    const env = agentEnvironment(executable, options)
    const probe = (args: string[]) => runProbe(executable, args, { signal, env, timeoutMs: Math.max(1, Math.min(5000, deadline - Date.now())) })
    const version = await probe(['--version'])
    const text = `${version.stdout}\n${version.stderr}`
    const match = agent === 'claude' ? text.match(/(\d+\.\d+\.\d+)[^\r\n]*\(Claude Code\)/i)
      : agent === 'codex' ? text.match(/codex-cli\s+(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i)
      : text.match(/^(?:opencode\s+)?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\s*$/im)
    if (version.code !== 0 || !match) continue
    const help = await probe(agent === 'claude' ? ['--help'] : [agent === 'codex' ? 'exec' : 'run', '--help'])
    const capabilities = `${help.stdout}\n${help.stderr}`
    const required = agent === 'claude' ? ['--tools', '--strict-mcp-config', '--disallowedTools']
      : agent === 'codex' ? ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--disable'] : ['--agent', '--format']
    if (help.failure) continue
    if (help.code !== 0 || !required.every(flag => capabilities.includes(flag))) { unsupportedVersion = match[1]!; continue }
    const auth = agent === 'opencode' ? 'unknown' as const : parseAuth(agent,
      await probe(agent === 'claude' ? ['auth', 'status'] : ['login', 'status']))
    return { agent, state: 'installed' as const, executable, version: match[1]!, auth }
  }
  if (unsupportedVersion) return { agent, state: 'unsupported' as const, version: unsupportedVersion, auth: 'unknown' as const }
  return { agent, state: found ? 'unusable' as const : 'missing' as const, auth: 'unknown' as const }
}

/** Refresh a running desktop process after a provider installer updates Windows PATH. */
export async function refreshWindowsPath(signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'win32') return
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = await runProbe(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine'))"], { signal })
  if (result.code === 0 && !result.failure) {
    process.env.PATH = [...new Set([...result.stdout.split(';'), ...(process.env.PATH ?? '').split(';')].filter(value => path.win32.isAbsolute(value)))].join(';')
  }
}
