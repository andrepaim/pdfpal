import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareVersions, versionParts, desktopTargets } from '../src/updates.mjs'

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

const exists = filename => fs.stat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
const validPublisher = value => typeof value === 'string' && !!value.trim() && value.length <= 256 && !/[\r\n]/.test(value)
/**
 * Check one platform's manifest and installer against the release version.
 * `label` names the platform in errors; Windows keeps its original wording.
 */
async function verifyPlatform(directory, target, version, channel, label) {
  const manifestFile = path.join(directory, target.manifest)
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  const filename = target.installer(version)
  if (manifest?.format !== 1 || manifest.appId !== 'io.pdfpal.desktop' || manifest.version !== version || manifest.platform !== target.platform || manifest.arch !== target.arch ||
      manifest.installer !== filename || typeof manifest.signed !== 'boolean' || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')) throw new Error(`Invalid production ${label}installer manifest`)
  if (channel === 'stable' && (!manifest.signed || !validPublisher(manifest.publisher))) throw new Error(label
    ? 'Stable desktop releases require a signed Mac build with a verified publisher, and Mac signing is not set up yet. Publish a suffixed preview version (for example 2.9.0-beta.1) instead.'
    : 'Stable desktop releases require a verified signed build')
  const installer = path.join(directory, filename)
  if ((await fs.stat(installer)).size !== manifest.size || await digest(installer) !== manifest.sha256) throw new Error(`${label ? 'Mac disk image' : 'Installer'} size or SHA-256 mismatch`)
  return { manifest, files: [{ name: filename, sha256: manifest.sha256 }, { name: target.manifest, sha256: await digest(manifestFile) }] }
}

/** The Mac paragraph of the release notes, present only when the release carries Mac files. */
function macNotes(manifest, repository, tag) {
  const opening = manifest.signed && validPublisher(manifest.publisher)
    ? `Mac publisher: ${manifest.publisher}.`
    : '**Not notarized:** this Mac build is not signed with an Apple Developer ID, so macOS refuses to open it the first time. Choose **Done** in that message (not Move to Trash), open **System Settings → Privacy & Security**, choose **Open Anyway** next to the pdfpal message, and confirm. Later launches open normally.'
  return `\n\n**Mac (experimental):** download **${manifest.installer}** below, open it, and drag **pdfpal** into **Applications**. It runs only on Macs with Apple Silicon (M1 or later), not on Intel Macs. ${opening} The Mac app keeps its library in \`~/.pdfpal\`, the same folder the pdfpal CLI uses on that Mac. [Mac installation guide](https://github.com/${repository}/blob/${tag}/docs/mac-quickstart.md)`
}

/**
 * Verify the tested build files in `directory` and write SHA256SUMS.txt, the
 * release notes and release-plan.json.
 *
 * Windows files are always required. Mac files are included when either Mac
 * file is present; `requireMac` makes their absence an error, so a release
 * cannot be published silently without them.
 */
export async function prepareRelease(directory, { version, commit, repository, requireMac = false }) {
  if (!validCommit(commit) || !validRepo(repository)) throw new Error('A source commit SHA and repository are required')
  const plan = releasePlan(version)
  const windows = await verifyPlatform(directory, desktopTargets['win32-x64'], version, plan.channel, '')
  const { manifest } = windows
  const filename = windows.files[0].name
  const macTarget = desktopTargets['darwin-arm64']
  const macPresent = await exists(path.join(directory, macTarget.manifest)) || await exists(path.join(directory, macTarget.installer(version)))
  if (requireMac && !macPresent) throw new Error(`Mac release files are required but ${macTarget.installer(version)} and ${macTarget.manifest} are missing`)
  const mac = macPresent ? await verifyPlatform(directory, macTarget, version, plan.channel, 'Mac ') : undefined
  const checksummed = [...windows.files, ...(mac?.files ?? [])]
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), checksummed.map(file => `${file.sha256}  ${file.name}\n`).join(''))
  const assets = []
  for (const name of [...checksummed.map(file => file.name), 'SHA256SUMS.txt']) assets.push({ name, size: (await fs.stat(path.join(directory, name))).size, sha256: await digest(path.join(directory, name)) })
  const aiSetup = compareVersions(version, '2.2.0-preview.1') >= 0
    ? 'Choose **Continue with ChatGPT** in AI settings to use eligible ChatGPT plan allowance without installing a coding agent. Claude Code, Codex and OpenCode remain available as alternatives. Account eligibility and provider usage limits apply.'
    : 'Uses your installed Claude Code or Codex account; provider usage limits apply.'
  const cloudSetup = compareVersions(version, '2.3.0-preview.1') >= 0
    ? '\n\nOptional Google sign-in and Firebase library sync are available in **Cloud library**. The bundled project syncs projects, source metadata, collections, notes, highlights and reading progress. PDF files remain local. Saved conversations stay local until explicitly included (available in pdfpal 2.4 and later). Sign-in alone does not upload your library; create a new cloud library and enable sync explicitly. Cloud and AI settings have also been redesigned. [Cloud setup and supported data](https://github.com/' + repository + '/blob/' + plan.tag + '/docs/firebase-setup.md)'
    : ''
  const conversationSetup = compareVersions(version, '2.4.0-preview.1') >= 0
    ? '\n\nChoose **Cloud library → Include saved conversations** to synchronize existing and future saved PDF/project questions and answers. This upgrades the cloud library; update its other devices to pdfpal 2.4 or later. PDF files, Kindle extension history and interactive visual assets remain local.'
    : ''
  const recoverySetup = compareVersions(version, '2.5.0-preview.1') >= 0
    ? '\n\n**Backups & recovery:** create verified full-library copies, schedule local backups, and Undo recent deletions. Open backups as separate recovery libraries and return to the original. **Privacy:** optional content-free cloud error reports, off by default, with preview/export/removal. **PDF file sync:** separate per-device opt-in and transfer status; the bundled project keeps Storage and billing disabled. [Backup guide](https://github.com/' + repository + '/blob/' + plan.tag + '/docs/backup-recovery.md) · [Error-report privacy](https://github.com/' + repository + '/blob/' + plan.tag + '/docs/error-reports.md)'
    : ''
  const shellSetup = compareVersions(version, '2.6.0-preview.1') >= 0
    ? '\n\n**A new Windows shell:** integrated dark title bar, native Windows caption controls, back/forward reading history, a compact app menu, and a project switcher with **Ctrl+K**. Open settings, cloud, backups, privacy and updates from the app menu (**F10**). The reader keeps its existing behavior and local library.'
    : ''
  const cliSetup = compareVersions(version, '2.7.0-preview.1') >= 0
    ? '\n\n**Manage pdfpal from ChatGPT:** the Windows installer now includes a matching CLI. Open **Command line & ChatGPT** in the app menu to install its skill and check the connection. Local agent sessions can browse projects, import and organize papers, write notes, and undo removals through the running desktop app. Library guards and operation receipts protect against wrong-library writes and duplicate retries; note edits detect concurrent changes. [CLI and skill guide](https://github.com/' + repository + '/blob/' + plan.tag + '/docs/windows-cli.md)'
    : ''
  const readingSetup = compareVersions(version, '2.8.0-beta.1') >= 0
    ? '\n\n**Better context for your questions:** when you ask about a selected passage, the assistant now also receives that page and the pages around it. Long questions keep their most distinctive words when pdfpal searches your papers, and single symbols can be matched. **Send feedback** in the app menu (**F10**) opens a prefilled GitHub issue in your browser with only the pdfpal and Windows versions; nothing is sent automatically.'
    : ''
  const notes = `Windows x64 desktop installer for pdfpal ${version}.\n\nDownload **${filename}** below, run it, and open **pdfpal** from Start. No separate Node.js installation is needed. ${aiSetup}${cloudSetup}${conversationSetup}${recoverySetup}${shellSetup}${cliSetup}${readingSetup}\n\n${manifest.signed ? `Publisher: ${manifest.publisher}.` : '**Unsigned engineering preview:** Windows may show an unknown-publisher or reputation prompt. Intended for testing; fresh-account onboarding and public-beta acceptance remain in progress.'}\n\n[Windows installation guide](https://github.com/${repository}/blob/${plan.tag}/docs/windows-quickstart.md)\n\nThe CLI remains available independently. Quit pdfpal from its tray before upgrading; the installer retains your library.${mac ? macNotes(mac.manifest, repository, plan.tag) : ''}\n\nSource commit: ${commit}\n`
  await fs.writeFile(path.join(directory, 'release-notes.md'), notes)
  const result = { format: 1, ...plan, commit, repository, platforms: mac ? ['win32-x64', 'darwin-arm64'] : ['win32-x64'], requireMac: requireMac === true, assets }
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

/**
 * Publish a complete draft, or verify an already-published release without mutations.
 * Every file in the plan (both platforms when present) goes through the same draft,
 * upload, digest verification and refuse-to-replace rules. `requireMac` (or a plan
 * prepared with it) refuses to publish without the Mac files.
 */
export async function publishRelease(directory, run = command, expected, { requireMac = false } = {}) {
  const saved = JSON.parse(await fs.readFile(path.join(directory, 'release-plan.json'), 'utf8'))
  if (expected && (saved.commit !== expected.commit || saved.repository !== expected.repository || saved.version !== expected.version)) throw new Error('Publication metadata does not match this workflow run')
  const plan = await prepareRelease(directory, { version: saved.version, commit: saved.commit, repository: saved.repository, requireMac: requireMac === true || saved.requireMac === true })
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
    run('gh', ['release', 'create', plan.tag, '--repo', plan.repository, '--target', plan.commit, '--draft', '--title', `pdfpal for ${plan.platforms.includes('darwin-arm64') ? 'Windows and Mac' : 'Windows'} ${plan.version}`, '--notes-file', path.join(directory, 'release-notes.md'), '--latest=false', ...(plan.channel === 'preview' ? ['--prerelease'] : [])])
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
  const args = process.argv.slice(2)
  const flags = args.filter(arg => arg.startsWith('--'))
  const [mode, target] = args.filter(arg => !arg.startsWith('--'))
  if (flags.some(flag => flag !== '--require-mac') || (flags.length && !['prepare', 'publish'].includes(mode))) throw new Error('Usage: node desktop-release.mjs plan | prepare <artifacts> [--require-mac] | publish <artifacts> [--require-mac]')
  const requireMac = flags.includes('--require-mac')
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
    console.log(JSON.stringify(await prepareRelease(path.resolve(target), { version, commit, repository, requireMac }), null, 2))
  } else if (mode === 'publish') {
    const expected = process.env.GITHUB_ACTIONS === 'true' ? { commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY, version: process.env.RELEASE_VERSION } : undefined
    console.log(JSON.stringify(await publishRelease(path.resolve(target), command, expected, { requireMac }), null, 2))
  }
  else throw new Error('Usage: node desktop-release.mjs plan | prepare <artifacts> [--require-mac] | publish <artifacts> [--require-mac]')
}
