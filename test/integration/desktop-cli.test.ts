import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import http from 'node:http'
import { cliPipeName } from '../../src/shared/cli-protocol.js'
import { startRuntime } from '../../src/server/runtime.js'
import { openDatabase } from '../../src/core/database.js'
import { testConfig } from '../helpers/test-utils.js'

async function fixture() {
  const config = testConfig(), profile = path.join(config.dataDir, 'profile')
  fs.mkdirSync(profile)
  const settings = { activeLibrary: 'original', libraries: { original: { label: 'Fixture library', dataDir: config.dataDir, dbPath: config.dbPath } } }
  const filename = path.join(profile, 'desktop.json')
  fs.writeFileSync(filename, JSON.stringify(settings))
  const runtime = await startRuntime(config, 0)
  const env = { ...process.env }
  for (const key of ['PDFPAL_DATA_DIR', 'PDFPAL_DB', 'PDFPAL_CLI_DESKTOP', 'PDFPAL_DESKTOP_BUILD']) delete env[key]
  async function cli(...args: string[]) {
    const result = await promisify(execFile)(process.execPath, ['dist/cli/index.js', '--desktop', '--profile', profile, '--json', ...args], { env, maxBuffer: 1024 * 1024 })
    return JSON.parse(result.stdout)
  }
  async function error(args: string[], code: string, exit: number) {
    await assert.rejects(cli(...args), (caught: any) => {
      assert.equal(caught.code, exit)
      assert.equal(JSON.parse(caught.stderr).error.code, code)
      return true
    })
  }
  return { config, profile, settings, filename, runtime, cli, error, env, async close() { await runtime.close(); fs.rmSync(config.dataDir, { recursive: true, force: true }) } }
}

test('desktop CLI manages the live library with compact retrieval, notes, trash and backups', { timeout: 60000 }, async () => {
  const f = await fixture()
  try {
    const sync = openDatabase(f.config)
    sync.exec("INSERT INTO sync_settings VALUES('enabled','1') ON CONFLICT(key) DO UPDATE SET value='1'")
    sync.close()
    const status = await f.cli('status')
    assert.equal(status.label, 'Fixture library')
    assert.ok(status.capabilities.includes('operation-receipts'))
    const project = await f.cli('project', 'create', 'Research ação 🧪')
    const target = await f.cli('project', 'create', 'Target')
    assert.equal((await f.cli('project', 'list', '--limit', '1')).nextOffset, 1)
    const collection = await f.cli('collection', 'create', project.id, 'Folder')
    const source = await f.cli('source', 'add', project.id, path.resolve('test/fixtures/sample.pdf'), '-t', 'Paper', '-c', collection.id)
    assert.equal('pdf_text' in source, false)
    assert.equal((await f.cli('source', 'add', project.id, path.resolve('test/fixtures/sample.pdf'))).id, source.id)
    assert.equal((await f.cli('source', 'list', project.id)).total, 1)
    const bounded = await f.cli('source', 'text', project.id, source.id, '--page', '1', '--limit', '5')
    assert.equal(bounded.text.length, 5)
    assert.ok(bounded.nextOffset)
    assert.ok((await f.cli('search', project.id, 'test')).length)
    await f.cli('source', 'file', project.id, source.id)
    assert.equal((await f.cli('source', 'show', project.id, source.id)).collection_id, null)
    const markdown = '\n# Olá 🧪\n\n  trailing spaces  \n'
    const file = path.join(f.config.dataDir, 'note.md'); fs.writeFileSync(file, markdown)
    const note = await f.cli('note', 'create', project.id, '--content-file', file, '-t', 'Notes')
    assert.equal(note.content, markdown)
    const edited = await f.cli('note', 'edit', project.id, note.id, '--content', 'New content', '--expect-updated-at', note.updated_at)
    await f.error(['note', 'edit', project.id, note.id, '--content', 'Stale draft', '--expect-updated-at', note.updated_at], 'NOTE_CHANGED', 4)
    assert.equal((await f.cli('note', 'show', project.id, note.id)).content, edited.content)
    await f.cli('source', 'move', project.id, source.id, target.id)
    await f.error(['source', 'remove', target.id, source.id], 'CONFIRMATION_REQUIRED', 2)
    const deleted = await f.cli('--receipt', 'source', 'remove', target.id, source.id, '--yes')
    assert.match(deleted.result.trashId, /^[a-f0-9]{32}$/)
    assert.equal(deleted.result.counts.sources, 1)
    await f.cli('trash', 'restore', deleted.result.trashId)
    assert.equal((await f.cli('source', 'list', target.id)).items[0].id, source.id)
    const backup = await f.cli('backup', 'create')
    assert.equal((await f.cli('backup', 'verify', backup.id)).valid, true)
    assert.equal((await f.cli('backup', 'list')).items[0].id, backup.id)
    const revision = await (await fetch(f.runtime.origin + '/api/library/revision')).json() as { revision: number }
    assert.ok(revision.revision >= 10)
    const db = openDatabase(f.config)
    assert.ok((db.prepare('SELECT COUNT(*) n FROM sync_outbox').get() as { n: number }).n > 0)
    assert.equal((db.prepare('SELECT COUNT(*) n FROM sources').get() as { n: number }).n, 1)
    db.close()
  } finally { await f.close() }
})

test('operation UUIDs survive retries and restarts without duplicate writes', { timeout: 30000 }, async () => {
  const f = await fixture()
  let restarted: Awaited<ReturnType<typeof startRuntime>> | undefined
  try {
    const id = randomUUID()
    const a = await f.cli('--receipt', '--operation', id, 'project', 'create', 'Once')
    assert.equal(a.operationId, id)
    assert.deepEqual(await f.cli('--receipt', '--operation', id, 'project', 'create', 'Once'), a)
    await f.error(['--operation', id, 'project', 'create', 'Different'], 'OPERATION_CONFLICT', 4)
    const importId = randomUUID()
    await f.cli('--receipt', '--no-wait', '--operation', importId, 'source', 'add', a.result.id, path.resolve('test/fixtures/sample.pdf'))
    const imported = await f.cli('--receipt', 'operation', 'wait', importId)
    assert.equal(imported.state, 'completed')
    await f.runtime.close()
    restarted = await startRuntime(f.config, 0)
    assert.equal((await f.cli('--operation', id, 'project', 'create', 'Once')).id, a.result.id)
    assert.equal((await f.cli('project', 'list')).total, 1)
    assert.equal((await f.cli('--receipt', '--operation', importId, 'source', 'add', a.result.id, path.resolve('test/fixtures/sample.pdf'))).result.id, imported.result.id)
  } finally { await restarted?.close(); await f.close() }
})

test('desktop library mismatch, invalid flags and inactive targets do not mutate either library', async () => {
  const f = await fixture(), other = testConfig()
  const db = openDatabase(other); db.close()
  try {
    await f.error(['--expect-library', 'different', 'project', 'create', 'Wrong'], 'LIBRARY_MISMATCH', 4)
    await f.error(['--wait-ms', '-1', 'project', 'create', 'Invalid'], 'INVALID_WAIT', 2)
    const id = randomUUID()
    const settings: any = f.settings
    settings.libraries[id] = { label: 'Recovery', dataDir: other.dataDir, dbPath: other.dbPath }
    fs.writeFileSync(f.filename, JSON.stringify(settings))
    await f.error(['--library', id, 'project', 'create', 'Inactive'], 'LIBRARY_NOT_ACTIVE', 4)
    settings.activeLibrary = id; fs.writeFileSync(f.filename, JSON.stringify(settings))
    await f.error(['--expect-library', f.runtime.identity.library, 'project', 'create', 'Switched'], 'DESKTOP_NOT_RUNNING', 3)
    for (const config of [f.config, other]) {
      const check = openDatabase(config)
      assert.equal((check.prepare('SELECT COUNT(*) n FROM projects').get() as { n: number }).n, 0)
      check.close()
    }
  } finally { await f.close(); fs.rmSync(other.dataDir, { recursive: true, force: true }) }
})

test('local CLI routes require credentials, library and instance; browser origins cannot use them', async () => {
  const f = await fixture()
  try {
    const owner = JSON.parse(fs.readFileSync(f.config.dbPath + '.server.json', 'utf8'))
    const route = f.runtime.origin + '/api/cli/v1/status'
    assert.equal((await fetch(route)).status, 403)
    const headers = { 'x-pdfpal-cli': owner.cliSecret, 'x-pdfpal-library': owner.library, 'x-pdfpal-instance': owner.instance }
    assert.equal((await fetch(route, { headers })).status, 200)
    assert.equal((await fetch(route, { headers: { ...headers, 'x-pdfpal-library': 'wrong' } })).status, 409)
    assert.equal((await fetch(route, { headers: { ...headers, 'x-pdfpal-instance': 'wrong' } })).status, 409)
    assert.equal((await fetch(route, { headers: { ...headers, origin: 'https://example.com' } })).status, 403)
    const response = await (await fetch(route, { headers })).text()
    assert.equal(response.includes(owner.cliSecret), false)
    assert.equal(response.includes(owner.secret), false)
  } finally { await f.close() }
})

test('desktop JSON stdin preserves Markdown and command titles do not switch CLI modes', async () => {
  const f = await fixture()
  try {
    const project = await f.cli('project', 'create', 'status')
    const markdown = '\nPowerShell quotes " and apostrophe \' — ação\n\n'
    const result = await new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, ['dist/cli/index.js', '--desktop', '--profile', f.profile, '--json', 'note', 'create', project.id], { env: f.env, stdio: 'pipe' })
      let output = '', error = ''
      child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { error += c })
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)))
      child.stdin.end(markdown)
    })
    assert.equal(result.content, markdown)
  } finally { await f.close() }
})

test('JSON argument files preserve literal option-like data and reject invalid payloads', async () => {
  const f = await fixture()
  try {
    const project = await f.cli('project', 'create', 'Literal data')
    const filename = path.join(f.config.dataDir, 'args.json')
    fs.writeFileSync(filename, JSON.stringify({ args: ['--desktop', '--profile', f.profile, '--json', 'note', 'create', project.id, '--content', '--standalone'] }))
    const result = await promisify(execFile)(process.execPath, ['dist/cli/index.js', '--request-file', filename], { env: f.env })
    assert.equal(JSON.parse(result.stdout).content, '--standalone')
    assert.equal(JSON.parse(result.stdout).project_id, project.id)
    fs.writeFileSync(filename, JSON.stringify({ args: [42] }))
    await assert.rejects(promisify(execFile)(process.execPath, ['dist/cli/index.js', '--json', '--request-file', filename], { env: f.env }), (error: any) => {
      assert.equal(error.code, 2); assert.equal(JSON.parse(error.stderr).error.code, 'INVALID_REQUEST_FILE'); return true
    })
  } finally { await f.close() }
})

test('a false runtime identity cannot collect the command credential or owner secret', async () => {
  const f = await fixture(), filename = f.config.dbPath + '.server.json', original = fs.readFileSync(filename, 'utf8')
  const owner = JSON.parse(original), instance = randomUUID()
  const received: http.IncomingHttpHeaders[] = []
  const fake = http.createServer((request, response) => {
    received.push(request.headers)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ protocol: 1, instance, library: owner.library, proof: '0'.repeat(64) }))
  })
  if (process.platform === 'win32') await new Promise<void>(resolve => fake.listen(cliPipeName(instance), resolve))
  else await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve))
  try {
    fs.writeFileSync(filename, JSON.stringify({ ...owner, instance,
      ...(process.platform === 'win32' ? { cliPipe: cliPipeName(instance) } : { origin: 'http://127.0.0.1:' + (fake.address() as {port:number}).port }) }))
    await f.error(['status'], 'LIBRARY_MISMATCH', 4)
    assert.equal(received.length, 1)
    assert.equal(Boolean(received[0]!['x-pdfpal-owner']), false)
    assert.equal(Boolean(received[0]!['x-pdfpal-cli']), false)
    assert.equal(typeof received[0]!['x-pdfpal-challenge'], 'string')
  } finally { fs.writeFileSync(filename, original); await new Promise<void>(resolve => fake.close(() => resolve())); await f.close() }
})
