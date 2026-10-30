import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { releasePlan, prepareRelease, publishRelease } from '../scripts/desktop-release.mjs'

test('only a desktop version change or explicit retry selects a release', () => {
  assert.equal(releasePlan('2.1.0-preview.4', '2.1.0-preview.3').publish, true)
  assert.equal(releasePlan('2.1.0-preview.3', '2.1.0-preview.3').publish, false)
  assert.equal(releasePlan('2.1.0-preview.3', '2.1.0-preview.3', true).publish, true)
  assert.equal(releasePlan('2.1.0-preview.3').channel, 'preview')
  assert.equal(releasePlan('2.1.0', '2.1.0-preview.3').channel, 'stable')
  assert.throws(() => releasePlan('2.1.0-preview.2', '2.1.0-preview.3'))
  assert.throws(() => releasePlan('2.1.0/invalid'))
})
test('push planning reads the actual previous commit and skips JSON-only edits', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pdfpal-release-git-test-'))
  const script=fileURLToPath(new URL('../scripts/desktop-release.mjs',import.meta.url))
  const git=(...args)=>{
    const result=spawnSync('git',args,{cwd:directory,encoding:'utf8'})
    assert.equal(result.status,0,result.stderr);return result.stdout.trim()
  }
  try {
    git('init','--quiet')
    await fs.mkdir(path.join(directory,'desktop'))
    await fs.writeFile(path.join(directory,'desktop/version.json'),'{"version":"2.1.0-preview.3"}')
    git('add','.');git('-c','user.name=Release Test','-c','user.email=test@example.invalid','commit','-qm','fixture')
    const before=git('rev-parse','HEAD')
    const run=()=>spawnSync(process.execPath,[script,'plan'],{cwd:directory,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'push',RELEASE_BEFORE:before,GITHUB_OUTPUT:path.join(directory,'output')}})
    await fs.writeFile(path.join(directory,'desktop/version.json'),'\n{ "version": "2.1.0-preview.3" }\n')
    let result=run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).publish,false)
    await fs.writeFile(path.join(directory,'desktop/version.json'),'{"version":"2.1.0-preview.4"}')
    result=run();assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).publish,true)
  } finally {await fs.rm(directory,{recursive:true,force:true})}
})
async function fixture(version = '2.1.0-preview.3') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfpal-release-test-'))
  const bytes = Buffer.from('Synthetic publication fixture; never execute')
  const installer = `pdfpal-Setup-${version}-x64.exe`
  const manifest = { format: 1, appId: 'io.pdfpal.desktop', version, platform: 'win32', arch: 'x64', signed: false, publisher: null, installer, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  await fs.writeFile(path.join(directory, installer), bytes)
  const metadata = path.join(directory, 'pdfpal-desktop-release.json')
  await fs.writeFile(metadata, JSON.stringify(manifest))
  const options = { version, commit: 'a'.repeat(40), repository: 'andrepaim/pdfpal' }
  return { directory, manifest, metadata, options, cleanup: () => fs.rm(directory, { recursive: true, force: true }) }
}
test('publication preparation binds hashes, stable signing requirement, version and application identity', async () => {
  const f = await fixture()
  try {
    const plan = await prepareRelease(f.directory, f.options)
    await assert.rejects(publishRelease(f.directory,()=>{throw new Error('Must not contact GitHub')},{commit:'b'.repeat(40),repository:plan.repository,version:plan.version}),/workflow run/)
    assert.equal(plan.assets.length, 3)
    assert.match(await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8'), /Unsigned engineering preview/)
    assert.match(await fs.readFile(path.join(f.directory, 'SHA256SUMS.txt'), 'utf8'), new RegExp(f.manifest.sha256))
    await fs.writeFile(f.metadata, JSON.stringify({ ...f.manifest, appId: 'io.pdfpal.desktop.installer-acceptance' }))
    await assert.rejects(prepareRelease(f.directory, f.options), /manifest/)
    await fs.writeFile(f.metadata, JSON.stringify(f.manifest))
    await fs.appendFile(path.join(f.directory, f.manifest.installer), 'changed')
    await assert.rejects(prepareRelease(f.directory, f.options), /mismatch/)
  } finally { await f.cleanup() }
  const stable = await fixture('2.1.0')
  try { await assert.rejects(prepareRelease(stable.directory, stable.options), /signed build/) }
  finally { await stable.cleanup() }
})
function github(plan, { release, ref, failUpload = false } = {}) {
  const calls = []
  const run = (_binary, args) => {
    calls.push(args)
    if (args[0] === 'api') {
      if (args[1].includes('/releases/tags/')) return release && !release.draft ? JSON.stringify(release) : undefined
      if (args[1].endsWith('/releases/42')) return release && JSON.stringify(release)
      if (args[1].includes('/git/ref/tags/')) return ref && JSON.stringify({ object: ref })
      throw new Error('Unexpected API call')
    }
    switch (args[1]) {
      case 'view': return release ? JSON.stringify({apiUrl:'https://api.github.com/repos/andrepaim/pdfpal/releases/42'}) : undefined
      case 'create':
        assert.ok(args.includes('--draft'))
        assert.ok(args.includes('--latest=false'))
        release = { draft: true, target_commitish: plan.commit, prerelease: true, html_url: 'https://github.com/andrepaim/pdfpal/releases/tag/' + plan.tag, assets: [] }
        return ''
      case 'upload':
        assert.equal(release.draft, true)
        if (failUpload) throw new Error('Simulated interrupted upload')
        release.assets = plan.assets.map(asset => ({ name: asset.name, state: 'uploaded', size: asset.size, digest: 'sha256:' + asset.sha256 }))
        return ''
      case 'edit':
        assert.ok(args.includes('--draft=false'))
        release.draft = false; ref = { type: 'commit', sha: plan.commit }
        return ''
      default: throw new Error('Unexpected mutation')
    }
  }
  return { run, calls }
}
test('publication stays a draft until uploads verify, and a retry leaves published bytes untouched', async () => {
  const f = await fixture()
  try {
    const plan = await prepareRelease(f.directory, f.options)
    const remote = github(plan)
    assert.equal((await publishRelease(f.directory, remote.run)).state, 'published')
    const mutations = remote.calls.filter(args => args[0] === 'release').length
    assert.equal((await publishRelease(f.directory, remote.run)).state, 'already-published')
    assert.equal(remote.calls.filter(args => args[0] === 'release').length, mutations)
    const interrupted = github(plan, { failUpload: true })
    await assert.rejects(publishRelease(f.directory, interrupted.run), /interrupted/)
    assert.equal(interrupted.calls.some(args => args[1] === 'edit'), false)
  } finally { await f.cleanup() }
})
test('partial drafts can resume; foreign tags and mismatched published assets cannot be replaced', async () => {
  const f = await fixture()
  try {
    const plan = await prepareRelease(f.directory, f.options)
    const draft = { draft: true, target_commitish: plan.commit, prerelease: true, assets: [] }
    const remote = github(plan, { release: draft })
    assert.equal((await publishRelease(f.directory, remote.run)).state, 'published')
    assert.equal(remote.calls.some(args => args[1] === 'create'), false)
    const foreign = github(plan, { ref: { type: 'commit', sha: 'b'.repeat(40) } })
    await assert.rejects(publishRelease(f.directory, foreign.run), /another source/)
    assert.equal(foreign.calls.some(args => ['create','upload','edit'].includes(args[1])), false)
    const mismatched = github(plan, { release: { draft: false, prerelease: true, assets: [] }, ref: { type: 'commit', sha: plan.commit } })
    await assert.rejects(publishRelease(f.directory, mismatched.run), /refusing to replace/)
    assert.equal(mismatched.calls.some(args => ['create','upload','edit'].includes(args[1])), false)
  } finally { await f.cleanup() }
})
