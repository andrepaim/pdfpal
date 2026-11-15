import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { releasePlan, prepareRelease, prepareCombinedRelease, publishRelease } from '../scripts/desktop-release.mjs'
import { prepareLinuxRelease } from '../scripts/linux-release.mjs'
const hasDpkg = spawnSync('dpkg-deb', ['--version']).status === 0

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
  const options = { version, commit: 'a'.repeat(40), repository: 'andrepaim/pdfpal', sourceDirty: false }
  return { directory, manifest, metadata, options, cleanup: () => fs.rm(directory, { recursive: true, force: true }) }
}
async function combinedFixture(version = '2.8.0-beta.6') {
  const f = await fixture(version)
  const packageRoot = path.join(f.directory, 'debian-fixture')
  await fs.mkdir(path.join(packageRoot, 'DEBIAN'), { recursive: true })
  await fs.writeFile(path.join(packageRoot, 'DEBIAN/control'), `Package: pdfpal-desktop\nVersion: ${version.replace('-', '~')}\nArchitecture: amd64\nMaintainer: Release Test <test@example.invalid>\nDescription: Synthetic release metadata fixture\n`)
  const result = spawnSync('dpkg-deb', ['--build', packageRoot, path.join(f.directory, `pdfpal-${version}-amd64.deb`)], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  await prepareRelease(f.directory, f.options)
  await prepareLinuxRelease(f.directory, f.options)
  return f
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
        if (!args.includes('--draft=false')) { assert.equal(release.draft, true); return '' }
        assert.ok(args.includes('--draft=false'))
        release.draft = false; ref = { type: 'commit', sha: plan.commit }
        return ''
      default: throw new Error('Unexpected mutation')
    }
  }
  return { run, calls }
}
test('publication stays a draft until uploads verify, and a retry leaves published bytes untouched', { skip: !hasDpkg }, async () => {
  const f = await combinedFixture()
  try {
    const plan = await prepareCombinedRelease(f.directory, f.options)
    const remote = github(plan)
    assert.equal((await publishRelease(f.directory, remote.run)).state, 'published')
    const mutations = remote.calls.filter(args => args[0] === 'release').length
    assert.equal((await publishRelease(f.directory, remote.run)).state, 'already-published')
    assert.equal(remote.calls.filter(args => args[0] === 'release').length, mutations)
    const interrupted = github(plan, { failUpload: true })
    await assert.rejects(publishRelease(f.directory, interrupted.run), /interrupted/)
    assert.equal(interrupted.calls.some(args => args[1] === 'edit' && args.includes('--draft=false')), false)
  } finally { await f.cleanup() }
})
test('partial drafts can resume; foreign tags and mismatched published assets cannot be replaced', { skip: !hasDpkg }, async () => {
  const f = await combinedFixture()
  try {
    const plan = await prepareCombinedRelease(f.directory, f.options)
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

test('beta release notes describe selection context and Send feedback, and earlier previews omit them', async () => {
  const f = await fixture('2.8.0-beta.1'), earlier = await fixture('2.7.0-preview.2')
  try {
    await prepareRelease(f.directory, f.options)
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    assert.match(notes, /Better context for your questions/)
    assert.match(notes, /Send feedback/)
    assert.match(notes, /Unsigned engineering preview/)
    await prepareRelease(earlier.directory, earlier.options)
    assert.doesNotMatch(await fs.readFile(path.join(earlier.directory, 'release-notes.md'), 'utf8'), /Send feedback/)
  } finally { await f.cleanup(); await earlier.cleanup() }
})

test('beta.2 release notes describe the cross-page highlight fix, and beta.1 omits it', async () => {
  const f = await fixture('2.8.0-beta.2'), earlier = await fixture('2.8.0-beta.1')
  try {
    await prepareRelease(f.directory, f.options)
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    assert.match(notes, /highlights across a page break/)
    assert.match(notes, /Better context for your questions/)
    await prepareRelease(earlier.directory, earlier.options)
    assert.doesNotMatch(await fs.readFile(path.join(earlier.directory, 'release-notes.md'), 'utf8'), /highlights across a page break/)
  } finally { await f.cleanup(); await earlier.cleanup() }
})

test('beta.4 release notes describe the reader dictionary, and beta.3 omits it', async () => {
  const f = await fixture('2.8.0-beta.4'), earlier = await fixture('2.8.0-beta.3')
  try {
    await prepareRelease(f.directory, f.options)
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    assert.match(notes, /a dictionary in the reader/)
    assert.match(notes, /sends nothing anywhere/)
    assert.match(notes, /Clearer visual explanations/)
    await prepareRelease(earlier.directory, earlier.options)
    assert.doesNotMatch(await fs.readFile(path.join(earlier.directory, 'release-notes.md'), 'utf8'), /a dictionary in the reader/)
  } finally { await f.cleanup(); await earlier.cleanup() }
})

test('beta.3 release notes describe the new visual explanations and related papers, and beta.2 omits them', async () => {
  const f = await fixture('2.8.0-beta.3'), earlier = await fixture('2.8.0-beta.2')
  try {
    await prepareRelease(f.directory, f.options)
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    assert.match(notes, /Clearer visual explanations/)
    assert.match(notes, /Related papers load more reliably/)
    assert.match(notes, /highlights across a page break/)
    await prepareRelease(earlier.directory, earlier.options)
    assert.doesNotMatch(await fs.readFile(path.join(earlier.directory, 'release-notes.md'), 'utf8'), /Clearer visual explanations/)
  } finally { await f.cleanup(); await earlier.cleanup() }
})

test('ChatGPT preview release notes explain direct plan access', async () => {
  const f = await fixture('2.2.0-preview.1')
  try {
    await prepareRelease(f.directory, f.options)
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    assert.match(notes, /Continue with ChatGPT/)
    assert.match(notes, /without installing a coding agent/)
  } finally { await f.cleanup() }
})

// A Windows-only payload must never become a shared desktop release.
test('publication refuses a Windows-only payload before contacting GitHub', async () => {
  const f = await fixture()
  try {
    const plan = await prepareRelease(f.directory, f.options)
    const remote = github(plan)
    await assert.rejects(publishRelease(f.directory, remote.run), /Linux|combined|coordinated/)
    assert.equal(remote.calls.length, 0)
  } finally { await f.cleanup() }
})

test('combined preparation binds all six files and both clean native source revisions', { skip: !hasDpkg }, async () => {
  const f = await combinedFixture()
  try {
    const plan = await prepareCombinedRelease(f.directory, f.options)
    assert.equal(plan.scope, 'windows-linux')
    assert.equal(plan.assets.length, 6)
    assert.equal(plan.sourceDirty, false)
    assert.deepEqual(plan.assets.map(asset => asset.name), [f.manifest.installer, 'pdfpal-desktop-release.json', 'SHA256SUMS.txt', `pdfpal-${f.options.version}-amd64.deb`, 'pdfpal-linux-release.json', 'SHA256SUMS-linux.txt'])
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    assert.match(notes, /one library per Google account/)
    assert.match(notes, /compact app menu/)
    assert.match(notes, /manually updated Debian engineering preview/)
    assert.match(notes, /Unsigned engineering preview/)
    assert.match(notes, new RegExp(f.options.commit))
    assert.deepEqual(await prepareCombinedRelease(f.directory, f.options), plan)
    for (const patch of [{ sourceCommit: 'b'.repeat(40) }, { sourceDirty: true }, { version: '2.8.0-beta.5' }, { arch: 'arm64' }]) {
      const filename = path.join(f.directory, 'pdfpal-linux-release.json')
      const body = await fs.readFile(filename, 'utf8')
      await fs.writeFile(filename, JSON.stringify({ ...JSON.parse(body), ...patch }))
      await assert.rejects(publishRelease(f.directory, () => { throw new Error('Must not contact GitHub') }), /Linux manifest/)
      await fs.writeFile(filename, body)
    }
    const nativePlanFile = path.join(f.directory, 'release-plan.json')
    const nativePlan = await fs.readFile(nativePlanFile, 'utf8')
    await fs.writeFile(nativePlanFile, JSON.stringify({ ...JSON.parse(nativePlan), sourceDirty: true }))
    await assert.rejects(prepareCombinedRelease(f.directory, f.options), /clean full source/)
    await fs.writeFile(nativePlanFile, nativePlan)
    await fs.appendFile(path.join(f.directory, 'SHA256SUMS-linux.txt'), 'changed')
    await assert.rejects(prepareCombinedRelease(f.directory, f.options), /Linux checksums/)
  } finally { await f.cleanup() }
})
test('combined preparation verifies Debian identity from actual package bytes', { skip: !hasDpkg }, async () => {
  const f = await combinedFixture()
  try {
    const control = path.join(f.directory, 'debian-fixture/DEBIAN/control')
    await fs.writeFile(control, (await fs.readFile(control, 'utf8')).replace('Architecture: amd64', 'Architecture: arm64'))
    const installer = `pdfpal-${f.options.version}-amd64.deb`, filename = path.join(f.directory, installer)
    const result = spawnSync('dpkg-deb', ['--build', path.join(f.directory, 'debian-fixture'), filename], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const manifestFile = path.join(f.directory, 'pdfpal-linux-release.json')
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
    const bytes = await fs.readFile(filename)
    await fs.writeFile(manifestFile, JSON.stringify({ ...manifest, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }))
    await assert.rejects(prepareCombinedRelease(f.directory, f.options), /Debian package identity/)
  } finally { await f.cleanup() }
})
test('a missing Linux asset or modified Windows native receipt never reaches draft creation', { skip: !hasDpkg }, async () => {
  const f = await combinedFixture()
  try {
    const nativePlanFile = path.join(f.directory, 'release-plan.json')
    const nativePlan = await fs.readFile(nativePlanFile, 'utf8')
    const changed = JSON.parse(nativePlan); changed.assets[0].sha256 = '0'.repeat(64)
    await fs.writeFile(nativePlanFile, JSON.stringify(changed))
    await assert.rejects(publishRelease(f.directory, () => { throw new Error('Must not contact GitHub') }), /Windows build provenance assets/)
    await fs.writeFile(nativePlanFile, nativePlan)
    await fs.rm(path.join(f.directory, `pdfpal-${f.options.version}-amd64.deb`))
    await assert.rejects(publishRelease(f.directory, () => { throw new Error('Must not contact GitHub') }))
  } finally { await f.cleanup() }
})

test('native metadata CLIs reject a claimed source SHA different from the checkout', () => {
  const windows = fileURLToPath(new URL('../scripts/desktop-release.mjs', import.meta.url))
  const linux = fileURLToPath(new URL('../scripts/linux-release.mjs', import.meta.url))
  for (const [script, args] of [[windows, ['prepare', os.tmpdir()]], [linux, [os.tmpdir(), 'b'.repeat(40)]]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, RELEASE_COMMIT: 'b'.repeat(40) } })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /source commit does not match the actual checkout/)
  }
})
test('a remote Linux digest mismatch leaves the combined release unpublished', { skip: !hasDpkg }, async () => {
  const f = await combinedFixture()
  try {
    const plan = await prepareCombinedRelease(f.directory, f.options), remote = github(plan)
    const run = (binary, args) => {
      const result = remote.run(binary, args)
      if (args[0] === 'api' && args[1].endsWith('/releases/42') && result) {
        const release = JSON.parse(result)
        if (release.assets.length) release.assets[3].digest = 'sha256:' + '0'.repeat(64)
        return JSON.stringify(release)
      }
      return result
    }
    await assert.rejects(publishRelease(f.directory, run), /refusing to replace/)
    assert.equal(remote.calls.some(args => args.includes('--draft=false')), false)
  } finally { await f.cleanup() }
})
