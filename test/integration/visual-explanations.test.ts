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

const pq = JSON.parse(fs.readFileSync(path.resolve('test/fixtures/visual-v2/pq.codex.json'), 'utf8')) as { definition: { title: string; scenes: Array<{ beats: Array<Record<string, unknown>> }> } }

// The fake agent answers call N with response-N.json when it exists, otherwise with response.json, and keeps each prompt.
async function setup() {
  const config = testConfig(); config.agent = 'codex'; config.codexBin = path.join(config.dataDir, 'codex-fixture')
  const output = path.join(config.dataDir, 'response.json'), prompt = path.join(config.dataDir, 'prompt.txt'), calls = path.join(config.dataDir, 'calls.txt')
  fs.writeFileSync(output, JSON.stringify(pq.definition))
  fs.writeFileSync(config.codexBin, `#!/usr/bin/env node
if(process.argv.includes('--version')){console.log('codex-cli 0.164.0');process.exit(0)};if(process.argv.includes('--help')){console.log('--tools --strict-mcp-config --disallowedTools --ignore-user-config --ignore-rules --ephemeral --disable');process.exit(0)};if(process.argv.includes('status')){process.exit(1)};
const fs=require('node:fs'),path=require('node:path');const input=fs.readFileSync(0,'utf8');fs.appendFileSync(${JSON.stringify(calls)},'call\\n')
const n=fs.readFileSync(${JSON.stringify(calls)},'utf8').trim().split('\\n').length;fs.writeFileSync(${JSON.stringify(prompt)},input);fs.writeFileSync(${JSON.stringify(prompt)}+'.'+n,input)
const nth=path.join(${JSON.stringify(config.dataDir)},'response-'+n+'.json');setTimeout(()=>process.stdout.write(fs.readFileSync(fs.existsSync(nth)?nth:${JSON.stringify(output)},'utf8')),50);`, { mode: 0o700 })
  const app = await buildServer(config), db = openDatabase(config)
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Visual research' } })).json()
  const other = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Other project' } })).json()
  const callCount = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').length : 0
  const respond = (n: number, text: string) => fs.writeFileSync(path.join(config.dataDir, `response-${n}.json`), text)
  return { app, config, db, project, other, output, prompt, calls, callCount, respond, async close() { await app.close(); db.close(); fs.rmSync(config.dataDir, { recursive: true, force: true }) } }
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
    assert.equal(result.status, 'complete'); assert.equal(result.definition.version, 2); assert.equal(result.definition.scenes.length, pq.definition.scenes.length)
    // The fixture cites pages this request did not supply, so those beats lose the citations and become background.
    assert.equal(JSON.stringify(result.definition).includes('pdf-3'), false); assert.equal(JSON.stringify(result.definition).includes('"basis":"source"'), false)
    assert.match(fs.readFileSync(s.prompt, 'utf8'), /Attention builds context from words/)
    assert.equal(s.callCount(), 1)
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

test('a web visual with a selection page includes that page and its neighbours', async () => {
  const s = await setup()
  try {
    const text = '[Page 1]\nPreceding page about warmup schedules.\n[Page 2]\nSelected sentence about clipping.\n[Page 3]\nFollowing page about divergence.'
    const source = createSource(s.db, s.project.id, text)
    new RetrievalService(s.db).index(source, text)
    const base = `/api/projects/${s.project.id}/visuals`
    const payload = { request_id: randomUUID(), question: 'Explain', source_id: source, selection: 'Selected sentence about clipping.', selection_page: 2 }
    const response = await s.app.inject({ method: 'POST', url: base, payload }); assert.equal(response.statusCode, 202)
    const result = await complete(s.app, `${base}/${response.json().id}`)
    assert.equal(result.status, 'complete')
    const prompt = fs.readFileSync(s.prompt, 'utf8')
    assert.match(prompt, /warmup schedules/); assert.match(prompt, /divergence/)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, request_id: randomUUID(), selection_page: 0 } })).statusCode, 400)
  } finally { await s.close() }
})

test('invalid visuals fail explicitly and retry uses the original context and replaces the failed history card', async () => {
  const s = await setup()
  try {
    fs.writeFileSync(s.output, '<html><script>bad()</script></html>')
    const base = `/api/projects/${s.project.id}/visuals`
    const created = (await s.app.inject({ method: 'POST', url: base, payload: { request_id: randomUUID(), question: 'Preserve this concept', active_source_ids: [] } })).json()
    const failed = await complete(s.app, `${base}/${created.id}`); assert.equal(failed.status, 'failed')
    assert.equal(failed.error, "The assistant's answer was not valid JSON (twice). Use Retry to try again."); assert.equal(s.callCount(), 2)
    assert.equal((await s.app.inject({ url: `/api/projects/${s.project.id}/chat` })).json().messages[1].content, failed.error)
    assert.equal((await s.app.inject({ method: 'POST', url: `${base}/${created.id}/save` })).statusCode, 409)
    fs.writeFileSync(s.output, JSON.stringify(pq.definition))
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

test('visual validation removes unknown references and unknown fields and rejects malformed requests and cross-project sources', async () => {
  const s = await setup()
  try {
    const base = `/api/projects/${s.project.id}/visuals`, payload = { request_id: randomUUID(), question: 'A concept', active_source_ids: [] }
    const source = createSource(s.db, s.other.id)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, source_id: source } })).statusCode, 404)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, selection: 'No source' } })).statusCode, 400)
    assert.equal((await s.app.inject({ method: 'POST', url: base, payload: { ...payload, question: '' } })).statusCode, 400)
    const invented = structuredClone(pq.definition) as typeof pq.definition & Record<string, unknown>
    invented.scenes[0]!.beats[0] = { caption: 'From the paper.', explanation: 'Cited.', basis: 'source', referenceIds: ['invented-page'] }
    invented.script = 'alert(1)'
    fs.writeFileSync(s.output, JSON.stringify(invented))
    const created = (await s.app.inject({ method: 'POST', url: base, payload })).json()
    const result = await complete(s.app, `${base}/${created.id}`)
    assert.equal(result.status, 'complete'); assert.equal(s.callCount(), 1)
    assert.deepEqual(result.definition.scenes[0].beats[0], { caption: 'From the paper.', explanation: 'Cited.', basis: 'background', referenceIds: [] })
    assert.equal(JSON.stringify(result.definition).includes('invented-page'), false); assert.equal('script' in result.definition, false)
  } finally { await s.close() }
})

test('fenced or prose-wrapped answers parse directly, and an unparseable first answer is repaired once with the error', async () => {
  const s = await setup()
  try {
    const base = `/api/projects/${s.project.id}/visuals`
    s.respond(1, `Here is the explanation.\n\n\`\`\`json\n${JSON.stringify(pq.definition, null, 2)}\n\`\`\`\n\nEnjoy!`)
    let created = (await s.app.inject({ method: 'POST', url: base, payload: { request_id: randomUUID(), question: 'Fenced', active_source_ids: [] } })).json()
    assert.equal((await complete(s.app, `${base}/${created.id}`)).status, 'complete'); assert.equal(s.callCount(), 1)
    s.respond(2, 'Here you go: {"version": 2, "title": "Broken",')
    created = (await s.app.inject({ method: 'POST', url: base, payload: { request_id: randomUUID(), question: 'Repair me', active_source_ids: [] } })).json()
    const repaired = await complete(s.app, `${base}/${created.id}`)
    assert.equal(repaired.status, 'complete'); assert.equal(repaired.definition.title, pq.definition.title); assert.equal(s.callCount(), 3)
    const first = fs.readFileSync(`${s.prompt}.2`, 'utf8'), second = fs.readFileSync(`${s.prompt}.3`, 'utf8')
    assert.doesNotMatch(first, /focus|CORRECTION/); assert.match(first, /Repair me/)
    assert.equal(second.startsWith(first.trimEnd()), true)
    assert.match(second, /CORRECTION\nYour previous answer to this request could not be used\. The problem: The answer was not valid JSON: /)
    assert.match(second, /<<<PREVIOUS ANSWER\nHere you go: \{"version": 2, "title": "Broken",\nPREVIOUS ANSWER>>>/)
  } finally { await s.close() }
})

test('a stored version 1 explanation still loads and saves to a note', async () => {
  const s = await setup()
  try {
    const id = randomUUID(), time = new Date().toISOString(), references = [{ id: 'pdf-1', label: 'Old paper · p. 3' }]
    s.db.prepare(`INSERT INTO visual_explanations(id,project_id,request_id,request_hash,question,status,definition_json,references_json,request_json,created_at,updated_at) VALUES (?,?,?,?,?,'complete',?,?,'{}',?,?)`)
      .run(id, s.project.id, randomUUID(), 'hash', 'Old question', JSON.stringify(visualFixture), JSON.stringify(references), time, time)
    const url = `/api/projects/${s.project.id}/visuals/${id}`
    const record = (await s.app.inject({ url })).json()
    assert.equal(record.status, 'complete'); assert.deepEqual(record.definition, visualFixture)
    const note = (await s.app.inject({ method: 'POST', url: `${url}/save` })).json()
    assert.equal(note.title, visualFixture.title)
    assert.match(note.content, /## 1\. Start with a word/); assert.match(note.content, /token being updated/); assert.match(note.content, /Old paper · p\. 3/)
    assert.match(note.content, new RegExp(`/projects/${s.project.id}/visuals/${id}`)); assert.equal(s.callCount(), 0)
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
    assert.equal(turn.status, 'complete'); assert.ok(turn.visual_id); assert.equal(turn.answer.startsWith(`# ${pq.definition.title}`), true)
    const bridge = `/api/extension/projects/${s.project.id}/visuals/${turn.visual_id}`, web = `/api/projects/${s.project.id}/visuals/${turn.visual_id}`
    assert.equal((await s.app.inject({ url: bridge })).statusCode, 401)
    assert.equal((await s.app.inject({ url: web })).statusCode, 404)
    const second = auth.exchange(auth.pairCode().code, origin)
    assert.equal((await s.app.inject({ url: bridge, headers: { ...headers, authorization: `Bearer ${second.token}` } })).statusCode, 404)
    assert.equal((await s.app.inject({ url: bridge, headers })).json().definition.title, pq.definition.title)
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
