import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './dist/core/config.js'

let server
process.parentPort.on('message', async ({ data }) => {
  if (data.type === 'stop') { await server?.close(); process.exit(0) }
})
try {
  // pdf.js classifies Electron utility processes as browsers. Supply its DOM
  // primitives and in-process worker explicitly; no document/Worker exists here.
  const canvas = await import('@napi-rs/canvas')
  for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[name] ??= canvas[name]
  globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const { buildServer } = await import('./dist/server/app.js')
  const config = loadConfig()
  server = await buildServer(config)
  const origin = await server.listen({ host: '127.0.0.1', port: process.env.PDFPAL_M0_SMOKE === '1' ? 0 : config.port })
  const checks = []
  if (process.env.PDFPAL_M0_SMOKE === '1') {
    const request = async (url, options) => {
      // Avoid reusing an undici keep-alive socket across the intentional restart.
      const response = await fetch(`${origin}${url}`, { ...options, headers: { connection: 'close', ...options?.headers } })
      if (!response.ok) throw new Error(`HTTP ${response.status} at ${url}`)
      return response
    }
    await (await request('/api/health')).json(); checks.push('http-health')
    const project = await (await request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'M0 fixture' }) })).json()
    checks.push('sqlite-create-project')
    const bytes = await fs.readFile(fileURLToPath(new URL('./sample.pdf', import.meta.url)))
    const body = new FormData(); body.append('file', new Blob([bytes], { type: 'application/pdf' }), 'sample.pdf')
    const source = await (await request(`/api/projects/${project.id}/sources/upload`, { method: 'POST', body })).json()
    if (!(source.pages > 0)) throw new Error('PDF extraction failed')
    checks.push('pdf-import-extraction')
    await (await request('/api/extensions/package')).json(); checks.push('extension-assets')
    const html = await (await request('/')).text()
    const asset = html.match(/src="([^"]+\.js)"/)
    if (!asset) throw new Error('Frontend asset missing')
    await (await request(asset[1])).arrayBuffer(); checks.push('frontend-assets')
    // Prove database handles can close and reopen in the same utility process.
    await server.close(); server = await buildServer(config)
    await server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) })
    const projects = await (await request('/api/projects')).json()
    if (!projects.some(item => item.id === project.id)) throw new Error('SQLite persistence failed')
    checks.push('sqlite-reopen-persistence')
  }
  let providers
  if (process.env.PDFPAL_M0_LIVE === '1') {
    const { checkProviders } = await import('./providers.mjs')
    providers = await checkProviders(true)
  }
  process.parentPort.postMessage({ type: 'ready', origin, checks, providers })
} catch (error) {
  if (process.env.PDFPAL_M0_SMOKE === '1') console.error('M0 backend check:', error.message)
  process.parentPort.postMessage({ type: 'failure', code: 'BACKEND_PROOF_FAILED' })
  await server?.close().catch(() => {})
  process.exit(1)
}
