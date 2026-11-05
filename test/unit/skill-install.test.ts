import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installSkill, skillStatus, uninstallSkill } from '../../src/cli/skill-install.js'

test('managed skills update without admin/symlinks and preserve custom content', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-skill-')), source = path.resolve('skills/pdfpal-cli')
  try {
    assert.equal(installSkill({ home, source, managedOnly: true }).updated, false)
    const installed = installSkill({ home, source })
    assert.equal(installed.installed, true)
    assert.equal(installSkill({ home, source }).updated, false)
    const file = path.join(installed.directory, 'SKILL.md')
    fs.appendFileSync(file, '\nUser customization\n')
    assert.equal(skillStatus(home).edited, true)
    assert.throws(() => installSkill({ home, source }), { code: 'SKILL_CUSTOMIZED' })
    assert.equal(installSkill({ home, source, managedOnly: true }).updated, false)
    assert.equal(uninstallSkill(home).preserved, true)
    const replaced = installSkill({ home, source, replace: true })
    assert.ok(replaced.backup)
    assert.ok(fs.readFileSync(path.join(replaced.backup!, 'SKILL.md'), 'utf8').includes('User customization'))
    assert.equal(uninstallSkill(home).removed, true)
    assert.equal(fs.existsSync(path.join(replaced.backup!, 'SKILL.md')), true)
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

test('legacy skill conflicts are explicit and diagnostic commands create no library', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfpal-skill-legacy-'))
  try {
    const legacy = path.join(home, '.codex/skills/pdfpal-cli')
    fs.mkdirSync(legacy, { recursive: true }); fs.writeFileSync(path.join(legacy, 'SKILL.md'), 'Existing skill')
    assert.throws(() => installSkill({ home, source: path.resolve('skills/pdfpal-cli') }), { code: 'SKILL_LEGACY_CONFLICT' })
    assert.equal(fs.existsSync(path.join(home, '.pdfpal')), false)
    assert.equal(fs.readFileSync(path.join(legacy, 'SKILL.md'), 'utf8'), 'Existing skill')
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})
