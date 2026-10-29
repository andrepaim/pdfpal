import { app, BrowserWindow, utilityProcess } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// M0 engineering harness, intentionally separate from production CLI startup.
const root = path.dirname(fileURLToPath(import.meta.url))
const smoke = process.argv.includes('--m0-smoke')
let backend, window, temporary, pendingReceipt, stopping = false, exited = false
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  const closed = backend && !exited ? new Promise(resolve => backend.once('exit', resolve)) : Promise.resolve()
  if (backend && !exited) backend.postMessage({ type: 'stop' })
  let forced = false
  const timer = setTimeout(() => { forced = true; backend?.kill() }, 5000)
  await closed
  clearTimeout(timer)
  if (temporary) {
    try { await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
    catch { code = 1 }
  }
  if (forced) code = 1
  if (pendingReceipt) {
    pendingReceipt.checks.push(forced ? 'backend-forced-stop' : 'backend-graceful-stop')
    if (forced) pendingReceipt.status = 'shutdown_failed'
    await fs.writeFile(process.env.PDFPAL_M0_RECEIPT, JSON.stringify(pendingReceipt, null, 2))
  }
  app.exit(code)
}
app.on('window-all-closed', () => { void shutdown() })
app.on('before-quit', event => { if (!stopping) { event.preventDefault(); void shutdown() } })
app.whenReady().then(async () => {
  try {
    if (smoke) temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-m0-'))
    backend = utilityProcess.fork(path.join(root, 'backend.mjs'), [], {
      env: { ...process.env, ...(temporary ? { PDFPAL_DATA_DIR: temporary, PDFPAL_DB: path.join(temporary, 'pdfpal.db') } : {}), PDFPAL_M0_SMOKE: smoke ? '1' : '0' },
      stdio: 'pipe', serviceName: 'pdfpal backend',
    })
    backend.once('exit', () => { exited = true })
    backend.stdout?.resume()
    if (smoke) backend.stderr?.on('data', chunk => process.stderr.write(chunk))
    else backend.stderr?.resume()
    // Do not pipe potentially sensitive backend logging into receipts.
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Backend readiness timed out')), process.env.PDFPAL_M0_LIVE === '1' ? 270000 : 30000)
      backend.on('message', message => {
        if (message.type === 'ready') { clearTimeout(timer); resolve(message) }
        if (message.type === 'failure') { clearTimeout(timer); reject(new Error(message.code)) }
      })
      backend.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited: ${code}`)) })
    })
    backend.once('exit', () => { if (!stopping) void shutdown(1) })
    window = new BrowserWindow({ width: 1250, height: 850, show: !smoke,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== ready.origin) event.preventDefault() })
    await window.loadURL(ready.origin)
    if (smoke) {
      const ui = await window.webContents.executeJavaScript('({ title: document.title, mounted: !!document.querySelector("#root")?.children.length })')
      if (!ui.mounted) throw new Error('Packaged reader did not mount')
      const receipt = { status: 'passed', platform: process.platform, arch: process.arch,
        electron: process.versions.electron, node: process.versions.node, checks: ready.checks, ui, providers: ready.providers }
      if (ready.providers?.agents.some(agent => agent.generation !== 'passed')) receipt.status = 'provider_gate_failed'
      if (!process.env.PDFPAL_M0_RECEIPT) throw new Error('Set PDFPAL_M0_RECEIPT for smoke evidence')
      pendingReceipt = receipt
      await shutdown(receipt.status === 'passed' ? 0 : 1)
    }
  } catch (error) {
    console.error(`M0 failed: ${error.message}`)
    await shutdown(1)
  }
})
