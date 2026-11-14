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

test('ChatGPT preview release notes explain direct plan access', async () => {
  const f = await fixture('2.2.0-preview.1')
  try {
    await prepareRelease(f.directory, f.options)
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    assert.match(notes, /Continue with ChatGPT/)
    assert.match(notes, /without installing a coding agent/)
  } finally { await f.cleanup() }
})

const macManifestName = 'pdfpal-desktop-release-darwin-arm64.json'
/** Adds the Mac build driver's output (disk image and manifest) to a Windows fixture. */
async function withMac(f, { signed = false } = {}) {
  const { version } = f.options
  const bytes = Buffer.from('Synthetic Mac disk image fixture; never open')
  const installer = `pdfpal-${version}-arm64.dmg`
  const manifest = { format: 1, appId: 'io.pdfpal.desktop', version, platform: 'darwin', arch: 'arm64', signed, publisher: signed ? 'Test Publisher' : null, installer, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  await fs.writeFile(path.join(f.directory, installer), bytes)
  const metadata = path.join(f.directory, macManifestName)
  await fs.writeFile(metadata, JSON.stringify(manifest))
  return { ...f, mac: { manifest, metadata, installer: path.join(f.directory, installer) } }
}
const sha256 = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')
const noGitHub = () => { throw new Error('Must not contact GitHub') }

test('two-platform preparation checksums every file and keeps the Windows files and names', async () => {
  const f = await withMac(await fixture('2.9.0-beta.1'))
  try {
    const plan = await prepareRelease(f.directory, { ...f.options, requireMac: true })
    const names = ['pdfpal-Setup-2.9.0-beta.1-x64.exe', 'pdfpal-desktop-release.json', 'pdfpal-2.9.0-beta.1-arm64.dmg', macManifestName, 'SHA256SUMS.txt']
    assert.deepEqual(plan.assets.map(asset => asset.name), names)
    assert.deepEqual(plan.platforms, ['win32-x64', 'darwin-arm64'])
    assert.equal(plan.requireMac, true)
    for (const asset of plan.assets) assert.equal(asset.sha256, await sha256(path.join(f.directory, asset.name)))
    const sums = await fs.readFile(path.join(f.directory, 'SHA256SUMS.txt'), 'utf8')
    assert.equal(sums, `${f.manifest.sha256}  ${names[0]}\n${await sha256(f.metadata)}  ${names[1]}\n${f.mac.manifest.sha256}  ${names[2]}\n${await sha256(f.mac.metadata)}  ${names[3]}\n`)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'release-plan.json'), 'utf8')), plan)
  } finally { await f.cleanup() }
})

test('a Windows-only directory prepares as before unless Mac files are required', async () => {
  const f = await fixture('2.9.0-beta.1')
  try {
    const plan = await prepareRelease(f.directory, f.options)
    assert.deepEqual(plan.assets.map(asset => asset.name), ['pdfpal-Setup-2.9.0-beta.1-x64.exe', 'pdfpal-desktop-release.json', 'SHA256SUMS.txt'])
    assert.deepEqual(plan.platforms, ['win32-x64'])
    assert.equal(plan.requireMac, false)
    assert.equal((await fs.readFile(path.join(f.directory, 'SHA256SUMS.txt'), 'utf8')).split('\n').filter(Boolean).length, 2)
    assert.doesNotMatch(await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8'), /Mac|dmg|Apple/)
    await assert.rejects(prepareRelease(f.directory, { ...f.options, requireMac: true }), /Mac release files are required/)
    // The publish-time switch applies to a plan prepared on the Windows runner, before any GitHub call.
    await prepareRelease(f.directory, f.options)
    await assert.rejects(publishRelease(f.directory, noGitHub, undefined, { requireMac: true }), /Mac release files are required/)
  } finally { await f.cleanup() }
  // A plan prepared with requireMac keeps requiring the Mac files at publication.
  const g = await withMac(await fixture('2.9.0-beta.1'))
  try {
    await prepareRelease(g.directory, { ...g.options, requireMac: true })
    await fs.rm(g.mac.installer); await fs.rm(g.mac.metadata)
    await assert.rejects(publishRelease(g.directory, noGitHub), /Mac release files are required/)
  } finally { await g.cleanup() }
})

test('tampered, mismatched or half-present Mac files are rejected before publication', async () => {
  const f = await withMac(await fixture('2.9.0-beta.1'))
  try {
    for (const patch of [{ appId: 'io.pdfpal.desktop.installer-acceptance' }, { version: '2.9.0-beta.2' }, { platform: 'win32' }, { arch: 'x64' }, { installer: 'pdfpal-Setup-2.9.0-beta.1-x64.exe' },
      { size: 1 }, { sha256: 'b'.repeat(64) }, { sha256: 'B'.repeat(64) }, { signed: 'no' }, { format: 2 }]) {
      await fs.writeFile(f.mac.metadata, JSON.stringify({ ...f.mac.manifest, ...patch }))
      await assert.rejects(prepareRelease(f.directory, { ...f.options, requireMac: true }), /Mac (installer manifest|disk image size or SHA-256 mismatch)/, JSON.stringify(patch))
    }
    await fs.writeFile(f.mac.metadata, JSON.stringify(f.mac.manifest))
    await prepareRelease(f.directory, { ...f.options, requireMac: true })
    await fs.appendFile(f.mac.installer, 'changed')
    await assert.rejects(prepareRelease(f.directory, f.options), /Mac disk image size or SHA-256 mismatch/)
    // One Mac file without the other is an error even when Mac files are optional.
    await fs.rm(f.mac.installer)
    await assert.rejects(prepareRelease(f.directory, f.options), /ENOENT/)
    await fs.rm(f.mac.metadata)
    await fs.writeFile(path.join(f.directory, 'pdfpal-2.9.0-beta.1-arm64.dmg'), 'orphan')
    await assert.rejects(prepareRelease(f.directory, f.options), /ENOENT/)
  } finally { await f.cleanup() }
})

test('a stable version refuses an unsigned Mac build', async () => {
  const f = await withMac(await fixture('2.9.0'))
  try {
    // Sign the Windows side so the only remaining reason to refuse is the Mac build.
    await fs.writeFile(f.metadata, JSON.stringify({ ...f.manifest, signed: true, publisher: 'Test Publisher' }))
    await assert.rejects(prepareRelease(f.directory, { ...f.options, requireMac: true }), /signed Mac build/)
    await assert.rejects(prepareRelease(f.directory, f.options), /signed Mac build/)
    await fs.writeFile(f.mac.metadata, JSON.stringify({ ...f.mac.manifest, signed: true, publisher: '' }))
    await assert.rejects(prepareRelease(f.directory, f.options), /signed Mac build/)
    await fs.writeFile(f.mac.metadata, JSON.stringify({ ...f.mac.manifest, signed: true, publisher: 'Test Publisher' }))
    const plan = await prepareRelease(f.directory, { ...f.options, requireMac: true })
    assert.equal(plan.channel, 'stable')
    assert.match(await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8'), /Mac publisher: Test Publisher\./)
  } finally { await f.cleanup() }
})

test('two-platform publication drafts, uploads and verifies every file, resumes, and never replaces', async () => {
  const f = await withMac(await fixture('2.9.0-beta.1'))
  const uploaded = asset => ({ name: asset.name, state: 'uploaded', size: asset.size, digest: 'sha256:' + asset.sha256 })
  try {
    const plan = await prepareRelease(f.directory, { ...f.options, requireMac: true })
    const remote = github(plan)
    assert.equal((await publishRelease(f.directory, remote.run, undefined, { requireMac: true })).state, 'published')
    const create = remote.calls.find(args => args[1] === 'create')
    assert.equal(create[create.indexOf('--title') + 1], 'pdfpal for Windows and Mac 2.9.0-beta.1')
    const upload = remote.calls.find(args => args[1] === 'upload')
    assert.deepEqual(upload.filter(arg => arg.startsWith(f.directory)).map(arg => path.basename(arg)), plan.assets.map(asset => asset.name))
    const mutations = remote.calls.filter(args => args[0] === 'release').length
    assert.equal((await publishRelease(f.directory, remote.run, undefined, { requireMac: true })).state, 'already-published')
    assert.equal(remote.calls.filter(args => args[0] === 'release').length, mutations)

    // A draft holding only the Windows files from an interrupted attempt resumes.
    const partial = { draft: true, target_commitish: plan.commit, prerelease: true, assets: plan.assets.slice(0, 2).map(uploaded) }
    const resumed = github(plan, { release: partial })
    assert.equal((await publishRelease(f.directory, resumed.run)).state, 'published')
    assert.equal(resumed.calls.some(args => args[1] === 'create'), false)

    // An upload whose disk image digest does not verify leaves the release a draft.
    const draft = { draft: true, target_commitish: plan.commit, prerelease: true, assets: [] }
    const corrupt = github(plan, { release: draft })
    const run = (binary, args) => {
      const value = corrupt.run(binary, args)
      if (args[1] === 'upload') draft.assets = draft.assets.map(item => item.name.endsWith('.dmg') ? { ...item, digest: 'sha256:' + 'e'.repeat(64) } : item)
      return value
    }
    await assert.rejects(publishRelease(f.directory, run), /refusing to replace/)
    assert.equal(corrupt.calls.some(args => args[1] === 'edit'), false)
    assert.equal(draft.draft, true)

    // A published release that lacks the Mac files, or has a different disk image, is never changed.
    const windowsOnly = plan.assets.filter(asset => !/arm64|darwin/.test(asset.name)).map(uploaded)
    const published = github(plan, { release: { draft: false, prerelease: true, assets: windowsOnly }, ref: { type: 'commit', sha: plan.commit } })
    await assert.rejects(publishRelease(f.directory, published.run), /refusing to replace/)
    assert.equal(published.calls.some(args => ['create', 'upload', 'edit'].includes(args[1])), false)
    const otherImage = plan.assets.map(asset => ({ ...uploaded(asset), ...(asset.name.endsWith('.dmg') ? { digest: 'sha256:' + 'e'.repeat(64) } : {}) }))
    const different = github(plan, { release: { draft: false, prerelease: true, assets: otherImage }, ref: { type: 'commit', sha: plan.commit } })
    await assert.rejects(publishRelease(f.directory, different.run), /refusing to replace/)
    assert.equal(different.calls.some(args => ['create', 'upload', 'edit'].includes(args[1])), false)

    // A tag from another commit is refused with the larger file set too.
    const foreign = github(plan, { ref: { type: 'commit', sha: 'b'.repeat(40) } })
    await assert.rejects(publishRelease(f.directory, foreign.run), /another source/)
    assert.equal(foreign.calls.some(args => ['create', 'upload', 'edit'].includes(args[1])), false)
  } finally { await f.cleanup() }
})

test('the Mac release-note paragraph appears only with Mac files', async () => {
  const f = await withMac(await fixture('2.9.0-beta.1')), windowsOnly = await fixture('2.9.0-beta.1')
  try {
    await prepareRelease(f.directory, f.options)
    const notes = await fs.readFile(path.join(f.directory, 'release-notes.md'), 'utf8')
    for (const expected of [/\*\*pdfpal-2\.9\.0-beta\.1-arm64\.dmg\*\*/, /Apple Silicon/, /not on Intel Macs/, /Not notarized/, /System Settings → Privacy & Security/, /Open Anyway/, /~\/\.pdfpal/, /docs\/mac-quickstart\.md/, /experimental/]) assert.match(notes, expected)
    // The Windows text is unchanged and the Mac paragraph sits before the source commit line.
    await prepareRelease(windowsOnly.directory, windowsOnly.options)
    const plain = await fs.readFile(path.join(windowsOnly.directory, 'release-notes.md'), 'utf8')
    const [windowsPart] = plain.split('\n\nSource commit:')
    assert.ok(notes.startsWith(windowsPart + '\n\n**Mac (experimental):**'))
    assert.ok(notes.endsWith(`\n\nSource commit: ${f.options.commit}\n`))
    assert.doesNotMatch(plain, /Mac|Apple|dmg/)
  } finally { await f.cleanup(); await windowsOnly.cleanup() }
})

test('the command line accepts --require-mac only for prepare and publish', async () => {
  const script = fileURLToPath(new URL('../scripts/desktop-release.mjs', import.meta.url))
  const f = await fixture('2.9.0-beta.1')
  try {
    const env = { ...process.env, RELEASE_VERSION: '2.9.0-beta.1', RELEASE_COMMIT: f.options.commit, GITHUB_REPOSITORY: f.options.repository }
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env })
    let result = run('prepare', f.directory)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).requireMac, false)
    result = run('prepare', f.directory, '--require-mac')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Mac release files are required/)
    await withMac(f)
    result = run('prepare', f.directory, '--require-mac')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).requireMac, true)
    for (const args of [['prepare', f.directory, '--require-macs'], ['plan', '--require-mac']]) {
      result = run(...args)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Usage/)
    }
  } finally { await f.cleanup() }
})
