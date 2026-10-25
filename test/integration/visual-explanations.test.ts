import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../../src/server/app.js'
import { openDatabase } from '../../src/core/database.js'
import { ExtensionAuth } from '../../src/core/extension-auth.js'
import { RetrievalService } from '../../src/core/retrieval.js'
import { testConfig, createSource } from '../helpers/test-utils.js'
import { visualFixture } from '../fixtures/visual.js'

async function setup() {
  const config = testConfig(); config.agent = 'codex'; config.codexBin = path.join(config.dataDir, 'codex-fixture')
  const output = path.join(config.dataDir, 'response.json'), prompt = path.join(config.dataDir, 'prompt.txt'), calls = path.join(config.dataDir, 'calls.txt')
  fs.writeFileSync(output, JSON.stringify(visualFixture))
  fs.writeFileSync(config.codexBin, `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(prompt)},fs.readFileSync(0,'utf8'));fs.appendFileSync(${JSON.stringify(calls)},'call\\n');setTimeout(()=>process.stdout.write(fs.readFileSync(${JSON.stringify(output)},'utf8')),100);`, { mode: 0o700 })
  const app = await buildServer(config), db = openDatabase(config)
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Visual research' } })).json()
  const other = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Other project' } })).json()
  return { app, config, db, project, other, output, prompt, calls, async close() { await app.close(); db.close(); fs.rmSync(config.dataDir, { recursive: true, force: true }) } }
}
async function complete(app: Awaited<ReturnType<typeof buildServer>>, url: string, headers?: Record<string, string>) {
  for (let i = 0; i < 150; i++) {
    const response = await app.inject({ url, headers }); assert.equal(response.statusCode, 200)
    const result = response.json()
    if (result.status === 'complete' || result.status === 'failed') return result
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Visual fixture did not finish')
}

test('web visuals preserve source scope and history, deduplicate generation, and save a reusable project note', async () => {
  const s = await setup()
  try {
    const source = createSource(s.db, s.project.id, '[Page 4]\nAttention builds context from words.')
    new RetrievalService(s.db).index(source, '[Page 4]\nAttention builds context from words.')
    const payload = { request_id: randomUUID(), question: 'Explain attention visually', source_id: source, selection: 'Attention builds context from words.' }
    const base = `/api/projects/${s.project.id}/visuals`
    const response = await s.app.inject({ method: 'POST', url: base, payload }); assert.equal(response.statusCode, 202)
    const id = response.json().id
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload })).json().id, id)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, question: 'Changed' } })).statusCode, 409)
    const result = await complete(s.app, `${base}/${id}`)
    assert.equal(result.status, 'complete'); assert.equal(result.definition.steps.length, 3)
    assert.match(fs.readFileSync(s.prompt, 'utf8'), /Attention builds context from words/)
    assert.equal(fs.readFileSync(s.calls, 'utf8').trim().split('\n').length, 1)
    const history = (await s.app.inject({ url: `/api/projects/${s.project.id}/sources/${source}/chat` })).json().messages
    assert.equal(history.length, 2); assert.equal(history[1].visual_id, id); assert.match(history[1].content, /Takeaways/)
    assert.equal((await s.app.inject({ url: `/api/projects/${s.other.id}/visuals/${id}` })).statusCode, 404)
    const note = (await s.app.inject({ method: 'POST', url: `${base}/${id}/save` })).json()
    assert.equal(note.source_id, source)
    assert.match(note.content, new RegExp(`/projects/${s.project.id}/visuals/${id}`))
    assert.equal((await s.app.inject({ method: 'POST', url: `${base}/${id}/save` })).json().id, note.id)
    assert.equal((s.db.prepare('SELECT COUNT(*) n FROM notes').get() as { n: number }).n, 1)
  } finally { await s.close() }
})

test('invalid visuals fail explicitly and retry uses the original context and replaces the failed history card', async () => {
  const s = await setup()
  try {
    fs.writeFileSync(s.output, '<html><script>bad()</script></html>')
    const base = `/api/projects/${s.project.id}/visuals`
    const created = (await s.app.inject({ method: 'POST', url: base, payload: { request_id: randomUUID(), question: 'Preserve this concept', active_source_ids: [] } })).json()
    const failed = await complete(s.app, `${base}/${created.id}`); assert.equal(failed.status, 'failed'); assert.match(failed.error, /valid visual/)
    assert.equal((await s.app.inject({ method: 'POST', url: `${base}/${created.id}/save` })).statusCode, 409)
    fs.writeFileSync(s.output, JSON.stringify(visualFixture))
    const payload = { request_id: randomUUID() }
    const retry = (await s.app.inject({ method: 'POST', url: `${base}/${created.id}/retry`, payload })).json()
    assert.notEqual(retry.id, created.id)
    assert.equal((await s.app.inject({ method: 'POST', url: `${base}/${created.id}/retry`, payload })).json().id, retry.id)
    assert.equal((await complete(s.app, `${base}/${retry.id}`)).status, 'complete')
    const history = (await s.app.inject({ url: `/api/projects/${s.project.id}/chat` })).json().messages
    assert.equal(history.length, 2); assert.equal(history[1].visual_id, retry.id)
    assert.match(fs.readFileSync(s.prompt, 'utf8'), /Preserve this concept/)
    assert.equal((await s.app.inject({ method: 'POST', url: `${base}/${retry.id}/retry`, payload: { request_id: randomUUID() } })).statusCode, 409)
  } finally { await s.close() }
})

test('visual validation rejects unknown references, malformed scenes, and cross-project sources', async () => {
  const s = await setup()
  try {
    const base = `/api/projects/${s.project.id}/visuals`, payload = { request_id: randomUUID(), question: 'A concept', active_source_ids: [] }
    const source = createSource(s.db, s.other.id)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, source_id: source } })).statusCode, 404)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, selection: 'No source' } })).statusCode, 400)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, question: '' } })).statusCode, 400)
    const invalid = structuredClone(visualFixture); invalid.steps[0]!.referenceIds = ['invented-page']
    fs.writeFileSync(s.output, JSON.stringify(invalid))
    let created = (await s.app.inject({ method: 'POST', url: base, payload })).json()
    assert.match((await complete(s.app, `${base}/${created.id}`)).error, /unavailable source/)
    fs.writeFileSync(s.output, JSON.stringify({ ...visualFixture, script: 'alert(1)' }))
    created = (await s.app.inject({ method: 'POST', url: base, payload: { ...payload, request_id: randomUUID() } })).json()
    assert.match((await complete(s.app, `${base}/${created.id}`)).error, /format requirements/)
  } finally { await s.close() }
})

test('Kindle visuals use the same renderer data and remain private to the paired client until saved to the project', async () => {
  const s = await setup()
  try {
    const auth = new ExtensionAuth(s.db), origin = `chrome-extension://${'a'.repeat(32)}`
    const pair = auth.exchange(auth.pairCode().code, origin), headers = { origin, authorization: `Bearer ${pair.token}` }
    const capture = { text: 'Attention adds context.', originalText: 'Attention adds context.', metadata: { title: 'Test book', author: 'Test author', location: 'Location 42', asin: 'TESTBOOK01', url: 'https://read.amazon.com/?asin=TESTBOOK01' }, method: 'text', capturedAt: new Date().toISOString(), scope: 'selection' }
    const response = await s.app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload: { request_id: randomUUID(), project_id: s.project.id, capture, question: 'Explain visually', response_mode: 'visual' } })
    assert.equal(response.statusCode, 202)
    const turn = await complete(s.app, `/api/extension/turns/${response.json().id}`, headers)
    assert.equal(turn.status, 'complete'); assert.ok(turn.visual_id); assert.match(turn.answer, /How attention builds context/)
    const bridge = `/api/extension/projects/${s.project.id}/visuals/${turn.visual_id}`, web = `/api/projects/${s.project.id}/visuals/${turn.visual_id}`
    assert.equal((await s.app.inject({ url: bridge })).statusCode, 401)
    assert.equal((await s.app.inject({ url: web })).statusCode, 404)
    const second = auth.exchange(auth.pairCode().code, origin)
    assert.equal((await s.app.inject({ url: bridge, headers: { ...headers, authorization: `Bearer ${second.token}` } })).statusCode, 404)
    assert.equal((await s.app.inject({ url: bridge, headers })).json().definition.title, visualFixture.title)
    const note = await s.app.inject({ method: 'POST', url: `${bridge}/save`, headers }); assert.equal(note.statusCode, 200)
    assert.equal((await s.app.inject({ url: web })).statusCode, 200)
    assert.equal((await s.app.inject({ method: 'POST', url: `${bridge}/save`, headers })).json().id, note.json().id)
    assert.match(fs.readFileSync(s.prompt, 'utf8'), /Location 42/)
  } finally { await s.close() }
})

test('interrupted visual generation is identified after restart without replaying the agent', async () => {
  const s = await setup()
  try {
    const id = randomUUID(), time = new Date().toISOString()
    s.db.prepare(`INSERT INTO visual_explanations(id,project_id,request_id,request_hash,question,status,references_json,request_json,created_at,updated_at) VALUES (?,?,?,?,?,'running','[]','{}',?,?)`)
      .run(id, s.project.id, randomUUID(), 'hash', 'Interrupted', time, time)
    const result = (await s.app.inject({ url: `/api/projects/${s.project.id}/visuals/${id}` })).json()
    assert.equal(result.status, 'failed'); assert.match(result.error, /restarted/); assert.equal(fs.existsSync(s.calls), false)
  } finally { await s.close() }
})
