import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { startRuntime, existingServer } from '../../src/server/runtime.js'
import { testConfig } from '../helpers/test-utils.js'
import { openDatabase } from '../../src/core/database.js'

test('server lease prevents duplicate ownership and validates a running endpoint', async () => {
  const config = testConfig()
  const runtime = await startRuntime(config, 0)
  try {
    assert.equal(await existingServer(config.dbPath), runtime.origin)
    await assert.rejects(startRuntime(config, 0), { code: 'SERVER_ALREADY_RUNNING' })
    const db = openDatabase(config)
    db.prepare("INSERT INTO projects(id,title,description,created_at,accessed_at) VALUES ('cli','Concurrent CLI','','now','now')").run()
    db.close()
    const projects = await (await fetch(`${runtime.origin}/api/projects`)).json() as Array<{ id: string }>
    assert.ok(projects.some(project => project.id === 'cli'))
    const privateFile = `${config.dbPath}.server.json`
    const owner = JSON.parse(fs.readFileSync(privateFile, 'utf8'))
    fs.writeFileSync(privateFile, JSON.stringify({ ...owner, secret: 'wrong-owner' }))
    assert.equal(await existingServer(config.dbPath), undefined)
    fs.writeFileSync(privateFile, JSON.stringify(owner))
  } finally { await runtime.close() }
  assert.equal(fs.existsSync(`${config.dbPath}.server.json`), false)
  const restarted = await startRuntime(config, 0)
  await restarted.close()
  fs.rmSync(config.dataDir, { recursive: true, force: true })
})

test('closing does not wait for spare connections that never send a request', async () => {
  const config = testConfig()
  const runtime = await startRuntime(config, 0)
  const url = new URL(runtime.origin)
  const spares: net.Socket[] = []
  const spare = () => { const socket = net.connect({ host: url.hostname, port: Number(url.port) }); socket.on('error', () => {}); spares.push(socket); return socket }
  try {
    // A browser keeps spare connections like these. Node counts a connection that has sent nothing as busy,
    // so closing idle connections leaves it open until the headers timeout. The stall this guards against was
    // only reproduced on macOS (about one app launch in fifteen), so this test states the requirement; it does
    // not fail on Linux when the fix is removed.
    const early = spare()
    await new Promise<void>(resolve => early.once('connect', resolve))
    assert.equal((await fetch(`${runtime.origin}/api/health`)).status, 200)
    const started = Date.now()
    let timer: NodeJS.Timeout | undefined
    const closing = runtime.close().then(() => true)
    // More arrive while the server is closing, before it stops listening (seen on macOS when the window closes).
    spare(); queueMicrotask(spare); process.nextTick(spare); setImmediate(spare)
    for (const delay of [0, 1, 2, 3, 5, 8]) setTimeout(spare, delay)
    const closed = await Promise.race([closing, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5000) })])
    clearTimeout(timer)
    assert.equal(closed, true, 'close was still waiting after 5 seconds')
    assert.ok(Date.now() - started < 5000)
  } finally { for (const socket of spares) socket.destroy(); fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})

test('newer schemas are rejected without changing the database', () => {
  const config = testConfig(), db = openDatabase(config)
  db.prepare("INSERT INTO schema_migrations VALUES (999,'future')").run()
  db.close()
  const before = fs.readFileSync(config.dbPath)
  assert.throws(() => openDatabase(config), { code: 'NEWER_DATABASE' })
  assert.deepEqual(fs.readFileSync(config.dbPath), before)
  fs.rmSync(config.dataDir, { recursive: true, force: true })
})

test('concurrent CLI startup serializes fresh migration and retains every write', async () => {
  const config = testConfig()
  try {
    await Promise.all(Array.from({ length: 4 }, (_, i) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['dist/cli/index.js', '--json', 'project', 'create', `Concurrent ${i}`], {
        env: { ...process.env, PDFPAL_DATA_DIR: config.dataDir, PDFPAL_DB: config.dbPath }, stdio: 'pipe',
      })
      let error = ''
      child.stdout.resume(); child.stderr.on('data', chunk => { error += chunk })
      child.on('error', reject)
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(error)))
    })))
    const db = openDatabase(config)
    assert.equal((db.prepare('SELECT COUNT(*) count FROM projects').get() as { count: number }).count, 4)
    db.close()
  } finally { fs.rmSync(config.dataDir, { recursive: true, force: true }) }
})
