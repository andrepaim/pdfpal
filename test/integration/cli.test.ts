import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

function runCli(dataDir: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(process.execPath, ['dist/cli/index.js', ...args], {
    cwd: path.resolve('.'), env: { ...process.env, PDFPAL_DATA_DIR: dataDir, ...extraEnv }, encoding: 'utf8',
  })
}

test('compiled CLI supports JSON project workflows', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-'))
  try {
    const created = JSON.parse(runCli(dataDir, ['project', 'create', 'CLI Project', '--json'])) as { id: string; title: string }
    assert.equal(created.title, 'CLI Project')
    const listed = JSON.parse(runCli(dataDir, ['project', 'list', '--json'])) as Array<{ id: string }>
    assert.equal(listed[0]?.id, created.id)
    assert.equal(JSON.parse(runCli(dataDir, ['project', 'show', created.id, '--json'])).id, created.id)
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI supports source lifecycle and project moves', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-source-'))
  try {
    runCli(dataDir, ['project', 'create', 'From', '--json'])
    runCli(dataDir, ['project', 'create', 'To', '--json'])
    const source = JSON.parse(runCli(dataDir, ['source', 'add', 'From', path.resolve('test/fixtures/sample.pdf'), '--title', 'Paper', '--json'])) as { id: string }
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'list', 'From', '--json'])).length, 1)
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'rename', 'From', source.id, 'Renamed', '--json'])).title, 'Renamed')
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'reindex', 'From', source.id, '--json'])).chunks_indexed, 2)
    assert.equal(JSON.parse(runCli(dataDir, ['source', 'move', 'From', source.id, 'To', '--json'])).project_id,
      JSON.parse(runCli(dataDir, ['project', 'show', 'To', '--json'])).id)
    runCli(dataDir, ['source', 'remove', 'To', source.id, '--yes', '--json'])
    assert.deepEqual(JSON.parse(runCli(dataDir, ['source', 'list', 'To', '--json'])), [])
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI returns structured errors and stable exit codes', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-error-'))
  try {
    const result = spawnSync(process.execPath, ['dist/cli/index.js', 'project', 'show', 'missing', '--json'], {
      cwd: path.resolve('.'), env: { ...process.env, PDFPAL_DATA_DIR: dataDir }, encoding: 'utf8',
    })
    assert.equal(result.status, 3)
    assert.equal(JSON.parse(result.stderr).error.code, 'PROJECT_NOT_FOUND')
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI ask help has no Tavily web-search option', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-help-'))
  try {
    const help = runCli(dataDir, ['ask', '--help'])
    assert.equal(help.includes('--no-web'), false)
    assert.equal(help.includes('Tavily'), false)
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})

test('compiled CLI rejects the removed web-search option', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-cli-no-web-'))
  try {
    const result = spawnSync(process.execPath, ['dist/cli/index.js', 'ask', 'missing', 'question', '--no-web'], {
      cwd: path.resolve('.'), env: { ...process.env, PDFPAL_DATA_DIR: dataDir }, encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unknown option '--no-web'/)
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
})
