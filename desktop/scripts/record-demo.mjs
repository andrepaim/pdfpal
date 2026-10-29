// Record the actual reader UI with a deterministic assistant and synthetic PDF.
// No personal account or provider allowance is used.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { startRuntime } from '../../dist/server/runtime.js'
import { loadConfig } from '../../dist/core/config.js'
const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(path.join(root, 'frontend/package.json'))
const { chromium } = require('@playwright/test')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-demo-'))
const output = path.join(root, 'desktop/evidence/demo')
await fs.mkdir(output, { recursive: true })
let runtime, browser
try {
  const binary = path.join(directory, 'fixture-agent')
  await fs.writeFile(binary, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>process.stdout.write("This sample PDF is a small document for testing the reader. You can select text, ask questions, save notes, and return to your reading later."));\n', { mode: 0o700 })
  runtime = await startRuntime(loadConfig({ dataDir: directory, agent: 'codex', codexBin: binary }), 0)
  const json = async (url, body) => {
    const response = await fetch(runtime.origin + url, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
    if (!response.ok) throw new Error(`Demo request failed (${response.status})`)
    return response.json()
  }
  const project = await json('/api/projects', { title: 'My first reading project' })
  const bytes = await fs.readFile(path.join(root, 'test/fixtures/sample.pdf'))
  const form = new FormData(); form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'sample.pdf')
  const upload = await fetch(`${runtime.origin}/api/projects/${project.id}/sources/upload`, { method: 'POST', body: form })
  const source = await upload.json()
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: output, size: { width: 1280, height: 800 } } })
  await context.addInitScript(() => {
    window.pdfpalDesktop = {
      setAgent: async id => id, onAgentChanged: () => () => {},
      setupStatus: async () => ({ complete: localStorage.getItem('demo-complete') === 'true' }),
      setupState: async () => ({ default: 'codex', explicit: true, complete: false, agents: [{ id: 'claude', label: 'Claude', available: false, state: 'missing' }, { id: 'codex', label: 'Codex', available: true, state: 'installed', auth: 'account' }] }),
      completeSetup: async () => { localStorage.setItem('demo-complete', 'true'); return true; },
    }
    addEventListener('DOMContentLoaded', () => {
      const label = document.createElement('div')
      label.textContent = 'DEMO · Sample PDF and simulated assistant'
      Object.assign(label.style, { position: 'fixed', bottom: '10px', left: '10px', zIndex: '99999', background: '#1a1a1a', color: '#a5b4fc', padding: '8px 12px', font: '12px system-ui', borderRadius: '6px' })
      document.body.append(label)
    })
  })
  const page = await context.newPage()
  await page.goto(runtime.origin)
  await page.getByRole('dialog', { name: 'Connect your reading assistant' }).waitFor()
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: 'Start reading' }).click()
  await page.waitForTimeout(1000)
  await page.getByText('My first reading project', { exact: true }).click()
  await page.waitForTimeout(1000)
  await page.goto(`${runtime.origin}/projects/${project.id}/sources/${source.id}`)
  await page.locator('[data-pdf-page="1"] canvas').waitFor()
  await page.waitForTimeout(1800)
  await page.locator('textarea').fill('What is this sample document about?')
  await page.waitForTimeout(1200)
  await page.locator('textarea').press('Enter')
  await page.getByText('This sample PDF is a small document for testing the reader.', { exact: false }).waitFor()
  await page.waitForTimeout(2500)
  await page.reload()
  await page.getByText('This sample PDF is a small document for testing the reader.', { exact: false }).waitFor()
  await page.waitForTimeout(1700)
  const video = page.video()
  await context.close()
  await video.saveAs(path.join(output, 'pdfpal-desktop-preview.webm'))
  await browser.close(); browser = undefined
  console.log(`Demo saved: ${path.join(output, 'pdfpal-desktop-preview.webm')}`)
} finally {
  await browser?.close()
  await runtime?.close()
  await fs.rm(directory, { recursive: true, force: true })
}
