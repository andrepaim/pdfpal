import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../../src/server/app.js'
import { openDatabase } from '../../src/core/database.js'
import { digest, ExtensionAuth } from '../../src/core/extension-auth.js'
import { createSource, testConfig } from '../helpers/test-utils.js'
import { RetrievalService } from '../../src/core/retrieval.js'

const origin = `chrome-extension://${'a'.repeat(32)}`
const capture = { text: 'Reading connects new ideas with what we already know.', originalText: 'Reading connects new ideas with what we already know.',
  metadata: { title: 'A Test Book', author: 'Test Author', location: 'Location 420', asin: 'TESTBOOK01', url: 'https://read.amazon.com/?asin=TESTBOOK01' },
  method: 'text', capturedAt: '2026-10-23T12:00:00.000Z' }
async function setup() {
  const config = testConfig()
  const promptFile = path.join(config.dataDir, 'prompt.txt')
  config.claudeBin = path.join(config.dataDir, 'fake-agent')
  fs.writeFileSync(config.claudeBin, `#!/usr/bin/env node\nconst fs=require('node:fs');const prompt=fs.readFileSync(0,'utf8');fs.writeFileSync(${JSON.stringify(promptFile)},prompt);setTimeout(()=>process.stdout.write('# Explanation\\n\\nThis connects the passage to earlier knowledge.'),100);\n`, { mode: 0o700 })
  const app = await buildServer(config), db = openDatabase(config), auth = new ExtensionAuth(db)
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Kindle test' } })).json()
  const pair = await app.inject({ method: 'POST', url: '/api/extension/pair', payload: { code: auth.pairCode().code, origin }, headers: { origin } })
  assert.equal(pair.statusCode, 200)
  const { token, client_id } = pair.json()
  const headers = { authorization: `Bearer ${token}`, origin }
  return { app, config, db, auth, project, token, client_id, headers, promptFile,
    async close() { await app.close(); db.close(); fs.rmSync(config.dataDir, { recursive: true, force: true }) } }
}
async function finished(app: Awaited<ReturnType<typeof buildServer>>, headers: Record<string, string>, id: string) {
  for (let i = 0; i < 100; i++) {
    const response = await app.inject({ url: `/api/extension/turns/${id}`, headers })
    const turn = response.json()
    if (turn.status === 'complete' || turn.status === 'failed') return turn
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Agent did not finish')
}

test('pair codes are single use, token hashes are stored, and bridge checks authority', async () => {
  const state = await setup()
  try {
    const { app, auth, db, headers, token, client_id } = state
    assert.equal((await app.inject({ url: '/api/extension/projects' })).statusCode, 401)
    assert.equal((await app.inject({ url: '/api/extension/projects', headers: { ...headers, origin: 'https://read.amazon.com' } })).statusCode, 403)
    assert.equal((await app.inject({ url: '/api/extension/projects', headers: { ...headers, origin: `chrome-extension://${'b'.repeat(32)}` } })).statusCode, 401)
    assert.equal((await app.inject({ url: '/api/extension/projects', headers: { ...headers, host: 'evil.test' } })).statusCode, 403)
    assert.equal((await app.inject({ url: '/api/extension/projects', headers, remoteAddress: '192.168.1.20' })).statusCode, 403)
    const code = auth.pairCode().code
    const exchange = () => app.inject({ method: 'POST', url: '/api/extension/pair', headers: { origin }, payload: { code, origin } })
    assert.equal((await exchange()).statusCode, 200); assert.equal((await exchange()).statusCode, 401)
    const expired = auth.pairCode().code
    db.prepare('UPDATE extension_pair_codes SET expires_at=0 WHERE code_hash=?').run(digest(expired))
    assert.equal((await app.inject({ method: 'POST', url: '/api/extension/pair', payload: { code: expired, origin } })).statusCode, 401)
    assert.notEqual((db.prepare('SELECT token_hash FROM extension_clients WHERE id=?').get(client_id) as { token_hash: string }).token_hash, token)
    auth.revoke(client_id)
    assert.equal((await app.inject({ url: '/api/extension/projects', headers })).statusCode, 401)
  } finally { await state.close() }
})

test('passage chat works without PDFs, persists exact context, and supports idempotent follow-ups and notes', async () => {
  const state = await setup()
  try {
    const { app, headers, project, db, promptFile } = state
    const payload = { request_id: randomUUID(), project_id: project.id, capture, question: 'Explain this passage.', include_project: false }
    const response = await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload })
    assert.equal(response.statusCode, 202)
    const turn = await finished(app, headers, response.json().id)
    assert.equal(turn.status, 'complete'); assert.match(turn.answer, /earlier knowledge/)
    assert.match(fs.readFileSync(promptFile, 'utf8'), /Location 420/)
    const duplicate = await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload })
    assert.equal(duplicate.json().id, turn.id)
    assert.equal((await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload: { ...payload, question: 'Changed' } })).statusCode, 409)
    const second = await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload: { ...payload, request_id: randomUUID(), question: 'Give an example.' } })
    assert.equal((await finished(app, headers, second.json().id)).status, 'complete')
    assert.match(fs.readFileSync(promptFile, 'utf8'), /Explain this passage/)
    const history = await app.inject({ method: 'POST', url: '/api/extension/history', headers, payload: { project_id: project.id, metadata: capture.metadata } })
    assert.equal(history.json().turns.length, 2)
    const save = { request_id: randomUUID(), project_id: project.id, capture, turn_id: turn.id }
    const note = await app.inject({ method: 'POST', url: '/api/extension/notes', headers, payload: save })
    assert.equal(note.statusCode, 200); assert.match(note.json().content, /Location 420/); assert.match(note.json().content, /## Answer/)
    assert.equal((await app.inject({ method: 'POST', url: '/api/extension/notes', headers, payload: save })).json().id, note.json().id)
    assert.equal((db.prepare('SELECT COUNT(*) n FROM notes').get() as { n: number }).n, 1)
    assert.equal((await app.inject({ url: `/api/projects/${project.id}/notes/${note.json().id}` })).statusCode, 200)
  } finally { await state.close() }
})

test('sessions and answers stay within their client, project and book and retrieval is opt in', async () => {
  const state = await setup()
  try {
    const { app, headers, project, auth, db, promptFile } = state
    const source = createSource(db, project.id, '[Page 8]\nReading connects ideas to scientific knowledge.')
    new RetrievalService(db).index(source, '[Page 8]\nReading connects ideas to scientific knowledge.')
    const ask = async (include_project: boolean) => {
      const result = await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload: { request_id: randomUUID(), project_id: project.id, capture, question: 'Reading knowledge', include_project } })
      return finished(app, headers, result.json().id)
    }
    const first = await ask(false)
    assert.deepEqual(first.research, [])
    const second = await ask(true)
    assert.equal(second.research[0].page_number, 8); assert.match(fs.readFileSync(promptFile, 'utf8'), /Test Source/)
    const otherProject = (await app.inject({ method: 'POST', url: '/api/projects', payload: { title: 'Other' } })).json()
    for (const body of [{ project_id: otherProject.id, metadata: capture.metadata }, { project_id: project.id, metadata: { ...capture.metadata, asin: 'OTHERBOOK1', url: 'https://read.amazon.com/?asin=OTHERBOOK1' } }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/extension/history', headers, payload: body })).json().turns.length, 0)
    }
    const badSave = await app.inject({ method: 'POST', url: '/api/extension/notes', headers, payload: { request_id: randomUUID(), project_id: otherProject.id, capture, turn_id: second.id } })
    assert.equal(badSave.statusCode, 404)
    const other = auth.exchange(auth.pairCode().code, origin)
    assert.equal((await app.inject({ url: `/api/extension/turns/${first.id}`, headers: { origin, authorization: `Bearer ${other.token}` } })).statusCode, 404)
    const invalid = await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload: { request_id: randomUUID(), project_id: project.id, capture: { ...capture, metadata: { ...capture.metadata, url: 'https://evil.test/' } }, question: 'Explain' } })
    assert.equal(invalid.statusCode, 400)
  } finally { await state.close() }
})

test('failed and interrupted jobs are recoverable without replaying an AI request', async () => {
  const state = await setup()
  try {
    const { app, config, headers, project, db } = state
    fs.unlinkSync(config.claudeBin)
    const payload = { request_id: randomUUID(), project_id: project.id, capture, question: 'Explain', include_project: false }
    const response = await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload })
    const result = await finished(app, headers, response.json().id)
    assert.equal(result.status, 'failed'); assert.match(result.error, /not installed/)
    db.prepare("UPDATE kindle_turns SET status='running',error=NULL WHERE id=?").run(result.id)
    const interrupted = (await app.inject({ url: `/api/extension/turns/${result.id}`, headers })).json()
    assert.equal(interrupted.status, 'failed'); assert.match(interrupted.error, /restarted/)
    const retry = await app.inject({ method: 'POST', url: '/api/extension/turns', headers, payload })
    assert.equal(retry.json().id, result.id); assert.equal(retry.json().status, 'failed')
  } finally { await state.close() }
})

test('book questions work without a selection and use this book’s saved excerpts without claiming full-book access', async () => {
  const state = await setup()
  try {
    const { app, headers, project, promptFile } = state
    const bookCapture = { ...capture, text: '', originalText: '', scope: 'book' }
    const ask = async () => {
      const response = await app.inject({ method: 'POST', url: '/api/extension/turns', headers,
        payload: { request_id: randomUUID(), project_id: project.id, capture: bookCapture, question: 'What is this book about?' } })
      assert.equal(response.statusCode, 202)
      return finished(app, headers, response.json().id)
    }
    assert.equal((await ask()).status, 'complete')
    let prompt = fs.readFileSync(promptFile, 'utf8')
    assert.match(prompt, /Scope: book/); assert.match(prompt, /not the entire book/)
    assert.match(prompt, /A Test Book/)
    assert.equal((await app.inject({ method: 'POST', url: '/api/extension/notes', headers,
      payload: { request_id: randomUUID(), project_id: project.id, capture } })).statusCode, 200)
    const result = await ask()
    prompt = fs.readFileSync(promptFile, 'utf8')
    assert.match(prompt, /Reading connects new ideas/)
    assert.match(prompt, /Previously captured excerpts/)
    const savedAnswer = await app.inject({ method: 'POST', url: '/api/extension/notes', headers,
      payload: { request_id: randomUUID(), project_id: project.id, capture: bookCapture, turn_id: result.id } })
    assert.equal(savedAnswer.statusCode, 200); assert.match(savedAnswer.json().content, /Asked about the book/)
    const invalidSelection = await app.inject({ method: 'POST', url: '/api/extension/turns', headers,
      payload: { request_id: randomUUID(), project_id: project.id, capture: { ...bookCapture, scope: 'selection' }, question: 'Explain' } })
    assert.equal(invalidSelection.statusCode, 400)
    const cleared = await app.inject({ method: 'POST', url: '/api/extension/history/clear', headers, payload: { project_id: project.id, metadata: capture.metadata } })
    assert.equal(cleared.statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: '/api/extension/history', headers,
      payload: { project_id: project.id, metadata: capture.metadata } })).json().turns.length, 0)
    assert.equal((await app.inject({ url: `/api/projects/${project.id}/notes` })).json().length, 2)
  } finally { await state.close() }
})
