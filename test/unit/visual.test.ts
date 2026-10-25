import test from 'node:test'
import assert from 'node:assert/strict'
import { visualDefinition, visualTranscript, type VisualRecord } from '../../src/shared/visual.js'
import { visualFixture } from '../fixtures/visual.js'
import { visualHtml, wrapLabel } from '../../frontend/src/lib/visual-html.ts'

test('visual scene validation rejects executable fields, invalid geometry, duplicate IDs and false source attribution', () => {
  assert.equal(visualDefinition.safeParse(visualFixture).success, true)
  assert.equal(visualDefinition.safeParse({ ...visualFixture, html: '<script>bad()</script>' }).success, false)
  const geometry = structuredClone(visualFixture)
  geometry.steps[0]!.scene.elements.push({ type: 'node', id: 'outside', x: 350, y: 20, width: 100, height: 80, label: 'Outside', color: 'indigo', shape: 'box' })
  assert.equal(visualDefinition.safeParse(geometry).success, false)
  const duplicate = structuredClone(visualFixture)
  duplicate.steps[0]!.scene.elements[1]!.id = duplicate.steps[0]!.scene.elements[0]!.id
  assert.equal(visualDefinition.safeParse(duplicate).success, false)
  const attribution = structuredClone(visualFixture); attribution.steps[0]!.basis = 'source'
  assert.equal(visualDefinition.safeParse(attribution).success, false)
  assert.match(visualTranscript(visualFixture), /token being updated/)
  assert.ok(wrapLabel('context-dependent representations', 130).length > 1)
})

test('HTML exports escape model text and contain only the packaged interaction script', () => {
  const definition = structuredClone(visualFixture)
  definition.title = '</title><script>alert("title")</script>'
  definition.steps[0]!.scene.elements[0]!.detail = '"><img src="https://bad.test" onerror="alert(1)">'
  const record: VisualRecord = { id: 'v', project_id: 'p', status: 'complete', definition, question: 'Concept', references: [], error: null, note_id: null, created_at: new Date().toISOString() }
  const html = visualHtml(record)
  assert.equal((html.match(/<script>/g) || []).length, 1)
  assert.equal(html.includes('<img'), false)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;img/)
  assert.equal(html.includes('src="https://'), false)
  assert.match(html, /data-detail=/)
  assert.match(html, /prefers-reduced-motion/)
  assert.throws(() => visualHtml({ ...record, definition: null }), /Wait for/)
})
