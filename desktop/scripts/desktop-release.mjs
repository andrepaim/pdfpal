import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareVersions, versionParts } from '../src/updates.mjs'

export function releasePlan(version, previous, manual = false) {
  const parsed = versionParts(version)
  if (previous !== undefined) {
    versionParts(previous)
    if (compareVersions(version, previous) < 0) throw new Error('Desktop versions must increase; published versions cannot be reused')
  }
  return { version, tag: `desktop-v${version}`, channel: parsed.preview ? 'preview' : 'stable', publish: manual || previous !== version }
}
function command(executable, args, optional = false) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  if (result.error) throw new Error(`Could not start ${executable}`)
  if (result.status !== 0) {
    if (optional && (/HTTP 404/.test(result.stderr) || /^release not found$/im.test(result.stderr.trim()))) return undefined
    throw new Error(`${executable} failed (${result.status}): ${(result.stderr || '').slice(0, 500)}`)
  }
  return result.stdout.trim()
}
async function digest(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}
const validCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
const validRepo = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..')

export async function prepareRelease(directory, { version, commit, repository }) {
  if (!validCommit(commit) || !validRepo(repository)) throw new Error('A source commit SHA and repository are required')
  const plan = releasePlan(version)
  const manifestFile = path.join(directory, 'pdfpal-desktop-release.json')
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  const filename = `pdfpal-Setup-${version}-x64.exe`
  if (manifest.format !== 1 || manifest.appId !== 'io.pdfpal.desktop' || manifest.version !== version || manifest.platform !== 'win32' || manifest.arch !== 'x64' ||
      manifest.installer !== filename || typeof manifest.signed !== 'boolean' || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')) throw new Error('Invalid production installer manifest')
  if (plan.channel === 'stable' && (!manifest.signed || typeof manifest.publisher !== 'string' || !manifest.publisher.trim() || manifest.publisher.length > 256 || /[\r\n]/.test(manifest.publisher))) throw new Error('Stable desktop releases require a verified signed build')
  const installer = path.join(directory, filename)
  if ((await fs.stat(installer)).size !== manifest.size || await digest(installer) !== manifest.sha256) throw new Error('Installer size or SHA-256 mismatch')
  const manifestHash = await digest(manifestFile)
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), `${manifest.sha256}  ${filename}\n${manifestHash}  pdfpal-desktop-release.json\n`)
  const assets = []
  for (const name of [filename, 'pdfpal-desktop-release.json', 'SHA256SUMS.txt']) assets.push({ name, size: (await fs.stat(path.join(directory, name))).size, sha256: await digest(path.join(directory, name)) })
  const notes = `Windows x64 desktop installer for pdfpal ${version}.\n\nDownload **${filename}** below, run it, and open **pdfpal** from Start. No separate Node.js installation is needed. Uses your installed Claude Code or Codex account; provider usage limits apply.\n\n${manifest.signed ? `Publisher: ${manifest.publisher}.` : '**Unsigned engineering preview:** Windows may show an unknown-publisher or reputation prompt. Intended for testing; fresh-account onboarding and public-beta acceptance remain in progress.'}\n\n[Windows installation guide](https://github.com/${repository}/blob/${plan.tag}/docs/windows-quickstart.md)\n\nThe CLI remains available independently. Quit pdfpal from its tray before upgrading; the installer retains your library.\n\nSource commit: ${commit}\n`
  await fs.writeFile(path.join(directory, 'release-notes.md'), notes)
  const result = { format: 1, ...plan, commit, repository, assets }
  await fs.writeFile(path.join(directory, 'release-plan.json'), JSON.stringify(result, null, 2))
  return result
}

export function verifyRemoteAssets(release, plan) {
  for (const expected of plan.assets) {
    const asset = release.assets?.find(item => item.name === expected.name)
    if (!asset || asset.state !== 'uploaded' || asset.size !== expected.size || asset.digest?.toLowerCase() !== `sha256:${expected.sha256}`) throw new Error('Existing release assets do not match the tested build; refusing to replace them')
  }
  if (release.prerelease !== (plan.channel === 'preview')) throw new Error('Release channel mismatch')
}

/** Publish a complete draft, or verify an already-published release without mutations. */
export async function publishRelease(directory, run = command, expected) {
  const saved = JSON.parse(await fs.readFile(path.join(directory, 'release-plan.json'), 'utf8'))
  if (expected && (saved.commit !== expected.commit || saved.repository !== expected.repository || saved.version !== expected.version)) throw new Error('Publication metadata does not match this workflow run')
  const plan = await prepareRelease(directory, saved)
  const api = endpoint => {
    const value = run('gh', ['api', `repos/${plan.repository}/${endpoint}`], true)
    return value === undefined ? undefined : JSON.parse(value)
  }
  const findRelease = () => {
    const published = api(`releases/tags/${plan.tag}`)
    if (published) return published
    // Unpublished drafts need not have a Git tag yet. gh's GraphQL-backed
    // lookup can locate them; then REST-by-ID includes the asset digests.
    const value = run('gh', ['release', 'view', plan.tag, '--repo', plan.repository, '--json', 'apiUrl'], true)
    if (value === undefined) return undefined
    const location = new URL(JSON.parse(value).apiUrl)
    const id = location.pathname.split('/').at(-1)
    if (location.origin !== 'https://api.github.com' || !/^\d+$/.test(id) || location.pathname.toLowerCase() !== `/repos/${plan.repository}/releases/${id}`.toLowerCase()) throw new Error('Unexpected release metadata location')
    return api(`releases/${id}`)
  }
  const existing = findRelease()
  let ref = api(`git/ref/tags/${plan.tag}`)?.object
  for (let depth = 0; ref?.type === 'tag' && depth < 5; depth++) ref = api(`git/tags/${ref.sha}`)?.object
  if (ref && (ref.type !== 'commit' || ref.sha !== plan.commit)) throw new Error('Release tag points to another source commit')
  if (existing) {
    if (!ref && existing.target_commitish !== plan.commit) throw new Error('Draft release targets another source commit')
    if (!existing.draft) {
      if (!ref) throw new Error('Published release has no verified source tag')
      verifyRemoteAssets(existing, plan)
      return { state: 'already-published', url: existing.html_url }
    }
  } else {
    run('gh', ['release', 'create', plan.tag, '--repo', plan.repository, '--target', plan.commit, '--draft', '--title', `pdfpal for Windows ${plan.version}`, '--notes-file', path.join(directory, 'release-notes.md'), '--latest=false', ...(plan.channel === 'preview' ? ['--prerelease'] : [])])
  }
  // Replacing partial assets is allowed only while the release is still a draft.
  const draft = findRelease()
  if (!draft?.draft || draft.target_commitish !== plan.commit) throw new Error('Expected an unpublished draft for this source commit')
  run('gh', ['release', 'upload', plan.tag, '--repo', plan.repository, ...plan.assets.map(asset => path.join(directory, asset.name)), '--clobber'])
  verifyRemoteAssets(findRelease(), plan)
  run('gh', ['release', 'edit', plan.tag, '--repo', plan.repository, '--draft=false', '--latest=false', `--prerelease=${plan.channel === 'preview'}`])
  return { state: 'published', url: `https://github.com/${plan.repository}/releases/tag/${plan.tag}` }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, target] = process.argv.slice(2)
  if (mode === 'plan') {
    const version = JSON.parse(await fs.readFile('desktop/version.json', 'utf8')).version
    let previous
    const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    if (!manual) {
      const before = process.env.RELEASE_BEFORE
      if (!validCommit(before) || /^0+$/.test(before)) throw new Error('A valid previous push commit is required')
      command('git', ['cat-file', '-e', `${before}^{commit}`])
      if (command('git', ['ls-tree', before, '--', 'desktop/version.json'])) previous = JSON.parse(command('git', ['show', `${before}:desktop/version.json`])).version
    }
    const plan = releasePlan(version, previous, manual)
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''))
    console.log(JSON.stringify(plan, null, 2))
  } else if (mode === 'prepare') {
    const version = process.env.RELEASE_VERSION ?? JSON.parse(await fs.readFile('desktop/version.json', 'utf8')).version
    const commit = process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? command('git', ['rev-parse', 'HEAD'])
    const repository = process.env.GITHUB_REPOSITORY ?? 'andrepaim/pdfpal'
    console.log(JSON.stringify(await prepareRelease(path.resolve(target), { version, commit, repository }), null, 2))
  } else if (mode === 'publish') {
    const expected = process.env.GITHUB_ACTIONS === 'true' ? { commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY, version: process.env.RELEASE_VERSION } : undefined
    console.log(JSON.stringify(await publishRelease(path.resolve(target), command, expected), null, 2))
  }
  else throw new Error('Usage: node desktop-release.mjs plan | prepare <artifacts> | publish <artifacts>')
}
