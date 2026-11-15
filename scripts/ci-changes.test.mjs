import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { documentationOnly, classifyChanges } from './ci-changes.mjs'

function repository() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-ci-scope-'))
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'master')
  const write = (name, text = 'example') => { fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true }); fs.writeFileSync(path.join(cwd, name), text) }
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD') }
  const pr = (base, head) => ({ pull_request: { base: { sha: base }, head: { sha: head } } })
  return { cwd, git, write, commit, pr, close: () => fs.rmSync(cwd, { recursive: true, force: true }) }
}

test('documentation/media edits, additions and deletions take the short path for PRs and pushes', () => {
  const r = repository()
  try {
    r.write('README.md'); const base = r.commit()
    r.git('rm', 'README.md'); r.write('docs/reader.md'); r.write('screenshots/example image.png'); const head = r.commit()
    assert.equal(classifyChanges('pull_request', r.pr(base, head), r.cwd).runFull, false)
    assert.equal(classifyChanges('push', { before: base, after: head }, r.cwd).runFull, false)
  } finally { r.close() }
})

test('the complete PR keeps an earlier code edit even when the last commit only changes docs', () => {
  const r = repository()
  try {
    r.write('src/server.ts', 'before'); const base = r.commit()
    r.write('src/server.ts', 'after'); r.commit()
    r.write('README.md'); const head = r.commit()
    assert.equal(classifyChanges('pull_request', r.pr(base, head), r.cwd).runFull, true)
  } finally { r.close() }
})

test('PR comparison ignores code merged only into the target branch', () => {
  const r = repository()
  try {
    r.write('README.md'); r.commit()
    r.git('checkout', '-b', 'docs')
    r.write('docs/reader.md'); const head = r.commit()
    r.git('checkout', 'master')
    r.write('src/server.ts'); const base = r.commit()
    assert.equal(classifyChanges('pull_request', r.pr(base, head), r.cwd).runFull, false)
  } finally { r.close() }
})

test('renaming or deleting runtime code cannot hide it as documentation', () => {
  const r = repository()
  try {
    r.write('src/server.ts'); const base = r.commit()
    r.git('mv', 'src/server.ts', 'README.md'); const head = r.commit()
    assert.equal(classifyChanges('pull_request', r.pr(base, head), r.cwd).runFull, true)
  } finally { r.close() }
})

test('workflows, tooling, dependency locks, skills and unknown paths keep full checks', () => {
  for (const file of ['.github/workflows/ci.yml', 'scripts/capture-readme.ts', 'package-lock.json', 'desktop/runtime-lock.json', 'skills/pdfpal-cli/SKILL.md', 'src/core/README.md', 'docs/example.ts', 'unknown']) {
    assert.equal(documentationOnly(['README.md', file]), false, file)
  }
})

test('manual runs, missing history, invalid events and empty diffs conservatively run full checks', () => {
  const r = repository()
  try {
    r.write('README.md'); const head = r.commit()
    assert.equal(classifyChanges('workflow_dispatch', {}, r.cwd).runFull, true)
    assert.equal(classifyChanges('push', { before: '0'.repeat(40), after: head }, r.cwd).runFull, true)
    assert.equal(classifyChanges('pull_request', r.pr('a'.repeat(40), head), r.cwd).runFull, true)
    assert.equal(classifyChanges('pull_request', r.pr('not-a-sha', head), r.cwd).runFull, true)
    assert.equal(classifyChanges('push', { before: head, after: head }, r.cwd).runFull, true)
  } finally { r.close() }
})
