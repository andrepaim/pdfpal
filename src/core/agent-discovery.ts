import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

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
  if (platform === 'win32' && env.APPDATA) dirs.push(p.join(env.APPDATA, 'npm'))
  // Homebrew prefixes on Apple silicon and Intel (Claude Code and Codex casks). The official native
  // installers of both use ~/.local/bin, added below for every platform.
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
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
  let unsupportedVersion: string | undefined
  for (const executable of agentCandidates(agent, { binary })) {
    if (signal?.aborted) break
    try { if (!fs.statSync(executable).isFile()) continue } catch { continue }
    found = true
    const version = await runProbe(executable, ['--version'], { signal })
    const text = `${version.stdout}\n${version.stderr}`
    const match = agent === 'claude' ? text.match(/(\d+\.\d+\.\d+)[^\r\n]*\(Claude Code\)/i) : text.match(/codex-cli\s+(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i)
    if (version.code !== 0 || !match) continue
    const help = await runProbe(executable, agent === 'claude' ? ['--help'] : ['exec', '--help'], { signal })
    const capabilities = `${help.stdout}\n${help.stderr}`
    const required = agent === 'claude' ? ['--tools', '--strict-mcp-config', '--disallowedTools'] : ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--disable']
    if (help.failure) continue
    if (help.code !== 0 || !required.every(flag => capabilities.includes(flag))) { unsupportedVersion = match[1]!; continue }
    const auth = await runProbe(executable, agent === 'claude' ? ['auth', 'status'] : ['login', 'status'], { signal })
    return { agent, state: 'installed' as const, executable, version: match[1]!, auth: parseAuth(agent, auth) }
  }
  if (unsupportedVersion) return { agent, state: 'unsupported' as const, version: unsupportedVersion, auth: 'unknown' as const }
  return { agent, state: found ? 'unusable' as const : 'missing' as const, auth: 'unknown' as const }
}

/**
 * Whether assistants are found with `discoverAgent` (fixed install locations, version, capability and
 * sign-in probes) instead of a plain `which` lookup. Always on Windows. On macOS only inside the desktop
 * app's backend: desktop/src/main.mjs is the only place that sets PDFPAL_APP_VERSION, in the environment
 * of the backend utility process it forks. An app opened from Finder or the Dock inherits a minimal PATH,
 * so `which` cannot see assistants there. The npm CLI and server in a terminal, and Linux, keep `which`.
 */
export function usesNativeDiscovery(options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}): boolean {
  const platform = options.platform ?? process.platform, env = options.env ?? process.env
  return platform === 'win32' || (platform === 'darwin' && Boolean(env.PDFPAL_APP_VERSION))
}

/** The user's login shell: $SHELL when it is an absolute path to an existing file, else the macOS default. */
export function loginShell(env: NodeJS.ProcessEnv = process.env): string {
  const shell = env.SHELL
  if (shell && path.posix.isAbsolute(shell)) { try { if (fs.statSync(shell).isFile()) return shell } catch {} }
  return '/bin/zsh'
}

const PATH_BEGIN = 'PDFPAL-LOGIN-PATH-BEGIN', PATH_END = 'PDFPAL-LOGIN-PATH-END'
/**
 * Prints the exported PATH between markers. `printenv` reads the exported value, which is colon-joined
 * even in fish, where `$PATH` is a list. The markers are printed from two words, so a shell echoing its
 * command line (for example with xtrace) never prints a complete marker.
 */
export function loginShellPathCommand(nonce: string): string {
  return `printf '%s-%s\\n' ${PATH_BEGIN} ${nonce}; /usr/bin/printenv PATH; printf '%s-%s\\n' ${PATH_END} ${nonce}`
}

/** Absolute PATH entries between the last begin marker and the next end marker, or undefined. */
export function parseLoginShellPath(stdout: string, nonce: string): string[] | undefined {
  const begin = `${PATH_BEGIN}-${nonce}`, end = `${PATH_END}-${nonce}`
  const start = stdout.lastIndexOf(begin)
  if (start < 0) return undefined
  const stop = stdout.indexOf(end, start + begin.length)
  if (stop < 0) return undefined
  const entries = [...new Set(stdout.slice(start + begin.length, stop).replace(/^[\r\n]+|[\r\n]+$/g, '').split(':').filter(entry => path.posix.isAbsolute(entry)))]
  return entries.length ? entries : undefined
}

/** `first` entries, then the current ones; absolute entries only, de-duplicated, colon-joined. */
export function mergePathEntries(first: string[], current: string | undefined): string {
  return [...new Set([...first, ...(current ?? '').split(':')].filter(entry => path.posix.isAbsolute(entry)))].join(':')
}

/**
 * Runs the login shell as a login, interactive shell, so the user's profile files apply, and merges its
 * PATH into `env.PATH`. Bounded by the probe timeout and output limit, honours `signal`, never throws.
 * On any failure `env.PATH` is left unchanged. Returns whether PATH was merged, or 'cancelled'.
 */
export async function applyLoginShellPath(options: { shell?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<boolean | 'cancelled'> {
  const env = options.env ?? process.env
  try {
    const nonce = randomBytes(12).toString('hex')
    const result = await runProbe(options.shell ?? loginShell(env), ['-l', '-i', '-c', loginShellPathCommand(nonce)], { signal: options.signal, timeoutMs: options.timeoutMs })
    if (result.failure === 'cancelled') return 'cancelled'
    if (result.failure) return false
    const entries = parseLoginShellPath(result.stdout, nonce)
    if (!entries) return false
    env.PATH = mergePathEntries(entries, env.PATH)
    return true
  } catch { return false }
}

let macPathPending: Promise<void> | undefined, macPathSettled = false
/**
 * macOS desktop app only: merge the login shell's PATH into this process, and so into every assistant
 * process it starts (a Node-based launcher needs `node`). Caching: `force` (used by assistant inspection:
 * page load, AI settings, "Check again", connection test) always launches the shell again; without it,
 * as before every question, the shell runs only if no attempt has finished in this process yet.
 * Concurrent callers share one shell launch.
 */
export function refreshMacPath(signal?: AbortSignal, options: { force?: boolean } = {}): Promise<void> {
  if (process.platform !== 'darwin' || !usesNativeDiscovery()) return Promise.resolve()
  if (macPathPending) return macPathPending
  if (macPathSettled && !options.force) return Promise.resolve()
  macPathPending = applyLoginShellPath({ signal })
    .then(result => { if (result !== 'cancelled') macPathSettled = true })
    .finally(() => { macPathPending = undefined })
  return macPathPending
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
