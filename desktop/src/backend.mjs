import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveAgentPreference } from './dist/core/config.js'
import { AgentService } from './dist/core/agents.js'

let runtime, config, stopping = false
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
    } else throw new Error('Unknown command')
    process.parentPort.postMessage({ type: 'rpc-result', id: data.id, result })
  } catch { process.parentPort.postMessage({ type: 'rpc-result', id: data.id, error: 'Could not apply this setting. Check your configuration and retry.' }) }
})
try {
  const canvas = await import('@napi-rs/canvas')
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[name] ??= canvas[name]
  globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const { startRuntime } = await import('./dist/server/runtime.js')
  config = loadConfig()
  const smoke = process.env.PDFPAL_M0_SMOKE === '1'
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
  const agents = await new AgentService(config).inspect()
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
