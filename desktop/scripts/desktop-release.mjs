import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compareVersions, versionParts } from '../src/updates.mjs'
import { verifyDebianIdentity } from './linux-release.mjs'

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

export async function prepareRelease(directory, { version, commit, repository, sourceDirty = true }) {
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
  const highlightFix = compareVersions(version, '2.8.0-beta.2') >= 0
    ? '\n\n**Fixed: highlights across a page break.** Highlighting text that runs from one page onto the next used to cover the whole first page. It now highlights only the selected text, as one highlight on each page. Highlights already saved with the full-page box keep it; delete and redo them.'
    : ''
  const visualSetup = compareVersions(version, '2.8.0-beta.3') >= 0
    ? '\n\n**Clearer visual explanations:** Explain visually now draws real figures (plots, step-by-step flows, rows of cells, bar charts, side-by-side comparisons and quadrants) in one consistent style, laid out by pdfpal so labels no longer overlap. Each figure builds up step by step; tap the progress bar to move between steps. Answers usually arrive in about a minute, and a failed one says what went wrong. Explanations you already saved open in the new style.\n\n**Related papers load more reliably:** when Semantic Scholar is busy, pdfpal waits and retries, then falls back to OpenAlex, and keeps showing the papers it already found.'
    : ''
  const dictionarySetup = compareVersions(version, '2.8.0-beta.4') >= 0
    ? '\n\n**New: a dictionary in the reader.** Double-click a word in a PDF, or select a short phrase, and its meanings appear under it. It recognises other forms of a word (“ran”, “mice”), hyphenated words and compounds such as “neural network”. It is English only, works offline from a built-in WordNet dictionary, and sends nothing anywhere. Research terms get their everyday meaning, or no card when the dictionary does not list them. Turn it off with **Definitions** in the reader toolbar.'
    : ''
  const notes = `Windows x64 desktop installer for pdfpal ${version}.\n\nDownload **${filename}** below, run it, and open **pdfpal** from Start. No separate Node.js installation is needed. ${aiSetup}${cloudSetup}${conversationSetup}${recoverySetup}${shellSetup}${cliSetup}${readingSetup}${highlightFix}${visualSetup}${dictionarySetup}\n\n${manifest.signed ? `Publisher: ${manifest.publisher}.` : '**Unsigned engineering preview:** Windows may show an unknown-publisher or reputation prompt. Intended for testing; fresh-account onboarding and public-beta acceptance remain in progress.'}\n\n[Windows installation guide](https://github.com/${repository}/blob/${plan.tag}/docs/windows-quickstart.md)\n\nThe CLI remains available independently. Quit pdfpal from its tray before upgrading; the installer retains your library.\n\nSource commit: ${commit}\n`
  await fs.writeFile(path.join(directory, 'release-notes.md'), notes)
  const result = { format: 1, ...plan, commit, repository, sourceDirty: Boolean(sourceDirty), assets }
  await fs.writeFile(path.join(directory, 'release-plan.json'), JSON.stringify(result, null, 2))
  return result
}

async function assetDetails(directory, name) {
  const filename = path.join(directory, name)
  return { name, size: (await fs.stat(filename)).size, sha256: await digest(filename) }
}
function sameAssets(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && expected.every(asset =>
    actual.filter(item => item.name === asset.name && item.size === asset.size && item.sha256 === asset.sha256).length === 1)
}

/** Read-only validation of both native builds; never regenerate integrity metadata here. */
export async function prepareCombinedRelease(directory, expected) {
  const windows = JSON.parse(await fs.readFile(path.join(directory, 'release-plan.json'), 'utf8'))
  const { version, commit, repository } = windows
  if (!validCommit(commit) || !validRepo(repository) || windows.format !== 1 || windows.sourceDirty !== false) throw new Error('Windows build provenance requires a clean full source commit')
  if (expected && (commit !== expected.commit || repository !== expected.repository || version !== expected.version)) throw new Error('Publication metadata does not match this workflow run')
  const plan = releasePlan(version)
  if (windows.tag !== plan.tag || windows.channel !== plan.channel) throw new Error('Windows build version/channel provenance mismatch')
  const windowsName = `pdfpal-Setup-${version}-x64.exe`
  const windowsManifestName = 'pdfpal-desktop-release.json'
  const windowsManifestFile = path.join(directory, windowsManifestName)
  const win = JSON.parse(await fs.readFile(windowsManifestFile, 'utf8'))
  if (win.format !== 1 || win.appId !== 'io.pdfpal.desktop' || win.version !== version || win.platform !== 'win32' || win.arch !== 'x64' ||
      win.installer !== windowsName || typeof win.signed !== 'boolean' || !Number.isSafeInteger(win.size) || win.size <= 0 || !/^[a-f0-9]{64}$/.test(win.sha256 ?? '')) throw new Error('Invalid production installer manifest')
  if (plan.channel === 'stable' && (!win.signed || typeof win.publisher !== 'string' || !win.publisher.trim() || win.publisher.length > 256 || /[\r\n]/.test(win.publisher))) throw new Error('Stable desktop releases require a verified signed build')
  const windowsAssets = await Promise.all([windowsName, windowsManifestName, 'SHA256SUMS.txt'].map(name => assetDetails(directory, name)))
  if (windowsAssets[0].size !== win.size || windowsAssets[0].sha256 !== win.sha256 || !sameAssets(windows.assets, windowsAssets)) throw new Error('Windows build provenance assets do not match the tested native build')
  if (await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8') !== `${win.sha256}  ${windowsName}\n${windowsAssets[1].sha256}  ${windowsManifestName}\n`) throw new Error('Windows checksums do not match the tested native build')

  const linuxName = `pdfpal-${version}-amd64.deb`, linuxManifestName = 'pdfpal-linux-release.json'
  let linux
  try { linux = JSON.parse(await fs.readFile(path.join(directory, linuxManifestName), 'utf8')) }
  catch { throw new Error('A complete Linux build is required for a coordinated desktop release') }
  if (linux.format !== 1 || linux.appId !== 'io.pdfpal.desktop' || linux.version !== version || linux.platform !== 'linux' || linux.arch !== 'x64' ||
      linux.installer !== linuxName || linux.sourceCommit !== commit || linux.sourceDirty !== false || linux.signed !== false || linux.upgrade !== 'manual' ||
      !Number.isSafeInteger(linux.size) || linux.size <= 0 || !/^[a-f0-9]{64}$/.test(linux.sha256 ?? '')) throw new Error('Linux manifest version, source provenance, or package identity mismatch')
  verifyDebianIdentity(command('dpkg-deb', ['--show', '--showformat=${Package}\n${Version}\n${Architecture}', path.join(directory, linuxName)]).split('\n'), version, 'x64')
  const linuxAssets = await Promise.all([linuxName, linuxManifestName, 'SHA256SUMS-linux.txt'].map(name => assetDetails(directory, name)))
  if (linuxAssets[0].size !== linux.size || linuxAssets[0].sha256 !== linux.sha256) throw new Error('Linux installer size or SHA-256 mismatch')
  if (await fs.readFile(path.join(directory, 'SHA256SUMS-linux.txt'), 'utf8') !== `${linux.sha256}  ${linuxName}\n${linuxAssets[1].sha256}  ${linuxManifestName}\n`) throw new Error('Linux checksums do not match the tested native build')
  // What changed is said per version, so the notes of an earlier coordinated release stay as they were published.
  const changes = compareVersions(version, '2.8.0-beta.12') >= 0
    ? '**Changes since 2.8.0-beta.11.** The PDF reader uses the same definition card layout as Contextual Dictionary. The preview shows up to three entries, three meanings per entry and one example per meaning. Choose **Show all meanings** to see every entry and meaning, with all examples. The controls and Wiktionary attribution stay visible as you scroll.'
    : compareVersions(version, '2.8.0-beta.11') >= 0
    ? '**Changes since 2.8.0-beta.10.** PDF definitions now use the same English Wiktionary dictionary and sense-ordering code as Contextual Dictionary. The pack ships with the app for offline lookup from first launch and adds about 58 MiB to the installer. Existing verified contextual model downloads are reused. With Order by context enabled, a lookup that reaches the time limit shows dictionary order. A repeat lookup can use the completed contextual result.'
    : compareVersions(version, '2.8.0-beta.10') >= 0
    ? '**Changes since 2.8.0-beta.9.** In a project’s Sources tab, use **Sort by** to order papers by import date or title in either direction. Each collection, including Unfiled, remembers its own choice on this device. The default is **Newest added**.'
    : compareVersions(version, '2.8.0-beta.9') >= 0
    ? '**Changes since 2.8.0-beta.8.** With Definitions on, selecting one or two words in a PDF opens the offline dictionary. If the lookup finds no entry or fails, choose **Explain** to ask about the selection. Select three or more words for the full action menu, or turn Definitions off to use that menu for any selection.'
    : compareVersions(version, '2.8.0-beta.8') >= 0
    ? '**Changes since 2.8.0-beta.7.** The offline English dictionary can now place definitions that fit your passage first inside each entry. Open **Order by context** in the reader toolbar, then choose **Download and turn on** to get the model and CPU runtime once per user. Libraries share the verified files. Future lookups run locally. The feature is off by default and falls back to WordNet order while loading or when scoring takes too long. The README also includes a reader demo video.'
    : compareVersions(version, '2.8.0-beta.7') >= 0
    ? '**Changes since 2.8.0-beta.6: Share what you read as a post.** From a highlight, a region of a page, the paper as a whole or several highlights, the reader makes an image from the paper\'s own page and a draft text for LinkedIn, X or Instagram. One assistant request writes the words; the image is drawn on your device. The crop is automatic and can be adjusted, and every highlight inside it is shown. On Instagram a post opens as a short carousel, and slides show numbers as numbers: a key number, a study\'s design in tiles, a small comparison table. Quotations are exact, every number must appear in the paper, and each word, value and row can be edited before you copy or save the image, a ZIP of slides or one PDF. Posts stay in the local library and are never synced. Sharing a paper sends more of its text to the assistant you chose than a highlight does; provider eligibility and usage limits apply.'
    : '**Changes since Windows 2.8.0-beta.4:** Linux now has a Debian engineering preview with its bundled authenticated CLI, secure OS-keyring storage and native window frame. Windows and Linux share the compact app menu, settings shortcuts and library controls. Cloud sync preserves one library per Google account and safely restores devices using a legacy library; signing in alone still uploads nothing. Reader/visual explanation documentation, screenshots, privacy, recovery and CLI guidance have been refreshed. This release packages both platforms from the same source revision.'
  const notes = `Windows x64 and Linux x64 desktop packages for pdfpal ${version}.

${changes}

**Windows:** download **${windowsName}**, quit pdfpal from its tray, then run the installer. The local library is retained; no separate Node.js installation is needed. ${win.signed ? `Verified Windows publisher: ${win.publisher}.` : '**Unsigned engineering preview:** Windows may show an unknown-publisher or reputation prompt. Intended for testing; fresh-account onboarding and public-beta acceptance remain in progress.'}

**Linux:** download **${linuxName}**, **pdfpal-linux-release.json** and **SHA256SUMS-linux.txt** into one directory. Run \`sha256sum -c SHA256SUMS-linux.txt\`, quit pdfpal, then install with \`sudo apt install ./${linuxName}\`. The app and bundled CLI need no system Node.js. This is an unsigned, manually updated Debian engineering preview; checksums establish integrity, not publisher trust. AppImage, automatic Linux updates, broad desktop-environment acceptance and fresh-account OAuth/keyring recovery remain outside completed preview acceptance. Back up your library before upgrading.

Both platforms retain the offline reader dictionary, page-context questions, cross-page highlight correction, visual explanations and related-paper fallback shipped in the preceding Windows betas. Optional Google sync, saved-conversation sync and PDF transfers retain their separate opt-ins. Provider eligibility and usage limits apply.

[Windows installation](https://github.com/${repository}/blob/${plan.tag}/docs/windows-quickstart.md) · [Linux installation and limitations](https://github.com/${repository}/blob/${plan.tag}/docs/linux-quickstart.md) · [Cloud setup and recovery](https://github.com/${repository}/blob/${plan.tag}/docs/firebase-setup.md)

The standalone npm CLI version is independent. This desktop release does not change the repository-wide Latest pointer. Engineering prereleases are excluded from the signed stable Windows updater channel.

Source commit: ${commit}
`
  await fs.writeFile(path.join(directory, 'release-notes.md'), notes)
  const result = { format: 1, scope: 'windows-linux', ...plan, commit, repository, sourceDirty: false, assets: [...windowsAssets, ...linuxAssets] }
  await fs.writeFile(path.join(directory, 'coordinated-release-plan.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}

export function verifyRemoteAssets(release, plan) {
  if (!Array.isArray(release.assets) || release.assets.length !== plan.assets.length || new Set(release.assets.map(asset => asset.name)).size !== plan.assets.length) throw new Error('Existing release assets do not match the tested build; refusing to replace them')
  for (const expected of plan.assets) {
    const asset = release.assets?.find(item => item.name === expected.name)
    if (!asset || asset.state !== 'uploaded' || asset.size !== expected.size || asset.digest?.toLowerCase() !== `sha256:${expected.sha256}`) throw new Error('Existing release assets do not match the tested build; refusing to replace them')
  }
  if (release.prerelease !== (plan.channel === 'preview')) throw new Error('Release channel mismatch')
}

/** Publish a complete draft, or verify an already-published release without mutations. */
export async function publishRelease(directory, run = command, expected) {
  const plan = await prepareCombinedRelease(directory, expected)
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
  const sourceRef = () => {
    let ref = api(`git/ref/tags/${plan.tag}`)?.object
    for (let depth = 0; ref?.type === 'tag' && depth < 5; depth++) ref = api(`git/tags/${ref.sha}`)?.object
    return ref
  }
  const ref = sourceRef()
  if (ref && (ref.type !== 'commit' || ref.sha !== plan.commit)) throw new Error('Release tag points to another source commit')
  if (existing) {
    if (!ref && existing.target_commitish !== plan.commit) throw new Error('Draft release targets another source commit')
    if (!existing.draft) {
      if (!ref) throw new Error('Published release has no verified source tag')
      verifyRemoteAssets(existing, plan)
      return { state: 'already-published', url: existing.html_url }
    }
  } else {
    run('gh', ['release', 'create', plan.tag, '--repo', plan.repository, '--target', plan.commit, '--draft', '--title', `pdfpal for Windows and Linux ${plan.version}`, '--notes-file', path.join(directory, 'release-notes.md'), '--latest=false', ...(plan.channel === 'preview' ? ['--prerelease'] : [])])
  }
  // Replacing partial assets is allowed only while the release is still a draft.
  const draft = findRelease()
  if (!draft?.draft || draft.target_commitish !== plan.commit) throw new Error('Expected an unpublished draft for this source commit')
  run('gh', ['release', 'edit', plan.tag, '--repo', plan.repository, '--title', `pdfpal for Windows and Linux ${plan.version}`, '--notes-file', path.join(directory, 'release-notes.md')])
  run('gh', ['release', 'upload', plan.tag, '--repo', plan.repository, ...plan.assets.map(asset => path.join(directory, asset.name)), '--clobber'])
  verifyRemoteAssets(findRelease(), plan)
  run('gh', ['release', 'edit', plan.tag, '--repo', plan.repository, '--draft=false', '--latest=false', `--prerelease=${plan.channel === 'preview'}`])
  const published = findRelease(), publishedRef = sourceRef()
  if (!published || published.draft || publishedRef?.type !== 'commit' || publishedRef.sha !== plan.commit) throw new Error('Published release source tag verification failed')
  verifyRemoteAssets(published, plan)
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
    if (command('git', ['rev-parse', 'HEAD']) !== commit) throw new Error('Windows source commit does not match the actual checkout')
    const sourceDirty = Boolean(command('git', ['status', '--porcelain']))
    if (sourceDirty) throw new Error('Windows release requires a clean source checkout')
    console.log(JSON.stringify(await prepareRelease(path.resolve(target), { version, commit, repository, sourceDirty }), null, 2))
  } else if (mode === 'combine') {
    const expected = { commit: process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? command('git', ['rev-parse', 'HEAD']), repository: process.env.GITHUB_REPOSITORY ?? 'andrepaim/pdfpal', version: process.env.RELEASE_VERSION ?? JSON.parse(await fs.readFile('desktop/version.json', 'utf8')).version }
    console.log(JSON.stringify(await prepareCombinedRelease(path.resolve(target), expected), null, 2))
  } else if (mode === 'publish') {
    const expected = process.env.GITHUB_ACTIONS === 'true' ? { commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY, version: process.env.RELEASE_VERSION } : undefined
    console.log(JSON.stringify(await publishRelease(path.resolve(target), command, expected), null, 2))
  }
  else throw new Error('Usage: node desktop-release.mjs plan | prepare <artifacts> | combine <artifacts> | publish <artifacts>')
}
