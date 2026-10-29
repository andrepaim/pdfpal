import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveAgentPreference, saveAgentBinary } from './dist/core/config.js'
import { discoverAgent, refreshWindowsPath } from './dist/core/agent-discovery.js'
import { AgentService } from './dist/core/agents.js'

let runtime, config, stopping = false, connectionTest
async function inspect() {
  const agents = await new AgentService(config).inspect()
  const file = await fs.readFile(path.join(config.dataDir, 'config.json'), 'utf8').then(JSON.parse).catch(() => ({}))
  return { default: config.agent, explicit: !!process.env.PDFPAL_AGENT || Object.hasOwn(file, 'agent'), agents }
}
process.parentPort.on('message', async ({ data }) => {
  if (data.type === 'stop') {
    stopping = true
    await runtime?.close(phase => process.parentPort.postMessage({ type: 'shutdown-progress', phase }))
    process.exit(0)
  }
  if (data.type !== 'rpc') return
  try {
    if (!runtime || stopping) throw new Error('Service is not ready')
    let result
    if (data.command === 'status') result = { active: AgentService.activeCount }
    else if (data.command === 'set-agent') {
      if (!['claude', 'codex', 'opencode'].includes(data.agent)) throw new Error('Unknown assistant')
      saveAgentPreference(config, data.agent)
      result = config.agent
    } else if (data.command === 'inspect') result = await inspect()
    else if (data.command === 'login-command' || data.command === 'choose-binary') {
      if (!['claude', 'codex'].includes(data.agent)) throw new Error('Unknown assistant')
      await refreshWindowsPath()
      const binary = data.command === 'choose-binary' ? data.executable : data.agent === 'claude' ? config.claudeBin : config.codexBin
      const status = await discoverAgent(data.agent, binary)
      if (status.state !== 'installed') throw new Error('The selected executable could not be verified. Install or repair the assistant, then retry.')
      if (data.command === 'choose-binary') { saveAgentBinary(config, data.agent, status.executable); result = true }
      else result = status.executable
    } else if (data.command === 'test-connection') {
      if (!['claude', 'codex'].includes(data.agent) || connectionTest) throw new Error('A connection test is already running or this assistant is unsupported.')
      const controller = new AbortController()
      connectionTest = controller
      try {
        const answer = await new AgentService(config).invoke('Reply exactly PDFPAL_CONNECTION_OK. Do not use tools, files, or network tools.', data.agent, config.model, { signal: controller.signal, timeoutMs: 60000 })
        if (answer.trim() !== 'PDFPAL_CONNECTION_OK') throw new Error('The assistant did not return the expected test response. Check its setup and retry.')
        result = { at: new Date().toISOString() }
      } finally { if (connectionTest === controller) connectionTest = undefined }
    } else if (data.command === 'cancel-test') { connectionTest?.abort(); result = true }
    else throw new Error('Unknown command')
    process.parentPort.postMessage({ type: 'rpc-result', id: data.id, result })
  } catch (error) {
    const safe = ['AGENT_SIGN_IN', 'AGENT_LIMIT', 'AGENT_OFFLINE', 'AGENT_SETUP', 'AGENT_TIMEOUT', 'AGENT_CANCELLED', 'AGENT_NOT_FOUND'].includes(error.code)
    process.parentPort.postMessage({ type: 'rpc-result', id: data.id, error: safe ? error.message : 'Could not complete this action. Check the official assistant setup instructions and retry.', code: error.code })
  }
})
try {
  const canvas = await import('@napi-rs/canvas')
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[name] ??= canvas[name]
  globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const { startRuntime } = await import('./dist/server/runtime.js')
  config = loadConfig()
  const smoke = process.env.PDFPAL_M0_SMOKE === '1'
  if (smoke && process.env.PDFPAL_M2_FAILURE_FIXTURE === '1') throw Object.assign(new Error('Fixture occupied port'), { code: 'EADDRINUSE' })
  runtime = await startRuntime(config, smoke ? 0 : config.port)
  const origin = runtime.origin, checks = []
  let fixture
  if (smoke) {
    const request = async (url, options) => {
      const response = await fetch(`${origin}${url}`, { ...options, headers: { connection: 'close', ...options?.headers } })
      if (!response.ok) throw new Error(`HTTP ${response.status} at ${url}`)
      return response
    }
    await (await request('/api/health')).json(); checks.push('http-health')
    const project = await (await request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Desktop fixture' }) })).json()
    checks.push('sqlite-create-project')
    const bytes = await fs.readFile(fileURLToPath(new URL('./sample.pdf', import.meta.url)))
    const body = new FormData(); body.append('file', new Blob([bytes], { type: 'application/pdf' }), 'sample.pdf')
    const source = await (await request(`/api/projects/${project.id}/sources/upload`, { method: 'POST', body })).json()
    if (!(source.pages > 0)) throw new Error('PDF extraction failed')
    fixture = { project: project.id, source: source.id }
    const { openDatabase } = await import('./dist/core/database.js')
    const { ExtensionAuth } = await import('./dist/core/extension-auth.js')
    const db = openDatabase(config)
    fixture.pairCode = new ExtensionAuth(db).pairCode().code
    db.close()
    checks.push('pdf-import-extraction')
    await (await request('/api/extensions/package')).json(); checks.push('extension-assets')
    const html = await (await request('/')).text()
    const asset = html.match(/src="([^"]+\.js)"/)
    if (!asset) throw new Error('Frontend asset missing')
    await (await request(asset[1])).arrayBuffer(); checks.push('frontend-assets')
    await runtime.close(); runtime = await startRuntime(config, Number(new URL(origin).port))
    const projects = await (await request('/api/projects')).json()
    if (!projects.some(item => item.id === project.id)) throw new Error('SQLite persistence failed')
    checks.push('sqlite-reopen-persistence')
  }
  let providers
  if (process.env.PDFPAL_M0_LIVE === '1') providers = await (await import('./providers.mjs')).checkProviders(true)
  const agents = []
  process.parentPort.postMessage({ type: 'ready', origin, checks, providers, fixture, agents, agent: config.agent,
    startup: { dataDir: path.resolve(config.dataDir), dbPath: path.resolve(config.dbPath), port: config.port } })
} catch (error) {
  const { existingServer } = await import('./dist/server/runtime.js')
  const existing = config && error.code === 'SERVER_ALREADY_RUNNING' ? await existingServer(config.dbPath) : undefined
  if (process.env.PDFPAL_M0_SMOKE === '1') console.error('Desktop backend check:', error.message)
  process.parentPort.postMessage({ type: 'failure', code: error.code ?? 'BACKEND_FAILED', message: error.message, existing })
  await runtime?.close().catch(() => {})
  process.exit(1)
}
