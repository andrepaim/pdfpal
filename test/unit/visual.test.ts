import test from 'node:test'
import assert from 'node:assert/strict'
import { visualDefinitionV1 as visualDefinition, visualTranscript, type VisualRecord } from '../../src/shared/visual.js'
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

// The HTML export draws with the shared renderer (src/shared/visual-kit), so these assertions hold for both formats.
import { readFileSync } from 'node:fs'
import { visualDefinitionV2, visualFrames } from '../../src/shared/visual.js'

test('HTML exports escape model text and contain only the packaged interaction script', () => {
  const check = (html: string) => {
    assert.equal((html.match(/<script>/g) || []).length, 1)
    assert.equal((html.match(/<script/g) || []).length, 1)
    assert.equal(html.includes('<img'), false)
    assert.match(html, /&lt;script&gt;/)
    assert.match(html, /&lt;img/)
    assert.equal(html.includes('src="https://'), false)
    assert.equal(html.includes('could not be drawn'), false)
    assert.match(html, /data-detail=/)
    assert.match(html, /prefers-reduced-motion/)
    assert.match(html, /@media print/)
  }
  // Format 1, restyled by the renderer.
  const definition = structuredClone(visualFixture)
  definition.title = '</title><script>alert("title")</script>'
  definition.steps[0]!.scene.elements[0]!.detail = '"><img src="https://bad.test" onerror="alert(1)">'
  const record: VisualRecord = { id: 'v', project_id: 'p', status: 'complete', definition, question: 'Concept', references: [], error: null, note_id: null, created_at: new Date().toISOString() }
  const html = visualHtml(record)
  check(html)
  assert.ok((html.match(/<svg[\s>]/g) || []).length >= definition.steps.length)
  assert.throws(() => visualHtml({ ...record, definition: null }), /Wait for/)

  // Format 2: one figure per scene, one step block per beat, hotspot detail kept for the export's own script.
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/visual-v2/resnet.claude.json', import.meta.url), 'utf8'))
  const v2 = visualDefinitionV2.parse(fixture.definition)
  v2.title = '</title><script>alert("title")</script>'
  const flow = v2.scenes.find(scene => scene.kind === 'flow')!
  assert.equal(flow.kind, 'flow')
  if (flow.kind === 'flow') {
    flow.nodes[0]!.detail = '"><img src="https://bad.test" onerror="alert(1)">'
    flow.nodes[1]!.label = '<script>alert(2)</script>'
  }
  v2.scenes[0]!.beats[0]!.caption = '<img src=x onerror=alert(3)>'
  const record2: VisualRecord = { ...record, definition: v2, references: fixture.references }
  const html2 = visualHtml(record2)
  check(html2)
  assert.ok((html2.match(/<svg[\s>]/g) || []).length >= v2.scenes.length)
  assert.equal((html2.match(/class="beat"/g) || []).length, visualFrames(v2).length)
  assert.match(html2, new RegExp(`Step 1 of ${visualFrames(v2).length}`))
  assert.match(html2, /Based on supplied text|Illustrative example|Background knowledge/)

  // Only an embedded data: URL becomes a font; anything else is dropped.
  assert.equal(visualHtml(record2, { fontDataUrl: 'https://fonts.example/inter.woff2' }).includes('fonts.example'), false)
  assert.equal(visualHtml(record2, { fontDataUrl: 'data:font/woff2;base64,AAAA") ; @import url(https://fonts.example' }).includes('fonts.example'), false)
  assert.match(visualHtml(record2, { fontDataUrl: 'data:font/woff2;base64,d09GMgABAAA=' }), /@font-face\{font-family:"Inter Variable"/)
  // A caller-supplied measurer is used for layout.
  let measured = 0
  visualHtml(record2, { measure: (text, size) => { measured++; return text.length * size * 0.6 } })
  assert.ok(measured > 0)
})
