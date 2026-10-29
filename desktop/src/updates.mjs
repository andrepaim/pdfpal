export const releasePage = 'https://github.com/andrepaim/pdfpal/releases'
const api = 'https://api.github.com/repos/andrepaim/pdfpal/releases?per_page=100'

export function versionParts(version) {
  if (typeof version !== 'string' || version.length > 80) throw new Error('Invalid desktop version')
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/)
  if (!match || match.slice(1, 4).some(part => Number(part) > 65535) || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) throw new Error('Invalid desktop version')
  return { core: match.slice(1, 4).map(Number), preview: match[4]?.split('.') }
}
export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right)
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return Math.sign(a.core[i] - b.core[i])
  if (!a.preview || !b.preview) return a.preview ? -1 : b.preview ? 1 : 0
  for (let i = 0; i < Math.max(a.preview.length, b.preview.length); i++) {
    const x = a.preview[i], y = b.preview[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}
function assetURL(tag, filename) {
  return `${releasePage}/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`
}
export function verifyRelease(release, manifest) {
  const version = release.tag_name?.replace(/^desktop-v/, '')
  versionParts(version)
  if (release.draft || release.prerelease || release.tag_name !== `desktop-v${version}` || versionParts(version).preview) throw new Error('Not a stable desktop release')
  const filename = `pdfpal-Setup-${version}-x64.exe`
  const asset = release.assets?.find(item => item.name === filename && item.state === 'uploaded')
  if (manifest.format !== 1 || manifest.appId !== 'io.pdfpal.desktop' || manifest.version !== version || manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.signed !== true ||
      typeof manifest.publisher !== 'string' || !manifest.publisher.trim() || manifest.publisher.length > 256 || /[\r\n]/.test(manifest.publisher) ||
      manifest.installer !== filename || !/^[a-f0-9]{64}$/i.test(manifest.sha256 ?? '') ||
      !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || !asset || asset.size !== manifest.size ||
      asset.browser_download_url !== assetURL(release.tag_name, filename) ||
      (asset.digest && asset.digest.toLowerCase() !== `sha256:${manifest.sha256.toLowerCase()}`)) throw new Error('Unverified desktop release')
  return { version, publisher: manifest.publisher, downloadURL: asset.browser_download_url,
    releaseURL: `${releasePage}/tag/${encodeURIComponent(release.tag_name)}`, notes: typeof release.body === 'string' ? release.body.slice(0, 8000) : '', sha256: manifest.sha256, size: manifest.size }
}
async function readJSON(url, request, limit) {
  const response = await request(url, { headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'Update checks are temporarily limited. Try again later.' : 'Could not check for updates. Check your internet connection and try again.')
  if (response.url) {
    const target = new URL(response.url)
    if (target.protocol !== 'https:' || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) throw new Error('Unverified release information')
  }
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Release information is too large')
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new Error('Release information is too large')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
/** User-initiated metadata check only. No automatic downloads, execution, or telemetry. */
export async function checkDesktopUpdates(currentVersion, request = fetch) {
  versionParts(currentVersion)
  try {
    const releases = await readJSON(api, request, 1024 * 1024)
    if (!Array.isArray(releases)) throw new Error('Unverified release information')
    const candidates = releases.filter(release => {
      try { return !release.draft && !release.prerelease && /^desktop-v/.test(release.tag_name) && !versionParts(release.tag_name.slice(9)).preview && release.assets?.some(asset => asset.name === 'pdfpal-desktop-release.json') } catch { return false }
    }).sort((a, b) => compareVersions(b.tag_name.slice(9), a.tag_name.slice(9)))
    for (const release of candidates) {
      const asset = release.assets.find(item => item.name === 'pdfpal-desktop-release.json')
      if (asset.browser_download_url !== assetURL(release.tag_name, asset.name) || asset.state !== 'uploaded') throw new Error('Unverified release information')
      const manifest = await readJSON(asset.browser_download_url, request, 64 * 1024)
      // An unsigned preview must never be promoted by this flow.
      if (manifest.signed !== true) continue
      const verified = verifyRelease(release, manifest)
      return { currentVersion, ...verified, state: compareVersions(verified.version, currentVersion) > 0 ? 'available' : 'current' }
    }
    return { state: 'unpublished', currentVersion }
  } catch (error) {
    return { state: 'error', currentVersion, message: /temporarily limited/.test(error.message) ? error.message : 'Could not verify desktop release information. Check your connection and try again.' }
  }
}
