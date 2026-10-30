import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveAgentPreference } from '../stage/dist/core/config.js'
import { startRuntime, existingServer } from '../stage/dist/server/runtime.js'

if (process.argv.includes('--lease-owner')) {
  const runtime = await startRuntime(loadConfig({ dataDir: process.argv.at(-1) }), 0)
  process.send({ origin: runtime.origin })
} else {
  test('server lease survives conflicts and is released after process death', { timeout: 15000 }, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-native-lease-'))
    const config = loadConfig({ dataDir })
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--lease-owner', dataDir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, PDFPAL_DB: config.dbPath } })
    try {
      const origin = await new Promise((resolve, reject) => { child.once('message', message => resolve(message.origin)); child.once('error', reject); child.once('exit', code => reject(new Error(`Owner exited ${code}`))) })
      assert.equal(await existingServer(config.dbPath), origin)
      await assert.rejects(startRuntime(config, 0), { code: 'SERVER_ALREADY_RUNNING' })
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGKILL'); await exited
      assert.equal(await existingServer(config.dbPath), undefined)
      const restarted = await startRuntime(config, 0)
      await restarted.close()
    } finally { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }) }
  })

  test('an occupied port releases ownership and saved agent settings preserve other keys', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-native-port-'))
    const config = loadConfig({ dataDir })
    const foreign = net.createServer()
    await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve))
    const port = foreign.address().port
    try {
      await assert.rejects(startRuntime(config, port), { code: 'EADDRINUSE' })
      await new Promise(resolve => foreign.close(resolve))
      const runtime = await startRuntime(config, port)
      await runtime.close()
      fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ port: 9999, custom: 'preserved' }))
      saveAgentPreference(config, 'codex')
      const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'))
      assert.equal(saved.port, 9999); assert.equal(saved.custom, 'preserved'); assert.equal(saved.agent, 'codex')
    } finally { foreign.close(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }) }
  })
}
