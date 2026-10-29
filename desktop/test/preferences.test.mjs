import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { preferences, restoreBounds, restoreLibraryRoute, safeRoute, startupArguments } from '../src/preferences.mjs'

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

test('Windows startup preserves paths containing spaces as individual arguments', () => {
  const args = startupArguments({ dataDir: 'C:\\My Library', dbPath: 'C:\\My Library\\pdfpal.db', port: 8200 }, 'C:\\Profile Folder')
  assert.deepEqual(args, ['--hidden', '"--data-dir=C:\\My Library"', '"--db=C:\\My Library\\pdfpal.db"', '--port=8200', '"--profile=C:\\Profile Folder"'])
})

test('a saved alpha project missing from the current library reopens home without clearing valid routes', async () => {
  const route = '/projects/00000000-0000-0000-0000-000000000001/chat'
  assert.equal(await restoreLibraryRoute(route, 'http://localhost:8200', async () => new Response('', { status: 404 })), '/')
  assert.equal(await restoreLibraryRoute(route, 'http://localhost:8200', async () => new Response('{}')), route)
  assert.equal(await restoreLibraryRoute(route, 'http://localhost:8200', async () => { throw new Error('offline') }), route)
  assert.equal(await restoreLibraryRoute('/extensions/connect', 'http://localhost:8200', async () => { throw new Error('should not query') }), '/extensions/connect')
})
