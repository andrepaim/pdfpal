import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { preferences, restoreBounds, safeRoute } from '../src/preferences.mjs'

test('window bounds return to an available monitor and fit small displays', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1024, height: 768 } }]
  assert.deepEqual(restoreBounds({ x: 4000, y: -2000, width: 1800, height: 1100 }, displays), { x: 0, y: 0, width: 1024, height: 768 })
  assert.deepEqual(restoreBounds({ x: NaN }, displays), { width: 1024, height: 768 })
})

test('preferences survive relaunch and reject external or malformed routes', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-prefs-'))
  try {
    const file = path.join(folder, 'desktop.json')
    preferences(file).update({ route: '/projects/abc/chat', maximized: true })
    assert.equal(preferences(file).value.route, '/projects/abc/chat')
    assert.equal(preferences(file).value.maximized, true)
    for (const route of ['//example.com', 'https://example.com', '/\\example.com', '/\nexample']) assert.equal(safeRoute(route), '/')
    fs.writeFileSync(file, 'broken json')
    assert.equal(preferences(file).value.route, '/')
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
